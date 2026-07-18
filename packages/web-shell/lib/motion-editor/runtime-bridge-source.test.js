import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION_EDITOR_PROTOCOL } from './protocol.js';
import { getRuntimeBridgeSource } from './runtime-bridge-source.js';

describe('native motion runtime bridge', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-uncraft-editor-mode');
    document.body.innerHTML = '<main><h1 id="hero-title" aria-label="CropTab"><span class="char">C</span><span class="char">r</span><span class="char">o</span><span class="char">p</span><span class="char">T</span><span class="char">a</span><span class="char">b</span></h1></main>';
  });

  it('normalizes browser animations and writes timing changes back to the live effect', () => {
    const title = document.getElementById('hero-title');
    const updateTiming = vi.fn();
    let keyframes = [
      { computedOffset: 0, opacity: '0', transform: 'translateY(24px)' },
      { computedOffset: 1, opacity: '1', transform: 'translateY(0px)' },
    ];
    const setKeyframes = vi.fn((next) => { keyframes = next; });
    const animation = {
      id: 'hero-reveal',
      animationName: 'hero-reveal',
      currentTime: 120,
      playState: 'running',
      playbackRate: 1,
      effect: {
        target: title,
        getTiming: () => ({ delay: 100, duration: 800, iterations: 1, direction: 'normal', fill: 'both', easing: 'ease-out' }),
        getComputedTiming: () => ({ duration: 800 }),
        getKeyframes: () => keyframes,
        setKeyframes,
        updateTiming,
      },
      pause: vi.fn(),
      play: vi.fn(),
    };
    title.getAnimations = () => [animation];
    document.getAnimations = () => [animation];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const firstCharacter = title.querySelector('.char');
    firstCharacter.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.find((message) => message.type === 'selection-changed');
    expect(selection.payload.element.id).toBe(title.dataset.uncraftId);
    expect(selection.payload.element.text).toBe('CropTab');
    expect(selection.payload.element.motion[0]).toMatchObject({
      engine: 'CSS',
      editability: 'direct',
      driver: { type: 'time' },
      timing: { delay: 100, duration: 800, easing: 'ease-out' },
    });
    expect(selection.payload.element.motion[0].tracks.map((track) => track.property)).toEqual(['opacity', 'transform']);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: selection.payload.element.id,
            kind: 'motion',
            motionId: selection.payload.element.motion[0].id,
            property: 'timing.duration',
            before: 800,
            value: 1200,
          },
        },
      },
    }));

    expect(updateTiming).toHaveBeenCalledWith({ duration: 1200 });

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'set-timeline-active',
        payload: { motionId: selection.payload.element.motion[0].id },
      },
    }));
    const timeline = messages.find((message) => message.type === 'timeline-changed');
    expect(timeline.payload).toMatchObject({ currentTime: 120, duration: 900, playState: 'running' });

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'seek-motion',
        payload: { motionId: selection.payload.element.motion[0].id, currentTime: 450 },
      },
    }));
    expect(animation.pause).toHaveBeenCalled();
    expect(animation.currentTime).toBe(450);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: selection.payload.element.id,
            kind: 'motion',
            motionId: selection.payload.element.motion[0].id,
            property: 'timing.playbackMode',
            before: 'once',
            value: 'ping-pong',
          },
        },
      },
    }));
    expect(updateTiming).toHaveBeenLastCalledWith({ iterations: Infinity, direction: 'alternate' });

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: selection.payload.element.id,
            kind: 'motion',
            motionId: selection.payload.element.motion[0].id,
            property: 'keyframe.opacity',
            before: { offset: 0.5, exists: false },
            value: { offset: 0.5, value: '0.6', exists: true },
          },
        },
      },
    }));
    expect(setKeyframes).toHaveBeenLastCalledWith([
      { offset: 0, opacity: '0', transform: 'translateY(24px)' },
      { offset: 0.5, opacity: '0.6' },
      { offset: 1, opacity: '1', transform: 'translateY(0px)' },
    ]);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: selection.payload.element.id,
            kind: 'motion',
            motionId: selection.payload.element.motion[0].id,
            property: 'keyframe.opacity',
            before: { offset: 0.5, value: '0.6', exists: true },
            value: { offset: 0.5, value: '0.6', easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', exists: true },
          },
        },
      },
    }));
    expect(setKeyframes).toHaveBeenLastCalledWith([
      { offset: 0, opacity: '0', transform: 'translateY(24px)' },
      { offset: 0.5, opacity: '0.6', easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
      { offset: 1, opacity: '1', transform: 'translateY(0px)' },
    ]);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patches',
        payload: {
          patches: [
            {
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: selection.payload.element.motion[0].id,
              property: 'keyframe.opacity',
              before: { offset: 0.5, value: '0.6', easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', exists: true },
              value: { offset: 0.5, exists: false },
            },
            {
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: selection.payload.element.motion[0].id,
              property: 'keyframe.opacity',
              before: { offset: 0.65, exists: false },
              value: { offset: 0.65, value: '0.6', easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', exists: true },
            },
          ],
        },
      },
    }));
    expect(setKeyframes).toHaveBeenLastCalledWith([
      { offset: 0, opacity: '0', transform: 'translateY(24px)' },
      { offset: 0.65, opacity: '0.6', easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
      { offset: 1, opacity: '1', transform: 'translateY(0px)' },
    ]);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: selection.payload.element.id,
            kind: 'motion',
            motionId: selection.payload.element.motion[0].id,
            property: 'keyframe.opacity',
            before: { offset: 0.65, value: '0.6', easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', exists: true },
            value: { offset: 0.65, value: '0.6', easing: null, exists: true },
          },
        },
      },
    }));
    expect(setKeyframes).toHaveBeenLastCalledWith([
      { offset: 0, opacity: '0', transform: 'translateY(24px)' },
      { offset: 0.65, opacity: '0.6' },
      { offset: 1, opacity: '1', transform: 'translateY(0px)' },
    ]);

    firstCharacter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(title.getAttribute('data-uncraft-text-editing')).toBe('true');
    const inlineEditor = document.querySelector('[data-uncraft-inline-text-overlay]');
    expect(inlineEditor).not.toBeNull();
    inlineEditor.textContent = 'CropBar';
    inlineEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    const inlineCommit = messages.find((message) => message.type === 'inline-text-committed');
    expect(inlineCommit.payload).toMatchObject({ before: 'CropTab', value: 'CropBar' });
    expect(title.getAttribute('aria-label')).toBe('CropBar');
    expect(title.querySelectorAll('.char')).toHaveLength(7);
    expect(title.textContent).toBe('CropBar');
    expect(firstCharacter.isConnected).toBe(true);
    expect(title.hasAttribute('contenteditable')).toBe(false);
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'set-timeline-active',
        payload: { motionId: null },
      },
    }));
    window.postMessage = originalPostMessage;
  });

  it('exposes editable start/end keyframes for GSAP tweens and writes them back non-destructively', () => {
    document.body.innerHTML = '<main><div id="tab"></div></main>';
    const tab = document.getElementById('tab');

    // Mock a live GSAP tween x: 0 -> 100, currently parked at 30% (rendered x = 30).
    const rendered = { x: 30 };
    let progress = 0.3;
    const from = { x: 0 };
    const to = { x: 100 };
    // Real GSAP tweens carry internal config vars (force3D, data) alongside the
    // animated ones; those must not surface as editable tracks.
    const vars = { x: 100, force3D: true, data: 'ScrollTrigger', duration: 1, ease: 'power2.out' };
    const tween = {
      targets: () => [tab],
      vars,
      duration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn((p) => {
        if (p === undefined) return progress;
        progress = p;
        rendered.x = from.x + (to.x - from.x) * p;
        return tween;
      }),
      invalidate: vi.fn(() => tween),
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [tween] },
      getProperty: (target, prop) => String(rendered[prop]),
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.find((message) => message.type === 'selection-changed');
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');

    // Track is now a real start->end pair, and it is declared keyframe-editable.
    expect(motion.capabilities.keyframes).toBe(true);
    expect(motion.tracks.map((track) => track.property)).toEqual(['x']);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.keyframes).toEqual([
      { offset: 0, value: '0', easing: 'power2.out' },
      { offset: 1, value: '100', easing: null },
    ]);
    // Sampling must not disturb the live tween: progress and rendered value restored.
    expect(progress).toBe(0.3);
    expect(rendered.x).toBe(30);

    // Editing the END keyframe writes to the authored vars and re-resolves.
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: selection.payload.element.id,
            kind: 'motion',
            motionId: motion.id,
            property: 'keyframe.x',
            before: { offset: 1, value: '100', exists: true },
            value: { offset: 1, value: '160', exists: true },
          },
        },
      },
    }));
    expect(vars.x).toBe('160');
    expect(tween.invalidate).toHaveBeenCalled();

    // Editing the START keyframe pins an explicit startAt without touching the end.
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: selection.payload.element.id,
            kind: 'motion',
            motionId: motion.id,
            property: 'keyframe.x',
            before: { offset: 0, value: '0', exists: true },
            value: { offset: 0, value: '20', exists: true },
          },
        },
      },
    }));
    expect(vars.startAt).toEqual({ x: '20' });
    expect(vars.x).toBe('160');

    window.postMessage = originalPostMessage;
  });

  it('re-renders a completed non-scroll GSAP tween after editing its end keyframe', () => {
    document.body.innerHTML = '<main><div id="mark"></div></main>';
    const mark = document.getElementById('mark');

    // Tween x: 0 -> 100 that has already played to completion (progress 1).
    const rendered = { x: 100 };
    let progress = 1;
    const vars = { x: 100, duration: 1, ease: 'none' };
    const tween = {
      targets: () => [mark],
      vars,
      duration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn((p) => {
        if (p === undefined) return progress;
        progress = p;
        rendered.x = Number(vars.x) * p; // recompute from the CURRENT target, like GSAP
        return tween;
      }),
      invalidate: vi.fn(() => tween),
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [tween] },
      getProperty: (target, prop) => String(rendered[prop]),
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    mark.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.find((message) => message.type === 'selection-changed');
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: selection.payload.element.id,
            kind: 'motion',
            motionId: motion.id,
            property: 'keyframe.x',
            before: { offset: 1, value: '100', exists: true },
            value: { offset: 1, value: '160', exists: true },
          },
        },
      },
    }));

    // The visible state reflects the new end value without a manual scrub.
    expect(rendered.x).toBe(160);

    window.postMessage = originalPostMessage;
  });
});
