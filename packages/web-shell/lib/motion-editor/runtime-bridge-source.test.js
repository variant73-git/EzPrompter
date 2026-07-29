import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOTION_EDITOR_PROTOCOL,
  MOTION_EDITOR_PROTOCOL_V2,
  SUPPORTED_MOTION_EDITOR_PROTOCOLS,
  commandV2,
} from './protocol.js';
import { getRuntimeBridgeSource } from './runtime-bridge-source.js';

describe('native motion runtime bridge', () => {
  beforeEach(() => {
    try { window.__uncraftMotionBridge?.teardown?.(); } catch (_) {}
    delete window.__uncraftMotionControlCapabilities;
    document.querySelectorAll('[data-uncraft-runtime-config]').forEach((node) => node.remove());
    document.documentElement.removeAttribute('data-uncraft-editor-mode');
    document.body.innerHTML = '<main><h1 id="hero-title" aria-label="CropTab"><span class="char">C</span><span class="char">r</span><span class="char">o</span><span class="char">p</span><span class="char">T</span><span class="char">a</span><span class="char">b</span></h1></main>';
  });

  function bootV2Runtime({
    bundleId = 'bundle-fixture',
    sessionId = 'session-fixture',
    sessionNonce = 'nonce-fixture-123456',
    origin = 'https://app.uncraft.test',
    runtimeFingerprint = 'sha256:fixture',
    controlManifest = null,
  } = {}) {
    const config = document.createElement('script');
    config.type = 'application/json';
    config.dataset.uncraftRuntimeConfig = 'true';
    config.textContent = JSON.stringify({
      initialManifest: { schemaVersion: 2, baseBundleId: bundleId, transactions: [], ...(controlManifest ? { controlManifest } : {}) },
      runtimeSessionId: sessionId,
      runtimeFingerprint,
      sessionNonce,
    });
    document.head.appendChild(config);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());
    const ready = messages.filter((message) => message.type === 'runtime-ready').pop();
    const context = {
      sessionNonce,
      runtimeGeneration: ready.payload.runtimeGeneration,
      bundleId,
      sessionId,
    };
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      origin,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        protocolVersion: MOTION_EDITOR_PROTOCOL,
        supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
        source: 'host',
        type: 'negotiate-protocol',
        requestId: 'negotiate-1',
        ...context,
        payload: { selectedProtocol: MOTION_EDITOR_PROTOCOL_V2 },
      },
    }));
    const negotiated = messages.filter((message) => message.type === 'protocol-negotiated').pop();
    const send = (type, payload, requestId, overrides = {}) => {
      const message = commandV2(type, payload, { ...context, requestId, ...overrides });
      window.dispatchEvent(new MessageEvent('message', { source: window, origin, data: message }));
      return message;
    };
    return {
      messages,
      ready,
      negotiated,
      context,
      send,
      restore: () => { window.__uncraftMotionBridge?.teardown?.(); window.postMessage = originalPostMessage; },
    };
  }

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

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('surfaces per-property tracks for GSAP keyframes tweens as detected but not retargetable', () => {
    document.body.innerHTML = '<main><div id="kf"></div></main>';
    const kfTarget = document.getElementById('kf');

    // Mock a live GSAP keyframes tween (array form). Real GSAP mutates each entry,
    // injecting config keys (parent/ease/overwrite/delay/duration) beside the animated
    // ones — probe-verified 2026-07-29 — so extraction must filter them. A top-level
    // `y` rides along to prove plain props KEEP their retargetability.
    const rendered = { x: 0, scale: 1, y: 0 };
    let progress = 0.2;
    const vars = {
      y: 40,
      keyframes: [
        { x: 0, duration: 1, parent: {}, ease: 'none', overwrite: 'auto', delay: 0 },
        { x: 60, duration: 1, parent: {}, ease: 'none', overwrite: 'auto', delay: 0 },
        { scale: 1.5, duration: 1, parent: {}, ease: 'none', overwrite: 'auto', delay: 0 },
      ],
      duration: 3,
      ease: 'power2.out',
    };
    const tween = {
      targets: () => [kfTarget],
      vars,
      duration: () => 3,
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
        rendered.x = 60 * p;
        rendered.scale = 1 + 0.5 * p;
        rendered.y = 40 * p;
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

    kfTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.find((message) => message.type === 'selection-changed');
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');

    // The keyframe-driven properties surface as real sampled tracks (no more
    // invisible writer -> unowned -> style patch stomped by the live tween).
    expect(motion.tracks.map((track) => track.property).sort()).toEqual(['scale', 'x', 'y']);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.keyframes).toEqual([
      { offset: 0, value: '0', easing: 'power2.out' },
      { offset: 1, value: '60', easing: null },
    ]);
    const scaleTrack = motion.tracks.find((track) => track.property === 'scale');
    expect(scaleTrack.keyframes.map((keyframe) => keyframe.value)).toEqual(['1', '1.5']);

    // No safe writeback exists for keyframes tweens (probe: vars edits corrupt the
    // path start; object-form edits are ignored) -> detected but NOT retargetable,
    // while the plain top-level `y` stays retargetable.
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(scaleTrack.ownership.retargetable).toBe(false);
    expect(motion.tracks.find((track) => track.property === 'y').ownership.retargetable).toBe(true);
    // Timeline keyframe editing uses the same unsafe write path -> disabled.
    expect(motion.capabilities.keyframes).toBe(false);

    // Defense in depth: a keyframe patch against a keyframes tween must not write.
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
            before: { offset: 1, value: '60', exists: true },
            value: { offset: 1, value: '160', exists: true },
          },
        },
      },
    }));
    expect(vars.x).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('never marks a property retargetable when keyframes also drive it (both-places form)', () => {
    document.body.innerHTML = '<main><div id="kfb"></div></main>';
    const bothTarget = document.getElementById('kfb');

    // gsap.to(el, { x: 100, keyframes: [...x...] }) — the SAME property authored in
    // both places. Probe-verified (2026-07-29): the keyframes win the rendered path,
    // and retargeting the top-level x corrupts the start. It must classify as
    // keyframe-driven (not retargetable), and the bridge must refuse the retarget.
    const rendered = { x: 0 };
    let progress = 0;
    const vars = {
      x: 100,
      keyframes: [
        { x: 0, duration: 1 },
        { x: 60, duration: 1 },
      ],
      duration: 2,
    };
    const tween = {
      targets: () => [bothTarget],
      vars,
      duration: () => 2,
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
        rendered.x = 60 * p;
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

    bothTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');

    // One deduplicated track, classified keyframe-driven.
    expect(motion.tracks.map((track) => track.property)).toEqual(['x']);
    expect(motion.tracks[0].ownership.retargetable).toBe(false);

    // Defense in depth: a retarget.final patch for it must not write vars.
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
            property: 'retarget.final',
            before: { schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value: '60' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'translateX',
              runtimeProperty: 'x',
              value: '200',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:translateX`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(vars.x).toBe(100);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('surfaces css-wrapper properties as retargetable tracks that write back INTO vars.css', () => {
    document.body.innerHTML = '<main><div id="cssw"></div></main>';
    const cssTarget = document.getElementById('cssw');

    // Legacy GSAP-2 wrapper: gsap.to(el, { css: { x: 60 } }). Probe-verified
    // (2026-07-29): writing top-level vars.x is a silent NO-OP on these tweens,
    // but writing vars.css.x + preserved-start invalidate retargets cleanly. So the
    // properties must surface as tracks (no more unowned -> style-stomp) AND the
    // absolute writeback must route into the css wrapper.
    const rendered = { x: 30 };
    let progress = 0.5;
    const vars = { css: { x: 60 }, duration: 1 };
    const tween = {
      targets: () => [cssTarget],
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
        rendered.x = 60 * p;
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

    cssTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');

    // 'css' is a wrapper, not a property: its sub-keys are the real tracks.
    expect(motion.tracks.map((track) => track.property)).toEqual(['x']);
    expect(motion.tracks[0].ownership.retargetable).toBe(true);
    // Step (keyframe) editing on css tweens is unproven -> disabled.
    expect(motion.capabilities.keyframes).toBe(false);

    // A keyframe patch must not write anything on a css tween (defense in depth).
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
            before: { offset: 1, value: '60', exists: true },
            value: { offset: 1, value: '160', exists: true },
          },
        },
      },
    }));
    expect(vars.css.x).toBe(60);
    expect(vars.x).toBeUndefined();

    // The retarget writes INTO vars.css (top-level writes are a no-op on css tweens).
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
            property: 'retarget.final',
            before: { schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value: '60' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'translateX',
              runtimeProperty: 'x',
              value: '160',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:translateX`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(vars.css.x).toBe(160);
    expect(vars.x).toBeUndefined();
    expect(tween.invalidate).toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('routes component retargets and write models through the css wrapper too', () => {
    document.body.innerHTML = '<main><div id="cssc"></div></main>';
    const cssTarget = document.getElementById('cssc');

    // css:{ scale } needs the component split INSIDE the wrapper (probe-verified:
    // css.scaleX/scaleY works; top-level writes are no-ops). And a relative value
    // inside the wrapper must surface its real write model — reading the top-level
    // vars (undefined) would misreport 'absolute'.
    const rendered = { scale: 1, scaleX: 1, scaleY: 1, x: 0 };
    let progress = 0.5;
    const vars = { css: { scale: 1.5, x: '+=60' }, duration: 1 };
    const tween = {
      targets: () => [cssTarget],
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
        rendered.scale = 1 + 0.5 * p;
        rendered.scaleX = rendered.scale;
        rendered.scaleY = rendered.scale;
        rendered.x = 60 * p;
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

    cssTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');

    // The relative value inside the wrapper surfaces its true write model — and
    // stays NON-retargetable: the relative/function/loop write paths write top-level
    // vars/startAt, which css tweens ignore (only the absolute wrapper write is proven).
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.writeModel).toBe('relative');
    expect(xTrack.ownership.retargetable).toBe(false);

    // Component retarget (scaleX) splits INSIDE the wrapper, never top-level.
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
            property: 'retarget.final',
            before: { schemaVersion: 2, semanticProperty: 'scaleX', runtimeProperty: 'scale', component: 'scaleX', value: '1.5' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'scaleX',
              runtimeProperty: 'scale',
              component: 'scaleX',
              value: '2',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:scaleX`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(vars.css.scaleX).toBe(2);
    expect(vars.css.scaleY).toBe('1.5');
    expect(vars.css.scale).toBeUndefined();
    expect(vars.scaleX).toBeUndefined();
    expect(vars.scale).toBeUndefined();

    // ROLLBACK with the STALE descriptor (runtimeProperty 'scale' — which the split
    // just deleted from the wrapper): the write must still find the wrapper via the
    // component key, or undo silently lands on ignored top-level vars.
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
            property: 'retarget.final',
            before: { schemaVersion: 2, semanticProperty: 'scaleX', runtimeProperty: 'scale', component: 'scaleX', value: '2' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'scaleX',
              runtimeProperty: 'scale',
              component: 'scaleX',
              value: '1.5',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:scaleX`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(vars.css.scaleX).toBe(1.5);
    expect(vars.scaleX).toBeUndefined();
    expect(vars.scale).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks colliding top-level + css.x authoring and reads endOnly values from the wrapper', () => {
    document.body.innerHTML = '<main><div id="csscol"></div><div id="csscross"></div><div id="cssend"></div></main>';
    const collisionTarget = document.getElementById('csscol');
    const crossTarget = document.getElementById('csscross');
    const endOnlyTarget = document.getElementById('cssend');

    const makeTween = (target, vars) => ({
      targets: () => [target],
      vars,
      duration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressFn(p) { return p === undefined ? 0 : this; }),
      invalidate: vi.fn(),
    });
    // Pathological authoring: the SAME property top-level AND in the wrapper.
    // The wrapper slot is the live one (top-level is a phantom — probe
    // 2026-07-29), but the write-bucket predicate and the authored slot still
    // disagree here — precedence stays locked, non-retargetable.
    const collisionTween = makeTween(collisionTarget, { x: '+=60', css: { x: 100 }, duration: 1 });
    // CROSS-FAMILY authoring (Sol round 3): vars.scale is a dead phantom (never
    // reaches CSS once a wrapper exists); css.scaleX is the live animation. The
    // phantom must NOT surface as a track, and the live scaleX edits cleanly
    // (probe: absolute wrapper write renders, start intact).
    const crossTween = makeTween(crossTarget, { scale: 1.5, css: { scaleX: 2 }, duration: 1 });
    const endOnlyTween = makeTween(endOnlyTarget, { css: { x: 60 }, duration: 1 });
    window.gsap = {
      globalTimeline: { getChildren: () => [collisionTween, crossTween, endOnlyTween] },
      // Sampling AVAILABLE here — the collision lock must come from the explicit
      // rule, not incidentally from a failed sampling path.
      getProperty: () => '0',
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    collisionTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    let selection = messages.filter((message) => message.type === 'selection-changed').pop();
    let motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    const collisionTrack = motion.tracks.find((track) => track.property === 'x');
    expect(collisionTrack.ownership.retargetable).toBe(false);
    // Its only track is wrapper-guarded -> the derived clip capability is false
    // (the old clip-level formula said true here — the exact Sol-v5 mismatch).
    expect(motion.capabilities.keyframes).toBe(false);

    crossTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(motion.tracks.map((track) => track.property)).toEqual(['scaleX']);
    expect(motion.tracks[0].ownership.retargetable).toBe(true);

    // endOnly path: drop getProperty so sampling is unavailable.
    delete window.gsap.getProperty;

    // endOnly fallback publishes the wrapper's known value, not ''.
    endOnlyTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    const endTrack = motion.tracks.find((track) => track.property === 'x');
    expect(endTrack.keyframes.at(-1).value).toBe('60');

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('drops phantom top-level props on css-wrapper tweens — only the wrapper animates CSS', () => {
    document.body.innerHTML = '<main><div id="cssmix"></div></main>';
    const mixedTarget = document.getElementById('cssmix');

    // Probe 2026-07-29 (_probe-mix-debug.mjs, GSAP 3.15 real): when a css:{}
    // wrapper is present — even EMPTY — every top-level animatable prop becomes a
    // generic object-property tween (el.x = 100): it never touches CSS, in either
    // direction ({x, css:{opacity}} and {opacity, css:{x}} both leave the
    // top-level prop unrendered). A "mixed" tween therefore has no top-level CSS
    // tracks: listing x as an editable track is a phantom (the same class of lie
    // as furo #1), and dropping it is what makes the element's x genuinely
    // unowned — a Properties style edit works and nothing stomps it.
    const rendered = { x: 0, opacity: 1 };
    let progress = 0.4;
    const tween = {
      targets: () => [mixedTarget],
      vars: { x: 100, css: { opacity: 0.5 }, duration: 1 },
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
        rendered.x = 100 * p;
        rendered.opacity = 1 - 0.5 * p;
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

    mixedTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');

    // x is a phantom — not a track. Its absence is what frees the style path.
    expect(motion.tracks.map((track) => track.property)).toEqual(['opacity']);
    // The wrapper-authored opacity stays retargetable (absolute wrapper write is proven).
    expect(motion.tracks.find((track) => track.property === 'opacity').ownership.retargetable).toBe(true);
    // No step-editable track left -> the clip-level capability follows the tracks.
    expect(motion.capabilities.keyframes).toBe(false);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('publishes per-track keyframe editability so the UI only enables what the writer accepts', () => {
    document.body.innerHTML = '<main><div id="purekf"></div><div id="wrapkf"></div><div id="kfdriven"></div><div id="stag1"></div><div id="stag2"></div></main>';
    const pureTarget = document.getElementById('purekf');
    const wrapTarget = document.getElementById('wrapkf');
    const kfDrivenTarget = document.getElementById('kfdriven');
    const staggerTarget = document.getElementById('stag1');

    // Sol round 5: the CLIP-level keyframe capability alone promised step edits
    // the per-property writer guard refuses. Each track now publishes whether the
    // keyframe writer accepts it, and the clip capability is DERIVED from the
    // tracks — the two can no longer disagree. (This per-track channel is also
    // what phase-2 array-form step editing will flip on.)
    const rendered = { x: 0, opacity: 1, y: 0 };
    let pureProgress = 0.4;
    const pureVars = { x: 100, duration: 1 };
    const pureTween = {
      targets: () => [pureTarget],
      vars: pureVars,
      duration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn((p) => {
        if (p === undefined) return pureProgress;
        pureProgress = p;
        rendered.x = 100 * p;
        return pureTween;
      }),
      invalidate: vi.fn(() => pureTween),
    };
    const wrapVars = { css: { opacity: 0.5 }, duration: 1 };
    const wrapTween = {
      targets: () => [wrapTarget],
      vars: wrapVars,
      duration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressFn(p) { return p === undefined ? 0 : this; }),
      invalidate: vi.fn(),
    };
    // A keyframes-driven tween surfaces tracks too (furo #1) — none are step-editable.
    const kfDrivenTween = {
      targets: () => [kfDrivenTarget],
      vars: { keyframes: [{ y: 0, duration: 1 }, { y: 60, duration: 1 }] },
      duration: () => 2,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressFn(p) { return p === undefined ? 0 : this; }),
      invalidate: vi.fn(),
    };
    // Stagger: the writer guard rejects EVERY step write on the facade (Sol v6
    // #3 — the flag must mirror it, or capability×guard reopens), and the reason
    // is published so the locked field can point at the way out (unchain).
    const staggerTween = {
      targets: () => [staggerTarget, document.getElementById('stag2')],
      vars: { x: 100, stagger: 0.1, duration: 1 },
      duration: () => 1.1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressFn(p) { return p === undefined ? 0 : this; }),
      invalidate: vi.fn(),
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [pureTween, wrapTween, kfDrivenTween, staggerTween] },
      getProperty: (target, prop) => String(rendered[prop]),
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    pureTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    let selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const pureMotion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(pureMotion.tracks.find((track) => track.property === 'x').keyframeEditable).toBe(true);
    expect(pureMotion.tracks.find((track) => track.property === 'x').keyframeEditReason).toBeUndefined();
    expect(pureMotion.capabilities.keyframes).toBe(true);

    // Regression (Sol v5): keyframe.x must APPLY where the writer accepts it.
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
            motionId: pureMotion.id,
            property: 'keyframe.x',
            before: { offset: 1, value: '100', exists: true },
            value: { offset: 1, value: '160', exists: true },
          },
        },
      },
    }));
    expect(pureVars.x).toBe('160');
    expect(pureTween.invalidate).toHaveBeenCalled();

    wrapTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const wrapMotion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(wrapMotion.tracks.find((track) => track.property === 'opacity').keyframeEditable).toBe(false);
    expect(wrapMotion.tracks.find((track) => track.property === 'opacity').keyframeEditReason).toBe('css-wrapper');
    expect(wrapMotion.capabilities.keyframes).toBe(false);

    // Regression (Sol v5): a wrapper-track step edit must refuse WITHOUT writing.
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
            motionId: wrapMotion.id,
            property: 'keyframe.opacity',
            before: { offset: 1, value: '0.5', exists: true },
            value: { offset: 1, value: '0.8', exists: true },
          },
        },
      },
    }));
    expect(wrapVars.css.opacity).toBe(0.5);
    expect(wrapVars.opacity).toBeUndefined();
    expect(wrapVars.startAt).toBeUndefined();

    kfDrivenTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const kfMotion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(kfMotion.tracks.find((track) => track.property === 'y').keyframeEditable).toBe(false);
    expect(kfMotion.tracks.find((track) => track.property === 'y').keyframeEditReason).toBe('keyframes');
    expect(kfMotion.capabilities.keyframes).toBe(false);

    staggerTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const staggerMotion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    const staggerTrack = staggerMotion.tracks.find((track) => track.property === 'x');
    expect(staggerTrack.keyframeEditable).toBe(false);
    expect(staggerTrack.keyframeEditReason).toBe('stagger');
    expect(staggerMotion.capabilities.keyframes).toBe(false);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps plugin-namespace vars (attr) in the inventory on wrapper tweens, locked read-only (Sol v6)', () => {
    document.body.innerHTML = '<main><div id="atw" data-n="0"></div><div id="atp" data-n="0"></div></main>';
    const wrapAttrTarget = document.getElementById('atw');
    const plainAttrTarget = document.getElementById('atp');

    // Probe 2026-07-29 (GSAP 3.15 real): with a css wrapper present, scalar
    // top-level props die (el.x, never CSS) but PLUGIN namespaces stay live —
    // attr:{'data-n':100} keeps animating the attribute. Dropping every
    // top-level var would erase a live writer from the inventory. Structured
    // (object-valued) vars survive the drop and are locked: no vars-write path
    // is proven for them (writing vars.attr = '160' would corrupt the object).
    const makeTween = (target, vars) => ({
      targets: () => [target],
      vars,
      duration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressFn(p) { return p === undefined ? 0 : this; }),
      invalidate: vi.fn(),
    });
    const wrapAttrTween = makeTween(wrapAttrTarget, { attr: { 'data-n': 100 }, x: 60, css: { opacity: 0.5 }, duration: 1 });
    const plainAttrTween = makeTween(plainAttrTarget, { attr: { 'data-n': 100 }, y: 50, duration: 1 });
    window.gsap = {
      globalTimeline: { getChildren: () => [wrapAttrTween, plainAttrTween] },
      getProperty: () => '0',
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    wrapAttrTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    let selection = messages.filter((message) => message.type === 'selection-changed').pop();
    let motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    // The scalar x is still a phantom (dropped); opacity (wrapper) and attr (plugin) remain.
    expect(motion.tracks.map((track) => track.property).sort()).toEqual(['attr', 'opacity']);
    const wrapAttrTrack = motion.tracks.find((track) => track.property === 'attr');
    expect(wrapAttrTrack.ownership.retargetable).toBe(false);
    expect(wrapAttrTrack.keyframeEditable).toBe(false);

    // On a plain tween the structured var is locked the same way (writing
    // vars.attr = '160' is the same corruption) while scalars stay editable.
    plainAttrTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    const plainAttrTrack = motion.tracks.find((track) => track.property === 'attr');
    expect(plainAttrTrack.ownership.retargetable).toBe(false);
    expect(plainAttrTrack.keyframeEditable).toBe(false);
    const yTrack = motion.tracks.find((track) => track.property === 'y');
    expect(yTrack.keyframeEditable).toBe(true);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps SCALAR registered-plugin vars in the inventory too, locked on both channels (Sol v7)', () => {
    document.body.innerHTML = '<main><div id="scw"></div><div id="scu"></div></main>';
    const target = document.getElementById('scw');
    const undefTarget = document.getElementById('scu');

    // Probe 2026-07-29 (GSAP 3.15 real): a REGISTERED plugin claims its var
    // regardless of value type — a scalar `fakeplug: 5` still runs its init
    // beside a css wrapper (TextPlugin's `text: "..."`, ScrollToPlugin's
    // `scrollTo: 500` are the real-world shapes). The object-valued heuristic
    // alone would drop it as a phantom — a live writer erased from the
    // inventory, the exact unowned->stomp lie again. gsap.core.globals() lists
    // registered plugins as `<Name>Plugin` keys: that set identifies plugin
    // vars, and the SAME predicate locks classifier and writers.
    // The var key is CASE-SENSITIVE and comes from the plugin's declared name
    // ('Fakeplug' → vars.Fakeplug; probe: lowercase does NOT fire its init), so
    // the set must be read from each plugin's `.prop` — real GSAP publishes the
    // exact var name there ({prop:'attr'}, {prop:'Fakeplug'}) — never derived
    // from the `<Name>Plugin` global key (lossy capitalization, Sol v8).
    const vars = { Fakeplug: 5, x: 60, css: { opacity: 0.5 }, duration: 1 };
    const tween = {
      targets: () => [target],
      vars,
      duration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressFn(p) { return p === undefined ? 0 : this; }),
      invalidate: vi.fn(),
    };
    // GSAP dispatches plugins by ENUMERATED KEY — {Fakeplug: undefined} still
    // runs init (probe 2026-07-29; a plugin may treat undefined as its default
    // and keep writing). The predicate must test key PRESENCE, not the value.
    const undefVars = { Fakeplug: undefined, css: { opacity: 0.5 }, duration: 1 };
    const undefTween = {
      targets: () => [undefTarget],
      vars: undefVars,
      duration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressFn(p) { return p === undefined ? 0 : this; }),
      invalidate: vi.fn(),
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [tween, undefTween] },
      getProperty: () => '0',
      core: { globals: () => ({ CSSPlugin: { prop: 'css' }, AttrPlugin: { prop: 'attr' }, FakeplugPlugin: { prop: 'Fakeplug' } }) },
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(motion.tracks.map((track) => track.property).sort()).toEqual(['Fakeplug', 'opacity']);
    const pluginTrack = motion.tracks.find((track) => track.property === 'Fakeplug');
    expect(pluginTrack.ownership.retargetable).toBe(false);
    expect(pluginTrack.keyframeEditable).toBe(false);
    expect(pluginTrack.keyframeEditReason).toBe('plugin');

    // Neither writer may mutate the plugin's var.
    const sendPatch = (property, patchProperty, value) => window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: selection.payload.element.id, kind: 'motion', motionId: motion.id,
            property: patchProperty,
            before: patchProperty.startsWith('keyframe.') ? { offset: 1, value: '5', exists: true } : { schemaVersion: 2, semanticProperty: property, runtimeProperty: property, value: '5' },
            value,
          },
        },
      },
    }));
    sendPatch('Fakeplug', 'keyframe.Fakeplug', { offset: 1, value: '9', exists: true });
    sendPatch('Fakeplug', 'retarget.final', {
      schemaVersion: 2, semanticProperty: 'Fakeplug', runtimeProperty: 'Fakeplug', value: '9',
      writeModel: 'absolute', responsiveScope: 'shared',
      owner: { channelId: `${motion.id}:Fakeplug`, motionId: motion.id },
      keyframe: { position: 'final-existing' },
    });
    expect(vars.Fakeplug).toBe(5);
    expect(vars.startAt).toBeUndefined();

    // Explicit-undefined plugin var: still a live writer -> still in the
    // inventory, still locked, still refused by the keyframe writer.
    undefTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const undefSelection = messages.filter((message) => message.type === 'selection-changed').pop();
    const undefMotion = undefSelection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(undefMotion.tracks.map((track) => track.property).sort()).toEqual(['Fakeplug', 'opacity']);
    const undefTrack = undefMotion.tracks.find((track) => track.property === 'Fakeplug');
    expect(undefTrack.ownership.retargetable).toBe(false);
    expect(undefTrack.keyframeEditable).toBe(false);
    expect(undefTrack.keyframeEditReason).toBe('plugin');
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: undefSelection.payload.element.id, kind: 'motion', motionId: undefMotion.id,
            property: 'keyframe.Fakeplug',
            before: { offset: 1, value: '', exists: true },
            value: { offset: 1, value: '9', exists: true },
          },
        },
      },
    }));
    expect(undefVars.Fakeplug).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(undefVars, 'Fakeplug')).toBe(true);
    expect(undefVars.startAt).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('validates a GSAP retarget round-trip — sourceValue is immutable metadata (Sol v6)', () => {
    document.body.innerHTML = '<main><div id="vplain"></div><div id="vwrap"></div></main>';
    const plainTarget = document.getElementById('vplain');
    const wrapTarget = document.getElementById('vwrap');

    // validate-transaction re-reads the patch value after applying. The GSAP
    // readback used to RECOMPUTE sourceValue from vars — post-write it differs
    // from the requested descriptor (and on wrapper tweens the top-level slot is
    // empty, so it silently vanished) → every GSAP retarget failed validation
    // with effect_mismatch (probe 2026-07-29, plain AND wrapper). sourceValue is
    // authored-value METADATA: the readback must carry it through untouched,
    // exactly like readBrowserRetarget does.
    const makeTween = (target, vars) => {
      const rendered = {};
      let current = 0.5;
      const tween = {
        targets: () => [target],
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
          if (p === undefined) return current;
          current = p;
          rendered.x = Number(vars.css && 'x' in vars.css ? vars.css.x : vars.x) * p;
          return tween;
        }),
        invalidate: vi.fn(() => tween),
        rendered,
      };
      return tween;
    };
    const plainTween = makeTween(plainTarget, { x: 60, duration: 1 });
    const wrapTween = makeTween(wrapTarget, { css: { x: 60 }, duration: 1 });
    window.gsap = {
      globalTimeline: { getChildren: () => [plainTween, wrapTween] },
      getProperty: (target, prop) => String((target === plainTarget ? plainTween : wrapTween).rendered[prop] ?? 0),
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const validate = (domId, tween) => {
      document.getElementById(domId).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const selection = messages.filter((message) => message.type === 'selection-changed').pop();
      const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
      const sourceValue = motion.tracks.find((track) => track.property === 'x').ownership.sourceValue;
      window.dispatchEvent(new MessageEvent('message', {
        source: window,
        data: {
          protocol: MOTION_EDITOR_PROTOCOL,
          source: 'host',
          type: 'validate-transaction',
          payload: {
            transaction: {
              id: `tx-${domId}`,
              patches: [{
                id: `p-${domId}`,
                elementId: selection.payload.element.id,
                kind: 'motion',
                motionId: motion.id,
                property: 'retarget.final',
                before: { schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value: String(sourceValue) },
                value: {
                  schemaVersion: 2,
                  semanticProperty: 'translateX',
                  runtimeProperty: 'x',
                  value: '160',
                  writeModel: 'absolute',
                  responsiveScope: 'shared',
                  sourceValue,
                  owner: { channelId: `${motion.id}:translateX`, motionId: motion.id },
                  keyframe: { position: 'final-existing' },
                },
              }],
            },
          },
        },
      }));
      return { tween, result: messages.filter((message) => message.type === 'validation-result').pop() };
    };

    const plain = validate('vplain', plainTween);
    expect(plain.result.payload.valid).toBe(true);
    expect(plain.result.payload.stages.apply).toBe('passed');
    // restored: the validated write must not leak into the live tween.
    expect(String(plainTween.vars.x)).toBe('60');

    const wrap = validate('vwrap', wrapTween);
    expect(wrap.result.payload.valid).toBe(true);
    expect(wrap.result.payload.stages.apply).toBe('passed');
    expect(String(wrapTween.vars.css.x)).toBe('60');
    expect(wrapTween.vars.x).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('sees css-wrapped keyframes entries and keeps looping css values non-retargetable', () => {
    document.body.innerHTML = '<main><div id="kfc"></div><div id="cloop"></div></main>';
    const kfCssTarget = document.getElementById('kfc');
    const loopTarget = document.getElementById('cloop');

    const rendered = { x: 0 };
    const makeTween = (target, vars, repeat = 0) => ({
      targets: () => [target],
      vars,
      duration: () => 2,
      delay: () => 0,
      repeat: () => repeat,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressFn(p) { return p === undefined ? 0 : this; }),
      invalidate: vi.fn(),
    });
    // GSAP honors a css wrapper INSIDE keyframes entries (probe-verified: the tween
    // animates x) — extraction must recurse or the writer goes invisible again.
    const kfCssTween = makeTween(kfCssTarget, {
      keyframes: [{ css: { x: 0 }, duration: 1 }, { css: { x: 100 }, duration: 1 }],
    });
    // A looping css:{} value writes through applyGsapLoopBase (top-level vars +
    // startAt) which the wrapper ignores — must stay non-retargetable.
    const loopTween = makeTween(loopTarget, { css: { x: 60 }, duration: 2 }, -1);
    window.gsap = {
      globalTimeline: { getChildren: () => [kfCssTween, loopTween] },
      getProperty: (target, prop) => String(rendered[prop]),
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    kfCssTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    let selection = messages.filter((message) => message.type === 'selection-changed').pop();
    let motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(motion.tracks.map((track) => track.property)).toEqual(['x']);
    expect(motion.tracks[0].ownership.retargetable).toBe(false);

    loopTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    const loopTrack = motion.tracks.find((track) => track.property === 'x');
    expect(loopTrack.ownership.writeModel).toBe('additive-base');
    expect(loopTrack.ownership.retargetable).toBe(false);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('extracts animated properties from object and percent GSAP keyframes forms', () => {
    document.body.innerHTML = '<main><div id="kfo"></div><div id="kfp"></div></main>';
    const objectTarget = document.getElementById('kfo');
    const percentTarget = document.getElementById('kfp');

    const rendered = { x: 0, scale: 1, opacity: 1 };
    const makeTween = (target, vars) => ({
      targets: () => [target],
      vars,
      duration: () => 2,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressFn(p) { return p === undefined ? 0 : this; }),
      invalidate: vi.fn(),
    });
    // Property-array form: {x:[...], scale:[...]} + easeEach config key.
    const objectTween = makeTween(objectTarget, {
      keyframes: { x: [0, 30, 60], scale: [1, 1.5], easeEach: 'power1.inOut' },
      duration: 2,
    });
    // Percent form: "N%" keys wrap per-stop objects (with injected config to filter).
    const percentTween = makeTween(percentTarget, {
      keyframes: { '0%': { x: 0, ease: 'none' }, '50%': { opacity: 0.5 }, '100%': { x: 60, opacity: 1 } },
      duration: 2,
    });
    window.gsap = {
      globalTimeline: { getChildren: () => [objectTween, percentTween] },
      getProperty: (target, prop) => String(rendered[prop]),
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    objectTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    let selection = messages.filter((message) => message.type === 'selection-changed').pop();
    let motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(motion.tracks.map((track) => track.property).sort()).toEqual(['scale', 'x']);
    expect(motion.tracks.every((track) => track.ownership.retargetable === false)).toBe(true);

    percentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(motion.tracks.map((track) => track.property).sort()).toEqual(['opacity', 'x']);
    expect(motion.tracks.every((track) => track.ownership.retargetable === false)).toBe(true);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('extracts properties from numeric-key GSAP keyframes (position keys without %)', () => {
    document.body.innerHTML = '<main><div id="kfn"></div></main>';
    const numericTarget = document.getElementById('kfn');

    // GSAP 3.15 accepts { 0: {...}, 50: {...}, 100: {...} } — parseFloat position
    // keys, no % required (probe-verified: the tween animates the full path). A
    // %-only matcher misses it and recreates the unowned -> style-stomp bug.
    const rendered = { x: 0, opacity: 1 };
    const tween = {
      targets: () => [numericTarget],
      vars: {
        keyframes: { 0: { x: 0 }, 50: { opacity: 0.5 }, 100: { x: 60, opacity: 1 } },
        duration: 2,
      },
      duration: () => 2,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressFn(p) { return p === undefined ? 0 : this; }),
      invalidate: vi.fn(),
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [tween] },
      getProperty: (target, prop) => String(rendered[prop]),
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    numericTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(motion.tracks.map((track) => track.property).sort()).toEqual(['opacity', 'x']);
    expect(motion.tracks.every((track) => track.ownership.retargetable === false)).toBe(true);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('lists every animated element on the page, flagging which are framed in the viewport', () => {
    document.body.innerHTML = `
      <main>
        <h2 id="headline">Fertilizer, reinvented</h2>
        <img id="pack" alt="CropTab packaging" />
        <div id="below">offscreen</div>
      </main>`;
    const headline = document.getElementById('headline');
    const pack = document.getElementById('pack');
    const below = document.getElementById('below');

    window.innerHeight = 800;
    window.innerWidth = 1440;
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    headline.getBoundingClientRect = rect(120, 60);
    pack.getBoundingClientRect = rect(300, 200);
    below.getBoundingClientRect = rect(2400, 100); // far below the fold

    const anim = (target) => ({
      effect: {
        target,
        getTiming: () => ({ delay: 0, duration: 500, iterations: 1, direction: 'normal', fill: 'both', easing: 'linear' }),
        getComputedTiming: () => ({ duration: 500 }),
        getKeyframes: () => [{ computedOffset: 0, opacity: '0' }, { computedOffset: 1, opacity: '1' }],
        setKeyframes: vi.fn(), updateTiming: vi.fn(),
      },
      playState: 'running', currentTime: 0, playbackRate: 1, pause: vi.fn(), play: vi.fn(),
    });
    const headlineAnim = anim(headline);
    const packAnim = anim(pack);
    const belowAnim = anim(below);
    document.getAnimations = () => [headlineAnim, packAnim, belowAnim];
    [headline, pack, below].forEach((el) => { el.getAnimations = () => []; });

    // A runtime tween aimed at a DETACHED node has no place on the page — it
    // must never become a row (the old viewport filter hid these by accident).
    const orphan = document.createElement('div');
    const orphanTween = {
      targets: () => [orphan], vars: { opacity: 1 }, parent: null,
      duration: () => 1, delay: () => 0, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false,
      scrollTrigger: null, progress: vi.fn(() => 0), invalidate: vi.fn(),
    };
    window.gsap = { globalTimeline: { getChildren: () => [orphanTween] }, getProperty: () => '0' };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));

    const view = messages.filter((message) => message.type === 'viewport-motion-changed').pop();
    expect(view).toBeTruthy();
    const rows = view.payload.rows;

    // The timeline is a full-page inventory (Figma Motion model): offscreen
    // elements are LISTED and flagged, never hidden — hiding them re-scoped the
    // list on every scrub, which read as "the strips move with the playhead".
    expect(rows.map((row) => row.elementId)).toEqual([headline.dataset.uncraftId, pack.dataset.uncraftId, below.dataset.uncraftId]);
    expect(rows.map((row) => row.inViewport)).toEqual([true, true, false]);
    // Each row is identified as a thing on the page, not as an engine object.
    expect(rows[0]).toMatchObject({ label: 'Fertilizer, reinvented', kind: 'text', count: 1 });
    expect(rows[1]).toMatchObject({ label: 'CropTab packaging', kind: 'image', count: 1 });

    // Each row carries the envelope needed to DRAW its strip — read cheaply from
    // timing, never by sampling (which would drive every tween on each scroll).
    expect(rows[0]).toMatchObject({ driver: 'time', delayMs: 0, durationMs: 500 });
    expect(rows[0].marks).toEqual([0, 1]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('emits page metrics and scroll-space geometry so one ruler can hold every strip', () => {
    document.body.innerHTML = `
      <main>
        <h2 id="headline">Fertilizer, reinvented</h2>
        <div id="vista"></div>
        <div id="slider"></div>
      </main>`;
    const headline = document.getElementById('headline');
    const vista = document.getElementById('vista');
    const slider = document.getElementById('slider');

    window.innerHeight = 800;
    window.innerWidth = 1440;
    window.scrollY = 1000;
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    headline.getBoundingClientRect = rect(120, 60);
    vista.getBoundingClientRect = rect(300, 400);
    slider.getBoundingClientRect = rect(500, 200);

    const timeAnim = {
      effect: {
        target: headline,
        getTiming: () => ({ delay: 0, duration: 500, iterations: 1, direction: 'normal', fill: 'both', easing: 'linear' }),
        getComputedTiming: () => ({ duration: 500 }),
        getKeyframes: () => [{ computedOffset: 0, opacity: '0' }, { computedOffset: 1, opacity: '1' }],
        setKeyframes: vi.fn(), updateTiming: vi.fn(),
      },
      playState: 'running', currentTime: 0, playbackRate: 1, pause: vi.fn(), play: vi.fn(),
    };
    document.getAnimations = () => [timeAnim];
    [headline, vista].forEach((el) => { el.getAnimations = () => []; });

    // A live ScrollTrigger instance carries numeric page-scroll start/end.
    const scrollTween = {
      targets: () => [vista],
      vars: { yPercent: -20 },
      parent: null,
      duration: () => 1, delay: () => 0, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false,
      scrollTrigger: { start: 400, end: 900, vars: {}, refresh: vi.fn() },
      progress: vi.fn((p) => (p === undefined ? 0 : scrollTween)),
      invalidate: vi.fn(),
    };
    // A HORIZONTAL trigger's pixels live on another axis — plotting or editing
    // them against the page's vertical ruler would target the wrong domain.
    const horizontalTween = {
      ...scrollTween,
      targets: () => [slider],
      scrollTrigger: { start: 100, end: 700, vars: { horizontal: true }, refresh: vi.fn() },
    };
    window.gsap = { globalTimeline: { getChildren: () => [scrollTween, horizontalTween] }, getProperty: () => '0' };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));

    const view = messages.filter((message) => message.type === 'viewport-motion-changed').pop();
    expect(view.payload.page).toMatchObject({ scrollY: 1000, viewportHeight: 800, scrollHeight: 5000, maxScroll: 4200 });

    const rows = Object.fromEntries(view.payload.rows.map((row) => [row.elementId, row]));
    // Scroll-driven strip sits exactly where its trigger says, in page pixels.
    expect(rows[vista.dataset.uncraftId]).toMatchObject({ driver: 'scroll', scrollStart: 400, scrollEnd: 900, scrollEditable: true });
    // Horizontal/custom-scroller triggers are shown but never strip-editable.
    expect(rows[slider.dataset.uncraftId]).toMatchObject({ driver: 'scroll', scrollEditable: false });
    // An unnamed div reads by its class, never as a bare tag — the row must be
    // recognisable as a thing on the page.
    vista.className = 'croptab-lottie w-embed';
    vista.removeAttribute('id');
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));
    const relisted = messages.filter((message) => message.type === 'viewport-motion-changed').pop();
    expect(relisted.payload.rows.find((row) => row.elementId === vista.dataset.uncraftId).label).toBe('croptab-lottie');
    // Time-driven strip is placed at the scroll point where it comes into view
    // (document top minus one viewport), clamped to the scrollable range.
    expect(rows[headline.dataset.uncraftId]).toMatchObject({ driver: 'time', scrollStart: 320, scrollEnd: null });

    // The ruler drives the site: scrubbing sends scroll-to.
    window.scrollTo = vi.fn();
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'scroll-to', payload: { scrollY: 1234 } },
    }));
    expect(window.scrollTo).toHaveBeenCalledWith(0, 1234);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('collapses split-text characters into ONE viewport row named after their root', () => {
    document.body.innerHTML = '<main><h2 id="reveal" aria-label="We found a way"><span class="char">W</span><span class="char">e</span><span class="char">f</span></h2></main>';
    const reveal = document.getElementById('reveal');
    const chars = Array.from(document.querySelectorAll('#reveal .char'));

    window.innerHeight = 800;
    window.innerWidth = 1440;
    window.scrollY = 0;
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 3000, configurable: true });
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    reveal.getBoundingClientRect = rect(200, 80);
    chars.forEach((char) => { char.getBoundingClientRect = rect(200, 80); });
    document.getAnimations = () => [];

    const globalTimeline = { getChildren: () => tweens };
    const mkTween = (target, delay) => ({
      targets: () => [target],
      vars: { opacity: 1, delay },
      parent: globalTimeline,
      duration: () => 0.6, delay: () => delay, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false, scrollTrigger: null,
      progress: vi.fn((p) => (p === undefined ? 0 : undefined)),
      invalidate: vi.fn(),
    });
    const tweens = chars.map((char, index) => mkTween(char, index * 0.05));
    window.gsap = { globalTimeline, getProperty: () => '0' };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));

    const view = messages.filter((message) => message.type === 'viewport-motion-changed').pop();
    // One legible row — never one row per character.
    expect(view.payload.rows).toHaveLength(1);
    expect(view.payload.rows[0]).toMatchObject({
      elementId: reveal.dataset.uncraftId,
      label: 'We found a way',
      kind: 'text',
      count: 3,
    });

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('collapses Webflow-style split words (classed masks + unnamed letter divs) into their text block', () => {
    // Real farmminerals structure: div.text-16-regular-caps > div.gsap_split_wordN-mask
    // > div.gsap_split_word > unnamed letter divs. Neither letters nor words match
    // .char/.word — attribution must be structural, not class-list-based.
    document.body.innerHTML = `
      <main><section>
        <div id="block" class="text-16-regular-caps green">
          <div class="gsap_split_word1-mask"><div class="gsap_split_word gsap_split_word1"><div>C</div><div>a</div></div></div>
          <div class="gsap_split_word2-mask"><div class="gsap_split_word gsap_split_word2"><div>r</div><div>b</div></div></div>
          <div class="gsap_split_word3-mask"><div class="gsap_split_word gsap_split_word3"><div>o</div><div>n</div></div></div>
          <div class="gsap_split_word4-mask"><div class="gsap_split_word gsap_split_word4"><div>a</div></div></div>
        </div>
      </section></main>`;
    const block = document.getElementById('block');
    const letters = Array.from(document.querySelectorAll('.gsap_split_word > div'));
    // One letter is mid-animation far off screen — the ROW is the block, which
    // is visible, so the member must still count.
    const offscreenLetter = letters[0];

    window.innerHeight = 800;
    window.innerWidth = 1440;
    window.scrollY = 0;
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 3000, configurable: true });
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    block.getBoundingClientRect = rect(200, 40);
    letters.forEach((letter) => { letter.getBoundingClientRect = rect(200, 40); });
    offscreenLetter.getBoundingClientRect = rect(4000, 40);
    document.getAnimations = () => [];

    const globalTimeline = { getChildren: () => tweens };
    const mkTween = (target, delay) => ({
      targets: () => [target],
      vars: { yPercent: 0, delay },
      parent: globalTimeline,
      duration: () => 0.6, delay: () => delay, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false, scrollTrigger: null,
      progress: vi.fn((p) => (p === undefined ? 0 : undefined)),
      invalidate: vi.fn(),
    });
    const tweens = letters.map((letter, index) => mkTween(letter, index * 0.02));
    window.gsap = { globalTimeline, getProperty: () => '0' };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));

    const view = messages.filter((message) => message.type === 'viewport-motion-changed').pop();
    expect(view.payload.rows).toHaveLength(1);
    expect(view.payload.rows[0]).toMatchObject({
      elementId: block.dataset.uncraftId,
      count: 7,
    });

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('never merges two split text blocks: the climb stops AT the text root, even when the root carries the split marker', () => {
    // Webflow/Timothy-Ricks pattern: [text-split] sits ON the heading itself.
    // The heading is the ROW — climbing past it would fuse title and subtitle.
    document.body.innerHTML = `
      <main><div class="hero-copy">
        <h1 text-split id="title"><span class="char">T</span><span class="char">i</span></h1>
        <p text-split id="subtitle"><span class="char">S</span><span class="char">u</span></p>
      </div></main>`;
    const title = document.getElementById('title');
    const subtitle = document.getElementById('subtitle');
    const chars = Array.from(document.querySelectorAll('.char'));

    window.innerHeight = 800;
    window.innerWidth = 1440;
    window.scrollY = 0;
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 3000, configurable: true });
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    [title, subtitle, ...chars].forEach((el) => { el.getBoundingClientRect = rect(200, 40); });
    document.getAnimations = () => [];

    const globalTimeline = { getChildren: () => tweens };
    const mkTween = (target) => ({
      targets: () => [target],
      vars: { opacity: 1 },
      parent: globalTimeline,
      duration: () => 0.6, delay: () => 0, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false, scrollTrigger: null,
      progress: vi.fn((p) => (p === undefined ? 0 : undefined)),
      invalidate: vi.fn(),
    });
    const tweens = chars.map(mkTween);
    window.gsap = { globalTimeline, getProperty: () => '0' };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));

    const view = messages.filter((message) => message.type === 'viewport-motion-changed').pop();
    expect(view.payload.rows.map((row) => row.elementId).sort()).toEqual(
      [title.dataset.uncraftId, subtitle.dataset.uncraftId].sort(),
    );

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('retargets a live ScrollTrigger range through vars + refresh, and rejects config-only triggers', () => {
    document.body.innerHTML = '<main><div id="vista"></div><div id="frozen"></div></main>';
    const vista = document.getElementById('vista');
    const frozen = document.getElementById('frozen');

    const liveTrigger = { start: 400, end: 900, vars: { start: 'top bottom', end: 'bottom top' }, refresh: vi.fn() };
    const mkTween = (target, scrollTrigger) => ({
      targets: () => [target],
      vars: { yPercent: -20, scrollTrigger: scrollTrigger === undefined ? undefined : scrollTrigger },
      parent: null,
      duration: () => 1, delay: () => 0, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false,
      scrollTrigger,
      progress: vi.fn((p) => (p === undefined ? 0 : undefined)),
      invalidate: vi.fn(),
    });
    const liveTween = mkTween(vista, liveTrigger);
    // A tween whose scrollTrigger is still a CONFIG object (no instance yet).
    const configTween = mkTween(frozen, { trigger: frozen, start: 'top bottom' });
    window.gsap = { globalTimeline: { getChildren: () => [liveTween, configTween] }, getProperty: () => '0' };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    vista.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    let selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const liveMotion = selection.payload.element.motion.find((clip) => clip.engine === 'ScrollTrigger');

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
            motionId: liveMotion.id,
            property: 'scroll.start',
            before: 400,
            value: 500,
          },
        },
      },
    }));
    expect(liveTrigger.vars.start).toBe(500);
    expect(liveTrigger.refresh).toHaveBeenCalled();

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
            motionId: liveMotion.id,
            property: 'scroll.end',
            before: 900,
            value: 1500,
          },
        },
      },
    }));
    expect(liveTrigger.vars.end).toBe(1500);

    // Config-only trigger cannot be retargeted — the edit must be rejected, not lost.
    frozen.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const configMotion = selection.payload.element.motion.find((clip) => clip.engine === 'ScrollTrigger');
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
            motionId: configMotion.id,
            property: 'scroll.start',
            before: 0,
            value: 250,
          },
        },
      },
    }));
    const rejected = messages.filter((message) => message.type === 'patch-rejected').pop();
    expect(rejected?.payload?.patch?.property).toBe('scroll.start');

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('editing a keyframe of a tween parked MID-animation never shifts its true start', () => {
    // Probe-verified on real GSAP 3.15 (probe-invalidate-rebase.mjs): a gsap.to
    // tween has an IMPLICIT from — invalidate() while parked re-records the
    // start from the PARKED rendered value (10 became 55). The writeback must
    // render progress(0) first so the re-record captures the true start.
    document.body.innerHTML = '<main><div id="chip"></div></main>';
    const chip = document.getElementById('chip');

    const vars = { x: 100, duration: 1, ease: 'none' };
    let recordedStart = 10;      // implicit from, already recorded
    let progress = 0.5;
    const rendered = { x: 55 };  // parked mid-way
    const tween = {
      targets: () => [chip],
      vars,
      parent: null,
      duration: () => 1, delay: () => 0, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false, scrollTrigger: null,
      progress: vi.fn((p) => {
        if (p === undefined) return progress;
        // GSAP semantics: first render after invalidate re-records the start
        // from whatever is currently rendered.
        if (recordedStart === null) recordedStart = rendered.x;
        progress = p;
        rendered.x = recordedStart + (Number(vars.x) - recordedStart) * p;
        return tween;
      }),
      invalidate: vi.fn(() => { recordedStart = null; return tween; }),
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [tween] },
      getProperty: (target, prop) => String(rendered[prop]),
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    let selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(motion.tracks[0].keyframes[0].value).toBe('10');

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
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));

    // The re-described track must still start at the TRUE from-value.
    const applied = messages.filter((message) => message.type === 'patch-applied').pop();
    const edited = applied.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    const xTrack = edited.tracks.find((track) => track.property === 'x');
    expect(xTrack.keyframes[0].value).toBe('10');
    expect(xTrack.keyframes[1].value).toBe('200');

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('classifies a scroll-scrubbed video as a MEDIA-driven clip — one currentTime track driven by scroll', () => {
    document.body.innerHTML = '<main><video id="reel"></video></main>';
    const reel = document.getElementById('reel');
    reel.getAnimations = () => [];

    const scrubTween = {
      targets: () => [reel],
      vars: { currentTime: 6.4 },
      parent: null,
      duration: () => 1, delay: () => 0, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false,
      scrollTrigger: { start: 1200, end: 2600, vars: { scrub: true }, refresh: vi.fn() },
      progress: vi.fn((p) => (p === undefined ? 0 : scrubTween)),
      invalidate: vi.fn(),
    };
    const seekTween = {
      ...scrubTween,
      vars: { currentTime: 5 },
      scrollTrigger: null,
      progress: vi.fn((p) => (p === undefined ? 0 : seekTween)),
    };
    window.gsap = { globalTimeline: { getChildren: () => [scrubTween, seekTween] }, getProperty: () => '0' };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    reel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const clip = selection.payload.element.motion.find((item) => item.engine === 'ScrollTrigger');
    // The cleanest case of the model: value = currentTime, clock = scroll.
    expect(clip.driver).toEqual({ type: 'media' });
    expect(clip.tracks.map((track) => track.property)).toEqual(['currentTime']);
    expect(clip.scroll).toMatchObject({ scrub: true });
    // A plain currentTime tween WITHOUT a scroll trigger is a timed seek, not
    // a media scrub — classifying it as media would export it as scroll-bound.
    const timedSeek = selection.payload.element.motion.find((item) => item.engine === 'GSAP');
    expect(timedSeek.driver).toEqual({ type: 'time' });

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('marks gsap.from() tweens as keyframe-read-only — vars hold the FROM, not the end', () => {
    // For a from() tween, writing vars[prop] would silently retarget the START
    // while the UI says "end". Until the writeback understands runBackwards,
    // the honest contract is: tracks visible, keyframes not editable.
    document.body.innerHTML = '<main><div id="intro"></div></main>';
    const intro = document.getElementById('intro');
    const fromTween = {
      targets: () => [intro],
      vars: { opacity: 0, runBackwards: true, duration: 1 },
      parent: null,
      duration: () => 1, delay: () => 0, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false, scrollTrigger: null,
      progress: vi.fn((p) => (p === undefined ? 0 : fromTween)),
      invalidate: vi.fn(),
    };
    window.gsap = { globalTimeline: { getChildren: () => [fromTween] }, getProperty: () => '0' };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    intro.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const clip = selection.payload.element.motion.find((item) => item.engine === 'GSAP');
    expect(clip.capabilities.keyframes).toBe(false);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('applies a new GSAP ease through parseEase, not vars alone', () => {
    document.body.innerHTML = '<main><div id="dot"></div></main>';
    const dot = document.getElementById('dot');
    const parsedEase = () => 0.42;
    const vars = { x: 100, duration: 1, ease: 'none' };
    const tween = {
      targets: () => [dot],
      vars,
      duration: () => 1, delay: () => 0, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false, scrollTrigger: null,
      progress: vi.fn((p) => (p === undefined ? 0 : tween)),
      invalidate: vi.fn(() => tween),
    };
    const parseEase = vi.fn(() => parsedEase);
    window.gsap = { globalTimeline: { getChildren: () => [tween] }, getProperty: () => '0', parseEase };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    dot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.find((message) => message.type === 'selection-changed');
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    tween.invalidate.mockClear();

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
            property: 'timing.easing',
            before: 'none',
            value: 'power4.in',
          },
        },
      },
    }));

    // The curve must actually be resolved and installed…
    expect(parseEase).toHaveBeenCalledWith('power4.in');
    expect(tween._ease).toBe(parsedEase);
    expect(vars.ease).toBe('power4.in');
    // …without invalidate(), which would re-base the tween's start onto whatever
    // value is on screen right now.
    expect(tween.invalidate).not.toHaveBeenCalled();

    window.postMessage = originalPostMessage;
  });

  it('scopes playback to the selected motion instead of the whole page', () => {
    document.body.innerHTML = '<main><h2 id="tag">Tag</h2><video id="clip"></video></main>';
    const tag = document.getElementById('tag');
    const clip = document.getElementById('clip');
    clip.pause = vi.fn();
    clip.play = vi.fn(() => Promise.resolve());
    window.lenis = { stop: vi.fn(), start: vi.fn() };

    const selectedAnimation = {
      id: 'tag-in', animationName: 'tag-in', currentTime: 0, playState: 'running', playbackRate: 1,
      effect: {
        target: tag,
        getTiming: () => ({ delay: 0, duration: 400, iterations: 1, direction: 'normal', fill: 'both', easing: 'linear' }),
        getComputedTiming: () => ({ duration: 400 }),
        getKeyframes: () => [{ computedOffset: 0, opacity: '0' }, { computedOffset: 1, opacity: '1' }],
        setKeyframes: vi.fn(), updateTiming: vi.fn(),
      },
      pause: vi.fn(), play: vi.fn(),
    };
    const otherAnimation = { ...selectedAnimation, id: 'other', pause: vi.fn(), play: vi.fn() };
    tag.getAnimations = () => [selectedAnimation];
    document.getAnimations = () => [selectedAnimation, otherAnimation];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    tag.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.find((message) => message.type === 'selection-changed');
    const motionId = selection.payload.element.motion[0].id;

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'playback',
        payload: { action: 'pause', speed: 1, motionId },
      },
    }));

    // The scoped path must have handled it (global path omits motionId).
    const ack = messages.filter((message) => message.type === 'playback-changed').pop();
    expect(ack.payload).toMatchObject({ action: 'pause', motionId });

    // Only the selected animation is touched — the page keeps living.
    expect(selectedAnimation.pause).toHaveBeenCalled();
    expect(otherAnimation.pause).not.toHaveBeenCalled();
    expect(clip.pause).not.toHaveBeenCalled();
    expect(window.lenis.stop).not.toHaveBeenCalled();

    // Changing speed must never start playback.
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'playback',
        payload: { action: 'speed', speed: 2, motionId },
      },
    }));
    expect(selectedAnimation.play).not.toHaveBeenCalled();
    expect(selectedAnimation.playbackRate).toBe(2);

    delete window.lenis;
    window.postMessage = originalPostMessage;
  });

  it('restores inline styles that a clearProps tween wipes while being sampled', () => {
    document.body.innerHTML = '<main><div id="card" style="opacity: 0.5; color: red;"></div></main>';
    const card = document.getElementById('card');

    // GSAP's CSSPlugin runs clearProps at completion, wiping style.cssText.
    // suppressEvents silences callbacks, NOT plugin/render side effects — so merely
    // sampling to progress 1 would permanently destroy unrelated inline styles.
    const vars = { x: 100, clearProps: 'all', duration: 1, ease: 'none' };
    let progress = 0.4;
    const tween = {
      targets: () => [card],
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
        if (p === 1) card.style.cssText = ''; // clearProps fires on completion
        return tween;
      }),
      invalidate: vi.fn(() => tween),
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [tween] },
      getProperty: () => '0',
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // Inspecting must never mutate the page.
    expect(card.style.opacity).toBe('0.5');
    expect(card.style.color).toBe('red');
    // clearProps is config, not an animatable track.
    const selection = messages.find((message) => message.type === 'selection-changed');
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(motion.tracks.map((track) => track.property)).toEqual(['x']);

    window.postMessage = originalPostMessage;
  });

  it('emits grouping metadata: split-text tweens point at their root, timeline children at their parent', () => {
    document.body.innerHTML = [
      '<main>',
      '<h1 id="headline" aria-label="Motion"><span class="char">M</span><span class="char">o</span><span class="char">t</span></h1>',
      '<div id="panel"><div id="panel-a"></div><div id="panel-b"></div></div>',
      '</main>',
    ].join('');
    const chars = Array.from(document.querySelectorAll('#headline .char'));
    const headline = document.getElementById('headline');
    const panel = document.getElementById('panel');
    const panelA = document.getElementById('panel-a');
    const panelB = document.getElementById('panel-b');

    const makeTween = (target, vars, parent) => ({
      targets: () => [target],
      vars,
      parent,
      duration: () => 1, delay: () => (vars.delay || 0), repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false, scrollTrigger: null,
      progress: vi.fn((p) => (p === undefined ? 0 : undefined)),
      invalidate: vi.fn(),
    });

    const globalTimeline = { getChildren: () => children };
    // A ScrollTrigger-driven timeline whose children are two tweens on the panel.
    const introTimeline = { vars: { id: 'intro' }, scrollTrigger: { vars: {} } };
    const charTweens = chars.map((char, index) => makeTween(char, { opacity: 1, delay: index * 0.05 }, globalTimeline));
    const panelTweens = [
      makeTween(panelA, { y: 0 }, introTimeline),
      makeTween(panelB, { y: 0 }, introTimeline),
    ];
    const children = [...charTweens, ...panelTweens];
    window.gsap = { globalTimeline, getProperty: () => '0' };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    // Selecting the headline lists the three char tweens, each linked to the split root.
    headline.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    let selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const charClips = selection.payload.element.motion.filter((item) => item.engine === 'GSAP');
    expect(charClips).toHaveLength(3);
    const headlineId = headline.dataset.uncraftId;
    charClips.forEach((item, index) => {
      expect(item.group).toMatchObject({
        targetId: chars[index].dataset.uncraftId,
        parentId: headlineId,
        splitRootId: headlineId,
        splitRootLabel: 'Motion',
        timelineId: null,
        targetCount: 1,
      });
    });

    // OWNERSHIP (2026-07-20): a container wrapper absorbs NOTHING — each
    // timeline child belongs to its own element's row/panel.
    panel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    expect(selection.payload.element.motion.filter((item) => item.engine === 'GSAP')).toHaveLength(0);

    // Selecting a child directly lists ITS tween, linked to the shared timeline.
    panelA.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const panelClips = selection.payload.element.motion.filter((item) => item.engine === 'GSAP');
    expect(panelClips).toHaveLength(1);
    expect(panelClips[0].group.timelineId).toBeTruthy();
    expect(panelClips[0].group).toMatchObject({
      splitRootId: null,
      timelineLabel: 'intro',
      timelineScroll: true,
    });
    expect(panelClips[0].group.parentId).toBe(panel.dataset.uncraftId);

    // Re-injecting the bridge resets its WeakMap — the timeline id must survive
    // because it is seeded from the timeline's authored id, not an instance counter
    // (the host may hold expanded-group state keyed by it across iframe reloads).
    const firstTimelineId = panelClips[0].group.timelineId;
    window.eval(getRuntimeBridgeSource());
    panelA.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const reinjectedClips = selection.payload.element.motion.filter((item) => item.engine === 'GSAP');
    expect(reinjectedClips[0].group.timelineId).toBe(firstTimelineId);

    delete window.gsap;
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

  function timeAnimationFor(target, overrides = {}) {
    return {
      effect: {
        target,
        getTiming: () => ({ delay: 0, duration: 500, iterations: 1, direction: 'normal', fill: 'both', easing: 'linear' }),
        getComputedTiming: () => ({ duration: 500 }),
        getKeyframes: () => [{ computedOffset: 0, opacity: '0' }, { computedOffset: 1, opacity: '1' }],
        setKeyframes: vi.fn(), updateTiming: vi.fn(),
      },
      playState: 'running', currentTime: 0, playbackRate: 1, pause: vi.fn(), play: vi.fn(),
      ...overrides,
    };
  }

  it('selection carries hostRowId: clicking inside an animated container resolves to its timeline row', () => {
    document.body.innerHTML = '<main><div id="wrap"><img id="pic" alt="Poster" /></div></main>';
    const wrap = document.getElementById('wrap');
    const pic = document.getElementById('pic');
    window.innerHeight = 800;
    window.innerWidth = 1440;
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    wrap.getBoundingClientRect = rect(100, 300);
    pic.getBoundingClientRect = rect(120, 200);
    const animation = timeAnimationFor(wrap);
    document.getAnimations = () => [animation];
    [wrap, pic].forEach((el) => { el.getAnimations = () => []; });

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    pic.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    expect(selection).toBeTruthy();
    // Whatever node the click resolves to, the payload names the row that owns
    // the animation — the UI never has to guess across the iframe boundary.
    // (Truthiness first: `undefined === undefined` must never pass this test.)
    expect(selection.payload.element.hostRowId).toBeTruthy();
    expect(selection.payload.element.hostRowId).toBe(wrap.dataset.uncraftId);

    window.postMessage = originalPostMessage;
  });

  it('clicking a site-authored split line (gsap_split_line) selects the TEXT BLOCK, not the fragment', () => {
    // Live-fixture regression: "most fertilizers…" lines carry the class
    // gsap_split_line (not SplitText's .line), so textRoot never climbed and
    // the click selected a transient fragment that the runtime re-splits away.
    document.body.innerHTML = `
      <main><div id="block" class="text-60-medium">
        <div class="gsap_split_line-mask"><div class="gsap_split_line">Most fertilizers</div></div>
        <div class="gsap_split_line-mask"><div class="gsap_split_line">never make it</div></div>
      </div></main>`;
    const block = document.getElementById('block');
    document.getAnimations = () => [];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    document.querySelector('.gsap_split_line').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    expect(selection).toBeTruthy();
    expect(selection.payload.element.id).toBe(block.dataset.uncraftId);

    window.postMessage = originalPostMessage;
  });

  it('latches a time strip position: rect drift between emits never moves the strip', () => {
    // Pinned/parallax pages report a different rect.top on every scroll —
    // re-deriving the reveal point per emit made strips crawl with the scrubber.
    document.body.innerHTML = '<main><h2 id="headline">Fertilizer, reinvented</h2></main>';
    const headline = document.getElementById('headline');
    window.innerHeight = 800;
    window.innerWidth = 1440;
    window.scrollY = 1000;
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    headline.getBoundingClientRect = rect(120, 60);
    const animation = timeAnimationFor(headline);
    document.getAnimations = () => [animation];
    headline.getAnimations = () => [];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const inspect = () => window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));
    inspect();
    const first = messages.filter((m) => m.type === 'viewport-motion-changed').pop().payload.rows[0];
    expect(first.scrollStart).toBe(320); // 120 + 1000 - 800

    // Parallax drift: the rect moves, the strip must NOT.
    headline.getBoundingClientRect = rect(400, 60);
    inspect();
    const second = messages.filter((m) => m.type === 'viewport-motion-changed').pop().payload.rows[0];
    expect(second.scrollStart).toBe(320);

    window.postMessage = originalPostMessage;
  });

  it('classless split chars inside a heading collapse into ONE row: the heading itself', () => {
    // Live fixture had one-letter rows ("a", "&", "0") — SplitText chars as
    // BARE divs inside an h2, no class dialect at all. The text block is the host.
    document.body.innerHTML = `
      <main><div class="capsule-heading"><h2 id="head" class="h2-style">
        <div><div id="c1">a</div></div>
        <div><div id="c2">b</div></div>
      </h2></div></main>`;
    const head = document.getElementById('head');
    const c1 = document.getElementById('c1');
    const c2 = document.getElementById('c2');
    window.innerHeight = 800;
    window.innerWidth = 1440;
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    [head, c1, c2].forEach((el, i) => { el.getBoundingClientRect = rect(100 + i, 40); el.getAnimations = () => []; });
    document.getAnimations = () => [timeAnimationFor(c1), timeAnimationFor(c2)];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));
    const rows = messages.filter((m) => m.type === 'viewport-motion-changed').pop().payload.rows;
    expect(rows.length).toBe(1);
    expect(rows[0].elementId).toBe(head.dataset.uncraftId);
    expect(rows[0].count).toBe(2);

    window.postMessage = originalPostMessage;
  });

  it('an animated image INSIDE a paragraph keeps its own row — only text fragments roll up', () => {
    document.body.innerHTML = '<main><p id="rich">Some text <img id="badge" alt="Badge" /> more text</p></main>';
    const rich = document.getElementById('rich');
    const badge = document.getElementById('badge');
    window.innerHeight = 800;
    window.innerWidth = 1440;
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    rich.getBoundingClientRect = rect(100, 60);
    badge.getBoundingClientRect = rect(110, 20);
    document.getAnimations = () => [timeAnimationFor(badge)];
    [rich, badge].forEach((el) => { el.getAnimations = () => []; });

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));
    const rows = messages.filter((m) => m.type === 'viewport-motion-changed').pop().payload.rows;
    expect(rows.length).toBe(1);
    expect(rows[0].elementId).toBe(badge.dataset.uncraftId);

    window.postMessage = originalPostMessage;
  });

  it('a container row never absorbs its children\'s clips: each tween belongs to its own host', () => {
    // Live fixture: an icon layer listed the neighbouring text's tween as a
    // sub-row. Ownership = host of the CLIP's target.
    document.body.innerHTML = `
      <main><div id="chunk" class="meet-tablet">
        <img id="icon" alt="meet-icon-1" />
        <h3 id="phrase" aria-label="Just drop it">Just drop it</h3>
      </div></main>`;
    const chunk = document.getElementById('chunk');
    const icon = document.getElementById('icon');
    const phrase = document.getElementById('phrase');
    window.innerHeight = 800;
    window.innerWidth = 1440;
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    [chunk, icon, phrase].forEach((el, i) => { el.getBoundingClientRect = rect(100 + i * 50, 40); });
    const iconAnim = timeAnimationFor(icon);
    const phraseAnim = timeAnimationFor(phrase);
    document.getAnimations = () => [iconAnim, phraseAnim];
    chunk.getAnimations = ({ subtree } = {}) => (subtree ? [iconAnim, phraseAnim] : []);
    icon.getAnimations = ({ subtree } = {}) => (subtree ? [iconAnim] : []);
    phrase.getAnimations = ({ subtree } = {}) => (subtree ? [phraseAnim] : []);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));
    const rows = messages.filter((m) => m.type === 'viewport-motion-changed').pop().payload.rows;
    // Icon and phrase are TWO layers — the chunk wrapper is none (no own tween).
    expect(rows.map((row) => row.elementId).sort()).toEqual([icon.dataset.uncraftId, phrase.dataset.uncraftId].sort());

    // Describing the WRAPPER lists nothing (its subtree's clips belong to
    // their own rows).
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'describe-element', payload: { elementId: (chunk.dataset.uncraftId = chunk.dataset.uncraftId || 'el-chunk-x', chunk.dataset.uncraftId) } },
    }));
    const described = messages.filter((m) => m.type === 'element-described').pop();
    expect(described.payload.element.motion.length).toBe(0);

    window.postMessage = originalPostMessage;
  });

  it('EDIT mode replays a time animation every time the scroll crosses its strip; preview does not', () => {
    document.body.innerHTML = '<main><div id="deep" class="promo-panel">Deep content</div></main>';
    const deep = document.getElementById('deep');
    window.innerHeight = 800;
    window.innerWidth = 1440;
    window.scrollY = 0;
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    deep.getBoundingClientRect = () => ({ top: 2400, bottom: 2500, left: 0, right: 400, width: 400, height: 100, x: 0, y: 2400 });
    const animation = timeAnimationFor(deep);
    document.getAnimations = () => [animation];
    deep.getAnimations = ({ subtree } = {}) => [animation];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));
    const row = messages.filter((m) => m.type === 'viewport-motion-changed').pop().payload.rows[0];
    expect(row.scrollStart).toBe(1600); // latched reveal point (2400 - 800)

    const playsBefore = animation.play.mock.calls.length;
    window.scrollY = 2000; // crosses 1600
    window.dispatchEvent(new Event('scroll'));
    expect(animation.play.mock.calls.length).toBeGreaterThan(playsBefore);

    // Passing back over it replays again.
    const playsMid = animation.play.mock.calls.length;
    window.scrollY = 800;
    window.dispatchEvent(new Event('scroll'));
    expect(animation.play.mock.calls.length).toBeGreaterThan(playsMid);

    // Preview mode = the site's own behaviour; no re-triggering.
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'set-mode', payload: { mode: 'preview' } },
    }));
    const playsPreview = animation.play.mock.calls.length;
    window.scrollY = 2000;
    window.dispatchEvent(new Event('scroll'));
    expect(animation.play.mock.calls.length).toBe(playsPreview);

    window.postMessage = originalPostMessage;
  });

  it('edit mode parks completed GSAP tweens (autoRemoveChildren off); preview restores the site default', () => {
    // GSAP gc-kills one-shot tweens on completion — measured live: after one
    // scroll-through there was nothing left to replay. Editing needs them parked.
    document.body.innerHTML = '<main><h2 id="headline">Fertilizer, reinvented</h2></main>';
    document.getAnimations = () => [];
    window.gsap = { globalTimeline: { autoRemoveChildren: true, getChildren: () => [] }, getProperty: () => '0' };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));
    expect(window.gsap.globalTimeline.autoRemoveChildren).toBe(false);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'set-mode', payload: { mode: 'preview' } },
    }));
    expect(window.gsap.globalTimeline.autoRemoveChildren).toBe(true);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'set-mode', payload: { mode: 'edit' } },
    }));
    expect(window.gsap.globalTimeline.autoRemoveChildren).toBe(false);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('EVERYTHING is selectable: a node with no selectable ancestor still selects itself', () => {
    document.body.innerHTML = '';
    const widget = document.createElement('x-widget');
    widget.textContent = '';
    document.body.appendChild(widget);
    document.getAnimations = () => [];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    widget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((m) => m.type === 'selection-changed').pop();
    expect(selection).toBeTruthy();
    expect(selection.payload.element.id).toBe(widget.dataset.uncraftId);

    window.postMessage = originalPostMessage;
  });

  it('rows are ordered by ARRIVAL: late-minted animations append at the bottom, never mid-list', () => {
    // Runtimes create tweens lazily while the user scrubs. Inserting the new
    // row at its axis position shifted every row below it — which read as
    // "the strips relocate with the playhead". Slots are forever; newcomers
    // go to the end.
    document.body.innerHTML = `
      <main>
        <h2 id="first">Fertilizer, reinvented</h2>
        <div id="middle" class="promo-panel">Middle content</div>
        <div id="last" class="footer-panel">Last content</div>
      </main>`;
    const first = document.getElementById('first');
    const middle = document.getElementById('middle');
    const last = document.getElementById('last');
    window.innerHeight = 800;
    window.innerWidth = 1440;
    window.scrollY = 0;
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    first.getBoundingClientRect = rect(1000, 60);
    middle.getBoundingClientRect = rect(2000, 100);
    last.getBoundingClientRect = rect(4000, 100);
    let animations = [timeAnimationFor(first), timeAnimationFor(last)];
    document.getAnimations = () => animations;
    [first, middle, last].forEach((el) => { el.getAnimations = () => []; });

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const inspect = () => window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));
    inspect();
    const initial = messages.filter((m) => m.type === 'viewport-motion-changed').pop().payload.rows.map((row) => row.elementId);
    expect(initial).toEqual([first.dataset.uncraftId, last.dataset.uncraftId]);

    // The runtime mints a tween for an element that sits BETWEEN the two.
    animations = [...animations, timeAnimationFor(middle)];
    inspect();
    const relisted = messages.filter((m) => m.type === 'viewport-motion-changed').pop().payload.rows.map((row) => row.elementId);
    expect(relisted).toEqual([first.dataset.uncraftId, last.dataset.uncraftId, middle.dataset.uncraftId]);

    window.postMessage = originalPostMessage;
  });

  it('hostRowId of an element that IS a row host is its own id, even inside another animated ancestor', () => {
    // Live-fixture regression: resolveHostRowId used to start the walk at
    // splitFragmentHost(), which could jump OVER the clicked element — a row
    // host itself — and resolve an ancestor's id, so no row ever lit up.
    document.body.innerHTML = '<main><div id="outer"><h2 id="inner">Fertilizer, reinvented</h2></div></main>';
    const outer = document.getElementById('outer');
    const inner = document.getElementById('inner');
    window.innerHeight = 800;
    window.innerWidth = 1440;
    const rect = (top, height) => () => ({ top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top });
    outer.getBoundingClientRect = rect(80, 400);
    inner.getBoundingClientRect = rect(120, 60);
    document.getAnimations = () => [timeAnimationFor(outer), timeAnimationFor(inner)];
    [outer, inner].forEach((el) => { el.getAnimations = () => []; });

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    expect(selection.payload.element.hostRowId).toBeTruthy();
    expect(selection.payload.element.hostRowId).toBe(inner.dataset.uncraftId);

    window.postMessage = originalPostMessage;
  });

  it('describe-element returns full detail for a row WITHOUT touching the selection', () => {
    document.body.innerHTML = '<main><h2 id="headline">Fertilizer, reinvented</h2></main>';
    const headline = document.getElementById('headline');
    window.innerHeight = 800;
    window.innerWidth = 1440;
    headline.getBoundingClientRect = () => ({ top: 120, bottom: 180, left: 0, right: 400, width: 400, height: 60, x: 0, y: 120 });
    const animation = timeAnimationFor(headline);
    document.getAnimations = () => [animation];
    headline.getAnimations = () => [animation];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    // Materialize row ids the way the UI receives them.
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));
    const selectionsBefore = messages.filter((message) => message.type === 'selection-changed').length;
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'describe-element', payload: { elementId: headline.dataset.uncraftId } },
    }));

    const described = messages.filter((message) => message.type === 'element-described').pop();
    expect(described).toBeTruthy();
    expect(described.payload.element.id).toBe(headline.dataset.uncraftId);
    expect(described.payload.element.motion.length).toBe(1);
    // Expanding a layer must never steal the user's selection.
    expect(messages.filter((message) => message.type === 'selection-changed').length).toBe(selectionsBefore);

    window.postMessage = originalPostMessage;
  });

  it('focus-element selects and scrolls an offscreen row without replaying it before meaningful visibility', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main><div id="deep" class="promo-panel">Deep content</div></main>';
    const deep = document.getElementById('deep');
    window.innerHeight = 800;
    window.innerWidth = 1440;
    deep.getBoundingClientRect = () => ({ top: 2400, bottom: 2500, left: 0, right: 400, width: 400, height: 100, x: 0, y: 2400 });
    deep.scrollIntoView = vi.fn();
    const animation = timeAnimationFor(deep);
    document.getAnimations = () => [animation];
    deep.getAnimations = () => [animation];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    // Materialize row ids the way the UI receives them.
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'inspect-viewport', payload: {} },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'focus-element', payload: { elementId: deep.dataset.uncraftId } },
    }));

    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    expect(selection.payload.element.id).toBe(deep.dataset.uncraftId);
    expect(deep.scrollIntoView).toHaveBeenCalled();
    // The hybrid editor no longer restarts a time clip on selection. The real
    // scroll may bring it into meaningful visibility, then settlement decides
    // what to freeze. A mocked offscreen rect must remain untouched.
    expect(animation.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(450);
    expect(animation.play).not.toHaveBeenCalled();

    vi.useRealTimers();
    window.postMessage = originalPostMessage;
  });

  it('negotiates v2 without breaking the v1 runtime-ready envelope', () => {
    const runtime = bootV2Runtime();
    expect(runtime.ready.protocol).toBe(MOTION_EDITOR_PROTOCOL);
    expect(runtime.ready.payload.supportedProtocols).toEqual(SUPPORTED_MOTION_EDITOR_PROTOCOLS);
    expect(runtime.negotiated).toMatchObject({
      protocol: MOTION_EDITOR_PROTOCOL_V2,
      source: 'runtime',
      type: 'protocol-negotiated',
      requestId: 'negotiate-1',
      sessionNonce: runtime.context.sessionNonce,
      runtimeGeneration: runtime.context.runtimeGeneration,
      bundleId: runtime.context.bundleId,
      sessionId: runtime.context.sessionId,
    });
    runtime.restore();
  });

  it('rolls back every prior mutation when a transaction fails in the middle', () => {
    document.body.innerHTML = '<main><div data-uncraft-id="el-a" style="opacity: 1" title="original"></div><div data-uncraft-id="el-b"></div></main>';
    const runtime = bootV2Runtime();
    const element = document.querySelector('[data-uncraft-id="el-a"]');
    runtime.send('apply-transaction', {
      transaction: {
        id: 'tx-rollback',
        patches: [
          { id: 'p1', elementId: 'el-a', kind: 'style', property: 'opacity', before: 'invented', value: '0.25' },
          { id: 'p2', elementId: 'el-a', kind: 'attribute', property: 'title', before: 'invented', value: 'changed' },
          { id: 'p3', elementId: 'missing', kind: 'style', property: 'color', before: '', value: 'red' },
        ],
      },
    }, 'request-rollback');

    expect(element.style.opacity).toBe('1');
    expect(element.getAttribute('title')).toBe('original');
    const rejected = runtime.messages.filter((message) => message.type === 'transaction-rejected').pop();
    expect(rejected.payload).toMatchObject({ transactionId: 'tx-rollback', code: 'target_missing' });
    expect(rejected.payload.error).toBeUndefined();
    expect(rejected.payload.diagnostics).toMatchObject({ code: 'target_missing' });
    runtime.restore();
  });

  it('captures runtime before values, commits atomically, and replays duplicate request IDs idempotently', () => {
    document.body.innerHTML = '<main><div data-uncraft-id="el-a" style="opacity: 1"></div></main>';
    const runtime = bootV2Runtime();
    document.querySelector('[data-uncraft-id="el-a"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const payload = {
      transaction: {
        id: 'tx-commit',
        patches: [{ id: 'p1', elementId: 'el-a', kind: 'style', property: 'opacity', before: 'invented', value: '0.4' }],
      },
    };
    const request = runtime.send('apply-transaction', payload, 'request-commit');
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      origin: 'https://app.uncraft.test',
      data: request,
    }));

    expect(document.querySelector('[data-uncraft-id="el-a"]').style.opacity).toBe('0.4');
    const committed = runtime.messages.filter((message) => message.type === 'transaction-committed');
    expect(committed).toHaveLength(2);
    expect(committed[0].payload.transaction.patches[0]).toMatchObject({ before: '1', value: '0.4' });
    expect(committed[0].payload.element).toMatchObject({
      id: 'el-a',
      styles: { opacity: '0.4' },
    });
    expect(committed[1].payload).toEqual(committed[0].payload);
    runtime.restore();
  });

  it('rolls back an acknowledged transaction as a second atomic transaction', () => {
    document.body.innerHTML = '<main><div data-uncraft-id="el-a" style="opacity: 1"></div></main>';
    const runtime = bootV2Runtime();
    runtime.send('apply-transaction', {
      transaction: {
        id: 'tx-original',
        patches: [{ id: 'p1', elementId: 'el-a', kind: 'style', property: 'opacity', before: 'invented', value: '0.4' }],
      },
    }, 'request-original');
    runtime.send('rollback-transaction', {
      targetTransactionId: 'tx-original',
      transactionId: 'tx-undo',
    }, 'request-undo');

    expect(document.querySelector('[data-uncraft-id="el-a"]').style.opacity).toBe('1');
    const committed = runtime.messages.filter((message) => message.type === 'transaction-committed');
    expect(committed).toHaveLength(2);
    expect(committed[1].payload).toMatchObject({ operation: 'rollback', transaction: { id: 'tx-undo' } });
    runtime.restore();
  });

  it('validates by applying, observing, and restoring without committing history', () => {
    document.body.innerHTML = '<main><div data-uncraft-id="el-a" style="opacity: 1"></div></main>';
    const runtime = bootV2Runtime();
    runtime.send('validate-transaction', {
      transaction: {
        id: 'tx-validate',
        patches: [{ id: 'p1', elementId: 'el-a', kind: 'style', property: 'opacity', before: 'invented', value: '0.35' }],
      },
    }, 'request-validate');

    expect(document.querySelector('[data-uncraft-id="el-a"]').style.opacity).toBe('1');
    const result = runtime.messages.filter((message) => message.type === 'validation-result').pop();
    expect(result.payload).toMatchObject({
      transactionId: 'tx-validate',
      valid: true,
      restored: true,
      stages: { read: 'passed', apply: 'passed', effect: 'passed', restore: 'passed', deterministic: 'passed', teardown: 'passed' },
    });
    expect(runtime.messages.filter((message) => message.type === 'transaction-committed')).toHaveLength(0);
    runtime.restore();
  });

  it('applies only ready custom controls declared for the exact bundle fingerprint', () => {
    document.body.innerHTML = '<main><div data-uncraft-id="el-a"></div></main>';
    const bundleId = 'bundle-controls';
    const runtimeFingerprint = 'sha256:controls';
    const control = {
      id: 'control-aaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'ready',
      bundleId,
      runtimeFingerprint,
      controlType: 'slider-number',
      domain: { min: 0, max: 2, step: 0.1 },
      binding: { kind: 'css-custom-property', property: '--motion-scale' },
      targets: [{ elementId: 'el-a', motionId: null, property: '--motion-scale' }],
    };
    const runtime = bootV2Runtime({
      bundleId,
      runtimeFingerprint,
      controlManifest: { bundleId, runtimeFingerprint, controls: [control] },
    });

    runtime.send('apply-transaction', {
      transaction: {
        id: 'tx-control',
        patches: [{ id: 'p-control', elementId: 'el-a', kind: 'control', property: control.id, before: '', value: 1.4 }],
      },
    }, 'request-control');

    expect(document.querySelector('[data-uncraft-id="el-a"]').style.getPropertyValue('--motion-scale')).toBe('1.4');
    expect(runtime.messages.filter((message) => message.type === 'transaction-committed').pop().payload.transaction.id).toBe('tx-control');

    runtime.send('apply-transaction', {
      transaction: {
        id: 'tx-control-off-step',
        patches: [{ id: 'p-control-off-step', elementId: 'el-a', kind: 'control', property: control.id, before: 1.4, value: 1.45 }],
      },
    }, 'request-control-off-step');
    expect(runtime.messages.filter((message) => message.type === 'transaction-rejected').pop().payload.code).toBe('invalid_value');
    expect(document.querySelector('[data-uncraft-id="el-a"]').style.getPropertyValue('--motion-scale')).toBe('1.4');

    runtime.send('apply-transaction', {
      transaction: {
        id: 'tx-control-escape',
        patches: [{ id: 'p-control-escape', elementId: 'el-a', kind: 'control', property: 'control-bbbbbbbbbbbbbbbbbbbbbbbb', before: '', value: 1 }],
      },
    }, 'request-control-escape');
    expect(runtime.messages.filter((message) => message.type === 'transaction-rejected').pop().payload.code).toBe('control_missing');
    runtime.restore();
  });

  it('executes an instrumented custom adapter only through the sandbox capability registry', () => {
    document.body.innerHTML = '<main><div data-uncraft-id="el-a"></div></main>';
    const bundleId = 'bundle-custom-adapter';
    const runtimeFingerprint = 'sha256:custom-adapter';
    let depth = 1;
    const read = vi.fn(() => depth);
    const apply = vi.fn(({ value }) => { depth = value; });
    window.__uncraftMotionControlCapabilities = {
      'motion.scalar': { read, apply },
    };
    const control = {
      id: 'control-cccccccccccccccccccccccc',
      status: 'ready',
      bundleId,
      runtimeFingerprint,
      controlType: 'slider-number',
      domain: { min: 0, max: 2, step: 0.1 },
      binding: { kind: 'custom-capability', capability: 'motion.scalar', property: 'depth' },
      targets: [{ elementId: 'el-a', motionId: 'custom-motion', property: 'depth' }],
    };
    const runtime = bootV2Runtime({
      bundleId,
      runtimeFingerprint,
      controlManifest: { bundleId, runtimeFingerprint, controls: [control] },
    });

    runtime.send('apply-transaction', {
      transaction: {
        id: 'tx-custom-adapter',
        patches: [{ id: 'p-custom-adapter', elementId: 'el-a', kind: 'control', property: control.id, before: 1, value: 1.6 }],
      },
    }, 'request-custom-adapter');

    expect(depth).toBe(1.6);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      controlId: control.id,
      elementId: 'el-a',
      motionId: 'custom-motion',
      property: 'depth',
      value: 1.6,
    }));
    expect(read).toHaveBeenCalled();
    runtime.restore();
  });

  it('captures gesture before once, previews updates, and commits one acknowledged transaction', () => {
    document.body.innerHTML = '<main><div data-uncraft-id="el-a" style="opacity: 1"></div></main>';
    const runtime = bootV2Runtime();
    runtime.send('begin-gesture', {
      gestureId: 'gesture-1',
      patch: { id: 'p1', elementId: 'el-a', kind: 'style', property: 'opacity', before: 'invented', value: '1' },
    }, 'request-gesture-begin');
    runtime.send('preview-gesture', { gestureId: 'gesture-1', value: '0.8' }, 'request-gesture-preview-1');
    runtime.send('preview-gesture', { gestureId: 'gesture-1', value: '0.2' }, 'request-gesture-preview-2');
    runtime.send('commit-gesture', { gestureId: 'gesture-1', transactionId: 'tx-gesture' }, 'request-gesture-commit');

    const committed = runtime.messages.filter((message) => message.type === 'transaction-committed');
    expect(committed).toHaveLength(1);
    expect(committed[0].payload.transaction.patches).toEqual([
      expect.objectContaining({ before: '1', value: '0.2' }),
    ]);
    runtime.restore();
  });

  it('cancels a preview gesture by restoring before and creating no history transaction', () => {
    document.body.innerHTML = '<main><div data-uncraft-id="el-a" style="opacity: 1"></div></main>';
    const runtime = bootV2Runtime();
    runtime.send('begin-gesture', {
      gestureId: 'gesture-cancel',
      patch: { id: 'p1', elementId: 'el-a', kind: 'style', property: 'opacity', before: 'invented', value: '1' },
    }, 'request-cancel-begin');
    runtime.send('preview-gesture', { gestureId: 'gesture-cancel', value: '0.2' }, 'request-cancel-preview');
    runtime.send('cancel-gesture', { gestureId: 'gesture-cancel' }, 'request-cancel');

    expect(document.querySelector('[data-uncraft-id="el-a"]').style.opacity).toBe('1');
    expect(runtime.messages.filter((message) => message.type === 'transaction-committed')).toHaveLength(0);
    expect(runtime.messages.filter((message) => message.type === 'gesture-canceled').pop().payload.restored).toBe(true);
    runtime.restore();
  });

  it('settles only the selected finite browser writer and leaves unrelated motion live', () => {
    const title = document.getElementById('hero-title');
    const unrelated = document.createElement('div');
    unrelated.id = 'ambient';
    document.body.appendChild(unrelated);
    title.getBoundingClientRect = () => ({ left: 40, top: 40, right: 240, bottom: 140, width: 200, height: 100 });
    unrelated.getBoundingClientRect = () => ({ left: 260, top: 40, right: 360, bottom: 140, width: 100, height: 100 });
    const selectedAnimation = {
      id: 'hero-in', animationName: 'hero-in', currentTime: 120, playState: 'running', playbackRate: 1,
      effect: {
        target: title,
        getTiming: () => ({ delay: 0, duration: 800, endDelay: 0, iterations: 1 }),
        getComputedTiming: () => ({ duration: 800, endTime: 800 }),
        getKeyframes: () => [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }],
      },
      pause: vi.fn(function pause() { this.playState = 'paused'; }),
      play: vi.fn(function play() { this.playState = 'running'; }),
    };
    const ambientAnimation = {
      id: 'ambient-loop', animationName: 'ambient-loop', currentTime: 410, playState: 'running', playbackRate: 1,
      effect: {
        target: unrelated,
        getTiming: () => ({ duration: 1000, iterations: Infinity }),
        getComputedTiming: () => ({ duration: 1000, endTime: Infinity }),
        getKeyframes: () => [],
      },
      pause: vi.fn(), play: vi.fn(),
    };
    title.getAnimations = () => [selectedAnimation];
    unrelated.getAnimations = () => [ambientAnimation];
    document.getAnimations = () => [selectedAnimation, ambientAnimation];

    const runtime = bootV2Runtime();
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const settled = runtime.messages.filter((message) => message.type === 'selection-settled').pop();
    expect(settled.payload).toMatchObject({ elementId: title.dataset.uncraftId, loop: false, writerCount: 1 });
    expect(selectedAnimation.pause).toHaveBeenCalled();
    expect(selectedAnimation.currentTime).toBe(800);
    expect(ambientAnimation.pause).not.toHaveBeenCalled();
    expect(ambientAnimation.currentTime).toBe(410);
    runtime.restore();
  });

  it('freezes a loop at its visible frame and reports Loop without inventing another frame', () => {
    const title = document.getElementById('hero-title');
    title.getBoundingClientRect = () => ({ left: 40, top: 40, right: 240, bottom: 140, width: 200, height: 100 });
    const animation = {
      id: 'marquee', animationName: 'marquee', currentTime: 630, playState: 'running', playbackRate: 1,
      effect: {
        target: title,
        getTiming: () => ({ duration: 1000, iterations: Infinity }),
        getComputedTiming: () => ({ duration: 1000, endTime: Infinity }),
        getKeyframes: () => [],
      },
      pause: vi.fn(function pause() { this.playState = 'paused'; }),
      play: vi.fn(function play() { this.playState = 'running'; }),
    };
    title.getAnimations = () => [animation];
    document.getAnimations = () => [animation];

    const runtime = bootV2Runtime();
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const settled = runtime.messages.filter((message) => message.type === 'selection-settled').pop();
    expect(settled.payload).toMatchObject({ loop: true, progress: 0.63 });
    expect(animation.currentTime).toBe(630);
    expect(animation.pause).toHaveBeenCalledTimes(1);

    runtime.send('inspect-viewport', {}, 'viewport-loop');
    const view = runtime.messages.filter((message) => message.type === 'viewport-motion-changed').pop();
    expect(view.payload.rows.find((row) => row.elementId === title.dataset.uncraftId)).toMatchObject({ loop: true });
    runtime.restore();
  });

  it('restores the live frame for Preview and reinstates the frozen selection on return', () => {
    const title = document.getElementById('hero-title');
    title.getBoundingClientRect = () => ({ left: 40, top: 40, right: 240, bottom: 140, width: 200, height: 100 });
    const animation = {
      id: 'hero-in', animationName: 'hero-in', currentTime: 180, playState: 'running', playbackRate: 1,
      effect: {
        target: title,
        getTiming: () => ({ duration: 800, iterations: 1 }),
        getComputedTiming: () => ({ duration: 800, endTime: 800 }),
        getKeyframes: () => [],
      },
      pause: vi.fn(function pause() { this.playState = 'paused'; }),
      play: vi.fn(function play() { this.playState = 'running'; }),
    };
    title.getAnimations = () => [animation];
    document.getAnimations = () => [animation];
    window.scrollY = 140;

    const runtime = bootV2Runtime();
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(animation.currentTime).toBe(800);
    expect(title).toHaveAttribute('data-uncraft-selected', 'true');

    runtime.send('set-mode', { mode: 'preview' }, 'preview-enter');
    expect(animation.currentTime).toBe(180);
    expect(animation.play).toHaveBeenCalled();
    expect(title).not.toHaveAttribute('data-uncraft-selected');
    expect(runtime.messages.filter((message) => message.type === 'edit-state-changed').pop().payload.state).toBe('previewing');

    runtime.send('set-mode', { mode: 'edit' }, 'preview-exit');
    expect(animation.currentTime).toBe(800);
    expect(title).toHaveAttribute('data-uncraft-selected', 'true');
    expect(runtime.messages.filter((message) => message.type === 'selection-settled').pop().payload.elementId).toBe(title.dataset.uncraftId);
    runtime.restore();
  });

  it('keeps a manually scrubbed frame frozen on release without creating a patch', () => {
    const title = document.getElementById('hero-title');
    title.getBoundingClientRect = () => ({ left: 40, top: 40, right: 240, bottom: 140, width: 200, height: 100 });
    const animation = {
      id: 'hero-in', animationName: 'hero-in', currentTime: 120, playState: 'running', playbackRate: 1,
      effect: {
        target: title,
        getTiming: () => ({ duration: 800, iterations: 1 }),
        getComputedTiming: () => ({ duration: 800, endTime: 800 }),
        getKeyframes: () => [],
      },
      pause: vi.fn(function pause() { this.playState = 'paused'; }),
      play: vi.fn(function play() { this.playState = 'running'; }),
    };
    title.getAnimations = () => [animation];
    document.getAnimations = () => [animation];

    const runtime = bootV2Runtime();
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const motionId = runtime.messages.filter((message) => message.type === 'selection-changed').pop().payload.element.motion[0].id;
    runtime.send('begin-scrub', {}, 'scrub-begin');
    runtime.send('seek-motion', { motionId, currentTime: 360 }, 'scrub-seek');
    runtime.send('end-scrub', {}, 'scrub-end');

    expect(animation.currentTime).toBe(360);
    expect(runtime.messages.filter((message) => message.type === 'edit-state-changed').pop().payload.state).toBe('editing-frozen');
    expect(runtime.messages.some((message) => message.type === 'transaction-committed' || message.type === 'patch-applied')).toBe(false);
    runtime.restore();
  });

  it('settles a scoped GSAP ScrollTrigger, then restores its exact live state on release', () => {
    const title = document.getElementById('hero-title');
    title.getBoundingClientRect = () => ({ left: 40, top: 40, right: 240, bottom: 140, width: 200, height: 100 });
    document.getAnimations = () => [];
    title.getAnimations = () => [];

    let progress = 0.35;
    let totalProgress = 0.35;
    let totalTime = 0.35;
    let paused = false;
    const trigger = {
      start: 120,
      end: 900,
      progress: 0.35,
      enabled: true,
      vars: { scrub: true },
      disable: vi.fn(() => { trigger.enabled = false; }),
      enable: vi.fn(() => { trigger.enabled = true; }),
      update: vi.fn(),
    };
    const tween = {
      targets: () => [title],
      vars: { yPercent: 0, duration: 1 },
      duration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: vi.fn(() => false),
      paused: vi.fn(() => paused),
      timeScale: vi.fn(() => 1),
      progress: vi.fn((value) => {
        if (value === undefined) return progress;
        progress = value;
        return tween;
      }),
      totalProgress: vi.fn((value) => {
        if (value === undefined) return totalProgress;
        totalProgress = value;
        totalTime = value;
        return tween;
      }),
      time: vi.fn(() => totalTime),
      totalTime: vi.fn((value) => {
        if (value === undefined) return totalTime;
        totalTime = value;
        totalProgress = value;
        progress = value;
        return tween;
      }),
      pause: vi.fn(() => { paused = true; return tween; }),
      play: vi.fn(() => { paused = false; return tween; }),
      invalidate: vi.fn(() => tween),
      scrollTrigger: trigger,
    };
    window.gsap = { globalTimeline: { getChildren: () => [tween] }, getProperty: () => '0' };

    const runtime = bootV2Runtime();
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(trigger.disable).toHaveBeenCalledWith(false, false);
    expect(tween.pause).toHaveBeenCalled();
    expect(totalProgress).toBe(1);
    expect(runtime.messages.filter((message) => message.type === 'selection-settled').pop().payload)
      .toMatchObject({ loop: false, writerCount: 1 });

    runtime.send('release-edit-state', {}, 'release-gsap');
    expect(totalTime).toBe(0.35);
    expect(trigger.enable).toHaveBeenCalledWith(false, false);
    expect(trigger.update).toHaveBeenCalled();
    expect(tween.play).toHaveBeenCalled();
    delete window.gsap;
    runtime.restore();
  });

  it('restores the previous writer before freezing a newly selected element', () => {
    const first = document.getElementById('hero-title');
    const second = document.createElement('h2');
    second.textContent = 'Second';
    document.body.appendChild(second);
    const visibleRect = () => ({ left: 40, top: 40, right: 240, bottom: 140, width: 200, height: 100 });
    first.getBoundingClientRect = visibleRect;
    second.getBoundingClientRect = visibleRect;
    const makeAnimation = (target, currentTime, endTime) => ({
      currentTime,
      playState: 'running',
      playbackRate: 1,
      effect: {
        target,
        getTiming: () => ({ duration: endTime, iterations: 1 }),
        getComputedTiming: () => ({ duration: endTime, endTime }),
        getKeyframes: () => [],
      },
      pause: vi.fn(function pause() { this.playState = 'paused'; }),
      play: vi.fn(function play() { this.playState = 'running'; }),
    });
    const firstAnimation = makeAnimation(first, 125, 800);
    const secondAnimation = makeAnimation(second, 210, 600);
    first.getAnimations = () => [firstAnimation];
    second.getAnimations = () => [secondAnimation];
    document.getAnimations = () => [firstAnimation, secondAnimation];

    const runtime = bootV2Runtime();
    first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(firstAnimation.currentTime).toBe(800);
    second.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(firstAnimation.currentTime).toBe(125);
    expect(firstAnimation.play).toHaveBeenCalled();
    expect(secondAnimation.currentTime).toBe(600);
    expect(secondAnimation.pause).toHaveBeenCalled();
    runtime.restore();
  });

  it('re-settles after scroll and treats duplicate selection as idempotent', () => {
    vi.useFakeTimers();
    const title = document.getElementById('hero-title');
    title.getBoundingClientRect = () => ({ left: 40, top: 40, right: 240, bottom: 140, width: 200, height: 100 });
    const animation = {
      currentTime: 120,
      playState: 'running',
      playbackRate: 1,
      effect: {
        target: title,
        getTiming: () => ({ duration: 800, iterations: 1 }),
        getComputedTiming: () => ({ duration: 800, endTime: 800 }),
        getKeyframes: () => [],
      },
      pause: vi.fn(function pause() { this.playState = 'paused'; }),
      play: vi.fn(function play() { this.playState = 'running'; }),
    };
    title.getAnimations = () => [animation];
    document.getAnimations = () => [animation];

    const runtime = bootV2Runtime();
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(animation.pause).toHaveBeenCalledTimes(1);
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(animation.pause).toHaveBeenCalledTimes(1);
    expect(runtime.messages.filter((message) => message.type === 'selection-settled').pop().payload.duplicate).toBe(true);

    window.dispatchEvent(new Event('scroll'));
    expect(animation.currentTime).toBe(120);
    expect(animation.play).toHaveBeenCalled();
    expect(runtime.messages.filter((message) => message.type === 'edit-state-changed').pop().payload.state).toBe('navigating');
    vi.advanceTimersByTime(120);
    expect(animation.currentTime).toBe(800);
    expect(animation.pause).toHaveBeenCalledTimes(2);
    expect(runtime.messages.filter((message) => message.type === 'edit-state-changed').pop().payload.state).toBe('editing-frozen');
    runtime.restore();
    vi.useRealTimers();
  });

  it('does not settle a one-pixel sliver that is technically inside the viewport', () => {
    const title = document.getElementById('hero-title');
    title.getBoundingClientRect = () => ({ left: -199, top: 40, right: 1, bottom: 140, width: 200, height: 100 });
    const animation = {
      currentTime: 120,
      playState: 'running',
      playbackRate: 1,
      effect: {
        target: title,
        getTiming: () => ({ duration: 800, iterations: 1 }),
        getComputedTiming: () => ({ duration: 800, endTime: 800 }),
        getKeyframes: () => [],
      },
      pause: vi.fn(),
      play: vi.fn(),
    };
    title.getAnimations = () => [animation];
    document.getAnimations = () => [animation];

    const runtime = bootV2Runtime();
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(animation.pause).not.toHaveBeenCalled();
    expect(animation.currentTime).toBe(120);
    expect(runtime.messages.filter((message) => message.type === 'selection-settlement-skipped').pop().payload.reason)
      .toBe('not-meaningfully-visible');
    runtime.restore();
  });

  it('ignores commands from the wrong origin, bundle, nonce, session, or runtime generation', () => {
    document.body.innerHTML = '<main><div data-uncraft-id="el-a" style="opacity: 1"></div></main>';
    const runtime = bootV2Runtime();
    const payload = {
      transaction: {
        id: 'tx-foreign',
        patches: [{ id: 'p1', elementId: 'el-a', kind: 'style', property: 'opacity', before: '1', value: '0.1' }],
      },
    };
    const base = commandV2('apply-transaction', payload, { ...runtime.context, requestId: 'request-foreign' });
    const variants = [
      { message: base, origin: 'https://other.test' },
      { message: { ...base, bundleId: 'other-bundle' }, origin: 'https://app.uncraft.test' },
      { message: { ...base, sessionNonce: 'other-nonce-1234' }, origin: 'https://app.uncraft.test' },
      { message: { ...base, sessionId: 'other-session' }, origin: 'https://app.uncraft.test' },
      { message: { ...base, runtimeGeneration: runtime.context.runtimeGeneration + 1 }, origin: 'https://app.uncraft.test' },
    ];
    variants.forEach(({ message, origin }) => window.dispatchEvent(new MessageEvent('message', { source: window, origin, data: message })));

    expect(document.querySelector('[data-uncraft-id="el-a"]').style.opacity).toBe('1');
    expect(runtime.messages.filter((message) => message.type === 'transaction-committed')).toHaveLength(0);
    runtime.restore();
  });

  it('emits heartbeat and responds with scoped runtime health', () => {
    vi.useFakeTimers();
    const runtime = bootV2Runtime();
    vi.advanceTimersByTime(1100);
    expect(runtime.messages.some((message) => message.type === 'heartbeat')).toBe(true);
    runtime.send('health-check', {}, 'request-health');
    expect(runtime.messages.filter((message) => message.type === 'runtime-health').pop().payload)
      .toMatchObject({ status: 'healthy' });
    runtime.restore();
    vi.useRealTimers();
  });

  it('enumerates browser writer ownership and retargets the existing final keyframe without changing timing', () => {
    const title = document.getElementById('hero-title');
    let keyframes = [
      { computedOffset: 0, opacity: '0', easing: 'ease-out' },
      { computedOffset: 1, opacity: '1' },
    ];
    const setKeyframes = vi.fn((next) => { keyframes = next; });
    const updateTiming = vi.fn();
    const animation = {
      id: 'hero-entrance',
      animationName: 'hero-entrance',
      currentTime: 400,
      playState: 'paused',
      playbackRate: 1,
      effect: {
        target: title,
        getTiming: () => ({ delay: 0, duration: 800, iterations: 1, direction: 'normal', fill: 'both', easing: 'ease-out' }),
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
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion[0];
    expect(motion.tracks[0].ownership).toMatchObject({
      behavior: 'entrance',
      relationship: 'independent',
      targetId: selection.payload.element.id,
      runtimeProperty: 'opacity',
      retargetable: true,
    });

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
            property: 'retarget.final',
            before: {
              schemaVersion: 2,
              semanticProperty: 'opacity',
              runtimeProperty: 'opacity',
              value: '1',
            },
            value: {
              schemaVersion: 2,
              semanticProperty: 'opacity',
              runtimeProperty: 'opacity',
              value: '0.7',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:opacity`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));

    expect(setKeyframes).toHaveBeenLastCalledWith([
      { offset: 0, opacity: '0', easing: 'ease-out' },
      { offset: 1, opacity: '0.7' },
    ]);
    expect(setKeyframes.mock.calls.at(-1)[0]).toHaveLength(2);
    expect(updateTiming).not.toHaveBeenCalled();
    expect(animation.currentTime).toBe(400);
    window.__uncraftMotionBridge?.teardown?.();
    window.postMessage = originalPostMessage;
  });

  it('retargets one browser transform component without disturbing the other authored components', () => {
    document.body.innerHTML = '<main><div id="card" aria-label="Feature card"></div></main>';
    const card = document.getElementById('card');
    let keyframes = [
      { computedOffset: 0, transform: 'rotate(12deg) scale(1.2) translateX(-40px)' },
      { computedOffset: 1, transform: 'rotate(12deg) scale(1.2) translateX(20px)' },
    ];
    const setKeyframes = vi.fn((next) => { keyframes = next; });
    const animation = {
      id: 'card-entrance',
      currentTime: 500,
      playState: 'paused',
      effect: {
        target: card,
        getTiming: () => ({ duration: 1000, iterations: 1, easing: 'power2.out' }),
        getComputedTiming: () => ({ duration: 1000 }),
        getKeyframes: () => keyframes,
        setKeyframes,
        updateTiming: vi.fn(),
      },
      pause: vi.fn(),
      play: vi.fn(),
    };
    card.getAnimations = () => [animation];
    document.getAnimations = () => [animation];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion[0];
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
            property: 'retarget.final',
            before: {
              schemaVersion: 2,
              semanticProperty: 'translateX',
              runtimeProperty: 'transform',
              component: 'translateX',
              value: '20px',
            },
            value: {
              schemaVersion: 2,
              semanticProperty: 'translateX',
              runtimeProperty: 'transform',
              component: 'translateX',
              value: '80px',
              writeModel: 'absolute',
              owner: { motionId: motion.id },
            },
          },
        },
      },
    }));

    expect(setKeyframes).toHaveBeenLastCalledWith([
      { offset: 0, transform: 'rotate(12deg) scale(1.2) translateX(-40px)' },
      { offset: 1, transform: 'rotate(12deg) scale(1.2) translateX(80px)' },
    ]);
    window.__uncraftMotionBridge?.teardown?.();
    window.postMessage = originalPostMessage;
  });

  it('shifts a looping browser animation around its visible frozen value', () => {
    document.body.innerHTML = '<main><div id="pulse" aria-label="Pulse"></div></main>';
    const pulse = document.getElementById('pulse');
    pulse.style.opacity = '0.5';
    let keyframes = [
      { computedOffset: 0, opacity: '0.2' },
      { computedOffset: 1, opacity: '0.8' },
    ];
    const setKeyframes = vi.fn((next) => { keyframes = next; });
    const animation = {
      id: 'pulse-loop',
      currentTime: 400,
      playState: 'paused',
      effect: {
        target: pulse,
        getTiming: () => ({ duration: 1000, iterations: Infinity, easing: 'ease-in-out' }),
        getComputedTiming: () => ({ duration: 1000 }),
        getKeyframes: () => keyframes,
        setKeyframes,
        updateTiming: vi.fn(),
      },
      pause: vi.fn(),
      play: vi.fn(),
    };
    pulse.getAnimations = () => [animation];
    document.getAnimations = () => [animation];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());
    pulse.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion[0];
    expect(motion.tracks[0].ownership.writeModel).toBe('additive-base');
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
            property: 'retarget.final',
            before: {
              schemaVersion: 2,
              semanticProperty: 'opacity',
              runtimeProperty: 'opacity',
              value: '0.5',
            },
            value: {
              schemaVersion: 2,
              semanticProperty: 'opacity',
              runtimeProperty: 'opacity',
              value: '0.7',
              writeModel: 'additive-base',
              owner: { motionId: motion.id },
            },
          },
        },
      },
    }));

    expect(setKeyframes).toHaveBeenLastCalledWith([
      { offset: 0, opacity: '0.4' },
      { offset: 1, opacity: '1' },
    ]);
    expect(animation.currentTime).toBe(400);
    window.__uncraftMotionBridge?.teardown?.();
    window.postMessage = originalPostMessage;
  });

  it('preserves a relative GSAP expression while retargeting its measured final value', () => {
    document.body.innerHTML = '<main><div id="mark" aria-label="Moving mark"></div></main>';
    const mark = document.getElementById('mark');
    const rendered = { x: 0 };
    let progress = 0.5;
    const vars = { id: 'mark-entrance', x: '+=100', duration: 1, ease: 'power2.out' };
    const resolveFinal = () => {
      const match = String(vars.x).match(/^([+-])=(\d+(?:\.\d+)?)$/);
      if (match) return (match[1] === '-' ? -1 : 1) * Number(match[2]);
      return Number(vars.x);
    };
    const tween = {
      vars,
      targets: () => [mark],
      duration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => true,
      startTime: () => 0,
      globalTime: () => 0,
      progress: vi.fn((next) => {
        if (next === undefined) return progress;
        progress = next;
        rendered.x = resolveFinal() * next;
        return tween;
      }),
      invalidate: vi.fn(() => tween),
    };
    tween.progress(progress);
    window.gsap = {
      globalTimeline: { getChildren: () => [tween] },
      getProperty: (_target, property) => rendered[property],
    };
    document.getAnimations = () => [];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());
    mark.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(motion.tracks[0].ownership).toMatchObject({ writeModel: 'relative', retargetable: true });
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
            property: 'retarget.final',
            before: {
              schemaVersion: 2,
              semanticProperty: 'translateX',
              runtimeProperty: 'x',
              value: '100',
            },
            value: {
              schemaVersion: 2,
              semanticProperty: 'translateX',
              runtimeProperty: 'x',
              value: '140',
              writeModel: 'relative',
              owner: { motionId: motion.id },
            },
          },
        },
      },
    }));

    expect(vars.x).toBe('+=140');
    expect(vars.ease).toBe('power2.out');
    expect(progress).toBe(0.5);
    expect(rendered.x).toBe(70);
    window.__uncraftMotionBridge?.teardown?.();
    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('wraps a single-target function-valued GSAP property instead of replacing its authored function', () => {
    document.body.innerHTML = '<main><div id="badge" aria-label="Moving badge"></div></main>';
    const badge = document.getElementById('badge');
    const rendered = { x: 0 };
    let progress = 0.25;
    const authored = (index) => 100 + (index * 20);
    const vars = { id: 'badge-motion', x: authored, duration: 2, ease: 'none' };
    const tween = {
      vars,
      targets: () => [badge],
      duration: () => 2,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => true,
      startTime: () => 0,
      globalTime: () => 0,
      progress: vi.fn((next) => {
        if (next === undefined) return progress;
        progress = next;
        const final = typeof vars.x === 'function' ? Number(vars.x(0, badge, [badge])) : Number(vars.x);
        rendered.x = final * next;
        return tween;
      }),
      invalidate: vi.fn(() => tween),
    };
    tween.progress(progress);
    window.gsap = {
      globalTimeline: { getChildren: () => [tween] },
      getProperty: (_target, property) => rendered[property],
    };
    document.getAnimations = () => [];

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());
    badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    expect(motion.tracks[0].ownership).toMatchObject({ writeModel: 'function-offset', retargetable: true });
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
            property: 'retarget.final',
            before: {
              schemaVersion: 2,
              semanticProperty: 'translateX',
              runtimeProperty: 'x',
              value: '100',
            },
            value: {
              schemaVersion: 2,
              semanticProperty: 'translateX',
              runtimeProperty: 'x',
              value: '150',
              writeModel: 'function-offset',
              owner: { motionId: motion.id },
            },
          },
        },
      },
    }));

    expect(vars.x).not.toBe(authored);
    expect(vars.x(0, badge, [badge])).toBe('150');
    expect(vars.x(2, badge, [badge])).toBe('190');
    expect(progress).toBe(0.25);
    expect(rendered.x).toBe(37.5);
    window.__uncraftMotionBridge?.teardown?.();
    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('commits and rolls back an ownership hint with its final-target retarget as one v2 transaction', () => {
    document.body.innerHTML = '<main><div id="hero" data-uncraft-id="el-hero" aria-label="Hero"></div></main>';
    const hero = document.getElementById('hero');
    let keyframes = [
      { computedOffset: 0, opacity: '0' },
      { computedOffset: 1, opacity: '1' },
    ];
    const setKeyframes = vi.fn((next) => { keyframes = next; });
    const animation = {
      id: 'hero-entrance',
      currentTime: 1000,
      playState: 'paused',
      effect: {
        target: hero,
        getTiming: () => ({ duration: 1000, iterations: 1, easing: 'ease-out' }),
        getComputedTiming: () => ({ duration: 1000 }),
        getKeyframes: () => keyframes,
        setKeyframes,
        updateTiming: vi.fn(),
      },
      pause: vi.fn(),
      play: vi.fn(),
    };
    hero.getAnimations = () => [animation];
    document.getAnimations = () => [animation];

    const runtime = bootV2Runtime();
    hero.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = runtime.messages.filter((message) => message.type === 'selection-changed').pop();
    const motion = selection.payload.element.motion[0];
    const channelId = `${motion.id}:opacity`;
    runtime.send('apply-transaction', {
      transaction: {
        id: 'tx-own-opacity',
        patches: [
          {
            id: 'hint-opacity',
            elementId: 'el-hero',
            kind: 'motion',
            motionId: motion.id,
            property: 'ownership.hint',
            before: null,
            value: {
              schemaVersion: 1,
              semanticProperty: 'opacity',
              channelId,
              motionId: motion.id,
            },
          },
          {
            id: 'retarget-opacity',
            elementId: 'el-hero',
            kind: 'motion',
            motionId: motion.id,
            property: 'retarget.final',
            before: {
              schemaVersion: 2,
              semanticProperty: 'opacity',
              runtimeProperty: 'opacity',
              value: '1',
            },
            value: {
              schemaVersion: 2,
              semanticProperty: 'opacity',
              runtimeProperty: 'opacity',
              value: '0.65',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId, motionId: motion.id },
            },
          },
        ],
      },
    }, 'request-own-opacity');

    const committed = runtime.messages.filter((message) => message.type === 'transaction-committed').pop();
    expect(committed.payload.transaction.patches[0].before).toEqual({
      schemaVersion: 1,
      semanticProperty: 'opacity',
      channelId: null,
      motionId: null,
    });
    expect(committed.payload.transaction.patches[1]).toMatchObject({
      before: { value: '1' },
      value: { value: '0.65' },
    });
    expect(keyframes.at(-1).opacity).toBe('0.65');

    runtime.send('rollback-transaction', {
      targetTransactionId: 'tx-own-opacity',
      transactionId: 'tx-own-opacity-undo',
    }, 'request-own-opacity-undo');

    expect(keyframes.at(-1).opacity).toBe('1');
    expect(runtime.messages.filter((message) => message.type === 'transaction-rejected')).toHaveLength(0);
    expect(runtime.messages.filter((message) => message.type === 'transaction-committed').pop().payload.operation)
      .toBe('rollback');
    runtime.restore();
  });

  it('reinspects stale targets and locally regenerates a changed animation binding', () => {
    document.body.innerHTML = '<main><div id="hero" data-uncraft-id="hero"></div></main>';
    const hero = document.getElementById('hero');
    let duration = 800;
    const updateTiming = vi.fn((next) => { if (Number.isFinite(next?.duration)) duration = next.duration; });
    const animation = {
      id: 'replacement-motion',
      animationName: 'replacement-motion',
      currentTime: 0,
      playState: 'paused',
      playbackRate: 1,
      effect: {
        target: hero,
        getTiming: () => ({ delay: 0, duration, iterations: 1, direction: 'normal', fill: 'both', easing: 'linear' }),
        getComputedTiming: () => ({ duration }),
        getKeyframes: () => [{ computedOffset: 0, opacity: '0' }, { computedOffset: 1, opacity: '1' }],
        updateTiming,
      },
      pause: vi.fn(),
      play: vi.fn(),
    };
    hero.getAnimations = () => [animation];
    document.getAnimations = () => [animation];
    const control = {
      id: 'control-aaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'ready',
      scope: 'animation',
      controlType: 'slider-number',
      currentValue: 800,
      originalValue: 800,
      domain: { min: 200, max: 1600, step: 100 },
      binding: { kind: 'known-runtime', engine: 'waapi', property: 'timing.duration' },
      targets: [{ semanticTargetId: 'hero', elementId: 'hero', motionId: 'stale-motion', property: 'timing.duration' }],
      bundleId: 'bundle-fixture',
      runtimeFingerprint: 'sha256:fixture',
    };
    const runtime = bootV2Runtime({
      controlManifest: {
        schemaVersion: 1,
        bundleId: 'bundle-fixture',
        runtimeFingerprint: 'sha256:fixture',
        controls: [control],
      },
    });

    runtime.send('recover-control', {
      controlId: control.id,
      stage: 'reinspect',
    }, 'recover-reinspect');
    expect(runtime.messages.filter((message) => message.type === 'control-recovery-result').pop().payload)
      .toMatchObject({ recovered: false, code: 'motion_missing', stage: 'reinspect' });

    runtime.send('recover-control', {
      controlId: control.id,
      stage: 'regenerate-control',
    }, 'recover-regenerate');
    const regenerated = runtime.messages.filter((message) => message.type === 'control-recovery-result').pop();
    expect(regenerated.payload).toMatchObject({ recovered: true, stage: 'regenerate-control' });
    expect(regenerated.payload.control.targets[0].motionId).not.toBe('stale-motion');
    expect(updateTiming).toHaveBeenCalled();
    runtime.restore();
  });

  it('reports runtime exceptions with a sanitized stable code only', () => {
    const runtime = bootV2Runtime();
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'secret page text at /private/site.js:42',
      error: new Error('credential-shaped-value'),
    }));

    const failure = runtime.messages.filter((message) => message.type === 'runtime-failure').pop();
    expect(failure.payload).toMatchObject({
      code: 'runtime_exception',
      diagnostics: { code: 'runtime_exception' },
    });
    expect(JSON.stringify(failure.payload)).not.toMatch(/secret|private|credential|site\.js/i);
    runtime.restore();
  });
});
