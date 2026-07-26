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
} from '../../lib/motion-editor/motion-ir.js';
import { applyStaggerDelays } from '../../lib/motion-editor/motion-groups.js';
import { getMotionEditorDevice } from '../../lib/motion-editor/devices.js';
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

const AUTO_KEYFRAME_PROPERTIES = new Set([
  'backgroundColor', 'borderRadius', 'color', 'filter', 'fontSize', 'fontWeight',
  'letterSpacing', 'lineHeight', 'opacity', 'transform', 'translate',
]);

const NO_PERSISTENCE = Object.freeze({
  autosave: false,
  load: async () => [],
  save: async () => {},
});

function requestId(prefix = 'request') {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function animationProperty(property) {
  return String(property || '').replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function patchValuesEqual(first, second) {
  if (typeof first === 'object' || typeof second === 'object') {
    try { return JSON.stringify(first) === JSON.stringify(second); } catch (_) { return false; }
  }
  return String(first ?? '') === String(second ?? '');
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
  const disposedRef = useRef(false);
  const persistenceRef = useRef(persistenceAdapter || NO_PERSISTENCE);
  const [status, setStatus] = useState('loading');
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
  const motionDetailRef = useRef(motionDetail);
  const lastAutoExpandedRef = useRef(null);

  historyRef.current = historyState;
  motionDetailRef.current = motionDetail;
  persistenceRef.current = persistenceAdapter || NO_PERSISTENCE;

  const historyPayload = useCallback((history = historyRef.current) => ({
    sessionId: history.sessionId,
    transactions: history.past.map((item) => ({
      ...item.transaction,
      repairs: item.repairs,
    })),
    patches: sessionHistoryPatches(history),
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
  const historyCount = sessionHistoryCount(historyState);

  useEffect(() => {
    setActiveMotionId((current) => motion.some((item) => item.id === current) ? current : motion[0]?.id || null);
  }, [motion]);

  useEffect(() => setSelectedKeyframe(null), [activeMotionId, selected?.id]);

  useEffect(() => {
    if (!patchError) return undefined;
    const timer = window.setTimeout(() => setPatchError(null), 4500);
    return () => window.clearTimeout(timer);
  }, [patchError]);

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
      setStatus('unhealthy');
      setPatchError('The website stopped responding. Your confirmed changes are safe.');
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
      const saved = sessionHistoryPatches(scoped);
      if (!saved.length) {
        setHistoryReady(true);
        return;
      }
      if (!useV2) {
        send('apply-patches', { patches: saved });
        setHistoryReady(true);
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
      setPendingTransactions(transactionLedgerRef.current.size);
      if (transactionLedgerRef.current.size === 0) setHistoryReady(true);
    }

    function releaseSettled(entries) {
      entries.forEach((entry) => {
        const acknowledged = entry.payload?.transaction || entry.transaction;
        const patches = acknowledged.patches || entry.transaction.patches;
        if (entry.status !== 'committed') {
          if (entry.meta.operation === 'replay') {
            const rejectedIds = new Set(entry.meta.patchIds || []);
            updateHistory((current) => sessionHistoryFromPatches(
              sessionHistoryPatches(current).filter((patch) => !rejectedIds.has(patch.id)),
              { sessionId: current.sessionId },
            ));
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
          return;
        }
        if (entry.meta.operation === 'apply') {
          updateHistory((current) => acknowledgeSessionTransaction(current, acknowledged, {
            sessionId: currentSessionId(runtimeContextRef.current),
            repairs: entry.payload?.repairs,
          }), { persist: true });
        } else if (entry.meta.operation === 'undo') {
          updateHistory((current) => undoSessionHistory(current).history, { persist: true });
        } else if (entry.meta.operation === 'redo') {
          updateHistory((current) => redoSessionHistory(current).history, { persist: true });
        }
        setSaveState('idle');
      });
      setPendingTransactions(transactionLedgerRef.current.size);
      if (transactionLedgerRef.current.size === 0) setHistoryReady(true);
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
        setHistoryReady(false);
        setRuntime(payload);
        if (transactionLedgerRef.current.size) {
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
          setStatus('ready');
          send('set-mode', { mode });
          send('inspect-viewport', {});
          void replayCurrentHistory(false);
        }
      }
      if (type === 'protocol-negotiated') {
        runtimeContextRef.current = { ...runtimeContextRef.current, protocol: MOTION_EDITOR_PROTOCOL_V2 };
        setStatus('ready');
        armHeartbeatTimeout();
        send('set-mode', { mode });
        send('inspect-viewport', {});
        void replayCurrentHistory(true);
      }
      if (type === 'heartbeat' || type === 'runtime-health') {
        armHeartbeatTimeout();
        setStatus('ready');
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
        setPatchError("This change couldn't be applied. The previous value was restored.");
      }
      if (type === 'viewport-motion-changed') {
        setViewportRows(Array.isArray(payload.rows) ? payload.rows : []);
        if (payload.page) setViewportPage(payload.page);
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
  }, [armHeartbeatTimeout, iframeRef, mode, send, updateHistory]);

  useEffect(() => {
    if (status === 'ready') send('set-mode', { mode });
  }, [mode, send, status]);

  useEffect(() => {
    if (status === 'ready') send('set-tool', { tool });
  }, [send, status, tool]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    send('set-timeline-active', { motionId: timelineOpen ? activeMotionId : null });
    return () => send('set-timeline-active', { motionId: null });
  }, [activeMotionId, send, status, timelineOpen]);

  function applyPatches(patches) {
    const changed = patches.filter((patch) => !patchValuesEqual(patch.before, patch.value));
    if (!changed.length) return;
    const groupId = changed.length > 1 ? requestId('group') : null;
    const grouped = changed.map((patch) => groupId ? { ...patch, groupId } : patch);
    const transaction = createTransaction({ patches: grouped, source: activePanel });
    if (runtimeContextRef.current?.protocol === MOTION_EDITOR_PROTOCOL_V2) {
      transactionLedgerRef.current.stage(transaction, { operation: 'apply' });
      setPendingTransactions(transactionLedgerRef.current.size);
      send('apply-transaction', { transaction }, { requestId: transaction.requestId });
      return;
    }
    if (grouped.length === 1) send('apply-patch', { patch: grouped[0] });
    else send('apply-patches', { patches: grouped });
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

  function applyStyle(property, value, before) {
    if (!selected) return;
    const stylePatch = createPatch({ elementId: selected.id, kind: 'style', property, before, value });
    const normalized = animationProperty(property);
    const canKeyframe = autoKeyframe && activeMotion?.capabilities?.keyframes && activeMotion?.editability === 'direct' && AUTO_KEYFRAME_PROPERTIES.has(normalized);
    if (!canKeyframe) {
      applyPatch(stylePatch);
      return;
    }
    const track = activeMotion.tracks.find((item) => animationProperty(item.property) === normalized);
    const existing = track?.keyframes?.find((keyframe) => Math.abs(Number(keyframe.offset) - timelineOffset) < 0.0005);
    applyPatches([stylePatch, createPatch({
      elementId: motionElementId,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${normalized}`,
      before: existing ? keyframeDescriptor(existing, timelineOffset) : { offset: timelineOffset, exists: false },
      value: { offset: timelineOffset, value: String(value), ...(existing?.easing ? { easing: existing.easing } : {}), exists: true },
    })]);
  }

  function applyText(value) {
    if (selected) applyPatch(createPatch({ elementId: selected.id, kind: 'text', before: selected.text, value }));
  }

  function applyAttribute(property, value, before) {
    if (selected) applyPatch(createPatch({ elementId: selected.id, kind: 'attribute', property, before, value }));
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
    const inverse = [...latest.transaction.patches, ...latest.repairs].reverse().map(invertPatch);
    if (runtimeContextRef.current?.protocol === MOTION_EDITOR_PROTOCOL_V2) {
      const transaction = createTransaction({ patches: inverse, source: 'undo' });
      transactionLedgerRef.current.stage(transaction, { operation: 'undo', transactionId: latest.transaction.id });
      setPendingTransactions(transactionLedgerRef.current.size);
      send('rollback-transaction', { transaction }, { requestId: transaction.requestId });
      return;
    }
    send('apply-patches', { patches: inverse });
    updateHistory((current) => undoSessionHistory(current).history, { persist: true });
    setSaveState('idle');
  }

  function redo() {
    if (pendingTransactions) return;
    const next = historyState.future[0];
    if (!next) return;
    const patches = [...next.transaction.patches, ...next.repairs];
    if (runtimeContextRef.current?.protocol === MOTION_EDITOR_PROTOCOL_V2) {
      const transaction = createTransaction({ patches, source: 'redo' });
      transactionLedgerRef.current.stage(transaction, { operation: 'redo', transactionId: next.transaction.id });
      setPendingTransactions(transactionLedgerRef.current.size);
      send('apply-transaction', { transaction }, { requestId: transaction.requestId });
      return;
    }
    send('apply-patches', { patches });
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
    applyPatch(createPatch({
      elementId: motionElementId,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: keyframeDescriptor(resolved.keyframe),
      value: { ...keyframeDescriptor(resolved.keyframe), value: String(value) },
    }));
  }

  function changeKeyframeEasing(selection, easing) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected || resolved.keyframe.easing === easing) return;
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
    if (heartbeatTimeoutRef.current) window.clearTimeout(heartbeatTimeoutRef.current);
    heartbeatTimeoutRef.current = null;
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
  }

  const commands = {
    resetSession,
    changeMode: (nextMode) => {
      if (nextMode === 'preview') void flush().catch(() => null);
      setMode(nextMode);
    },
    changeTool: (nextTool) => setTool(nextTool),
    changeDevice: (nextDevice) => setDeviceId(getMotionEditorDevice(nextDevice).id),
    markRuntimeLoaded: () => setStatus((current) => current === 'ready' ? current : 'bridge'),
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
    applyText,
    applyAttribute,
    applyMotion,
    applyStripEdit,
    applyStagger,
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
    changePlaybackMode,
    toggleAutoKeyframe,
    selectKeyframe: setSelectedKeyframe,
    moveKeyframe,
    duplicateKeyframe,
    deleteKeyframe,
    changeKeyframeEasing,
    changeKeyframeValue,
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
    autoExpandedRowId: lastAutoExpandedRef.current,
    commands,
  };
}
