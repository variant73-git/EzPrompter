'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  command,
  commandV2,
  createPatch,
  invertPatch,
  isRuntimeMessage,
  matchesRuntimeContext,
  MOTION_EDITOR_PROTOCOL,
  MOTION_EDITOR_PROTOCOL_V2,
  removeRejectedPatch,
  storageKey,
  SUPPORTED_MOTION_EDITOR_PROTOCOLS,
} from '../../lib/motion-editor/protocol.js';
import {
  TRANSACTION_LIMITS,
  createTransaction,
  createTransactionLedger,
} from '../../lib/motion-editor/transaction.js';
import {
  buildStripEditPatches,
  motionPlaybackMode,
  normalizeMotionClip,
  trackKeyframeEditable,
} from '../../lib/motion-editor/motion-ir.js';
import {
  analyzeMotionOwnership,
  motionOwnershipForProperties,
  normalizeSemanticProperty,
} from '../../lib/motion-editor/motion-ownership.js';
import {
  buildFinalTargetPatch,
  buildOwnershipHintPatch,
  ownershipHintsFromPatches,
} from '../../lib/motion-editor/retarget-patch.js';
import { applyStaggerDelays } from '../../lib/motion-editor/motion-groups.js';
import { getMotionEditorDevice } from '../../lib/motion-editor/devices.js';
import {
  createResponsiveManifestPatch,
  parseResponsiveManifest,
  responsiveManifestAfterPatches,
  responsivePatchAppliesToDevice,
  responsivePropertyKey,
  responsiveRuntimePatches,
  resolveResponsiveProperty,
  setResponsivePropertyMode,
  setResponsivePropertyValue,
  withResponsiveMetadata,
} from '../../lib/motion-editor/responsive-manifest.js';
import {
  EDIT_STATES,
  createEditState,
  transitionEditState,
} from '../../lib/motion-editor/edit-state-machine.js';
import {
  acknowledgeSessionTransaction,
  createSessionHistory,
  redoSessionHistory,
  scopeSessionHistory,
  sessionHistoryCount,
  sessionHistoryFromPatches,
  sessionHistoryPatches,
  undoSessionHistory,
} from '../../lib/motion-editor/session-history.js';
import {
  RECOVERY_ACTIONS,
  createRecoveryPolicy,
} from '../../lib/motion-editor/recovery-policy.js';
import {
  FAILURE_CLASSES,
  createSanitizedDiagnostic,
} from '../../lib/motion-editor/failure-codes.js';

const AUTO_KEYFRAME_PROPERTIES = new Set([
  'backgroundColor', 'borderRadius', 'color', 'filter', 'fontSize', 'fontWeight',
  'letterSpacing', 'lineHeight', 'opacity', 'transform', 'translate',
]);

const NO_PERSISTENCE = Object.freeze({
  autosave: false,
  load: async () => [],
  save: async () => {},
});

const FAILED_MUTATION_COPY = "This change couldn't be applied. The previous value was restored.";
const RECOVERED_WITH_DISABLED_CONTROL_COPY = 'The website was recovered. One unsupported control was disabled.';

function requestId(prefix = 'request') {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function animationProperty(property) {
  return String(property || '').replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function propertyLabel(property) {
  const labels = {
    backgroundColor: 'Fill',
    borderRadius: 'Radius',
    fontSize: 'Size',
    fontWeight: 'Weight',
    letterSpacing: 'Letter spacing',
    lineHeight: 'Line height',
    translateX: 'X',
    translateY: 'Y',
    scaleX: 'Scale X',
    scaleY: 'Scale Y',
    skewX: 'Skew X',
    skewY: 'Skew Y',
    transformOriginX: 'Origin X',
    transformOriginY: 'Origin Y',
  };
  return labels[property] || `${property[0]?.toUpperCase() || ''}${property.slice(1)}`;
}

function patchValuesEqual(first, second) {
  if (typeof first === 'object' || typeof second === 'object') {
    try { return JSON.stringify(first) === JSON.stringify(second); } catch (_) { return false; }
  }
  return String(first ?? '') === String(second ?? '');
}

function controlUpdateFromPatches(patches, direction = 'forward') {
  const patch = (patches || []).find((candidate) => candidate?.controlId || candidate?.kind === 'control');
  if (!patch) return null;
  return {
    controlId: patch.controlId || patch.property,
    value: direction === 'backward' ? patch.before : patch.value,
  };
}

function keyframeDescriptor(keyframe, offset = keyframe?.offset) {
  if (!keyframe) return { offset: Number(offset) || 0, exists: false };
  return {
    offset: Number(offset) || 0,
    value: String(keyframe.value ?? ''),
    ...(keyframe.easing ? { easing: keyframe.easing } : {}),
    exists: true,
  };
}

function currentSessionId(context) {
  return context?.sessionId || 'motion-lab-session';
}

function loadedHistory(value, sessionId) {
  if (Array.isArray(value)) {
    if (value.length && value.every((item) => Array.isArray(item?.patches) || item?.transaction)) {
      return createSessionHistory({ sessionId, transactions: value });
    }
    return sessionHistoryFromPatches(value, { sessionId });
  }
  if (Array.isArray(value?.transactions)) {
    return createSessionHistory({ sessionId, transactions: value.transactions });
  }
  if (Array.isArray(value?.patches)) return sessionHistoryFromPatches(value.patches, { sessionId });
  return createSessionHistory({ sessionId });
}

function responsivePropertyName(property) {
  if (property === 'text' || String(property).startsWith('attribute.')) return property;
  return normalizeSemanticProperty(property);
}

function responsiveBindingFromPatch(patch) {
  if (!patch || patch.kind === 'responsive') return null;
  const binding = {
    elementId: patch.elementId,
    kind: patch.kind,
    ...(['text', 'svg'].includes(patch.kind) ? {} : { property: patch.property }),
    ...(patch.kind === 'motion' ? { motionId: patch.motionId } : {}),
  };
  if (patch.kind === 'motion' && patch.property === 'retarget.final' && patch.value && typeof patch.value === 'object') {
    binding.valueTemplate = patch.value;
  }
  return binding;
}

function responsiveStoredValue(patch, visibleValue) {
  if (patch?.kind === 'style' && patch.property === 'transform') {
    return { visibleValue, runtimeValue: patch.value };
  }
  return visibleValue;
}

export function createLocalMotionPersistenceAdapter(source, storage = null) {
  const resolveStorage = () => storage || globalThis.localStorage;
  return {
    autosave: false,
    async load() {
      try {
        const parsed = JSON.parse(resolveStorage().getItem(storageKey(source)) || '[]');
        return Array.isArray(parsed) ? parsed : parsed?.patches || parsed?.transactions || [];
      } catch (_) {
        return [];
      }
    },
    async save({ patches }) {
      resolveStorage().setItem(storageKey(source), JSON.stringify(Array.isArray(patches) ? patches : []));
    },
  };
}

export function useNativeMotionController({
  iframeRef: suppliedIframeRef = null,
  persistenceAdapter = NO_PERSISTENCE,
  activePanel = 'properties',
  timelineOpen = false,
} = {}) {
  const internalIframeRef = useRef(null);
  const iframeRef = suppliedIframeRef || internalIframeRef;
  const runtimeContextRef = useRef(null);
  const transactionLedgerRef = useRef(createTransactionLedger());
  const heartbeatTimeoutRef = useRef(null);
  const recoveryTimerRef = useRef(null);
  const recoveryPolicyRef = useRef(createRecoveryPolicy());
  const recoverySequenceRef = useRef(0);
  const pendingControlRecoveryRef = useRef(null);
  const inFlightControlTransactionsRef = useRef(new Map());
  const runtimeRecoverySnapshotRef = useRef(null);
  const runtimeRecoveredRef = useRef(false);
  const recoveryExecutorRef = useRef(null);
  const disposedRef = useRef(false);
  const persistenceRef = useRef(persistenceAdapter || NO_PERSISTENCE);
  const [status, setStatus] = useState('loading');
  const statusRef = useRef(status);
  const [runtime, setRuntime] = useState(null);
  const [mode, setMode] = useState('edit');
  const [tool, setTool] = useState('select');
  const [deviceId, setDeviceId] = useState('desktop');
  const [selected, setSelected] = useState(null);
  const [viewportRows, setViewportRows] = useState([]);
  const [viewportPage, setViewportPage] = useState(null);
  const [historyState, setHistoryState] = useState(() => createSessionHistory());
  const historyRef = useRef(historyState);
  const [speed, setSpeed] = useState(1);
  const [saveState, setSaveState] = useState('idle');
  const [historyReady, setHistoryReady] = useState(false);
  const [patchError, setPatchError] = useState(null);
  const [pendingTransactions, setPendingTransactions] = useState(0);
  const [activeMotionId, setActiveMotionId] = useState(null);
  const [timelineState, setTimelineState] = useState({ currentTime: 0, duration: 1000, playState: 'idle' });
  const [autoKeyframe, setAutoKeyframe] = useState(false);
  const [selectedKeyframe, setSelectedKeyframe] = useState(null);
  const [motionDetail, setMotionDetail] = useState({});
  const [editState, setEditState] = useState(() => createEditState());
  const [selectionSettlement, setSelectionSettlement] = useState(null);
  const [ownershipConflict, setOwnershipConflict] = useState(null);
  const [responsiveManifest, setResponsiveManifest] = useState({});
  const responsiveManifestRef = useRef(responsiveManifest);
  const [controlManifest, setControlManifest] = useState({});
  const controlManifestRef = useRef(controlManifest);
  const [controlAvailability, setControlAvailability] = useState({});
  const [runtimeRecovery, setRuntimeRecovery] = useState(null);
  const [recoveryNotice, setRecoveryNotice] = useState(null);
  const runtimeRecoveryRef = useRef(runtimeRecovery);
  const [pendingResponsiveScopeChange, setPendingResponsiveScopeChange] = useState(null);
  const motionDetailRef = useRef(motionDetail);
  const lastAutoExpandedRef = useRef(null);
  const deviceIdRef = useRef(deviceId);
  const lastResponsiveDeviceRef = useRef(deviceId);
  const selectedRef = useRef(selected);
  const viewportPageRef = useRef(viewportPage);
  const timelineStateRef = useRef(timelineState);
  const activeMotionIdRef = useRef(activeMotionId);
  const modeRef = useRef(mode);
  const toolRef = useRef(tool);

  historyRef.current = historyState;
  motionDetailRef.current = motionDetail;
  persistenceRef.current = persistenceAdapter || NO_PERSISTENCE;
  responsiveManifestRef.current = responsiveManifest;
  controlManifestRef.current = controlManifest;
  deviceIdRef.current = deviceId;
  selectedRef.current = selected;
  viewportPageRef.current = viewportPage;
  timelineStateRef.current = timelineState;
  activeMotionIdRef.current = activeMotionId;
  modeRef.current = mode;
  toolRef.current = tool;
  statusRef.current = status;

  const replaceResponsiveManifest = useCallback((nextManifest) => {
    const parsed = parseResponsiveManifest(nextManifest);
    responsiveManifestRef.current = parsed;
    setResponsiveManifest(parsed);
    return parsed;
  }, []);

  const replaceControlManifest = useCallback((nextManifest) => {
    const parsed = nextManifest && typeof nextManifest === 'object' ? nextManifest : {};
    controlManifestRef.current = parsed;
    setControlManifest(parsed);
    return parsed;
  }, []);

  const updateControlValue = useCallback((controlId, value) => {
    const current = controlManifestRef.current;
    if (!Array.isArray(current?.controls)) return current;
    const next = {
      ...current,
      controls: current.controls.map((control) => (
        control.id === controlId ? { ...control, currentValue: value } : control
      )),
    };
    return replaceControlManifest(next);
  }, [replaceControlManifest]);

  const replaceRecoveredControl = useCallback((nextControl) => {
    if (!nextControl?.id) return controlManifestRef.current;
    const current = controlManifestRef.current;
    if (!Array.isArray(current?.controls)) return current;
    const next = {
      ...current,
      controls: current.controls.map((control) => (
        control.id === nextControl.id ? { ...control, ...nextControl, status: 'ready' } : control
      )),
    };
    return replaceControlManifest(next);
  }, [replaceControlManifest]);

  const setControlRecoveryStatus = useCallback((controlId, recoveryStatus = 'ready', code = null) => {
    if (!controlId) return;
    setControlAvailability((current) => ({
      ...current,
      [controlId]: recoveryStatus === 'ready' ? null : { recoveryStatus, code },
    }));
  }, []);

  const emitRecoveryDiagnostic = useCallback((input) => {
    window.dispatchEvent(new CustomEvent('uncraft:motion-diagnostic', {
      detail: createSanitizedDiagnostic(input),
    }));
  }, []);

  const historyPayload = useCallback((history = historyRef.current) => ({
    sessionId: history.sessionId,
    transactions: history.past.map((item) => ({
      ...item.transaction,
      repairs: item.repairs,
    })),
    patches: sessionHistoryPatches(history),
    responsiveManifest: responsiveManifestRef.current,
    controlManifest: controlManifestRef.current,
  }), []);

  const updateHistory = useCallback((updater, { persist = false } = {}) => {
    const current = historyRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    historyRef.current = next;
    setHistoryState(next);
    if (persist && persistenceRef.current.autosave) {
      void persistenceRef.current.save(historyPayload(next)).catch(() => {
        if (disposedRef.current) return;
        setSaveState('error');
        setPatchError("Your changes couldn't be saved yet. Your confirmed edits are still open.");
      });
    }
    return next;
  }, [historyPayload]);

  const selectedRowId = selected ? (selected.hostRowId || selected.id) : null;
  const motionFromHost = Boolean(selected && selectedRowId && selectedRowId !== selected.id && motionDetail[selectedRowId]);
  const motion = useMemo(() => {
    const own = (selected?.motion || []).map(normalizeMotionClip);
    return motionFromHost ? motionDetail[selectedRowId] : own;
  }, [motionDetail, motionFromHost, selected, selectedRowId]);
  const activeMotion = motion.find((item) => item.id === activeMotionId) || null;
  const motionElementId = motionFromHost ? selectedRowId : selected?.id || null;
  const timelineOffset = useMemo(() => {
    if (!activeMotion) return 0;
    const delay = Math.max(0, activeMotion.timing.delay || 0);
    const duration = Math.max(1, activeMotion.timing.duration || 1);
    return Math.max(0, Math.min(1, (timelineState.currentTime - delay) / duration));
  }, [activeMotion, timelineState.currentTime]);
  const device = getMotionEditorDevice(deviceId);
  const historyPatches = useMemo(() => sessionHistoryPatches(historyState), [historyState]);
  const ownershipHints = useMemo(() => ownershipHintsFromPatches(historyPatches), [historyPatches]);
  const propertyOwnership = useMemo(() => motionOwnershipForProperties({
    motion,
    targetId: motionElementId,
    ownershipHints,
  }), [motion, motionElementId, ownershipHints]);
  const historyCount = sessionHistoryCount(historyState);
  const responsiveDescriptorFor = useCallback((property) => {
    const normalized = responsivePropertyName(property);
    return selected?.responsiveProperties?.[normalized]
      || selected?.responsiveProperties?.[property]
      || selected?.responsive?.properties?.[normalized]
      || selected?.responsive?.properties?.[property]
      || null;
  }, [selected]);
  const responsiveScopeFor = useCallback((property, fallbackValue = null, binding = null) => {
    if (!selected?.id) return null;
    const normalized = responsivePropertyName(property);
    const descriptor = responsiveDescriptorFor(property);
    const propertyKey = responsivePropertyKey(selected.id, normalized);
    const resolved = resolveResponsiveProperty(responsiveManifestRef.current, {
      propertyKey,
      deviceId,
      fallbackValue,
      descriptor,
    });
    return {
      ...resolved,
      binding: resolved.binding || binding,
      property: normalized,
    };
  }, [deviceId, responsiveDescriptorFor, responsiveManifest, selected]);

  const transitionEditor = useCallback((event) => {
    setEditState((current) => transitionEditState(current, event));
  }, []);

  useEffect(() => {
    setActiveMotionId((current) => motion.some((item) => item.id === current) ? current : motion[0]?.id || null);
  }, [motion]);

  useEffect(() => setSelectedKeyframe(null), [activeMotionId, selected?.id]);

  useEffect(() => setOwnershipConflict(null), [selected?.id]);

  useEffect(() => {
    if (!patchError) return undefined;
    const timer = window.setTimeout(() => setPatchError(null), 4500);
    return () => window.clearTimeout(timer);
  }, [patchError]);

  useEffect(() => {
    if (!recoveryNotice) return undefined;
    const timer = window.setTimeout(() => setRecoveryNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [recoveryNotice]);

  useEffect(() => {
    if (autoKeyframe && !(activeMotion?.capabilities?.keyframes && activeMotion?.editability === 'direct')) {
      setAutoKeyframe(false);
    }
  }, [activeMotion, autoKeyframe]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      if (heartbeatTimeoutRef.current) window.clearTimeout(heartbeatTimeoutRef.current);
      if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const adapter = persistenceAdapter || NO_PERSISTENCE;
    const unsubscribe = adapter.subscribe?.((next) => {
      if (disposedRef.current) return;
      if (next.status === 'saving') setSaveState('saving');
      if (next.status === 'saved') setSaveState('saved');
      if (next.status === 'error') {
        setSaveState('error');
        setPatchError("Your changes couldn't be saved yet. Your confirmed edits are still open.");
      }
    });
    return () => {
      unsubscribe?.();
      adapter.dispose?.({ flushPending: true });
    };
  }, [persistenceAdapter]);

  useEffect(() => {
    function flushConfirmedDraft() {
      if (!persistenceRef.current.autosave) return;
      void persistenceRef.current.flush?.({ keepalive: true }).catch(() => null);
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') flushConfirmedDraft();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushConfirmedDraft);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushConfirmedDraft);
    };
  }, []);

  const armHeartbeatTimeout = useCallback(() => {
    if (heartbeatTimeoutRef.current) window.clearTimeout(heartbeatTimeoutRef.current);
    heartbeatTimeoutRef.current = window.setTimeout(() => {
      if (disposedRef.current) return;
      recoveryExecutorRef.current?.({ code: 'bridge_timeout' });
    }, 3500);
  }, []);

  const send = useCallback((type, payload = {}, options = {}) => {
    if (disposedRef.current) return null;
    const context = runtimeContextRef.current;
    const nextRequestId = options.requestId || requestId(type);
    const message = context?.protocol === MOTION_EDITOR_PROTOCOL_V2
      ? commandV2(type, payload, { ...context, requestId: nextRequestId })
      : command(type, payload);
    iframeRef.current?.contentWindow?.postMessage(message, '*');
    return nextRequestId;
  }, [iframeRef]);

  function clearRecoveryTimer() {
    if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = null;
  }

  function disableControl(controlId, code) {
    clearRecoveryTimer();
    if (pendingControlRecoveryRef.current?.controlId === controlId) pendingControlRecoveryRef.current = null;
    setControlRecoveryStatus(controlId, 'unavailable', code);
    emitRecoveryDiagnostic({
      transition: 'control-disabled',
      code,
      controlId,
      operation: RECOVERY_ACTIONS.DISABLE_CONTROL,
      recovered: false,
    });
    if (runtimeRecoveredRef.current) {
      setRecoveryNotice(RECOVERED_WITH_DISABLED_CONTROL_COPY);
      runtimeRecoveredRef.current = false;
      runtimeRecoverySnapshotRef.current = null;
      recoveryPolicyRef.current.recovered({ code, controlId });
    }
    if (!runtimeRecoveryRef.current?.exhausted) setStatus('ready');
  }

  async function beginRuntimeRecovery(failure) {
    clearRecoveryTimer();
    inFlightControlTransactionsRef.current.clear();
    if (heartbeatTimeoutRef.current) window.clearTimeout(heartbeatTimeoutRef.current);
    heartbeatTimeoutRef.current = null;
    emitRecoveryDiagnostic({
      transition: 'failure-detected',
      code: failure.code,
      controlId: failure.controlId,
      operation: RECOVERY_ACTIONS.RELOAD_RUNTIME,
      recovered: false,
    });
    const decision = recoveryPolicyRef.current.runtimeFailure(failure);
    if (decision.action === RECOVERY_ACTIONS.FALLBACK_SNAPSHOT) {
      if (failure.controlId) disableControl(failure.controlId, failure.code);
      const exhausted = {
        requestId: recoverySequenceRef.current,
        attempt: decision.runtimeAttempt,
        code: decision.code,
        exhausted: true,
      };
      runtimeRecoveryRef.current = exhausted;
      setRuntimeRecovery(exhausted);
      setStatus('unavailable');
      setHistoryReady(false);
      setPatchError("This website couldn't be recovered. Your confirmed version is safe.");
      transitionEditor({ type: 'runtime-unavailable', code: decision.code });
      emitRecoveryDiagnostic({
        transition: 'snapshot-restored',
        code: decision.code,
        operation: RECOVERY_ACTIONS.FALLBACK_SNAPSHOT,
        attempt: decision.runtimeAttempt,
        recovered: false,
      });
      return;
    }

    if (!runtimeRecoverySnapshotRef.current) {
      runtimeRecoverySnapshotRef.current = {
        selectionId: selectedRef.current?.id || null,
        scrollY: Number(viewportPageRef.current?.scrollY) || 0,
        activeMotionId: activeMotionIdRef.current || null,
        currentTime: Number(timelineStateRef.current?.currentTime) || 0,
        mode: modeRef.current,
        tool: toolRef.current,
        deviceId: deviceIdRef.current,
      };
    }
    runtimeRecoveryRef.current = {
      preparing: true,
      attempt: decision.runtimeAttempt,
      code: decision.code,
      controlId: failure.controlId || null,
      exhausted: false,
    };
    if (failure.controlId) setControlRecoveryStatus(failure.controlId, 'recovering', failure.code);
    setStatus('recovering');
    setHistoryReady(false);
    emitRecoveryDiagnostic({
      transition: 'recovery-started',
      code: decision.code,
      controlId: failure.controlId,
      operation: RECOVERY_ACTIONS.RELOAD_RUNTIME,
      attempt: decision.runtimeAttempt,
      recovered: false,
    });

    try {
      await persistenceRef.current.save(historyPayload());
      await persistenceRef.current.flush?.();
    } catch (_) {
      // The server's last acknowledged draft remains the safe recovery source.
    }
    if (disposedRef.current) return;
    const request = {
      requestId: ++recoverySequenceRef.current,
      attempt: decision.runtimeAttempt,
      code: decision.code,
      controlId: failure.controlId || null,
      exhausted: false,
    };
    runtimeRecoveryRef.current = request;
    setRuntimeRecovery(request);
  }

  function retryRecoveredControl(nextControl = null) {
    clearRecoveryTimer();
    const pending = pendingControlRecoveryRef.current;
    if (!pending?.controlId || !pending.transaction) return;
    if (nextControl?.id === pending.controlId) replaceRecoveredControl(nextControl);
    const control = nextControl?.id === pending.controlId
      ? nextControl
      : controlManifestRef.current?.controls?.find((candidate) => candidate.id === pending.controlId);
    const patches = pending.transaction.patches.map((patch, index) => ({
      ...patch,
      ...(control?.targets?.[index]?.elementId ? { elementId: control.targets[index].elementId } : {}),
      id: requestId('repair-patch'),
      createdAt: new Date().toISOString(),
    }));
    const transaction = createTransaction({ patches, source: pending.transaction.source });
    pendingControlRecoveryRef.current = { ...pending, transaction, recoveryRequestId: null };
    transactionLedgerRef.current.stage(transaction, {
      operation: 'apply',
      controlUpdate: pending.controlUpdate,
      recoveredControl: true,
      recoveryOperationId: pending.operationId,
    });
    inFlightControlTransactionsRef.current.set(transaction.id, {
      controlId: pending.controlId,
      controlUpdate: pending.controlUpdate,
      transaction,
      operationId: pending.operationId,
    });
    setPendingTransactions(transactionLedgerRef.current.size);
    send('apply-transaction', { transaction }, { requestId: transaction.requestId });
  }

  function executeRecovery(input = {}) {
    const failure = {
      code: input.code || 'unknown_failure',
      controlId: input.controlId || pendingControlRecoveryRef.current?.controlId || null,
      operationId: input.operationId || pendingControlRecoveryRef.current?.operationId || null,
    };
    const decision = recoveryPolicyRef.current.next(failure);
    emitRecoveryDiagnostic({
      transition: 'recovery-step',
      code: decision.code,
      controlId: decision.controlId,
      operation: decision.action,
      attempt: decision.attempt,
      recovered: false,
    });

    if (decision.action === RECOVERY_ACTIONS.RETRY_TRANSPORT) {
      setStatus('recovering');
      clearRecoveryTimer();
      recoveryTimerRef.current = window.setTimeout(() => {
        recoveryTimerRef.current = null;
        send('health-check');
        armHeartbeatTimeout();
      }, decision.delayMs);
      return;
    }
    if (decision.action === RECOVERY_ACTIONS.RELOAD_RUNTIME) {
      if (runtimeRecoveryRef.current?.preparing) return;
      if (runtimeRecoveryRef.current
        && !runtimeRecoveryRef.current.exhausted
        && decision.failureClass === FAILURE_CLASSES.FATAL_RUNTIME) return;
      if (!failure.controlId && inFlightControlTransactionsRef.current.size) {
        const activeControl = inFlightControlTransactionsRef.current.values().next().value;
        const responsibleFailure = {
          code: 'runtime_exception',
          controlId: activeControl.controlId,
          operationId: activeControl.operationId,
        };
        pendingControlRecoveryRef.current = {
          ...activeControl,
          failure: responsibleFailure,
          recoveryRequestId: null,
        };
        setPatchError(FAILED_MUTATION_COPY);
        setControlRecoveryStatus(activeControl.controlId, 'recovering', responsibleFailure.code);
        recoveryPolicyRef.current.next(responsibleFailure);
        void beginRuntimeRecovery(responsibleFailure);
        return;
      }
      void beginRuntimeRecovery(failure);
      return;
    }
    if (decision.action === RECOVERY_ACTIONS.DISABLE_CONTROL) {
      if (failure.controlId) disableControl(failure.controlId, decision.code);
      else void beginRuntimeRecovery(failure);
      return;
    }
    if (!failure.controlId) {
      void beginRuntimeRecovery(failure);
      return;
    }

    setControlRecoveryStatus(failure.controlId, 'recovering', decision.code);
    const recoveryRequestId = send('recover-control', {
      controlId: failure.controlId,
      stage: decision.action,
    });
    if (pendingControlRecoveryRef.current?.controlId === failure.controlId) {
      pendingControlRecoveryRef.current = {
        ...pendingControlRecoveryRef.current,
        failure,
        recoveryRequestId,
      };
    }
    clearRecoveryTimer();
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null;
      executeRecovery(failure);
    }, 1800);
  }

  function restoreRuntimeContext() {
    const snapshot = runtimeRecoverySnapshotRef.current;
    if (!snapshot) return;
    send('set-mode', { mode: snapshot.mode });
    send('set-tool', { tool: snapshot.tool });
    send('scroll-to', { scrollY: snapshot.scrollY });
    if (snapshot.selectionId) send('select-element', { elementId: snapshot.selectionId, deviceId: snapshot.deviceId });
    if (snapshot.activeMotionId) {
      send('set-timeline-active', { motionId: snapshot.activeMotionId });
      send('seek-motion', { motionId: snapshot.activeMotionId, currentTime: snapshot.currentTime });
    }
  }

  function finishRuntimeRecovery() {
    const active = runtimeRecoveryRef.current;
    if (!active || active.exhausted) return;
    restoreRuntimeContext();
    runtimeRecoveryRef.current = null;
    setRuntimeRecovery(null);
    setStatus('ready');
    setHistoryReady(true);
    runtimeRecoveredRef.current = true;
    emitRecoveryDiagnostic({
      transition: 'runtime-reopened',
      code: active.code,
      controlId: active.controlId,
      operation: RECOVERY_ACTIONS.RELOAD_RUNTIME,
      attempt: active.attempt,
      recovered: true,
    });
    const pending = pendingControlRecoveryRef.current;
    if (pending?.controlId) {
      executeRecovery(pending.failure || { code: active.code, controlId: pending.controlId });
      return;
    }
    runtimeRecoveredRef.current = false;
    runtimeRecoverySnapshotRef.current = null;
    recoveryPolicyRef.current.recovered({ code: active.code });
    emitRecoveryDiagnostic({
      transition: 'recovery-succeeded',
      code: active.code,
      operation: RECOVERY_ACTIONS.RELOAD_RUNTIME,
      attempt: active.attempt,
      recovered: true,
    });
  }

  recoveryExecutorRef.current = executeRecovery;

  useEffect(() => {
    if (!selected?.id) return;
    setMotionDetail((current) => ({ ...current, [selected.id]: (selected.motion || []).map(normalizeMotionClip) }));
    const rowId = selected.hostRowId || selected.id;
    lastAutoExpandedRef.current = rowId;
    if (rowId !== selected.id && !motionDetailRef.current[rowId] && status === 'ready') {
      send('describe-element', { elementId: rowId });
    }
  }, [selected, send, status]);

  useEffect(() => {
    async function replayCurrentHistory(useV2) {
      const sessionId = currentSessionId(runtimeContextRef.current);
      let scoped;
      try {
        scoped = scopeSessionHistory(historyRef.current, sessionId);
        if (!scoped.past.length) {
          const loaded = await persistenceRef.current.load();
          if (disposedRef.current || currentSessionId(runtimeContextRef.current) !== sessionId) return;
          if (loaded?.manifest?.responsiveManifest != null) {
            replaceResponsiveManifest(loaded.manifest.responsiveManifest);
          }
          if (loaded?.manifest?.controlManifest != null) {
            replaceControlManifest(loaded.manifest.controlManifest);
          }
          scoped = loadedHistory(loaded, sessionId);
        }
      } catch {
        if (!disposedRef.current) {
          setSaveState('error');
          setPatchError("Your changes couldn't be loaded yet. Please keep this editor open.");
        }
        return;
      }
      updateHistory(scoped);
      const saved = sessionHistoryPatches(scoped).filter((patch) => (
        responsivePatchAppliesToDevice(patch, deviceIdRef.current)
      ));
      const responsivePatches = responsiveRuntimePatches(
        responsiveManifestRef.current,
        deviceIdRef.current,
      );
      if (!useV2) {
        if (saved.length) send('apply-patches', { patches: saved });
        if (responsivePatches.length) send('apply-patches', { patches: responsivePatches });
        setHistoryReady(true);
        if (runtimeRecoveryRef.current && !runtimeRecoveryRef.current.exhausted) finishRuntimeRecovery();
        return;
      }
      for (let index = 0; index < saved.length; index += TRANSACTION_LIMITS.maxPatches) {
        const patches = saved.slice(index, index + TRANSACTION_LIMITS.maxPatches);
        const transaction = createTransaction({ patches, source: 'replay' });
        transactionLedgerRef.current.stage(transaction, {
          operation: 'replay',
          patchIds: patches.map((patch) => patch.id),
        });
        send('apply-transaction', { transaction }, { requestId: transaction.requestId });
      }
      if (responsivePatches.length) {
        const transaction = createTransaction({ patches: responsivePatches, source: 'responsive' });
        transactionLedgerRef.current.stage(transaction, { operation: 'responsive-reconcile' });
        send('apply-transaction', { transaction }, { requestId: transaction.requestId });
      }
      setPendingTransactions(transactionLedgerRef.current.size);
      if (transactionLedgerRef.current.size === 0) {
        setHistoryReady(true);
        if (runtimeRecoveryRef.current && !runtimeRecoveryRef.current.exhausted) finishRuntimeRecovery();
      }
    }

    function releaseSettled(entries) {
      let recoveryReplayFailed = false;
      entries.forEach((entry) => {
        if (entry.meta.controlUpdate?.controlId) {
          inFlightControlTransactionsRef.current.delete(entry.transaction.id);
        }
        const acknowledged = entry.payload?.transaction || entry.transaction;
        const patches = acknowledged.patches || entry.transaction.patches;
        if (entry.status !== 'committed') {
          if (entry.meta.operation === 'replay') {
            if (runtimeRecoveryRef.current && !runtimeRecoveryRef.current.exhausted) {
              recoveryReplayFailed = true;
              if (!runtimeRecoveryRef.current.preparing) {
                void beginRuntimeRecovery({ code: entry.payload?.code || 'replay_failed' });
              }
            } else {
              const rejectedIds = new Set(entry.meta.patchIds || []);
              updateHistory((current) => sessionHistoryFromPatches(
                sessionHistoryPatches(current).filter((patch) => !rejectedIds.has(patch.id)),
                { sessionId: current.sessionId },
              ));
            }
          }
          if (entry.meta.operation === 'undo' || entry.meta.operation === 'redo') {
            window.dispatchEvent(new CustomEvent('uncraft:motion-diagnostic', {
              detail: {
                code: `${entry.meta.operation}_transaction_rejected`,
                operation: entry.meta.operation,
                nodeScoped: true,
              },
            }));
          }
          if (entry.meta.operation === 'apply' && entry.meta.controlUpdate?.controlId) {
            const controlId = entry.meta.controlUpdate.controlId;
            const code = entry.payload?.code || 'transaction_rejected';
            const operationId = entry.meta.recoveryOperationId || entry.transaction.id;
            pendingControlRecoveryRef.current = {
              controlId,
              controlUpdate: entry.meta.controlUpdate,
              transaction: entry.transaction,
              operationId,
              failure: { code, controlId, operationId },
              recoveryRequestId: null,
            };
            setPatchError(FAILED_MUTATION_COPY);
            emitRecoveryDiagnostic({
              transition: 'failure-detected',
              code,
              controlId,
              operation: 'apply-control',
              recovered: false,
            });
            executeRecovery({ code, controlId, operationId });
          }
          return;
        }
        if (entry.meta.responsiveManifest) {
          replaceResponsiveManifest(entry.meta.responsiveManifest);
        }
        if (entry.meta.operation === 'apply') {
          if (entry.meta.controlUpdate) {
            updateControlValue(entry.meta.controlUpdate.controlId, entry.meta.controlUpdate.value);
          }
          updateHistory((current) => acknowledgeSessionTransaction(current, acknowledged, {
            sessionId: currentSessionId(runtimeContextRef.current),
            repairs: entry.payload?.repairs,
          }), { persist: true });
          if (entry.meta.recoveredControl && entry.meta.controlUpdate?.controlId) {
            const controlId = entry.meta.controlUpdate.controlId;
            const failure = pendingControlRecoveryRef.current?.failure || { code: 'transaction_rejected', controlId };
            pendingControlRecoveryRef.current = null;
            setControlRecoveryStatus(controlId, 'ready');
            runtimeRecoveredRef.current = false;
            runtimeRecoverySnapshotRef.current = null;
            recoveryPolicyRef.current.recovered(failure);
            emitRecoveryDiagnostic({
              transition: 'recovery-succeeded',
              code: failure.code,
              controlId,
              operation: 'apply-control',
              recovered: true,
            });
          }
        } else if (entry.meta.operation === 'undo') {
          if (entry.meta.controlUpdate) updateControlValue(entry.meta.controlUpdate.controlId, entry.meta.controlUpdate.value);
          updateHistory((current) => undoSessionHistory(current).history, { persist: true });
        } else if (entry.meta.operation === 'redo') {
          if (entry.meta.controlUpdate) updateControlValue(entry.meta.controlUpdate.controlId, entry.meta.controlUpdate.value);
          updateHistory((current) => redoSessionHistory(current).history, { persist: true });
        }
        setSaveState('idle');
      });
      setPendingTransactions(transactionLedgerRef.current.size);
      if (transactionLedgerRef.current.size === 0) {
        setHistoryReady(!recoveryReplayFailed);
        if (!recoveryReplayFailed && runtimeRecoveryRef.current && !runtimeRecoveryRef.current.exhausted) {
          finishRuntimeRecovery();
        }
      }
    }

    function recordRuntimeTransaction(transaction, repairs = []) {
      updateHistory((current) => {
        const sessionId = currentSessionId(runtimeContextRef.current);
        const scoped = scopeSessionHistory(current, sessionId);
        return acknowledgeSessionTransaction(scoped, transaction, { sessionId, repairs });
      }, { persist: true });
    }

    function onMessage(event) {
      if (disposedRef.current || event.source !== iframeRef.current?.contentWindow || !isRuntimeMessage(event.data)) return;
      const { type, payload = {} } = event.data;
      if (event.data.protocol === MOTION_EDITOR_PROTOCOL_V2) {
        const context = runtimeContextRef.current;
        if (!context || !matchesRuntimeContext(event.data, context, event.origin)) return;
      }
      if (type === 'runtime-ready') {
        if (heartbeatTimeoutRef.current) window.clearTimeout(heartbeatTimeoutRef.current);
        heartbeatTimeoutRef.current = null;
        transitionEditor({ type: 'runtime-ready' });
        setSelectionSettlement(null);
        setHistoryReady(false);
        setRuntime(payload);
        if (transactionLedgerRef.current.size && !runtimeRecoveryRef.current) {
          setPatchError('The website restarted before a change was confirmed. The previous value was restored.');
        }
        transactionLedgerRef.current = createTransactionLedger();
        setPendingTransactions(0);
        const supportsV2 = Array.isArray(payload.supportedProtocols) && payload.supportedProtocols.includes(MOTION_EDITOR_PROTOCOL_V2);
        if (supportsV2) {
          const context = {
            protocol: MOTION_EDITOR_PROTOCOL,
            sessionNonce: payload.sessionNonce,
            runtimeGeneration: payload.runtimeGeneration,
            bundleId: payload.bundleId,
            sessionId: payload.sessionId,
            origin: event.origin,
          };
          runtimeContextRef.current = context;
          updateHistory((current) => scopeSessionHistory(current, currentSessionId(context)));
          setStatus('negotiating');
          const negotiationId = requestId('negotiate');
          iframeRef.current?.contentWindow?.postMessage({
            ...command('negotiate-protocol', { selectedProtocol: MOTION_EDITOR_PROTOCOL_V2 }),
            protocolVersion: MOTION_EDITOR_PROTOCOL,
            supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
            sessionNonce: context.sessionNonce,
            requestId: negotiationId,
            runtimeGeneration: context.runtimeGeneration,
            bundleId: context.bundleId,
            sessionId: context.sessionId,
          }, '*');
        } else {
          runtimeContextRef.current = { protocol: MOTION_EDITOR_PROTOCOL, origin: event.origin, sessionId: 'motion-lab-session' };
          setStatus(runtimeRecoveryRef.current ? 'recovering' : 'ready');
          send('set-mode', { mode });
          send('inspect-viewport', {});
          void replayCurrentHistory(false);
        }
      }
      if (type === 'protocol-negotiated') {
        runtimeContextRef.current = { ...runtimeContextRef.current, protocol: MOTION_EDITOR_PROTOCOL_V2 };
        setStatus(runtimeRecoveryRef.current ? 'recovering' : 'ready');
        armHeartbeatTimeout();
        send('set-mode', { mode });
        send('inspect-viewport', {});
        void replayCurrentHistory(true);
      }
      if (type === 'heartbeat' || type === 'runtime-health') {
        armHeartbeatTimeout();
        if (!runtimeRecoveryRef.current) {
          if (statusRef.current === 'recovering') {
            recoveryPolicyRef.current.recovered({ code: 'bridge_timeout' });
            emitRecoveryDiagnostic({
              transition: 'recovery-succeeded',
              code: 'bridge_timeout',
              operation: RECOVERY_ACTIONS.RETRY_TRANSPORT,
              recovered: true,
            });
          }
          setStatus('ready');
        }
      }
      if (type === 'transaction-committed') {
        const transaction = payload.transaction;
        if (transaction?.id && transactionLedgerRef.current.has(transaction.id)) {
          releaseSettled(transactionLedgerRef.current.settle(transaction.id, 'committed', payload));
        } else if (payload.originatedByRuntime && transaction?.patches?.length) {
          recordRuntimeTransaction(transaction, payload.repairs);
          setSaveState('idle');
        }
        if (payload.element) setSelected(payload.element);
        window.setTimeout(() => send('refresh-inventory'), 80);
      }
      if (type === 'transaction-rejected') {
        if (payload.transactionId && transactionLedgerRef.current.has(payload.transactionId)) {
          releaseSettled(transactionLedgerRef.current.settle(payload.transactionId, 'rejected', payload));
        }
        setPatchError(FAILED_MUTATION_COPY);
      }
      if (type === 'control-recovery-result') {
        const pending = pendingControlRecoveryRef.current;
        if (!pending || payload.controlId !== pending.controlId) return;
        if (pending.recoveryRequestId && event.data.requestId !== pending.recoveryRequestId) return;
        clearRecoveryTimer();
        emitRecoveryDiagnostic({
          transition: payload.recovered ? 'recovery-step' : 'failure-detected',
          code: payload.code || pending.failure?.code,
          controlId: pending.controlId,
          operation: payload.stage || 'recover-control',
          recovered: payload.recovered === true,
        });
        if (payload.recovered === true) retryRecoveredControl(payload.control || null);
        else executeRecovery({
          code: payload.code || pending.failure?.code,
          controlId: pending.controlId,
          operationId: pending.operationId,
        });
      }
      if (type === 'runtime-failure') {
        const activeControl = inFlightControlTransactionsRef.current.values().next().value;
        if (activeControl && !pendingControlRecoveryRef.current) {
          const failure = {
            code: payload.code || 'runtime_exception',
            controlId: activeControl.controlId,
            operationId: activeControl.operationId,
          };
          pendingControlRecoveryRef.current = {
            ...activeControl,
            failure,
            recoveryRequestId: null,
          };
          setPatchError(FAILED_MUTATION_COPY);
          setControlRecoveryStatus(activeControl.controlId, 'recovering', failure.code);
          executeRecovery(failure);
        } else {
          executeRecovery({ code: payload.code || 'runtime_exception' });
        }
      }
      if (type === 'viewport-motion-changed') {
        setViewportRows(Array.isArray(payload.rows) ? payload.rows : []);
        if (payload.page) setViewportPage(payload.page);
      }
      if (type === 'edit-state-changed') {
        const eventByState = {
          [EDIT_STATES.NAVIGATING]: { type: 'scroll-started' },
          [EDIT_STATES.SELECTION_PENDING]: { type: 'select', elementId: payload.selectionId },
          [EDIT_STATES.SETTLING]: {
            type: 'settlement-started',
            elementId: payload.selectionId,
            operationId: payload.operationId,
          },
          [EDIT_STATES.EDITING_FROZEN]: payload.reason
            ? {
              type: 'settlement-skipped',
              elementId: payload.selectionId,
              operationId: payload.operationId,
              reason: payload.reason,
            }
            : {
              type: 'settlement-completed',
              elementId: payload.selectionId,
              operationId: payload.operationId,
              loop: payload.loop,
            },
          [EDIT_STATES.SCRUBBING]: { type: 'scrub-started' },
          [EDIT_STATES.PREVIEWING]: { type: 'preview-started' },
          [EDIT_STATES.RECOVERING]: { type: 'recovery-started', code: payload.code },
          [EDIT_STATES.UNAVAILABLE]: { type: 'runtime-unavailable', code: payload.code },
        };
        const nextEvent = eventByState[payload.state];
        if (nextEvent) transitionEditor(nextEvent);
      }
      if (type === 'selection-settled') {
        setSelectionSettlement({ status: 'settled', ...payload });
      }
      if (type === 'selection-settlement-skipped') {
        setSelectionSettlement({ status: 'skipped', ...payload });
      }
      if (type === 'selection-settlement-recovering') {
        setSelectionSettlement({ status: 'recovering', ...payload });
      }
      if (type === 'element-described' && payload.element?.id) {
        setMotionDetail((current) => ({ ...current, [payload.element.id]: (payload.element.motion || []).map(normalizeMotionClip) }));
      }
      if (type === 'selection-changed' || type === 'patch-applied' || type === 'inline-text-edit-started') {
        setSelected(payload.element || null);
      }
      if (type === 'inline-text-committed') {
        const patch = createPatch({ elementId: payload.elementId, kind: 'text', before: payload.before, value: payload.value });
        recordRuntimeTransaction(createTransaction({ patches: [patch], source: 'runtime-inline-text' }));
        setSelected(payload.element || null);
        setSaveState('idle');
      }
      if (type === 'inventory-changed') {
        setRuntime((current) => current ? { ...current, assets: payload.assets || [], profile: payload.profile || current.profile } : current);
      }
      if (type === 'layout-intent-committed') {
        const patch = {
          ...createPatch({ elementId: payload.elementId, kind: 'style', property: 'translate', before: payload.before, value: payload.value }),
          layoutIntent: { delta: payload.delta, originalRect: payload.originalRect },
        };
        recordRuntimeTransaction(createTransaction({ patches: [patch], source: 'runtime-layout' }));
        setSelected(payload.element || null);
        setSaveState('idle');
      }
      if (type === 'patches-applied' && payload.element) setSelected(payload.element);
      if (type === 'patch-rejected') {
        updateHistory((current) => sessionHistoryFromPatches(
          removeRejectedPatch(sessionHistoryPatches(current), payload.patch),
          { sessionId: current.sessionId },
        ), { persist: true });
        setPatchError(payload.error || 'The change could not be applied.');
      }
      if (type === 'playback-changed' && payload.speed) setSpeed(payload.speed);
      if (type === 'timeline-changed') {
        setTimelineState({
          currentTime: Number(payload.currentTime) || 0,
          duration: Math.max(1, Number(payload.duration) || 1),
          playState: payload.playState || 'idle',
        });
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [armHeartbeatTimeout, iframeRef, mode, replaceControlManifest, replaceResponsiveManifest, send, transitionEditor, updateControlValue, updateHistory]);

  useEffect(() => {
    if (status === 'ready') send('set-mode', { mode });
  }, [mode, send, status]);

  useEffect(() => {
    if (status === 'ready') send('set-tool', { tool });
  }, [send, status, tool]);

  useEffect(() => {
    if (status !== 'ready' || lastResponsiveDeviceRef.current === deviceId) return;
    lastResponsiveDeviceRef.current = deviceId;
    setSelectionSettlement(null);
    const patches = responsiveRuntimePatches(responsiveManifestRef.current, deviceId);
    if (patches.length) {
      if (runtimeContextRef.current?.protocol === MOTION_EDITOR_PROTOCOL_V2) {
        const transaction = createTransaction({ patches, source: 'responsive' });
        transactionLedgerRef.current.stage(transaction, { operation: 'responsive-reconcile' });
        setPendingTransactions(transactionLedgerRef.current.size);
        send('apply-transaction', { transaction }, { requestId: transaction.requestId });
      } else {
        send('apply-patches', { patches });
      }
    }
    send('inspect-viewport', {});
    if (selected?.id) send('select-element', { elementId: selected.id, deviceId });
  }, [deviceId, selected?.id, send, status]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    send('set-timeline-active', { motionId: timelineOpen ? activeMotionId : null });
    return () => send('set-timeline-active', { motionId: null });
  }, [activeMotionId, send, status, timelineOpen]);

  function applyPatches(patches, {
    source = activePanel,
    responsiveManifest: nextResponsiveManifest = null,
    controlUpdate = null,
  } = {}) {
    const changed = patches.filter((patch) => !patchValuesEqual(patch.before, patch.value));
    if (!changed.length) return;
    const groupId = changed.length > 1 ? requestId('group') : null;
    const grouped = changed.map((patch) => groupId ? { ...patch, groupId } : patch);
    const transaction = createTransaction({ patches: grouped, source });
    if (runtimeContextRef.current?.protocol === MOTION_EDITOR_PROTOCOL_V2) {
      transactionLedgerRef.current.stage(transaction, {
        operation: 'apply',
        ...(nextResponsiveManifest ? { responsiveManifest: nextResponsiveManifest } : {}),
        ...(controlUpdate ? { controlUpdate } : {}),
      });
      if (controlUpdate?.controlId) {
        inFlightControlTransactionsRef.current.set(transaction.id, {
          controlId: controlUpdate.controlId,
          controlUpdate,
          transaction,
          operationId: transaction.id,
        });
      }
      setPendingTransactions(transactionLedgerRef.current.size);
      send('apply-transaction', { transaction }, { requestId: transaction.requestId });
      return;
    }
    if (grouped.length === 1) send('apply-patch', { patch: grouped[0] });
    else send('apply-patches', { patches: grouped });
    if (nextResponsiveManifest) replaceResponsiveManifest(nextResponsiveManifest);
    if (controlUpdate) updateControlValue(controlUpdate.controlId, controlUpdate.value);
    updateHistory((current) => {
      const sessionId = currentSessionId(runtimeContextRef.current);
      const scoped = scopeSessionHistory(current, sessionId);
      return acknowledgeSessionTransaction(scoped, transaction, { sessionId });
    }, { persist: true });
    setSaveState('idle');
    window.setTimeout(() => send('refresh-inventory'), 80);
  }

  function applyPatch(patch) {
    applyPatches([patch]);
  }

  function applyResponsiveEdit(property, visibleValue, patches) {
    if (!selected?.id || !patches?.length) return;
    const normalized = responsivePropertyName(property);
    const descriptor = responsiveDescriptorFor(property);
    const propertyKey = responsivePropertyKey(selected.id, normalized);
    const current = parseResponsiveManifest(responsiveManifestRef.current);
    const beforeEntry = current.properties?.[propertyKey] || null;
    const primaryPatch = patches.find((patch) => patch.property !== 'ownership.hint') || patches.at(-1);
    const binding = responsiveBindingFromPatch(primaryPatch);
    const scope = responsiveScopeFor(property, primaryPatch?.before ?? visibleValue, binding);
    if (scope?.mode === 'computed') return;
    let base = current;
    if (!beforeEntry && scope?.mode === 'per-device') {
      base = setResponsivePropertyMode(base, {
        propertyKey,
        mode: 'per-device',
        deviceId,
        visibleValue: primaryPatch?.before ?? visibleValue,
        binding,
        descriptor,
      });
    }
    const next = setResponsivePropertyValue(base, {
      propertyKey,
      deviceId,
      value: responsiveStoredValue(primaryPatch, visibleValue),
      binding,
      descriptor: { ...descriptor, mode: scope?.mode || descriptor?.mode || 'shared' },
      provenance: scope?.provenance,
    });
    const afterEntry = next.properties[propertyKey];
    const responsivePatches = patches.map((patch) => withResponsiveMetadata(patch, {
      propertyKey,
      mode: afterEntry.mode,
      deviceId,
      beforeEntry,
      afterEntry,
    }));
    applyPatches(responsivePatches, { responsiveManifest: next });
  }

  function applyStyle(property, value, before) {
    if (!selected) return;
    const responsiveScope = responsiveScopeFor(property, before);
    if (responsiveScope?.mode === 'computed') return;
    const scopedBefore = responsiveScope?.effectiveValue ?? before;
    const normalized = animationProperty(property);
    const canKeyframe = autoKeyframe && activeMotion?.capabilities?.keyframes && activeMotion?.editability === 'direct' && AUTO_KEYFRAME_PROPERTIES.has(normalized);
    if (canKeyframe) {
      const stylePatch = createPatch({ elementId: selected.id, kind: 'style', property, before: scopedBefore, value });
      const track = activeMotion.tracks.find((item) => animationProperty(item.property) === normalized);
      const existing = track?.keyframes?.find((keyframe) => Math.abs(Number(keyframe.offset) - timelineOffset) < 0.0005);
      applyResponsiveEdit(property, value, [stylePatch, createPatch({
        elementId: motionElementId,
        kind: 'motion',
        motionId: activeMotion.id,
        property: `keyframe.${normalized}`,
        before: existing ? keyframeDescriptor(existing, timelineOffset) : { offset: timelineOffset, exists: false },
        value: { offset: timelineOffset, value: String(value), ...(existing?.easing ? { easing: existing.easing } : {}), exists: true },
      })]);
      return;
    }
    const semanticProperty = normalizeSemanticProperty(property);
    const ownership = propertyOwnership[semanticProperty] || analyzeMotionOwnership({
      motion,
      property: semanticProperty,
      targetId: motionElementId,
      ownershipHint: ownershipHints[semanticProperty],
    });
    // Unsupported = a writer exists but none is retargetable (gsap.from, keyframes
    // tweens, code-only). Never raise the chooser for it — a list with no choice is
    // a dead end (product rule 2026-07-29: no blocking dialog; the field renders
    // disabled with a locked indicator, and the explanation lives in Motion via an
    // explicit focusOwnership click).
    if (ownership.status === 'unsupported') return;
    if (ownership.status === 'ambiguous') {
      const conflict = {
        ...ownership,
        requestId: requestId('ownership'),
        label: propertyLabel(semanticProperty),
        pending: {
          property: semanticProperty,
          value,
          before: scopedBefore,
        },
      };
      setOwnershipConflict(conflict);
      if (ownership.candidates[0]?.motionId) setActiveMotionId(ownership.candidates[0].motionId);
      return;
    }
    const patch = buildFinalTargetPatch({
      elementId: ownership.status === 'owned' ? motionElementId : selected.id,
      property: semanticProperty,
      before: scopedBefore,
      value,
      owner: ownership.owner,
      transform: selected.styles?.transform,
      transformOrigin: selected.styles?.transformOrigin,
    });
    applyResponsiveEdit(property, value, [createPatch(patch)]);
  }

  function focusOwnership(property) {
    const semanticProperty = normalizeSemanticProperty(property);
    const ownership = propertyOwnership[semanticProperty] || analyzeMotionOwnership({
      motion,
      property: semanticProperty,
      targetId: motionElementId,
      ownershipHint: ownershipHints[semanticProperty],
    });
    if (!ownership.candidates.length) return;
    setOwnershipConflict({
      ...ownership,
      requestId: requestId('ownership'),
      label: propertyLabel(semanticProperty),
      pending: null,
    });
    if (ownership.candidates[0]?.motionId) setActiveMotionId(ownership.candidates[0].motionId);
  }

  function chooseOwnership(channelId) {
    if (!ownershipConflict) return;
    const owner = ownershipConflict.candidates.find((candidate) => candidate.channelId === channelId);
    if (!owner?.retargetable) return;
    const property = ownershipConflict.property;
    const patches = [createPatch(buildOwnershipHintPatch({
      elementId: motionElementId,
      property,
      owner,
      before: ownershipHints[property] || null,
    }))];
    if (ownershipConflict.pending) {
      const pending = ownershipConflict.pending;
      patches.push(createPatch(buildFinalTargetPatch({
        elementId: motionElementId,
        property,
        before: pending.before,
        value: pending.value,
        owner,
        transform: selected?.styles?.transform,
        transformOrigin: selected?.styles?.transformOrigin,
      })));
    }
    setActiveMotionId(owner.motionId);
    setOwnershipConflict(null);
    if (ownershipConflict.pending) applyResponsiveEdit(property, ownershipConflict.pending.value, patches);
    else applyPatches(patches);
  }

  function applyText(value) {
    if (!selected) return;
    const scope = responsiveScopeFor('text', selected.text);
    if (scope?.mode === 'computed') return;
    applyResponsiveEdit('text', value, [createPatch({
      elementId: selected.id,
      kind: 'text',
      before: scope?.effectiveValue ?? selected.text,
      value,
    })]);
  }

  function applyAttribute(property, value, before) {
    if (!selected) return;
    const responsiveProperty = `attribute.${property}`;
    const scope = responsiveScopeFor(responsiveProperty, before);
    if (scope?.mode === 'computed') return;
    applyResponsiveEdit(responsiveProperty, value, [createPatch({
      elementId: selected.id,
      kind: 'attribute',
      property,
      before: scope?.effectiveValue ?? before,
      value,
    })]);
  }

  async function persistResponsiveTransaction(transaction, nextManifest) {
    const sessionId = currentSessionId(runtimeContextRef.current);
    const nextHistory = acknowledgeSessionTransaction(
      scopeSessionHistory(historyRef.current, sessionId),
      transaction,
      { sessionId },
    );
    replaceResponsiveManifest(nextManifest);
    updateHistory(nextHistory);
    if (!persistenceRef.current.autosave) return;
    setSaveState('saving');
    try {
      await persistenceRef.current.save(historyPayload(nextHistory));
      await persistenceRef.current.flush?.();
      if (!disposedRef.current) setSaveState('saved');
    } catch (_) {
      if (!disposedRef.current) {
        setSaveState('error');
        setPatchError("Your changes couldn't be saved yet. Your confirmed edits are still open.");
      }
    }
  }

  async function commitResponsiveScopeChange(change, mode) {
    if (!selected?.id || !change) return;
    const normalized = responsivePropertyName(change.property);
    const propertyKey = change.propertyKey || responsivePropertyKey(selected.id, normalized);
    const current = parseResponsiveManifest(responsiveManifestRef.current);
    const beforeEntry = current.properties?.[propertyKey] || null;
    const descriptor = responsiveDescriptorFor(change.property);
    const next = setResponsivePropertyMode(current, {
      propertyKey,
      mode,
      deviceId: change.deviceId || deviceId,
      visibleValue: change.visibleValue,
      binding: change.binding || beforeEntry?.binding || null,
      descriptor,
      provenance: beforeEntry?.provenance || descriptor?.provenance,
    });
    const patch = createResponsiveManifestPatch({
      elementId: selected.id,
      propertyKey,
      before: beforeEntry,
      value: next.properties[propertyKey],
    });
    const transaction = createTransaction({ patches: [patch], source: 'responsive' });
    setPendingResponsiveScopeChange(null);
    await persistResponsiveTransaction(transaction, next);
  }

  function requestResponsiveScopeChange(change) {
    if (!change || !selected?.id) return null;
    const normalized = responsivePropertyName(change.property);
    const propertyKey = change.propertyKey || responsivePropertyKey(selected.id, normalized);
    const scope = responsiveScopeFor(change.property, change.visibleValue, change.binding);
    if (scope?.mode === 'computed') return null;
    const nextChange = {
      ...change,
      property: normalized,
      propertyKey,
      deviceId: change.deviceId || deviceId,
    };
    if (change.action === 'reconnect') {
      return commitResponsiveScopeChange(nextChange, 'shared');
    }
    setPendingResponsiveScopeChange(nextChange);
    return nextChange;
  }

  function confirmResponsiveScopeChange() {
    if (!pendingResponsiveScopeChange) return Promise.resolve(null);
    return commitResponsiveScopeChange(pendingResponsiveScopeChange, 'per-device');
  }

  function cancelResponsiveScopeChange() {
    setPendingResponsiveScopeChange(null);
  }

  function applyMotion(clip, property, value, before) {
    if (!selected || !clip?.id) return;
    applyPatch(createPatch({ elementId: motionElementId, kind: 'motion', motionId: clip.id, property, before, value }));
  }

  function applyStripEdit(row, next) {
    if (!selected || !activeMotion) return;
    const edits = buildStripEditPatches({ motion: activeMotion, row, next });
    if (!edits.length) return;
    applyPatches(edits.map((edit) => createPatch({ elementId: motionElementId, kind: 'motion', motionId: activeMotion.id, ...edit })));
    window.setTimeout(() => send('inspect-viewport'), 60);
  }

  function applyStagger(members, valueMs) {
    if (!selected) return;
    applyPatches(applyStaggerDelays(members, valueMs).map(({ clip, delay }) => createPatch({
      elementId: motionElementId,
      kind: 'motion',
      motionId: clip.id,
      property: 'timing.delay',
      before: clip.timing.delay,
      value: delay,
    })));
  }

  function applyCustomControl(control, value) {
    if (!control?.id || control.status !== 'ready' || controlAvailability[control.id]
      || patchValuesEqual(control.currentValue, value)) return;
    const patches = (control.targets || []).map((target) => ({
      ...createPatch({
        elementId: target.elementId,
        kind: 'control',
        property: control.id,
        before: control.currentValue,
        value,
      }),
      controlId: control.id,
    }));
    if (!patches.length) return;
    applyPatches(patches, {
      source: 'custom-control',
      controlUpdate: { controlId: control.id, value },
    });
  }

  function unlinkMotion(row, linkIds) {
    const patches = (linkIds || []).map((linkId) => createPatch({
      elementId: row.elementId,
      kind: 'motion',
      motionId: linkId,
      property: 'link.detach',
      before: { detached: false },
      value: { detached: true },
    }));
    if (!patches.length) return;
    applyPatches(patches);
    window.setTimeout(() => {
      send('inspect-viewport');
      send('describe-element', { elementId: row.elementId });
    }, 120);
  }

  async function replaceAsset(asset, file) {
    if (asset.kind === 'svg') {
      applyPatch(createPatch({ elementId: asset.elementId, kind: 'svg', before: asset.markup || '', value: await file.text() }));
      return;
    }
    const value = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    if (asset.kind === 'background') {
      applyPatch(createPatch({ elementId: asset.elementId, kind: 'style', property: 'background-image', before: `url("${asset.source}")`, value: `url("${value}")` }));
    } else {
      applyPatch(createPatch({ elementId: asset.elementId, kind: 'attribute', property: asset.property || 'src', before: asset.source, value }));
    }
  }

  function undo() {
    if (pendingTransactions) return;
    const latest = historyState.past.at(-1);
    if (!latest) return;
    const nextResponsiveManifest = responsiveManifestAfterPatches(
      responsiveManifestRef.current,
      latest.transaction.patches,
      'backward',
    );
    const inverse = [...latest.transaction.patches, ...latest.repairs]
      .reverse()
      .map(invertPatch)
      .filter((patch) => responsivePatchAppliesToDevice(patch, deviceId));
    if (runtimeContextRef.current?.protocol === MOTION_EDITOR_PROTOCOL_V2 && inverse.length) {
      const transaction = createTransaction({ patches: inverse, source: 'undo' });
      transactionLedgerRef.current.stage(transaction, {
        operation: 'undo',
        transactionId: latest.transaction.id,
        responsiveManifest: nextResponsiveManifest,
        controlUpdate: controlUpdateFromPatches(latest.transaction.patches, 'backward'),
      });
      setPendingTransactions(transactionLedgerRef.current.size);
      send('rollback-transaction', { transaction }, { requestId: transaction.requestId });
      return;
    }
    if (inverse.length) send('apply-patches', { patches: inverse });
    replaceResponsiveManifest(nextResponsiveManifest);
    const controlUpdate = controlUpdateFromPatches(latest.transaction.patches, 'backward');
    if (controlUpdate) updateControlValue(controlUpdate.controlId, controlUpdate.value);
    updateHistory((current) => undoSessionHistory(current).history, { persist: true });
    setSaveState('idle');
  }

  function redo() {
    if (pendingTransactions) return;
    const next = historyState.future[0];
    if (!next) return;
    const nextResponsiveManifest = responsiveManifestAfterPatches(
      responsiveManifestRef.current,
      next.transaction.patches,
      'forward',
    );
    const patches = [...next.transaction.patches, ...next.repairs]
      .filter((patch) => responsivePatchAppliesToDevice(patch, deviceId));
    if (runtimeContextRef.current?.protocol === MOTION_EDITOR_PROTOCOL_V2 && patches.length) {
      const transaction = createTransaction({ patches, source: 'redo' });
      transactionLedgerRef.current.stage(transaction, {
        operation: 'redo',
        transactionId: next.transaction.id,
        responsiveManifest: nextResponsiveManifest,
        controlUpdate: controlUpdateFromPatches(next.transaction.patches, 'forward'),
      });
      setPendingTransactions(transactionLedgerRef.current.size);
      send('apply-transaction', { transaction }, { requestId: transaction.requestId });
      return;
    }
    if (patches.length) send('apply-patches', { patches });
    replaceResponsiveManifest(nextResponsiveManifest);
    const controlUpdate = controlUpdateFromPatches(next.transaction.patches, 'forward');
    if (controlUpdate) updateControlValue(controlUpdate.controlId, controlUpdate.value);
    updateHistory((current) => redoSessionHistory(current).history, { persist: true });
    setSaveState('idle');
  }

  async function save() {
    setSaveState('saving');
    try {
      await persistenceRef.current.save(historyPayload());
      await persistenceRef.current.flush?.();
      if (disposedRef.current) return;
      setSaveState('saved');
      window.setTimeout(() => { if (!disposedRef.current) setSaveState('idle'); }, 1800);
    } catch (_) {
      if (disposedRef.current) return;
      setSaveState('error');
      setPatchError("Your changes couldn't be saved yet. Your confirmed edits are still open.");
    }
  }

  async function flush() {
    if (!persistenceRef.current.autosave) return null;
    await persistenceRef.current.save(historyPayload());
    return persistenceRef.current.flush?.();
  }

  async function commit(reason = 'exit') {
    setSaveState('saving');
    try {
      await persistenceRef.current.save(historyPayload());
      await persistenceRef.current.flush?.();
      const result = await persistenceRef.current.commit?.({ reason });
      if (!disposedRef.current) setSaveState('saved');
      return result || null;
    } catch (error) {
      if (!disposedRef.current) {
        setSaveState('error');
        setPatchError("Your changes couldn't be saved yet. Your confirmed edits are still open.");
      }
      throw error;
    }
  }

  async function discard() {
    setSaveState('saving');
    try {
      const result = await persistenceRef.current.discard?.();
      if (!disposedRef.current) setSaveState('idle');
      return result || null;
    } catch (error) {
      if (!disposedRef.current) {
        setSaveState('error');
        setPatchError("Your changes couldn't be discarded yet. Keep editing and try again.");
      }
      throw error;
    }
  }

  function playback(action) {
    send('playback', { action, speed, motionId: activeMotionId });
  }

  function changeSpeed(nextSpeed) {
    setSpeed(nextSpeed);
    send('playback', { action: 'speed', speed: nextSpeed, motionId: activeMotionId });
  }

  function selectMotion(motionId) {
    setActiveMotionId(motionId);
  }

  function seekMotion(currentTime) {
    if (!activeMotionId) return;
    setTimelineState((current) => ({ ...current, currentTime, playState: 'paused' }));
    send('seek-motion', { motionId: activeMotionId, currentTime });
  }

  function beginScrub() {
    transitionEditor({ type: 'scrub-started' });
    send('begin-scrub');
  }

  function endScrub() {
    send('end-scrub');
  }

  function changePlaybackMode(nextMode) {
    if (activeMotion) applyMotion(activeMotion, 'timing.playbackMode', nextMode, motionPlaybackMode(activeMotion.timing));
  }

  function toggleAutoKeyframe(nextValue) {
    if (nextValue) playback('pause');
    setAutoKeyframe(nextValue);
  }

  function resolveKeyframe(selection) {
    if (!selection || !activeMotion || selection.motionId !== activeMotion.id) return null;
    const track = activeMotion.tracks.find((item) => item.property === selection.property);
    const keyframe = track?.keyframes?.find((item) => Math.abs(Number(item.offset) - Number(selection.offset)) < 0.0005);
    return track && keyframe ? { track, keyframe } : null;
  }

  function availableKeyframeOffset(track, desiredOffset, ignoredOffset = null) {
    const desired = Math.max(0, Math.min(1, Number(desiredOffset) || 0));
    const occupied = (offset) => track.keyframes.some((keyframe) => (
      Math.abs(Number(keyframe.offset) - offset) < 0.004
      && (ignoredOffset == null || Math.abs(Number(keyframe.offset) - Number(ignoredOffset)) >= 0.0005)
    ));
    if (!occupied(desired)) return desired;
    for (let step = 1; step <= 100; step += 1) {
      const distance = step * 0.01;
      if (desired + distance <= 1 && !occupied(desired + distance)) return desired + distance;
      if (desired - distance >= 0 && !occupied(desired - distance)) return desired - distance;
    }
    return desired;
  }

  function deleteKeyframe(selection) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected) return;
    applyPatch(createPatch({
      elementId: motionElementId,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: keyframeDescriptor(resolved.keyframe),
      value: keyframeDescriptor(null, resolved.keyframe.offset),
    }));
    setSelectedKeyframe(null);
  }

  function duplicateKeyframe(selection, requestedOffset = null) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected) return;
    const defaultStep = Math.max(0.02, Math.min(0.12, 80 / Math.max(1, activeMotion.timing.duration)));
    const preferred = requestedOffset == null
      ? (Number(resolved.keyframe.offset) + defaultStep <= 1 ? Number(resolved.keyframe.offset) + defaultStep : Number(resolved.keyframe.offset) - defaultStep)
      : requestedOffset;
    const offset = availableKeyframeOffset(resolved.track, preferred);
    const existing = resolved.track.keyframes.find((keyframe) => Math.abs(Number(keyframe.offset) - offset) < 0.0005);
    applyPatch(createPatch({
      elementId: motionElementId,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: keyframeDescriptor(existing, offset),
      value: keyframeDescriptor(resolved.keyframe, offset),
    }));
    setSelectedKeyframe({ motionId: activeMotion.id, property: resolved.track.property, offset });
    seekMotion((activeMotion.timing.delay || 0) + offset * Math.max(1, activeMotion.timing.duration));
  }

  function moveKeyframe(selection, requestedOffset) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected) return;
    const sourceOffset = Number(resolved.keyframe.offset) || 0;
    const offset = availableKeyframeOffset(resolved.track, requestedOffset, sourceOffset);
    if (Math.abs(offset - sourceOffset) < 0.0005) return;
    const existing = resolved.track.keyframes.find((keyframe) => Math.abs(Number(keyframe.offset) - offset) < 0.0005);
    applyPatches([
      createPatch({
        elementId: motionElementId,
        kind: 'motion',
        motionId: activeMotion.id,
        property: `keyframe.${resolved.track.property}`,
        before: keyframeDescriptor(resolved.keyframe),
        value: keyframeDescriptor(null, sourceOffset),
      }),
      createPatch({
        elementId: motionElementId,
        kind: 'motion',
        motionId: activeMotion.id,
        property: `keyframe.${resolved.track.property}`,
        before: keyframeDescriptor(existing, offset),
        value: keyframeDescriptor(resolved.keyframe, offset),
      }),
    ]);
    setSelectedKeyframe({ motionId: activeMotion.id, property: resolved.track.property, offset });
    seekMotion((activeMotion.timing.delay || 0) + offset * Math.max(1, activeMotion.timing.duration));
  }

  function changeKeyframeValue(selection, value) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected || String(resolved.keyframe.value) === String(value)) return;
    // The runtime guard would reject this track's step write anyway — refusing
    // here keeps a doomed patch (and its error toast) out of the pipeline.
    if (!trackKeyframeEditable(resolved.track)) return;
    applyPatch(createPatch({
      elementId: motionElementId,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: keyframeDescriptor(resolved.keyframe),
      value: { ...keyframeDescriptor(resolved.keyframe), value: String(value) },
    }));
  }

  // Fase-2: edit the VALUE of one intermediate keyframe entry, addressed by
  // raw entry index (the canonical step address — offsets duplicate on
  // zero-duration entries). Locked steps (frozen-run members, channel locks)
  // are refused here so a doomed patch never round-trips an error toast.
  function changeStepValue(selection, value) {
    if (!selected || !activeMotion || selection?.motionId !== activeMotion.id) return;
    const track = (activeMotion.tracks || []).find((candidate) => candidate.property === selection.property);
    const step = track?.steps?.find((candidate) => candidate.entryIndex === selection.entryIndex);
    if (!track || !step || String(step.value) === String(value)) return;
    if (!step.editable) return;
    applyPatch(createPatch({
      elementId: motionElementId,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframeStep.${track.property}`,
      before: { entryIndex: step.entryIndex, token: step.token, value: String(step.value), exists: true },
      value: { entryIndex: step.entryIndex, token: step.token, value: String(value), exists: true },
    }));
  }

  function changeKeyframeEasing(selection, easing) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected || resolved.keyframe.easing === easing) return;
    if (!trackKeyframeEditable(resolved.track)) return;
    applyPatch(createPatch({
      elementId: motionElementId,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: { ...keyframeDescriptor(resolved.keyframe), easing: resolved.keyframe.easing || null },
      value: { ...keyframeDescriptor(resolved.keyframe), easing },
    }));
  }

  function resetSession() {
    if (runtimeContextRef.current) send('release-edit-state');
    if (heartbeatTimeoutRef.current) window.clearTimeout(heartbeatTimeoutRef.current);
    heartbeatTimeoutRef.current = null;
    clearRecoveryTimer();
    recoveryPolicyRef.current = createRecoveryPolicy();
    pendingControlRecoveryRef.current = null;
    inFlightControlTransactionsRef.current = new Map();
    runtimeRecoverySnapshotRef.current = null;
    runtimeRecoveredRef.current = false;
    runtimeRecoveryRef.current = null;
    runtimeContextRef.current = null;
    transactionLedgerRef.current = createTransactionLedger();
    lastAutoExpandedRef.current = null;
    setStatus('loading');
    setRuntime(null);
    setMode('edit');
    setTool('select');
    setSelected(null);
    setViewportRows([]);
    setViewportPage(null);
    updateHistory(createSessionHistory());
    setSpeed(1);
    setSaveState('idle');
    setHistoryReady(false);
    setPatchError(null);
    setPendingTransactions(0);
    setActiveMotionId(null);
    setTimelineState({ currentTime: 0, duration: 1000, playState: 'idle' });
    setAutoKeyframe(false);
    setSelectedKeyframe(null);
    setMotionDetail({});
    setEditState(createEditState());
    setSelectionSettlement(null);
    setOwnershipConflict(null);
    replaceResponsiveManifest({});
    replaceControlManifest({});
    setControlAvailability({});
    setRuntimeRecovery(null);
    setRecoveryNotice(null);
    setPendingResponsiveScopeChange(null);
    lastResponsiveDeviceRef.current = deviceIdRef.current;
  }

  const commands = {
    resetSession,
    changeMode: (nextMode) => {
      if (nextMode === 'preview') void flush().catch(() => null);
      setMode(nextMode);
    },
    changeTool: (nextTool) => setTool(nextTool),
    changeDevice: (nextDevice) => setDeviceId(getMotionEditorDevice(nextDevice).id),
    markRuntimeLoaded: () => {
      setStatus((current) => current === 'ready' ? current : 'bridge');
      armHeartbeatTimeout();
    },
    reportRuntimeRecoveryFailure: (code = 'runtime_session_unavailable') => beginRuntimeRecovery({
      code,
      controlId: runtimeRecoveryRef.current?.controlId || pendingControlRecoveryRef.current?.controlId || null,
    }),
    send,
    describeElement: (elementId) => send('describe-element', { elementId }),
    selectElement: (elementId) => send('select-element', { elementId }),
    focusElement: (elementId) => send('focus-element', { elementId }),
    scrollTo: (scrollY) => {
      setViewportPage((current) => current ? { ...current, scrollY } : current);
      send('scroll-to', { scrollY });
    },
    scrubIntro: (timeMs) => send('scrub-intro', { timeMs }),
    applyPatches,
    applyStyle,
    requestResponsiveScopeChange,
    confirmResponsiveScopeChange,
    cancelResponsiveScopeChange,
    focusOwnership,
    chooseOwnership,
    clearOwnership: () => setOwnershipConflict(null),
    applyText,
    applyAttribute,
    applyMotion,
    applyStripEdit,
    applyStagger,
    applyCustomControl,
    resetCustomControl: (control) => applyCustomControl(control, control?.originalValue),
    unlinkMotion,
    replaceAsset,
    undo,
    redo,
    save,
    flush,
    commit,
    discard,
    playback,
    changeSpeed,
    selectMotion,
    seekMotion,
    beginScrub,
    endScrub,
    changePlaybackMode,
    toggleAutoKeyframe,
    selectKeyframe: setSelectedKeyframe,
    moveKeyframe,
    duplicateKeyframe,
    deleteKeyframe,
    changeKeyframeEasing,
    changeKeyframeValue,
    changeStepValue,
  };

  return {
    iframeRef,
    status,
    runtime,
    mode,
    tool,
    device,
    selected,
    selectedRowId,
    viewportRows,
    viewportPage,
    historyCount,
    historyPatches,
    canUndo: historyState.past.length > 0,
    canRedo: historyState.future.length > 0,
    speed,
    saveState,
    historyReady,
    patchError,
    pendingTransactions,
    activeMotionId,
    motion,
    activeMotion,
    timelineState,
    timelineOffset,
    autoKeyframe,
    selectedKeyframe,
    motionDetail,
    editState,
    selectionSettlement,
    ownershipHints,
    propertyOwnership,
    ownershipConflict,
    responsiveManifest,
    controlManifest,
    controlAvailability,
    runtimeRecovery,
    recoveryNotice,
    customControls: Array.isArray(controlManifest?.controls)
      ? controlManifest.controls
        .filter((control) => control.status === 'ready')
        .map((control) => {
          const availability = controlAvailability[control.id];
          return {
            ...control,
            disabled: Boolean(availability),
            recoveryStatus: availability?.recoveryStatus || 'ready',
          };
        })
      : [],
    responsiveScopeFor,
    pendingResponsiveScopeChange,
    autoExpandedRowId: lastAutoExpandedRef.current,
    commands,
  };
}
