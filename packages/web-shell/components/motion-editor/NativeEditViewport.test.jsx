import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const changeDevice = vi.fn();
const markRuntimeLoaded = vi.fn();
const resetSession = vi.fn();
const reportRuntimeRecoveryFailure = vi.fn();
const reloadRuntime = vi.fn();
const failRuntime = vi.fn();
const iframeRef = { current: null };
let controllerStatus = 'loading';
let runtimeRecovery = null;
let recoveryNotice = null;
let patchError = null;
let editState = { value: 'navigating' };

vi.mock('./useNativeMotionController.js', () => ({
  useNativeMotionController: vi.fn(() => ({
    iframeRef,
    status: controllerStatus,
    runtimeRecovery,
    recoveryNotice,
    patchError,
    mode: 'edit',
    editState,
    commands: { changeDevice, markRuntimeLoaded, resetSession, reportRuntimeRecoveryFailure, reloadRuntime, failRuntime },
  })),
}));

const { default: NativeEditViewport } = await import('./NativeEditViewport.jsx');

function runtimeResponse(nodeId) {
  return {
    ok: true,
    json: async () => ({
      runtime: {
        url: `https://runtime.uncraft.test/api/runtime/token-${nodeId}/index.html`,
        bundleId: '33333333-3333-4333-8333-333333333333',
        runtimeFingerprint: `sha256:${'a'.repeat(64)}`,
      },
      session: { id: `session-${nodeId}`, baseSnapshotId: `snapshot-${nodeId}`, revision: 0 },
    }),
  };
}

beforeEach(() => {
  changeDevice.mockReset();
  markRuntimeLoaded.mockReset();
  resetSession.mockReset();
  reportRuntimeRecoveryFailure.mockReset();
  reloadRuntime.mockReset();
  failRuntime.mockReset();
  iframeRef.current = null;
  controllerStatus = 'loading';
  runtimeRecovery = null;
  recoveryNotice = null;
  patchError = null;
  editState = { value: 'navigating' };
  vi.stubGlobal('fetch', vi.fn(async (url) => runtimeResponse(String(url).split('/')[3])));
});

afterEach(() => vi.unstubAllGlobals());

describe('NativeEditViewport', () => {
  it('opens one short-lived node-scoped runtime session and keeps the clone sandbox isolated', async () => {
    render(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);

    expect(screen.getByRole('status').textContent).toBe('Please wait — it’ll be worth the wait.');
    await waitFor(() => expect(screen.getByTitle('Native animated website runtime')).toBeTruthy());

    expect(fetch).toHaveBeenCalledWith('/api/nodes/node-a/runtime-session', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    const iframe = screen.getByTitle('Native animated website runtime');
    expect(iframe.getAttribute('src')).toContain('/token-node-a/');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-pointer-lock');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.load(iframe);
    expect(markRuntimeLoaded).toHaveBeenCalledOnce();
  });

  it('flips the sandbox to allow-same-origin only when the runtime session is in lease mode', async () => {
    fetch.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({
        runtime: { url: 'https://abc.rt.localtest.test/api/rt/sess/index.html', mode: 'lease', origin: 'https://abc.rt.localtest.test' },
        session: { id: 'session-lease', baseSnapshotId: 'snap', revision: 0 },
      }),
    }));
    render(<NativeEditViewport nodeId="node-lease" deviceId="desktop" />);
    await waitFor(() => expect(screen.getByTitle('Native animated website runtime')).toBeTruthy());
    const iframe = screen.getByTitle('Native animated website runtime');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-pointer-lock');
  });

  it('in lease mode + connected, renews the lease on the interval and masks on a terminal refusal', async () => {
    const { LEASE_RENEW_INTERVAL_MS } = await import('../../lib/motion-editor/lease-renewal.js');
    vi.useFakeTimers();
    try {
      controllerStatus = 'ready';
      const renewCalls = [];
      fetch.mockImplementation(async (url) => {
        if (String(url).endsWith('/runtime-session')) {
          return { ok: true, json: async () => ({
            runtime: { url: 'https://abc.rt.localtest.test/api/rt/sess/index.html', mode: 'lease', origin: 'https://abc.rt.localtest.test', expiresAt: new Date(Date.now() + 4 * 3.6e6).toISOString() },
            session: { id: 'session-lease', baseSnapshotId: 'snap', revision: 0 },
          }) };
        }
        renewCalls.push(String(url));
        return { ok: false, status: 409, json: async () => ({ error: 'not_renewable' }) };
      });

      render(<NativeEditViewport nodeId="node-lease" deviceId="desktop" />);
      // Descarrega o encadeamento fetch→json do open (várias voltas de
      // microtask) para o modo virar 'lease' e o laço agendar.
      await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS + 10); });

      expect(renewCalls.some((u) => u.endsWith('/runtime-session/renew'))).toBe(true);
      expect(failRuntime).toHaveBeenCalledWith('lease_renew_terminal');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a fixed canonical viewport, clips runtime overlays, and follows device changes', async () => {
    const { rerender } = render(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    const viewport = screen.getByLabelText('Native website editing viewport');
    expect(viewport.dataset.viewportWidth).toBe('1280');
    expect(viewport.dataset.viewportHeight).toBe('800');
    expect(viewport.style.overflow).toBe('hidden');

    rerender(<NativeEditViewport nodeId="node-a" deviceId="tablet" />);
    expect(viewport.dataset.viewportWidth).toBe('768');
    expect(viewport.dataset.viewportHeight).toBe('920');
    expect(changeDevice).toHaveBeenLastCalledWith('tablet');
    await waitFor(() => expect(screen.getByTitle('Native animated website runtime')).toBeTruthy());
  });

  it('keeps two native nodes scoped to separate runtime sessions', async () => {
    render(
      <>
        <NativeEditViewport nodeId="node-a" deviceId="desktop" />
        <NativeEditViewport nodeId="node-b" deviceId="mobile" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTitle('Native animated website runtime')).toHaveLength(2));
    expect(fetch).toHaveBeenCalledWith('/api/nodes/node-a/runtime-session', expect.any(Object));
    expect(fetch).toHaveBeenCalledWith('/api/nodes/node-b/runtime-session', expect.any(Object));
    const sources = screen.getAllByTitle('Native animated website runtime').map((frame) => frame.getAttribute('src'));
    expect(sources[0]).not.toBe(sources[1]);
  });

  it('closes the half-open editor with a non-technical failure when the runtime session cannot open', async () => {
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'not_available' }) });
    const onUnavailable = vi.fn();
    render(<NativeEditViewport nodeId="node-a" deviceId="desktop" onUnavailable={onUnavailable} />);

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith({
      code: 'runtime_session_unavailable',
    }));
    expect(screen.getByRole('alert').textContent).toBe("This website couldn't be opened for editing.");
    expect(screen.queryByTitle('Native animated website runtime')).toBeNull();
  });

  it('reports exhausted runtime recovery once so the canvas can restore its camera and geometry', async () => {
    const onUnavailable = vi.fn();
    const { rerender } = render(
      <NativeEditViewport nodeId="node-a" deviceId="desktop" onUnavailable={onUnavailable} />,
    );
    await waitFor(() => expect(screen.getByTitle('Native animated website runtime')).toBeTruthy());

    controllerStatus = 'unavailable';
    runtimeRecovery = { requestId: 2, attempt: 2, exhausted: true };
    rerender(<NativeEditViewport nodeId="node-a" deviceId="desktop" onUnavailable={onUnavailable} />);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith({ code: 'runtime_recovery_exhausted' }));
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it('reopens a signed runtime automatically and renders only non-technical recovery copy', async () => {
    const { rerender } = render(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    await waitFor(() => expect(screen.getByTitle('Native animated website runtime')).toBeTruthy());
    fetch.mockClear();

    controllerStatus = 'recovering';
    runtimeRecovery = { requestId: 7, attempt: 1, exhausted: false };
    rerender(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith('/api/nodes/node-a/runtime-session', expect.objectContaining({ method: 'POST' }));

    recoveryNotice = 'The website was recovered. One unsupported control was disabled.';
    controllerStatus = 'ready';
    runtimeRecovery = null;
    rerender(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    expect(screen.getByRole('status').textContent).toBe('The website was recovered. One unsupported control was disabled.');
    patchError = "This change couldn't be applied. The previous value was restored.";
    rerender(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    expect(screen.getByRole('alert').textContent).toBe("This change couldn't be applied. The previous value was restored.");
    expect(screen.queryByText(/retry|repair|regenerate/i)).toBeNull();
  });

  it('masks in place on mid-edit failure: no teardown report, iframe unmounted, work message shown', async () => {
    const onUnavailable = vi.fn();
    const { rerender } = render(
      <NativeEditViewport nodeId="node-a" deviceId="desktop" onUnavailable={onUnavailable} />,
    );
    await waitFor(() => expect(screen.getByTitle('Native animated website runtime')).toBeTruthy());

    controllerStatus = 'unavailable';
    runtimeRecovery = { requestId: 2, attempt: 2, exhausted: true };
    editState = { value: 'masked', code: 'runtime_recovery_exhausted' };
    rerender(<NativeEditViewport nodeId="node-a" deviceId="desktop" onUnavailable={onUnavailable} />);

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(/your edits are safe/i)).toBeTruthy();
    expect(screen.queryByTitle('Native animated website runtime')).toBeNull();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('the mask reload button asks the controller to reload the runtime', async () => {
    const { rerender } = render(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    await waitFor(() => expect(screen.getByTitle('Native animated website runtime')).toBeTruthy());

    controllerStatus = 'unavailable';
    runtimeRecovery = { requestId: 2, attempt: 2, exhausted: true };
    editState = { value: 'masked', code: 'x' };
    rerender(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reloadRuntime).toHaveBeenCalledOnce();
  });

  it('keeps the mask up while a reload attempt is in flight (RELOADING renders the mask, button disabled)', async () => {
    const { rerender } = render(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    await waitFor(() => expect(screen.getByTitle('Native animated website runtime')).toBeTruthy());

    controllerStatus = 'recovering';
    runtimeRecovery = { requestId: 3, attempt: 0, exhausted: false };
    editState = { value: 'reloading', code: 'x' };
    rerender(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: /reloading/i }).disabled).toBe(true);
  });

  it('returns a failed automatic reopen to the controller instead of exposing recovery choices', async () => {
    const { rerender } = render(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    await waitFor(() => expect(screen.getByTitle('Native animated website runtime')).toBeTruthy());
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'not_available' }) });

    controllerStatus = 'recovering';
    runtimeRecovery = { requestId: 9, attempt: 1, exhausted: false };
    rerender(<NativeEditViewport nodeId="node-a" deviceId="desktop" />);
    await waitFor(() => expect(reportRuntimeRecoveryFailure).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /retry|repair|regenerate/i })).toBeNull();
  });
});
