import { StrictMode, createRef } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  MOTION_EDITOR_PROTOCOL,
  MOTION_EDITOR_PROTOCOL_V2,
  SUPPORTED_MOTION_EDITOR_PROTOCOLS,
} from '../../lib/motion-editor/protocol.js';
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

const V2_CONTEXT = {
  sessionNonce: 'nonce-123456789',
  runtimeGeneration: 1,
  bundleId: 'bundle-native',
  sessionId: 'session-native',
};

function runtimeV2Message(frame, type, payload = {}, requestId = `runtime-${type}`, context = V2_CONTEXT) {
  return new MessageEvent('message', {
    source: frame.contentWindow,
    origin: 'https://runtime.uncraft.test',
    data: {
      protocol: MOTION_EDITOR_PROTOCOL_V2,
      protocolVersion: MOTION_EDITOR_PROTOCOL_V2,
      supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
      source: 'runtime',
      type,
      requestId,
      ...context,
      payload,
    },
  });
}

function customControl(overrides = {}) {
  return {
    id: 'control-aaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'ready',
    scope: 'animation',
    label: 'Depth',
    description: 'Controls depth.',
    controlType: 'slider-number',
    unit: 'multiplier',
    currentValue: 1,
    originalValue: 1,
    domain: { min: 0, max: 2, step: 0.1 },
    binding: { kind: 'custom-capability', capability: 'motion.scalar', property: 'depth' },
    targets: [{ elementId: 'hero', motionId: 'hero-motion', property: 'depth' }],
    ...overrides,
  };
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
    await waitFor(() => expect(first.result.current.historyReady).toBe(true));
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

    act(() => result.current.commands.resetSession());
    expect(result.current.status).toBe('loading');
    expect(result.current.selected).toBeNull();
    expect(result.current.viewportRows).toEqual([]);
    expect(result.current.historyCount).toBe(0);
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

  it('autosaves only acknowledged history and flushes before a server commit', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ transactions: [] })),
      save: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      commit: vi.fn(async () => ({ snapshot: { id: 'snapshot-2' } })),
      discard: vi.fn(async () => ({})),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));

    await act(async () => window.dispatchEvent(readyMessage(frame)));
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'selection-changed',
        payload: { element: { id: 'hero', label: 'Hero', motion: [] } },
      },
    })));

    act(() => result.current.commands.applyStyle('opacity', '0.5', '1'));
    await waitFor(() => expect(persistenceAdapter.save).toHaveBeenCalled());
    expect(persistenceAdapter.save.mock.calls.at(-1)[0].transactions).toHaveLength(1);

    act(() => result.current.commands.undo());
    await waitFor(() => expect(persistenceAdapter.save.mock.calls.at(-1)[0].transactions).toHaveLength(0));
    act(() => result.current.commands.redo());
    await waitFor(() => expect(persistenceAdapter.save.mock.calls.at(-1)[0].transactions).toHaveLength(1));

    await act(async () => result.current.commands.commit('exit'));
    expect(persistenceAdapter.flush).toHaveBeenCalled();
    expect(persistenceAdapter.commit).toHaveBeenCalledWith({ reason: 'exit' });
  });

  it('does not add or autosave a runtime inventory refresh', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ transactions: [] })),
      save: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));
    await act(async () => window.dispatchEvent(readyMessage(frame)));
    persistenceAdapter.save.mockClear();

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'inventory-changed',
        payload: { assets: [], profile: {} },
      },
    })));

    expect(result.current.historyCount).toBe(0);
    expect(persistenceAdapter.save).not.toHaveBeenCalled();
  });

  it('waits for v2 acknowledgement before autosave and preserves history when Undo is rejected', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ transactions: [] })),
      save: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const diagnostic = vi.fn();
    window.addEventListener('uncraft:motion-diagnostic', diagnostic);
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: {
          title: 'V2 fixture',
          supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
          ...V2_CONTEXT,
        },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'selection-changed', {
      element: { id: 'hero', label: 'Hero', motion: [] },
    })));
    persistenceAdapter.save.mockClear();

    act(() => result.current.commands.applyStyle('opacity', '0.5', '1'));
    const applyMessage = frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .findLast((message) => message.type === 'apply-transaction');
    expect(result.current.historyCount).toBe(0);
    expect(persistenceAdapter.save).not.toHaveBeenCalled();

    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-committed', {
      transaction: applyMessage.payload.transaction,
    }, applyMessage.requestId)));
    await waitFor(() => expect(result.current.historyCount).toBe(1));
    expect(persistenceAdapter.save).toHaveBeenCalledTimes(1);

    act(() => result.current.commands.undo());
    const undoMessage = frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .findLast((message) => message.type === 'rollback-transaction');
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-rejected', {
      transactionId: undoMessage.payload.transaction.id,
      code: 'write_failed',
    }, undoMessage.requestId)));

    expect(result.current.historyCount).toBe(1);
    expect(result.current.canRedo).toBe(false);
    expect(persistenceAdapter.save).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(diagnostic.mock.calls[0][0].detail).toMatchObject({ code: 'undo_transaction_rejected' });
    window.removeEventListener('uncraft:motion-diagnostic', diagnostic);
  });

  it('composes sequential direct transform components from the acknowledged runtime selection', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const { result } = renderHook(() => useNativeMotionController({ iframeRef }));

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: {
          title: 'Transform fixture',
          supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
          ...V2_CONTEXT,
        },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'selection-changed', {
      element: {
        id: 'hero',
        label: 'Hero',
        styles: { transform: 'none', transformOrigin: '50% 50%' },
        motion: [],
      },
    })));

    act(() => result.current.commands.applyStyle('translateX', '18px', '0px'));
    const translate = frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .findLast((message) => message.type === 'apply-transaction');
    expect(translate.payload.transaction.patches[0]).toMatchObject({
      kind: 'style',
      property: 'transform',
      value: 'translateX(18px)',
    });

    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-committed', {
      transaction: translate.payload.transaction,
      element: {
        id: 'hero',
        label: 'Hero',
        styles: { transform: 'matrix(1, 0, 0, 1, 18, 0)', transformOrigin: '50% 50%' },
        motion: [],
      },
    }, translate.requestId)));
    await waitFor(() => expect(result.current.selected.styles.transform).toBe('matrix(1, 0, 0, 1, 18, 0)'));

    act(() => result.current.commands.applyStyle('rotate', '7deg', '0deg'));
    const rotate = frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .findLast((message) => message.type === 'apply-transaction');
    expect(rotate.payload.transaction.patches[0]).toMatchObject({
      kind: 'style',
      property: 'transform',
      before: 'matrix(1, 0, 0, 1, 18, 0)',
      value: 'matrix(0.992546, 0.121869, -0.121869, 0.992546, 18, 0)',
    });
  });

  it('resumes and replays the server draft after a browser reload', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const persisted = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source: 'properties',
      createdAt: '2026-07-26T10:00:00.000Z',
      patches: [{
        id: 'patch-persisted',
        elementId: 'hero',
        kind: 'style',
        property: 'opacity',
        before: '1',
        value: '0.5',
        createdAt: '2026-07-26T10:00:00.000Z',
      }],
      automaticRepairs: [{
        id: 'patch-repair',
        elementId: 'hero',
        kind: 'style',
        property: 'transform',
        before: 'translateX(2px)',
        value: 'translateX(0px)',
        createdAt: '2026-07-26T10:00:00.000Z',
      }],
    };
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ transactions: [persisted] })),
      save: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));

    await act(async () => window.dispatchEvent(readyMessage(frame)));
    await waitFor(() => expect(result.current.historyCount).toBe(1));

    const replay = frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === 'apply-patches');
    expect(replay.payload.patches.map((patch) => patch.id)).toEqual(['patch-persisted', 'patch-repair']);
    expect(result.current.canUndo).toBe(true);
    expect(persistenceAdapter.save).not.toHaveBeenCalled();
  });

  it('flushes the confirmed draft before Preview and when the page becomes hidden', async () => {
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ transactions: [] })),
      save: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ persistenceAdapter }));

    await act(async () => result.current.commands.changeMode('preview'));
    await waitFor(() => expect(persistenceAdapter.flush).toHaveBeenCalledTimes(1));

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(persistenceAdapter.flush).toHaveBeenCalledTimes(2));
    expect(persistenceAdapter.flush.mock.calls[1][0]).toEqual({ keepalive: true });
    visibility.mockRestore();
  });

  it('tracks the explicit hybrid edit state and loop settlement reported by the runtime', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const { result } = renderHook(() => useNativeMotionController({ iframeRef }));

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: { title: 'Loop fixture', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...V2_CONTEXT },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
    await act(async () => {
      window.dispatchEvent(runtimeV2Message(frame, 'edit-state-changed', {
        state: 'selection-pending',
        selectionId: 'ticker',
      }, 'state-selection'));
      window.dispatchEvent(runtimeV2Message(frame, 'edit-state-changed', {
        state: 'settling',
        selectionId: 'ticker',
        operationId: 'settlement-1',
      }, 'state-settling'));
      window.dispatchEvent(runtimeV2Message(frame, 'selection-settled', {
        elementId: 'ticker',
        operationId: 'settlement-1',
        loop: true,
        progress: 0.63,
        writerCount: 1,
      }, 'state-settled-detail'));
      window.dispatchEvent(runtimeV2Message(frame, 'edit-state-changed', {
        state: 'editing-frozen',
        selectionId: 'ticker',
        operationId: 'settlement-1',
        loop: true,
      }, 'state-frozen'));
    });

    expect(result.current.editState).toMatchObject({
      value: 'editing-frozen',
      selectionId: 'ticker',
      loop: true,
    });
    expect(result.current.selectionSettlement).toMatchObject({
      status: 'settled',
      elementId: 'ticker',
      loop: true,
      progress: 0.63,
    });
  });

  it('sends transient Preview and scrub commands without adding session history', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const { result } = renderHook(() => useNativeMotionController({ iframeRef }));
    await act(async () => window.dispatchEvent(readyMessage(frame)));
    frame.contentWindow.postMessage.mockClear();

    act(() => result.current.commands.beginScrub());
    act(() => result.current.commands.seekMotion(320));
    act(() => result.current.commands.endScrub());
    act(() => result.current.commands.changeMode('preview'));

    await waitFor(() => {
      const types = frame.contentWindow.postMessage.mock.calls.map(([message]) => message.type);
      expect(types).toContain('begin-scrub');
      expect(types).toContain('end-scrub');
      expect(types).toContain('set-mode');
    });
    expect(result.current.historyCount).toBe(0);
    expect(result.current.mode).toBe('preview');
  });

  it('releases scoped runtime state before resetting an active session', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const { result } = renderHook(() => useNativeMotionController({ iframeRef }));
    await act(async () => window.dispatchEvent(readyMessage(frame)));
    frame.contentWindow.postMessage.mockClear();

    act(() => result.current.commands.resetSession());

    expect(frame.contentWindow.postMessage.mock.calls.map(([message]) => message.type)).toContain('release-edit-state');
    expect(result.current.editState.value).toBe('navigating');
  });

  it('retargets the true final owner from Properties without creating a keyframe at the playhead', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const { result } = renderHook(() => useNativeMotionController({ iframeRef }));
    await act(async () => window.dispatchEvent(readyMessage(frame)));
    frame.contentWindow.postMessage.mockClear();

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'selection-changed',
        payload: {
          element: {
            id: 'hero',
            label: 'Hero',
            styles: { opacity: '1', transform: 'none', transformOrigin: '50% 50%' },
            motion: [{
              id: 'hero-entrance',
              engine: 'GSAP',
              editability: 'adapter',
              timing: { duration: 800 },
              tracks: [{
                property: 'opacity',
                keyframes: [{ offset: 0, value: '0' }, { offset: 1, value: '1' }],
                ownership: {
                  channelId: 'hero-entrance:opacity',
                  behavior: 'entrance',
                  order: 10,
                  targetId: 'hero',
                  runtimeProperty: 'opacity',
                  retargetable: true,
                },
              }],
            }],
          },
        },
      },
    })));
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'timeline-changed',
        payload: { currentTime: 400, duration: 800, playState: 'paused' },
      },
    })));

    act(() => result.current.commands.applyStyle('opacity', '0.7', '1'));
    const message = frame.contentWindow.postMessage.mock.calls
      .map(([value]) => value)
      .findLast((value) => value.type === 'apply-patch');
    expect(message.payload.patch).toMatchObject({
      kind: 'motion',
      motionId: 'hero-entrance',
      property: 'retarget.final',
      value: {
        semanticProperty: 'opacity',
        value: '0.7',
      },
    });
    expect(message.payload.patch.property.startsWith('keyframe.')).toBe(false);
  });

  it('quietly refuses an unsupported Properties edit without raising the chooser', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const { result } = renderHook(() => useNativeMotionController({ iframeRef }));
    await act(async () => window.dispatchEvent(readyMessage(frame)));
    frame.contentWindow.postMessage.mockClear();

    // A single writer that is NOT retargetable (e.g. gsap.from(), or a keyframes
    // tween): ownership resolves 'unsupported'. The field is disabled in the UI,
    // and the controller must NOT open the ownership chooser (a list with no
    // choice) — the explanation lives behind the explicit indicator instead.
    const motion = [{
      id: 'entrance',
      engine: 'GSAP',
      editability: 'adapter',
      timing: {},
      tracks: [{
        property: 'opacity',
        keyframes: [{ offset: 1, value: '1' }],
        ownership: {
          channelId: 'entrance:opacity',
          behavior: 'entrance',
          relationship: 'independent',
          targetId: 'hero',
          runtimeProperty: 'opacity',
          retargetable: false,
        },
      }],
    }];
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'selection-changed',
        payload: {
          element: {
            id: 'hero',
            label: 'Hero',
            styles: { opacity: '0.8', transform: 'none', transformOrigin: '50% 50%' },
            motion,
          },
        },
      },
    })));

    act(() => result.current.commands.applyStyle('opacity', '0.6', '0.8'));
    expect(result.current.ownershipConflict).toBeNull();
    expect(frame.contentWindow.postMessage.mock.calls
      .map(([value]) => value.type)
      .some((type) => type === 'apply-patch' || type === 'apply-patches')).toBe(false);

    // The explicit indicator click still opens the Motion-side explanation.
    act(() => result.current.commands.focusOwnership('opacity'));
    expect(result.current.ownershipConflict).toMatchObject({
      status: 'unsupported',
      property: 'opacity',
    });
  });

  it('refuses keyframe edits on a track the writer will reject — no patch leaves the controller', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const { result } = renderHook(() => useNativeMotionController({ iframeRef }));
    await act(async () => window.dispatchEvent(readyMessage(frame)));
    frame.contentWindow.postMessage.mockClear();

    // Sol round 5: a clip whose capability allows step edits can still carry
    // tracks the writer refuses (phase-2 array-form tweens will publish exactly
    // this shape). The controller must honor the per-track flag — emitting the
    // doomed patch would round-trip an error toast for an input that looked
    // editable.
    const motion = [{
      id: 'mixed',
      engine: 'GSAP',
      editability: 'adapter',
      timing: { duration: 1000 },
      capabilities: { timing: true, easing: true, keyframes: true },
      tracks: [
        {
          property: 'x',
          keyframeEditable: true,
          keyframes: [{ offset: 0, value: '0' }, { offset: 1, value: '100' }],
          ownership: {
            channelId: 'mixed:x',
            behavior: 'entrance',
            relationship: 'independent',
            targetId: 'hero',
            runtimeProperty: 'x',
            retargetable: true,
          },
        },
        {
          property: 'opacity',
          keyframeEditable: false,
          keyframes: [{ offset: 0, value: '1' }, { offset: 1, value: '0.5' }],
          ownership: {
            channelId: 'mixed:opacity',
            behavior: 'entrance',
            relationship: 'independent',
            targetId: 'hero',
            runtimeProperty: 'opacity',
            retargetable: true,
          },
        },
      ],
    }];
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'selection-changed',
        payload: {
          element: {
            id: 'hero',
            label: 'Hero',
            styles: { opacity: '1', transform: 'none', transformOrigin: '50% 50%' },
            motion,
          },
        },
      },
    })));

    act(() => result.current.commands.changeKeyframeValue({ motionId: 'mixed', property: 'opacity', offset: 1 }, '0.8'));
    act(() => result.current.commands.changeKeyframeEasing({ motionId: 'mixed', property: 'opacity', offset: 1 }, 'ease-in'));
    expect(frame.contentWindow.postMessage.mock.calls
      .map(([value]) => value)
      .some((value) => value.type === 'apply-patch' || value.type === 'apply-patches')).toBe(false);

    // The editable track keeps its full path: the same command emits the patch.
    act(() => result.current.commands.changeKeyframeValue({ motionId: 'mixed', property: 'x', offset: 1 }, '160'));
    const message = frame.contentWindow.postMessage.mock.calls
      .map(([value]) => value)
      .findLast((value) => value.type === 'apply-patch');
    expect(message.payload.patch).toMatchObject({
      kind: 'motion',
      motionId: 'mixed',
      property: 'keyframe.x',
      value: { offset: 1, value: '160' },
    });
  });

  it('holds an ambiguous Properties edit until Motion chooses a contributor, then persists the hint with the retarget', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const { result } = renderHook(() => useNativeMotionController({ iframeRef }));
    await act(async () => window.dispatchEvent(readyMessage(frame)));
    frame.contentWindow.postMessage.mockClear();

    const motion = [
      {
        id: 'entrance',
        engine: 'GSAP',
        editability: 'adapter',
        timing: {},
        tracks: [{
          property: 'opacity',
          keyframes: [{ offset: 1, value: '1' }],
          ownership: {
            channelId: 'entrance:opacity',
            behavior: 'entrance',
            relationship: 'independent',
            targetId: 'hero',
            runtimeProperty: 'opacity',
          },
        }],
      },
      {
        id: 'hover',
        engine: 'WAAPI',
        editability: 'direct',
        timing: {},
        tracks: [{
          property: 'opacity',
          keyframes: [{ offset: 1, value: '0.8' }],
          ownership: {
            channelId: 'hover:opacity',
            behavior: 'hover',
            relationship: 'independent',
            targetId: 'hero',
            runtimeProperty: 'opacity',
          },
        }],
      },
    ];
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'selection-changed',
        payload: {
          element: {
            id: 'hero',
            label: 'Hero',
            styles: { opacity: '0.8', transform: 'none', transformOrigin: '50% 50%' },
            motion,
          },
        },
      },
    })));

    act(() => result.current.commands.applyStyle('opacity', '0.6', '0.8'));
    expect(result.current.ownershipConflict).toMatchObject({
      property: 'opacity',
      status: 'ambiguous',
    });
    expect(frame.contentWindow.postMessage.mock.calls
      .map(([value]) => value.type)
      .some((type) => type === 'apply-patch' || type === 'apply-patches')).toBe(false);

    act(() => result.current.commands.chooseOwnership('hover:opacity'));
    const message = frame.contentWindow.postMessage.mock.calls
      .map(([value]) => value)
      .findLast((value) => value.type === 'apply-patches');
    expect(message.payload.patches).toHaveLength(2);
    expect(message.payload.patches[0]).toMatchObject({
      kind: 'motion',
      motionId: 'hover',
      property: 'ownership.hint',
    });
    expect(message.payload.patches[1]).toMatchObject({
      kind: 'motion',
      motionId: 'hover',
      property: 'retarget.final',
      value: { semanticProperty: 'opacity', value: '0.6' },
    });
    expect(result.current.ownershipHints.opacity).toMatchObject({
      channelId: 'hover:opacity',
      motionId: 'hover',
    });
    expect(result.current.ownershipConflict).toBeNull();
  });

  it('loads sparse responsive overrides and remeasures settlement when the active device changes', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const propertyKey = 'hero:opacity';
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({
        manifest: {
          responsiveManifest: {
            schemaVersion: 1,
            properties: {
              [propertyKey]: {
                mode: 'per-device',
                sharedValue: '1',
                overrides: { desktop: '0.6' },
                provenance: 'inferred',
                binding: { elementId: 'hero', kind: 'style', property: 'opacity' },
              },
            },
          },
        },
        transactions: [],
      })),
      save: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));
    await act(async () => window.dispatchEvent(readyMessage(frame)));
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'selection-changed',
        payload: { element: { id: 'hero', label: 'Hero', styles: { opacity: '0.6' }, motion: [] } },
      },
    })));

    expect(result.current.responsiveScopeFor('opacity', '0.6')).toMatchObject({
      propertyKey,
      mode: 'per-device',
      effectiveValue: '0.6',
    });
    frame.contentWindow.postMessage.mockClear();
    act(() => result.current.commands.changeDevice('mobile'));
    expect(result.current.responsiveScopeFor('opacity', '0.6')).toMatchObject({
      mode: 'per-device',
      effectiveValue: '1',
    });
    await waitFor(() => expect(frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .some((message) => message.type === 'select-element' && message.payload.elementId === 'hero')).toBe(true));
    expect(result.current.historyCount).toBe(0);
  });

  it('records unlink, reconnect, and device-only values in the same history and flushes scope changes', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ manifest: { responsiveManifest: {} }, transactions: [] })),
      save: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));
    await act(async () => window.dispatchEvent(readyMessage(frame)));
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'selection-changed',
        payload: { element: { id: 'hero', label: 'Hero', styles: { opacity: '1' }, motion: [] } },
      },
    })));
    persistenceAdapter.save.mockClear();

    const trigger = document.createElement('button');
    act(() => result.current.commands.requestResponsiveScopeChange({
      action: 'unlink',
      property: 'opacity',
      label: 'Opacity',
      visibleValue: '1',
      binding: { elementId: 'hero', kind: 'style', property: 'opacity' },
      trigger,
    }));
    expect(result.current.pendingResponsiveScopeChange).toMatchObject({ property: 'opacity', deviceId: 'desktop' });
    await act(async () => result.current.commands.confirmResponsiveScopeChange());

    expect(result.current.responsiveScopeFor('opacity', '1')).toMatchObject({
      mode: 'per-device',
      effectiveValue: '1',
    });
    expect(result.current.historyCount).toBe(1);
    expect(result.current.canUndo).toBe(true);
    expect(persistenceAdapter.save.mock.calls.at(-1)[0]).toMatchObject({
      transactions: [expect.objectContaining({ source: 'responsive' })],
      responsiveManifest: expect.objectContaining({ schemaVersion: 1 }),
    });
    expect(persistenceAdapter.flush).toHaveBeenCalledTimes(1);

    act(() => result.current.commands.applyStyle('opacity', '0.5', '1'));
    await waitFor(() => expect(result.current.responsiveScopeFor('opacity', '1')).toMatchObject({
      mode: 'per-device',
      effectiveValue: '0.5',
    }));
    expect(result.current.historyPatches.at(-1)).toMatchObject({
      responsive: { mode: 'per-device', deviceId: 'desktop' },
    });

    await act(async () => result.current.commands.requestResponsiveScopeChange({
      action: 'reconnect',
      property: 'opacity',
      label: 'Opacity',
      visibleValue: '0.5',
      binding: { elementId: 'hero', kind: 'style', property: 'opacity' },
      trigger,
    }));
    expect(result.current.pendingResponsiveScopeChange).toBeNull();
    expect(result.current.responsiveScopeFor('opacity', '0.5')).toMatchObject({
      mode: 'shared',
      effectiveValue: '0.5',
      overrides: {},
    });
    expect(result.current.historyCount).toBe(3);
    expect(persistenceAdapter.flush).toHaveBeenCalledTimes(2);

    act(() => result.current.commands.undo());
    expect(result.current.responsiveScopeFor('opacity', '0.5').mode).toBe('per-device');
    expect(result.current.historyCount).toBe(2);
  });

  it('loads ready custom controls, applies them through v2, and persists the acknowledged value', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const control = {
      id: 'control-aaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'ready',
      scope: 'animation',
      label: 'Depth',
      controlType: 'slider-number',
      currentValue: 1,
      originalValue: 1,
      domain: { min: 0, max: 2, step: 0.1 },
      binding: { kind: 'custom-capability', capability: 'motion.scalar', property: 'depth' },
      targets: [{ elementId: 'hero', motionId: 'hero-motion', property: 'depth' }],
    };
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({
        manifest: { controlManifest: { schemaVersion: 1, controls: [control] } },
        transactions: [],
      })),
      save: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: { title: 'V2 controls', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...V2_CONTEXT },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
    await waitFor(() => expect(result.current.customControls).toHaveLength(1));
    persistenceAdapter.save.mockClear();

    act(() => result.current.commands.applyCustomControl(result.current.customControls[0], 1.5));
    const applyMessage = frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .findLast((message) => message.type === 'apply-transaction');
    expect(applyMessage.payload.transaction).toMatchObject({
      source: 'custom-control',
      patches: [{ kind: 'control', property: control.id, before: 1, value: 1.5 }],
    });
    expect(result.current.customControls[0].currentValue).toBe(1);

    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-committed', {
      transaction: applyMessage.payload.transaction,
    }, applyMessage.requestId)));
    await waitFor(() => expect(result.current.customControls[0].currentValue).toBe(1.5));
    expect(persistenceAdapter.save.mock.calls.at(-1)[0].controlManifest.controls[0].currentValue).toBe(1.5);

    act(() => result.current.commands.undo());
    const undoMessage = frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .findLast((message) => message.type === 'rollback-transaction');
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-committed', {
      transaction: undoMessage.payload.transaction,
    }, undoMessage.requestId)));
    await waitFor(() => expect(result.current.customControls[0].currentValue).toBe(1));

    act(() => result.current.commands.redo());
    const redoMessage = frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .findLast((message) => message.type === 'apply-transaction');
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-committed', {
      transaction: redoMessage.payload.transaction,
    }, redoMessage.requestId)));
    await waitFor(() => expect(result.current.customControls[0].currentValue).toBe(1.5));
  });

  it('reinspects and retries a stale custom binding without creating a repair undo entry', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const control = customControl();
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ manifest: { controlManifest: { schemaVersion: 1, controls: [control] } }, transactions: [] })),
      save: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const diagnostic = vi.fn();
    window.addEventListener('uncraft:motion-diagnostic', diagnostic);
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: { title: 'V2 recovery', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...V2_CONTEXT },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
    await waitFor(() => expect(result.current.customControls).toHaveLength(1));

    act(() => result.current.commands.applyCustomControl(result.current.customControls[0], 1.5));
    const firstApply = frame.contentWindow.postMessage.mock.calls.map(([message]) => message)
      .findLast((message) => message.type === 'apply-transaction');
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-rejected', {
      transactionId: firstApply.payload.transaction.id,
      code: 'target_missing',
    }, firstApply.requestId)));

    expect(result.current.patchError).toBe("This change couldn't be applied. The previous value was restored.");
    expect(result.current.customControls[0]).toMatchObject({ disabled: true, recoveryStatus: 'recovering' });
    const reinspect = frame.contentWindow.postMessage.mock.calls.map(([message]) => message)
      .findLast((message) => message.type === 'recover-control');
    expect(reinspect.payload).toMatchObject({ controlId: control.id, stage: 'reinspect' });

    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'control-recovery-result', {
      controlId: control.id,
      stage: 'reinspect',
      recovered: true,
    }, reinspect.requestId)));
    const retry = frame.contentWindow.postMessage.mock.calls.map(([message]) => message)
      .filter((message) => message.type === 'apply-transaction').at(-1);
    expect(retry.payload.transaction.id).not.toBe(firstApply.payload.transaction.id);
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-committed', {
      transaction: retry.payload.transaction,
    }, retry.requestId)));

    await waitFor(() => expect(result.current.historyCount).toBe(1));
    expect(result.current.customControls[0]).toMatchObject({ currentValue: 1.5, disabled: false });
    expect(persistenceAdapter.save.mock.calls.at(-1)[0].transactions).toHaveLength(1);
    expect(diagnostic.mock.calls.some(([event]) => event.detail.transition === 'recovery-succeeded')).toBe(true);
    window.removeEventListener('uncraft:motion-diagnostic', diagnostic);
  });

  it('disables only an exhausted unsupported control and keeps unrelated controls available', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const controls = [
      customControl(),
      customControl({ id: 'control-bbbbbbbbbbbbbbbbbbbbbbbb', label: 'Speed' }),
    ];
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ manifest: { controlManifest: { schemaVersion: 1, controls } }, transactions: [] })),
      save: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: { title: 'V2 recovery', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...V2_CONTEXT },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
    await waitFor(() => expect(result.current.customControls).toHaveLength(2));

    act(() => result.current.commands.applyCustomControl(result.current.customControls[0], 1.5));
    const apply = frame.contentWindow.postMessage.mock.calls.map(([message]) => message)
      .findLast((message) => message.type === 'apply-transaction');
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-rejected', {
      transactionId: apply.payload.transaction.id,
      code: 'capability_missing',
    }, apply.requestId)));

    expect(result.current.customControls[0]).toMatchObject({ disabled: true, recoveryStatus: 'unavailable' });
    expect(result.current.customControls[1]).toMatchObject({ disabled: false });
    expect(result.current.historyCount).toBe(0);
    expect(frame.contentWindow.postMessage.mock.calls.map(([message]) => message.type)).not.toContain('regenerate-control');
  });

  it('stops after two failed automatic runtime reopen attempts and preserves the draft', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ transactions: [] })),
      save: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: { title: 'V2 recovery', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...V2_CONTEXT },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'runtime-failure', { code: 'runtime_exception' })));
    await waitFor(() => expect(result.current.runtimeRecovery).toMatchObject({ attempt: 1, exhausted: false }));

    await act(async () => result.current.commands.reportRuntimeRecoveryFailure('runtime_session_unavailable'));
    expect(result.current.runtimeRecovery).toMatchObject({ attempt: 2, exhausted: false });
    await act(async () => result.current.commands.reportRuntimeRecoveryFailure('runtime_session_unavailable'));
    expect(result.current.runtimeRecovery).toMatchObject({ attempt: 2, exhausted: true });
    expect(result.current.status).toBe('unavailable');
    expect(persistenceAdapter.save).toHaveBeenCalled();
    expect(persistenceAdapter.flush).toHaveBeenCalled();
    expect(result.current.historyCount).toBe(0);
  });

  it('attributes a runtime crash to the in-flight control without persisting its unacknowledged value', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const control = customControl();
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ manifest: { controlManifest: { schemaVersion: 1, controls: [control] } }, transactions: [] })),
      save: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: { title: 'V2 crash', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...V2_CONTEXT },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
    await waitFor(() => expect(result.current.customControls).toHaveLength(1));
    act(() => result.current.commands.applyCustomControl(result.current.customControls[0], 1.5));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'runtime-failure', { code: 'runtime_exception' })));

    await waitFor(() => expect(result.current.runtimeRecovery).toMatchObject({
      attempt: 1,
      controlId: control.id,
      exhausted: false,
    }));
    expect(result.current.patchError).toBe("This change couldn't be applied. The previous value was restored.");
    expect(result.current.customControls[0]).toMatchObject({ currentValue: 1, disabled: true, recoveryStatus: 'recovering' });
    expect(result.current.historyCount).toBe(0);
    expect(persistenceAdapter.save.mock.calls.at(-1)[0].transactions).toHaveLength(0);
  });

  it('replays the last acknowledged draft and restores selection, scroll, and frame after a runtime restart', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ transactions: [] })),
      save: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter, timelineOpen: true }));

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: { title: 'V2 recovery', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...V2_CONTEXT },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
    await act(async () => {
      window.dispatchEvent(runtimeV2Message(frame, 'selection-changed', {
        element: {
          id: 'hero',
          label: 'Hero',
          motion: [{
            id: 'hero-motion',
            engine: 'CSS',
            editability: 'direct',
            driver: { type: 'time' },
            capabilities: { keyframes: true },
            timing: { delay: 0, duration: 1000, endDelay: 0, iterations: 1 },
            tracks: [{ property: 'opacity', keyframes: [{ offset: 0, value: '0' }, { offset: 1, value: '1' }] }],
          }],
        },
      }));
      window.dispatchEvent(runtimeV2Message(frame, 'viewport-motion-changed', {
        rows: [{ elementId: 'hero' }],
        page: { scrollY: 420, scrollHeight: 2400 },
      }));
      window.dispatchEvent(runtimeV2Message(frame, 'timeline-changed', {
        currentTime: 360,
        duration: 1000,
        playState: 'paused',
      }));
    });
    act(() => result.current.commands.applyStyle('opacity', '0.5', '1'));
    const applied = frame.contentWindow.postMessage.mock.calls.map(([message]) => message)
      .findLast((message) => message.type === 'apply-transaction');
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-committed', {
      transaction: applied.payload.transaction,
    }, applied.requestId)));
    await waitFor(() => expect(result.current.historyCount).toBe(1));
    const applyCountBeforeRecovery = frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'apply-transaction').length;

    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'runtime-failure', { code: 'runtime_exception' })));
    await waitFor(() => expect(result.current.runtimeRecovery).toMatchObject({ attempt: 1 }));
    const nextContext = { ...V2_CONTEXT, sessionNonce: 'nonce-reopened-123', runtimeGeneration: 2 };
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: { title: 'Recovered', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...nextContext },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(
      frame,
      'protocol-negotiated',
      {},
      'runtime-protocol-negotiated-2',
      nextContext,
    )));
    await waitFor(() => expect(frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'apply-transaction').length).toBeGreaterThan(applyCountBeforeRecovery));
    const recoveryTransactions = frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'apply-transaction')
      .slice(applyCountBeforeRecovery);
    for (const replay of recoveryTransactions) {
      await act(async () => window.dispatchEvent(runtimeV2Message(
        frame,
        'transaction-committed',
        { transaction: replay.payload.transaction },
        replay.requestId,
        nextContext,
      )));
    }

    await waitFor(() => expect(result.current.runtimeRecovery).toBeNull());
    expect(result.current.status).toBe('ready');
    expect(result.current.historyCount).toBe(1);
    const recoveryCommands = frame.contentWindow.postMessage.mock.calls.map(([message]) => message);
    expect(recoveryCommands.findLast((message) => message.type === 'scroll-to').payload).toEqual({ scrollY: 420 });
    expect(recoveryCommands.findLast((message) => message.type === 'select-element').payload).toMatchObject({ elementId: 'hero' });
    expect(recoveryCommands.findLast((message) => message.type === 'seek-motion').payload).toMatchObject({
      motionId: 'hero-motion',
      currentTime: 360,
    });
  });

  it('keeps confirmed history intact when recovery replay fails and advances to the next bounded reopen', async () => {
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const persisted = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source: 'properties',
      createdAt: '2026-07-26T10:00:00.000Z',
      patches: [{
        id: 'patch-persisted-recovery',
        elementId: 'hero',
        kind: 'style',
        property: 'opacity',
        before: '1',
        value: '0.5',
        createdAt: '2026-07-26T10:00:00.000Z',
      }],
      automaticRepairs: [],
    };
    const persistenceAdapter = {
      autosave: true,
      load: vi.fn(async () => ({ transactions: [persisted] })),
      save: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const { result } = renderHook(() => useNativeMotionController({ iframeRef, persistenceAdapter }));

    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: { title: 'Initial', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...V2_CONTEXT },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
    await waitFor(() => expect(frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message.type)).toContain('apply-transaction'));
    const initialReplay = frame.contentWindow.postMessage.mock.calls.map(([message]) => message)
      .findLast((message) => message.type === 'apply-transaction');
    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'transaction-committed', {
      transaction: initialReplay.payload.transaction,
    }, initialReplay.requestId)));
    expect(result.current.historyCount).toBe(1);

    await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'runtime-failure', { code: 'runtime_exception' })));
    await waitFor(() => expect(result.current.runtimeRecovery).toMatchObject({ attempt: 1 }));
    const nextContext = { ...V2_CONTEXT, sessionNonce: 'nonce-replay-failed', runtimeGeneration: 2 };
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'https://runtime.uncraft.test',
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'runtime',
        type: 'runtime-ready',
        payload: { title: 'Recovery attempt', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...nextContext },
      },
    })));
    await act(async () => window.dispatchEvent(runtimeV2Message(
      frame,
      'protocol-negotiated',
      {},
      'runtime-protocol-negotiated-replay',
      nextContext,
    )));
    await waitFor(() => expect(frame.contentWindow.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'apply-transaction').length).toBeGreaterThan(1));
    const failedReplay = frame.contentWindow.postMessage.mock.calls.map(([message]) => message)
      .findLast((message) => message.type === 'apply-transaction');
    await act(async () => window.dispatchEvent(runtimeV2Message(
      frame,
      'transaction-rejected',
      { transactionId: failedReplay.payload.transaction.id, code: 'write_failed' },
      failedReplay.requestId,
      nextContext,
    )));

    await waitFor(() => expect(result.current.runtimeRecovery).toMatchObject({ attempt: 2, exhausted: false }));
    expect(result.current.historyCount).toBe(1);
    expect(persistenceAdapter.save.mock.calls.at(-1)[0].transactions).toHaveLength(1);
    expect(result.current.historyReady).toBe(false);
  });

  it('automatically probes a transient bridge timeout and returns to ready on health acknowledgement', async () => {
    vi.useFakeTimers();
    const frame = runtimeFrame();
    const iframeRef = createRef();
    iframeRef.current = frame;
    const diagnostic = vi.fn();
    window.addEventListener('uncraft:motion-diagnostic', diagnostic);
    const hook = renderHook(() => useNativeMotionController({ iframeRef }));
    try {
      await act(async () => window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        origin: 'https://runtime.uncraft.test',
        data: {
          protocol: MOTION_EDITOR_PROTOCOL,
          source: 'runtime',
          type: 'runtime-ready',
          payload: { title: 'V2 heartbeat', supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, ...V2_CONTEXT },
        },
      })));
      await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'protocol-negotiated')));
      frame.contentWindow.postMessage.mockClear();

      act(() => vi.advanceTimersByTime(3_501));
      expect(hook.result.current.status).toBe('recovering');
      act(() => vi.advanceTimersByTime(301));
      expect(frame.contentWindow.postMessage.mock.calls.map(([message]) => message.type)).toContain('health-check');

      await act(async () => window.dispatchEvent(runtimeV2Message(frame, 'runtime-health', { status: 'healthy' })));
      expect(hook.result.current.status).toBe('ready');
      expect(diagnostic.mock.calls.some(([event]) => event.detail.transition === 'recovery-succeeded')).toBe(true);
    } finally {
      hook.unmount();
      window.removeEventListener('uncraft:motion-diagnostic', diagnostic);
      vi.useRealTimers();
    }
  });
});
