import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const changeDevice = vi.fn();
const markRuntimeLoaded = vi.fn();
const iframeRef = { current: null };
let controllerStatus = 'loading';

vi.mock('./useNativeMotionController.js', () => ({
  useNativeMotionController: vi.fn(() => ({
    iframeRef,
    status: controllerStatus,
    commands: { changeDevice, markRuntimeLoaded },
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
  iframeRef.current = null;
  controllerStatus = 'loading';
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

  it('reports an unexpected runtime teardown once so the canvas can restore its camera and geometry', async () => {
    const onUnavailable = vi.fn();
    const { rerender } = render(
      <NativeEditViewport nodeId="node-a" deviceId="desktop" onUnavailable={onUnavailable} />,
    );
    await waitFor(() => expect(screen.getByTitle('Native animated website runtime')).toBeTruthy());

    controllerStatus = 'unhealthy';
    rerender(<NativeEditViewport nodeId="node-a" deviceId="desktop" onUnavailable={onUnavailable} />);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith({ code: 'runtime_unavailable' }));
    expect(onUnavailable).toHaveBeenCalledOnce();
  });
});
