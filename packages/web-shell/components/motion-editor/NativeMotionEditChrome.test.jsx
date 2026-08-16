import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const commit = vi.fn();
const discard = vi.fn();
const changeMode = vi.fn();
const confirmResponsiveScopeChange = vi.fn();
const cancelResponsiveScopeChange = vi.fn();
const controller = {
  status: 'ready',
  runtime: null,
  selected: null,
  selectedRowId: null,
  viewportRows: [],
  viewportPage: null,
  motionDetail: {},
  motion: [],
  activeMotion: null,
  activeMotionId: null,
  mode: 'edit',
  editState: { value: 'navigating', selectionId: null, loop: false },
  selectionSettlement: null,
  timelineOffset: 0,
  timelineState: { currentTime: 0, duration: 1000, playState: 'idle' },
  speed: 1,
  autoKeyframe: false,
  selectedKeyframe: null,
  pendingTransactions: 0,
  saveState: 'idle',
  historyReady: true,
  canUndo: false,
  canRedo: false,
  pendingResponsiveScopeChange: null,
  commands: new Proxy({ commit, discard, changeMode, confirmResponsiveScopeChange, cancelResponsiveScopeChange }, {
    get: (target, property) => target[property] || vi.fn(),
  }),
};

vi.mock('./useNativeMotionController.js', () => ({
  useNativeMotionController: vi.fn(() => controller),
}));

const {
  NativeMotionEditSessionProvider,
  NativeMotionEditTopbarControls,
  nativeMotionEditShellLayout,
} = await import('./NativeMotionEditChrome.jsx');

afterEach(() => {
  controller.mode = 'edit';
  controller.pendingResponsiveScopeChange = null;
  controller.commands.changeMode?.mockClear?.();
  confirmResponsiveScopeChange.mockClear();
  cancelResponsiveScopeChange.mockClear();
  document.body.className = '';
  document.body.removeAttribute('style');
});

describe('NativeMotionEditChrome', () => {
  it('mounts canvas-level chrome only for a native editing session', () => {
    const { rerender } = render(
      <NativeMotionEditSessionProvider active={false} nodeId={null}>
        <div>Canvas</div>
        <NativeMotionEditTopbarControls />
      </NativeMotionEditSessionProvider>,
    );

    expect(screen.queryByLabelText('Website editing sidebar')).toBeNull();
    expect(screen.queryByLabelText('Native website inspector')).toBeNull();

    rerender(
      <NativeMotionEditSessionProvider active nodeId="node-native">
        <div>Canvas</div>
        <NativeMotionEditTopbarControls />
      </NativeMotionEditSessionProvider>,
    );

    expect(screen.getByLabelText('Website editing sidebar')).toBeTruthy();
    expect(screen.getByLabelText('Native website inspector')).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: 'Edit history' })).toBeTruthy();
    expect(document.body.classList.contains('native-motion-editing')).toBe(true);
  });

  it('keeps both panels reserved while adapting the left rail for narrow hosts', () => {
    expect(nativeMotionEditShellLayout(1440)).toEqual({ left: 224, right: 248, bottom: 200 });
    expect(nativeMotionEditShellLayout(820)).toEqual({ left: 176, right: 224, bottom: 200 });
    expect(nativeMotionEditShellLayout(640)).toEqual({ left: 52, right: 216, bottom: 200 });
  });

  it('commits Done and discards Cancel before allowing the canvas to exit', async () => {
    const onCommitted = vi.fn();
    const onDiscarded = vi.fn();
    commit.mockResolvedValue({ snapshot: { id: 'snapshot-2' } });
    discard.mockResolvedValue({ session: { status: 'discarded' } });
    render(
      <NativeMotionEditSessionProvider
        active
        nodeId="node-native"
        onCommitted={onCommitted}
        onDiscarded={onDiscarded}
      >
        <div>Canvas</div>
      </NativeMotionEditSessionProvider>,
    );

    await act(async () => window.dispatchEvent(new CustomEvent('uncraft:editor-action', {
      detail: { nodeId: 'node-native', action: 'save' },
    })));
    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith({ snapshot: { id: 'snapshot-2' } }));

    await act(async () => window.dispatchEvent(new CustomEvent('uncraft:editor-action', {
      detail: { nodeId: 'node-native', action: 'cancel' },
    })));
    await waitFor(() => expect(onDiscarded).toHaveBeenCalledWith({ session: { status: 'discarded' } }));
  });

  it('enters Preview from the edit topbar and leaves only a clear return action visible', () => {
    const { rerender } = render(
      <NativeMotionEditSessionProvider active nodeId="node-native">
        <div>Canvas</div>
        <NativeMotionEditTopbarControls />
      </NativeMotionEditSessionProvider>,
    );

    screen.getByRole('button', { name: 'Preview website' }).click();
    expect(controller.commands.changeMode).toHaveBeenCalledWith('preview');

    controller.mode = 'preview';
    rerender(
      <NativeMotionEditSessionProvider active nodeId="node-native">
        <div>Canvas</div>
        <NativeMotionEditTopbarControls />
      </NativeMotionEditSessionProvider>,
    );

    expect(screen.queryByLabelText('Website editing sidebar')).toBeNull();
    expect(screen.queryByLabelText('Native website inspector')).toBeNull();
    expect(document.body.classList.contains('native-motion-previewing')).toBe(true);
    screen.getByRole('button', { name: 'Back to Edit' }).click();
    expect(controller.commands.changeMode).toHaveBeenLastCalledWith('edit');
  });

  it('mounts the responsive scope confirmation above the editing shell', () => {
    controller.pendingResponsiveScopeChange = {
      property: 'opacity',
      label: 'Opacity',
      deviceId: 'desktop',
      trigger: document.createElement('button'),
    };
    const { unmount } = render(
      <NativeMotionEditSessionProvider active nodeId="node-native">
        <div>Canvas</div>
      </NativeMotionEditSessionProvider>,
    );

    expect(screen.getByRole('dialog', { name: 'Change device scope' })).toBeTruthy();
    screen.getByRole('button', { name: 'Set Desktop-Only' }).click();
    expect(controller.commands.confirmResponsiveScopeChange).toHaveBeenCalled();
    unmount();
  });
});
