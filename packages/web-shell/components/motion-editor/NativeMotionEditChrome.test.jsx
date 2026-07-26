import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const controller = {
  status: 'loading',
  runtime: null,
  selected: null,
  selectedRowId: null,
  viewportRows: [],
  viewportPage: null,
  motionDetail: {},
  motion: [],
  activeMotion: null,
  activeMotionId: null,
  timelineOffset: 0,
  timelineState: { currentTime: 0, duration: 1000, playState: 'idle' },
  speed: 1,
  autoKeyframe: false,
  selectedKeyframe: null,
  pendingTransactions: 0,
  canUndo: false,
  canRedo: false,
  commands: new Proxy({}, { get: () => vi.fn() }),
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
});
