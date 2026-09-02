'use client';

import { useEffect, useRef, useState } from 'react';
import { getMotionEditorDevice } from '../../lib/motion-editor/devices.js';
import { EDIT_STATES } from '../../lib/motion-editor/edit-state-machine.js';
import { useNativeMotionEditSession } from './NativeMotionEditChrome.jsx';
import { useNativeMotionController } from './useNativeMotionController.js';
import { LEASE_RENEW_INTERVAL_MS, decideRenewOutcome } from '../../lib/motion-editor/lease-renewal.js';
import RuntimeMask from './RuntimeMask.jsx';
import { toast } from '../Toast.jsx';

const EMPTY_PERSISTENCE = Object.freeze({
  load: async () => [],
  save: async () => {},
});

const LOADING_COPY = 'Please wait — it’ll be worth the wait.';
const UNAVAILABLE_COPY = "This website couldn't be opened for editing.";

function NativeEditViewportRuntime({
  nodeId,
  deviceId = 'desktop',
  onBusyChange,
  onUnavailable,
  controller,
}) {
  const device = getMotionEditorDevice(deviceId);
  const [runtimeUrl, setRuntimeUrl] = useState(null);
  // Modo lease: o iframe carrega da origem PRÓPRIA da sessão (allow-same-origin
  // — as pré-condições host-guard/SW/CSP já shipadas) e valida postMessage
  // pela origem real. Legado: origem opaca (sandbox sem same-origin).
  const [runtimeMode, setRuntimeMode] = useState('legacy');
  const [loadState, setLoadState] = useState('loading');
  const leaseExpiryRef = useRef(0);
  const unavailableRef = useRef(onUnavailable);
  const busyRef = useRef(onBusyChange);
  const unavailableReportedRef = useRef(false);
  unavailableRef.current = onUnavailable;
  busyRef.current = onBusyChange;

  const { iframeRef, status, commands } = controller;

  function reportUnavailable(code) {
    if (unavailableReportedRef.current) return;
    unavailableReportedRef.current = true;
    setLoadState('unavailable');
    busyRef.current?.(false);
    window.dispatchEvent(new CustomEvent('uncraft:native-edit-unavailable', {
      detail: { nodeId, code },
    }));
    unavailableRef.current?.({ code });
  }

  useEffect(() => {
    commands.changeDevice(device.id);
  }, [commands, device.id]);

  // O ESTADO da máquina decide máscara×teardown, não este componente: com o
  // runtime já anunciado neste mount, a exaustão vira MASKED (editor fica de
  // pé, trabalho preservado) e NADA é reportado ao canvas — reportar era
  // exatamente o caminho que desmontava tudo com toast. UNAVAILABLE (falha de
  // ABERTURA, sem trabalho a poupar) mantém o teardown de sempre.
  const machineValue = controller.editState?.value;
  const masked = machineValue === EDIT_STATES.MASKED;
  const reloadingRuntime = machineValue === EDIT_STATES.RELOADING;

  useEffect(() => {
    if (masked || reloadingRuntime) return;
    if (status === 'unavailable' && controller.runtimeRecovery?.exhausted) {
      reportUnavailable('runtime_recovery_exhausted');
    }
  }, [controller.runtimeRecovery?.exhausted, status, masked, reloadingRuntime]);

  useEffect(() => {
    if (masked) busyRef.current?.(false);
  }, [masked]);

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;
    unavailableReportedRef.current = false;
    commands.resetSession?.();
    commands.changeDevice(device.id);
    setLoadState('loading');
    setRuntimeUrl(null);
    busyRef.current?.(true);

    async function openRuntime() {
      try {
        const response = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/runtime-session`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          signal: abortController.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok || !body?.runtime?.url || !body?.session?.id) {
          throw new Error('runtime_session_unavailable');
        }
        // O clone foi refeito e um rascunho de animação do clone anterior ficou
        // para trás. Dizer isso é obrigatório: sem a frase, a pessoa vê o clone
        // novo sem as edições dela e lê como perda de trabalho salvo.
        // A EXISTÊNCIA do aviso já basta: o servidor só o emite quando o
        // rascunho aposentado tinha trabalho dentro. Condicionar à contagem
        // deixava calado justamente o caso em que ela é zero mas a revisão não
        // (rascunho mexido sem transações registradas) — perda silenciosa pela
        // porta dos fundos (Sol).
        const aposentado = body.session.supersededDraft;
        if (aposentado) {
          const quantas = Number(aposentado.edits) || 0;
          toast.error(quantas > 0
            ? `Your unsaved animation edits were made on an earlier clone of this site and could not be carried over (${quantas} change${quantas > 1 ? 's' : ''}).`
            : 'Unsaved animation work from an earlier clone of this site could not be carried over.');
        }
        setRuntimeMode(body.runtime.mode === 'lease' ? 'lease' : 'legacy');
        leaseExpiryRef.current = Date.parse(body.runtime.expiresAt) || 0;
        setRuntimeUrl(body.runtime.url);
        setLoadState('runtime-loading');
      } catch (error) {
        if (!active || error?.name === 'AbortError') return;
        reportUnavailable('runtime_session_unavailable');
      }
    }

    void openRuntime();
    return () => {
      active = false;
      abortController.abort();
      busyRef.current?.(false);
    };
  }, [nodeId]);

  useEffect(() => {
    const recovery = controller.runtimeRecovery;
    if (!recovery?.requestId || recovery.exhausted) return undefined;
    const abortController = new AbortController();
    let active = true;
    unavailableReportedRef.current = false;
    setLoadState('loading');
    setRuntimeUrl(null);
    busyRef.current?.(true);

    async function reopenRuntime() {
      try {
        const response = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/runtime-session`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          signal: abortController.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok || !body?.runtime?.url || !body?.session?.id) {
          throw new Error('runtime_session_unavailable');
        }
        setRuntimeMode(body.runtime.mode === 'lease' ? 'lease' : 'legacy');
        leaseExpiryRef.current = Date.parse(body.runtime.expiresAt) || 0;
        setRuntimeUrl(body.runtime.url);
        setLoadState('runtime-loading');
      } catch (error) {
        if (!active || error?.name === 'AbortError') return;
        busyRef.current?.(false);
        commands.reportRuntimeRecoveryFailure?.('runtime_session_unavailable');
      }
    }

    void reopenRuntime();
    return () => {
      active = false;
      abortController.abort();
    };
  }, [controller.runtimeRecovery?.requestId, nodeId]);

  // Laço de renovação da lease (Task 13): só em modo lease e com o runtime
  // conectado. Estende a lease no servidor SEM trocar URL nem recarregar o
  // iframe — é isto que mata a imagem quebrada às 4h. Auto-agendado: intervalo
  // no sucesso, backoff em falha transiente (continua editando), máscara em
  // recusa TERMINAL ou quando a lease está prestes a vencer (decideRenewOutcome).
  useEffect(() => {
    if (runtimeMode !== 'lease' || status !== 'ready') return undefined;
    let stopped = false;
    let timer = null;
    let failures = 0;

    function schedule(ms) {
      timer = window.setTimeout(renewOnce, ms); // eslint-disable-line no-use-before-define
    }

    async function renewOnce() {
      let outcome;
      try {
        const res = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/runtime-session/renew`, {
          method: 'POST',
          credentials: 'include',
        });
        outcome = decideRenewOutcome({
          ok: res.ok, status: res.status, now: Date.now(),
          expiresAtMs: leaseExpiryRef.current, consecutiveFailures: failures,
        });
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          const next = Date.parse(body?.expiresAt);
          if (Number.isFinite(next)) leaseExpiryRef.current = next;
        }
      } catch {
        outcome = decideRenewOutcome({
          ok: false, status: 0, now: Date.now(),
          expiresAtMs: leaseExpiryRef.current, consecutiveFailures: failures,
        });
      }
      if (stopped) return;
      if (outcome.action === 'ok') { failures = 0; schedule(LEASE_RENEW_INTERVAL_MS); }
      else if (outcome.action === 'backoff') { failures += 1; schedule(outcome.delayMs); }
      else commands.failRuntime?.(`lease_renew_${outcome.reason}`);
    }

    schedule(LEASE_RENEW_INTERVAL_MS);
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [runtimeMode, status, nodeId]);

  return (
    <div
      aria-label={controller.mode === 'preview' ? 'Native website preview' : 'Native website editing viewport'}
      data-edit-state={controller.editState?.value || 'navigating'}
      data-previewing={controller.mode === 'preview' || undefined}
      data-viewport-width={device.width}
      data-viewport-height={device.height}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#191917',
      }}
    >
      {masked ? (
        // Terminal: iframe DESMONTADO de propósito — mata o JS e a rede do
        // documento morto; um Reload monta um documento FRESCO de URL nova.
        <RuntimeMask onReload={() => commands.reloadRuntime?.()} />
      ) : loadState === 'unavailable' ? (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: '#F1F0EB',
            font: '500 13px/1.4 var(--font-inter), Inter, sans-serif',
          }}
        >
          {UNAVAILABLE_COPY}
        </div>
      ) : runtimeUrl ? (
        <>
          <iframe
            ref={iframeRef}
            title="Native animated website runtime"
            src={runtimeUrl}
            sandbox={runtimeMode === 'lease' ? 'allow-scripts allow-same-origin allow-pointer-lock' : 'allow-scripts allow-pointer-lock'}
            referrerPolicy="no-referrer"
            onLoad={() => {
              setLoadState('ready');
              busyRef.current?.(false);
              commands.markRuntimeLoaded();
            }}
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              border: 0,
              background: '#191917',
            }}
          />
          {status !== 'ready' && (
            <div
              role="status"
              aria-live="polite"
              style={{
                // The runtime iframe paints the SITE's own background while
                // GSAP boots and the bridge negotiates — a long stretch with
                // zero feedback. Darken the stage and keep the process's
                // existing message up until the runtime announces ready.
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                padding: 24,
                textAlign: 'center',
                background: 'rgba(15, 15, 14, 0.78)',
                color: '#F1F0EB',
                font: '500 14px/1.5 var(--font-inter), Inter, sans-serif',
                pointerEvents: 'none',
              }}
            >
              {LOADING_COPY}
            </div>
          )}
          {controller.recoveryNotice && (
            <div
              role="status"
              aria-live="polite"
              style={{
                position: 'absolute',
                left: '50%',
                bottom: 16,
                transform: 'translateX(-50%)',
                maxWidth: 'calc(100% - 32px)',
                padding: '8px 11px',
                borderRadius: 8,
                background: 'rgba(25, 25, 23, 0.92)',
                color: '#F1F0EB',
                font: '500 12px/1.4 var(--font-inter), Inter, sans-serif',
              }}
            >
              {controller.recoveryNotice}
            </div>
          )}
          {controller.patchError && (
            <div
              role="alert"
              style={{
                position: 'absolute',
                left: '50%',
                bottom: controller.recoveryNotice ? 58 : 16,
                transform: 'translateX(-50%)',
                maxWidth: 'calc(100% - 32px)',
                padding: '8px 11px',
                borderRadius: 8,
                background: 'rgba(71, 34, 31, 0.94)',
                color: '#F1F0EB',
                font: '500 12px/1.4 var(--font-inter), Inter, sans-serif',
              }}
            >
              {controller.patchError}
            </div>
          )}
          {reloadingRuntime && (
            // Durante o reload o iframe PRECISA estar montado (é ele que carrega
            // a URL nova e anuncia ready) — a máscara fica por cima, desarmada.
            <RuntimeMask reloading onReload={() => {}} />
          )}
        </>
      ) : reloadingRuntime ? (
        <RuntimeMask reloading onReload={() => {}} />
      ) : (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: '#B5B3AC',
            font: '500 13px/1.4 var(--font-inter), Inter, sans-serif',
          }}
        >
          {LOADING_COPY}
        </div>
      )}
    </div>
  );
}

function StandaloneNativeEditViewport(props) {
  const controller = useNativeMotionController({
    persistenceAdapter: EMPTY_PERSISTENCE,
  });
  return <NativeEditViewportRuntime {...props} controller={controller} />;
}

export default function NativeEditViewport(props) {
  const session = useNativeMotionEditSession();
  if (session?.controller) {
    return <NativeEditViewportRuntime {...props} controller={session.controller} />;
  }
  return <StandaloneNativeEditViewport {...props} />;
}
