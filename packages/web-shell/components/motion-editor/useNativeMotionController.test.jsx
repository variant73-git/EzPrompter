import { StrictMode, createRef } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MOTION_EDITOR_PROTOCOL } from '../../lib/motion-editor/protocol.js';
import {
  createLocalMotionPersistenceAdapter,
  useNativeMotionController,
} from './useNativeMotionController.js';

function runtimeFrame() {
  return { contentWindow: { postMessage: vi.fn() } };
}

function readyMessage(frame, title = 'Fixture') {
  return new MessageEvent('message', {
    source: frame.contentWindow,
    origin: 'https://runtime.uncraft.test',
    data: {
      protocol: MOTION_EDITOR_PROTOCOL,
      source: 'runtime',
      type: 'runtime-ready',
      payload: { title },
    },
  });
}

describe('useNativeMotionController', () => {
  it('isolates two controllers by iframe source and survives React strict mode without duplicate listeners', async () => {
    const firstFrame = runtimeFrame();
    const secondFrame = runtimeFrame();
    const firstRef = createRef();
    const secondRef = createRef();
    firstRef.current = firstFrame;
    secondRef.current = secondFrame;
    const wrapper = ({ children }) => <StrictMode>{children}</StrictMode>;
    const first = renderHook(() => useNativeMotionController({ iframeRef: firstRef }), { wrapper });
    const second = renderHook(() => useNativeMotionController({ iframeRef: secondRef }), { wrapper });

    await act(async () => window.dispatchEvent(readyMessage(firstFrame, 'First')));

    expect(first.result.current.runtime.title).toBe('First');
    expect(first.result.current.status).toBe('ready');
    expect(second.result.current.runtime).toBeNull();
    expect(firstFrame.contentWindow.postMessage.mock.calls.filter(([message]) => message.type === 'inspect-viewport')).toHaveLength(1);
    expect(secondFrame.contentWindow.postMessage).not.toHaveBeenCalled();

    first.unmount();
    await act(async () => window.dispatchEvent(readyMessage(firstFrame, 'Late')));
    expect(firstFrame.contentWindow.postMessage.mock.calls.filter(([message]) => message.type === 'inspect-viewport')).toHaveLength(1);
    second.unmount();
  });

  it('switches devices without creating session history', () => {
    const iframeRef = createRef();
    iframeRef.current = runtimeFrame();
    const { result } = renderHook(() => useNativeMotionController({ iframeRef }));

    expect(result.current.device.id).toBe('desktop');
    expect(result.current.historyCount).toBe(0);
    act(() => result.current.commands.changeDevice('mobile'));
    expect(result.current.device).toMatchObject({ id: 'mobile', width: 390, height: 844 });
    expect(result.current.historyCount).toBe(0);
  });

  it('preserves selection, viewport inspection, timeline, playback, patch, undo, and redo behavior', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const { result } = renderHook(() => useNativeMotionController({ iframeRef }));

    await act(async () => window.dispatchEvent(readyMessage(frame)));
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        origin: 'https://runtime.uncraft.test',
        data: {
          protocol: MOTION_EDITOR_PROTOCOL,
          source: 'runtime',
          type: 'selection-changed',
          payload: { element: { id: 'hero', label: 'Hero', motion: [] } },
        },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        origin: 'https://runtime.uncraft.test',
        data: {
          protocol: MOTION_EDITOR_PROTOCOL,
          source: 'runtime',
          type: 'viewport-motion-changed',
          payload: { rows: [{ elementId: 'hero' }], page: { scrollY: 120, scrollHeight: 2400 } },
        },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        origin: 'https://runtime.uncraft.test',
        data: {
          protocol: MOTION_EDITOR_PROTOCOL,
          source: 'runtime',
          type: 'timeline-changed',
          payload: { currentTime: 250, duration: 1000, playState: 'paused' },
        },
      }));
    });

    expect(result.current.selected.id).toBe('hero');
    expect(result.current.viewportRows).toEqual([{ elementId: 'hero' }]);
    expect(result.current.viewportPage.scrollY).toBe(120);
    expect(result.current.timelineState).toMatchObject({ currentTime: 250, duration: 1000, playState: 'paused' });

    act(() => result.current.commands.playback('play'));
    expect(frame.contentWindow.postMessage.mock.calls.map(([message]) => message.type)).toContain('playback');

    act(() => result.current.commands.applyStyle('opacity', '0.5', '1'));
    expect(result.current.historyCount).toBe(1);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.commands.undo());
    expect(result.current.historyCount).toBe(0);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.commands.redo());
    expect(result.current.historyCount).toBe(1);
    expect(result.current.canRedo).toBe(false);
  });

  it('uses a caller-supplied persistence adapter and keeps localStorage inside the lab adapter', async () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify([{ id: 'patch-1', elementId: 'hero', kind: 'style', property: 'opacity', before: '1', value: '0.5' }])),
      setItem: vi.fn(),
    };
    const adapter = createLocalMotionPersistenceAdapter('/runtime/custom.html', storage);
    const loaded = await adapter.load();
    expect(loaded).toHaveLength(1);

    await adapter.save({ patches: loaded });
    expect(storage.setItem).toHaveBeenCalledWith(
      'uncraft:native-motion-patches:v1:/runtime/custom.html',
      JSON.stringify(loaded),
    );
  });
});
