'use client';

import { useEffect, useRef, useState } from 'react';
import { getMotionEditorDevice } from '../../lib/motion-editor/devices.js';
import { useNativeMotionEditSession } from './NativeMotionEditChrome.jsx';
import { useNativeMotionController } from './useNativeMotionController.js';

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
  const [loadState, setLoadState] = useState('loading');
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

  useEffect(() => {
    if (status === 'unhealthy') reportUnavailable('runtime_unavailable');
  }, [status]);

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
      {loadState === 'unavailable' ? (
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
        <iframe
          ref={iframeRef}
          title="Native animated website runtime"
          src={runtimeUrl}
          sandbox="allow-scripts allow-pointer-lock"
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
