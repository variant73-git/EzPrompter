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

    // The ARRAY form has a proven safe write path: editing the ENTRIES of
    // vars.keyframes + preserved-start invalidate (probe 2026-07-29). So the
    // plain-value `x` flips retargetable/step-editable, while `scale` (a
    // component-decomposed property — entry writes unproven) stays locked and
    // the plain top-level `y` keeps its retargetability.
    expect(xTrack.ownership.retargetable).toBe(true);
    expect(xTrack.keyframeEditable).toBe(true);
    expect(xTrack.keyframeEditReason).toBeUndefined();
    expect(scaleTrack.ownership.retargetable).toBe(false);
    expect(scaleTrack.keyframeEditable).toBe(false);
    expect(scaleTrack.keyframeEditReason).toBe('keyframes');
    expect(motion.tracks.find((track) => track.property === 'y').ownership.retargetable).toBe(true);
    // Derived from the tracks: the editable array-form x enables the clip.
    expect(motion.capabilities.keyframes).toBe(true);

    // The step edit routes through the ENTRIES — vars.x must never be written
    // (probe: vars writes corrupt the path start even with preserved-start).
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
    expect(vars.startAt).toBeUndefined();
    expect(vars.keyframes[1].x).toBe(160);
    expect(vars.keyframes[0].x).toBe(0);
    expect(tween.invalidate).toHaveBeenCalled();

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
        { x: 0, duration: 1, parent: {} },
        { x: 60, duration: 1, parent: {} },
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

  // ---- FEATURE caminho-seguro: entry-edit da forma ARRAY de vars.keyframes ------
  // Probe 2026-07-29 (_probe-kf-entryedit.mjs, GSAP 3.15 real): editar as ENTRADAS
  // + invalidatePreservingStart rende path limpo (trailing run; intermediárias e
  // duplicatas não-trailing intactas; css DENTRO de entry honrado; startAt pós-hoc
  // limpo). Both-places segue trancado (o invalidate RESSUSCITA o top-level morto).

  const buildArrayKeyframesTween = (target, vars, { repeat = 0, targets } = {}) => {
    const rendered = { x: 0 };
    const tween = {
      targets: () => targets || [target],
      vars,
      duration: () => Number(vars.duration) || 2,
      delay: () => 0,
      repeat: () => repeat,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressMock(p) {
        if (p === undefined) return progressMock.current || 0;
        progressMock.current = p;
        const entries = Array.isArray(vars.keyframes)
          ? vars.keyframes.filter((entry) => entry && Object.prototype.hasOwnProperty.call(entry, 'x'))
          : [];
        const end = entries.length ? Number(entries[entries.length - 1].x) : 0;
        rendered.x = end * p;
        return tween;
      }),
      invalidate: vi.fn(() => tween),
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [tween] },
      getProperty: (element, prop) => String(rendered[prop] ?? ''),
    };
    return tween;
  };

  const grabMotion = (target, messages) => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.filter((message) => message.type === 'selection-changed').pop();
    return { selection, motion: selection.payload.element.motion.find((clip) => clip.engine === 'GSAP') };
  };

  const sendRetarget = (selection, motion, value) => {
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
            before: { schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value: '0' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'translateX',
              runtimeProperty: 'x',
              value,
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:translateX`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
  };

  it('retargets the ARRAY keyframes form by editing the trailing-run ENTRIES only', () => {
    document.body.innerHTML = '<main><div id="kfa"></div></main>';
    const target = document.getElementById('kfa');
    // Carrying entries [0, 60, 60] -> trailing run = the LAST TWO (value == end).
    // The y values, injected config keys and per-entry durations must survive.
    const vars = {
      keyframes: [
        { x: 0, y: 10, duration: 1, parent: {}, ease: 'none', overwrite: 'auto', delay: 0 },
        { x: 60, y: 20, duration: 1, parent: {}, ease: 'none', overwrite: 'auto', delay: 0 },
        { x: 60, duration: 1, parent: {}, ease: 'none', overwrite: 'auto', delay: 0 },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(true);

    sendRetarget(selection, motion, '160');

    expect(vars.keyframes.map((entry) => entry.x)).toEqual([0, 160, 160]);
    expect(vars.keyframes.map((entry) => entry.y)).toEqual([10, 20, undefined]);
    expect(vars.keyframes.map((entry) => entry.duration)).toEqual([1, 1, 1]);
    expect(vars.x).toBeUndefined();
    expect(vars.startAt).toBeUndefined();
    expect(tween.invalidate).toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('restores the EXACT authored entries on rollback even when the new value collides with an intermediate entry', () => {
    document.body.innerHTML = '<main><div id="kfu"></div></main>';
    const target = document.getElementById('kfu');
    // [100, 200] -> retarget end to 100 (collides with entry 0). The edited-entry
    // set is FROZEN at first write: rolling back to 200 must restore [100, 200],
    // never [200, 200] (a recomputed trailing run would swallow entry 0).
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '100');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 100]);

    sendRetarget(selection, motion, '200');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('writes entry-edits INTO an entry-level css wrapper when the property lives there', () => {
    document.body.innerHTML = '<main><div id="kfc"></div></main>';
    const target = document.getElementById('kfc');
    // GSAP honors css:{} INSIDE keyframes entries (probe E) — the write must land
    // in entry.css, never as a sibling entry.x.
    const vars = { keyframes: [{ css: { x: 30 }, duration: 1, parent: {} }, { css: { x: 60 }, duration: 1, parent: {} }], duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(true);

    sendRetarget(selection, motion, '160');
    expect(vars.keyframes[1].css.x).toBe(160);
    expect(vars.keyframes[0].css.x).toBe(30);
    expect(vars.keyframes[1].x).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('edits the START of an array keyframes tween via startAt and refuses intermediate steps', () => {
    document.body.innerHTML = '<main><div id="kfs"></div></main>';
    const target = document.getElementById('kfs');
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const sendKeyframe = (offset, value) => window.dispatchEvent(new MessageEvent('message', {
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
            before: { offset, value: '', exists: true },
            value: { offset, value, exists: true },
          },
        },
      },
    }));

    // startAt post-hoc is clean on keyframes tweens (probe G) — offset-0 edits land there.
    sendKeyframe(0, '40');
    expect(vars.startAt).toEqual({ x: '40' });
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(tween.invalidate).toHaveBeenCalled();

    // Intermediate steps stay phase-2: nothing may be written.
    tween.invalidate.mockClear();
    sendKeyframe(0.5, '150');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(vars.startAt).toEqual({ x: '40' });
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('reads the final step of an array keyframes tween from its ENTRIES so transactions can roll it back (Sol r1)', () => {
    document.body.innerHTML = '<main><div id="kfv"></div></main>';
    const target = document.getElementById('kfv');
    // The transactional reader must see the entry-driven end ({exists:true}, the
    // trailing entry's value — entry.css included) or before/value both read
    // {exists:false}: undo becomes a no-op and validate-transaction "restores"
    // while leaving the edit applied.
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-kf-step',
            patches: [{
              id: 'p-kf-step',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframe.x',
              before: { offset: 1, value: '200', exists: true },
              value: { offset: 1, value: '160', exists: true },
            }],
          },
        },
      },
    }));
    const validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(true);
    // The probe transaction must leave NOTHING behind: entries restored exactly.
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(vars.x).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  // ---- FASE-2 timeline: steps[] endereçáveis por rawEntryIndex ------------------
  // Design-lock Sol r0–r3 (2026-07-31): endereço canônico transacional =
  // rawEntryIndex (índice na ordem VIVA das entries — allEntries do plano);
  // endOffset = endpoint renderizado do child / tl.duration(), POSICIONAMENTO
  // apenas (probe zero-dur: endpoints duplicam; total-zero: 0/0 → null).

  it('exposes addressable steps with RAW entry indexes (missing-prop entries keep their slot)', () => {
    document.body.innerHTML = '<main><div id="kst"></div></main>';
    const target = document.getElementById('kst');
    // [{x:100},{opacity:.5},{x:300}] — o 2º carrier de x é a entry RAW 2 (probe E):
    // um índice de bucket filtrado leria/escreveria a entry errada.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { opacity: 0.5, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps).toEqual([
      { entryIndex: 0, offset: null, value: '100', editable: true, token: expect.any(String) },
      { entryIndex: 2, offset: null, value: '300', editable: false, reason: 'final', isEnd: true, token: expect.any(String) },
    ]);
    const opacityTrack = motion.tracks.find((track) => track.property === 'opacity');
    // Carrier único = o próprio run: sem step intermediário, edita pelo end.
    expect(opacityTrack.steps).toEqual([{ entryIndex: 1, offset: null, value: '0.5', editable: false, reason: 'final', isEnd: true, token: expect.any(String) }]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('positions steps at the child RENDERED ENDPOINT normalized by the inner timeline duration', () => {
    document.body.innerHTML = '<main><div id="kso"></div></main>';
    const target = document.getElementById('kso');
    // Probe B/zero-dur: endpoints vêm de startTime()+duration() dos children,
    // normalizados por tl.duration() (NUNCA pelo duration do parent — stretch);
    // duration:0 no meio duplica o endpoint (offsets iguais, entryIndex distintos).
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 0, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 2,
    };
    const tween = buildArrayKeyframesTween(target, vars);
    const childFor = (entry, start, dur) => ({
      vars: entry, startTime: () => start, duration: () => dur, _initted: true,
    });
    tween.timeline = {
      duration: () => 2,
      getChildren: () => [
        childFor(vars.keyframes[0], 0, 1),
        childFor(vars.keyframes[1], 1, 0),
        childFor(vars.keyframes[2], 1, 1),
      ],
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps).toEqual([
      { entryIndex: 0, offset: 0.5, value: '100', editable: true, token: expect.any(String) },
      { entryIndex: 1, offset: 0.5, value: '200', editable: true, token: expect.any(String) },
      { entryIndex: 2, offset: 1, value: '300', editable: false, reason: 'final', isEnd: true, token: expect.any(String) },
    ]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('reports null step offsets when the inner timeline duration is zero (0/0 has no address)', () => {
    document.body.innerHTML = '<main><div id="ksz"></div></main>';
    const target = document.getElementById('ksz');
    const vars = {
      keyframes: [
        { x: 100, duration: 0, parent: {} },
        { x: 200, duration: 0, parent: {} },
      ],
      duration: 0,
    };
    const tween = buildArrayKeyframesTween(target, vars);
    const childFor = (entry) => ({ vars: entry, startTime: () => 0, duration: () => 0, _initted: true });
    tween.timeline = {
      duration: () => 0,
      getChildren: () => [childFor(vars.keyframes[0]), childFor(vars.keyframes[1])],
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps).toEqual([
      { entryIndex: 0, offset: null, value: '100', editable: true, token: expect.any(String) },
      { entryIndex: 1, offset: null, value: '200', editable: false, reason: 'final', isEnd: true, token: expect.any(String) },
    ]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  const sendStep = (selection, motion, property, entryIndex, value) => {
    // Como a UI real: o token vem da exposição (steps[]) da inspeção corrente.
    const track = motion.tracks.find((candidate) => candidate.property === property);
    const token = track?.steps?.find((step) => step.entryIndex === entryIndex)?.token;
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
            property: `keyframeStep.${property}`,
            before: { entryIndex, token, value: '', exists: true },
            value: { entryIndex, token, value, exists: true },
          },
        },
      },
    }));
  };

  it('a pre-first-write REORDER with equal values refuses — the exposure token pins the entry the UI showed (Sol r19)', () => {
    document.body.innerHTML = '<main><div id="ksw2"></div></main>';
    const target = document.getElementById('ksw2');
    // A (idx1, dur 1) e B (idx2, dur 2) com o MESMO x=200: a página troca as
    // duas ANTES do primeiro write. Sem token, o freeze aconteceria no write e
    // a identidade passaria trivialmente (plano comparado com ele mesmo) —
    // editando/journalando a entry errada sem detecção possível por valor.
    const entryA = { x: 200, duration: 1, parent: {} };
    const entryB = { x: 200, duration: 2, parent: {} };
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        entryA,
        entryB,
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 5,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // Página troca A/B antes do 1º write.
    vars.keyframes[1] = entryB;
    vars.keyframes[2] = entryA;
    sendStep(selection, motion, 'x', 1, '500');
    expect(entryA.x).toBe(200);
    expect(entryB.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Re-inspeção re-expõe a verdade atual — o edit volta a funcionar.
    const regrab = grabMotion(target, messages);
    sendStep(regrab.selection, regrab.motion, 'x', 1, '500');
    expect(entryB.x).toBe(500);
    expect(entryA.x).toBe(200);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('edits an INTERMEDIATE keyframe entry by raw index and restores it verbatim on rollback', () => {
    document.body.innerHTML = '<main><div id="kse"></div></main>';
    const target = document.getElementById('kse');
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '500');
    // Escrita coerce: bucket numérico recebe NÚMERO (como o entry-edit).
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 300]);
    expect(tween.invalidate).toHaveBeenCalled();

    // Rollback = valor original → restore VERBATIM (número 200, nunca '200').
    sendStep(selection, motion, 'x', 1, '200');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200, 300]);
    expect(vars.keyframes[1].x).toBe(200);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('refuses step edits on FROZEN trailing-run members — the end edit owns the hold', () => {
    document.body.innerHTML = '<main><div id="ksh"></div></main>';
    const target = document.getElementById('ksh');
    // [100, 200, 200]: run congelado = entries 1 e 2. Editar um membro
    // individualmente divergiria o run e o value-replay do undo do retarget
    // não representa estado divergente (Sol F1 — journal separado por writer).
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '250');
    sendStep(selection, motion, 'x', 2, '250');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200, 200]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('addresses steps by RAW entry index — a missing-prop entry refuses instead of shifting', () => {
    document.body.innerHTML = '<main><div id="ksr"></div></main>';
    const target = document.getElementById('ksr');
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { opacity: 0.5, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // raw 1 não carrega x — recusa, nada escrito (um índice de bucket teria
    // editado a entry errada).
    sendStep(selection, motion, 'x', 1, '150');
    expect(vars.keyframes[1]).toEqual({ opacity: 0.5, duration: 1, parent: {} });
    expect(tween.invalidate).not.toHaveBeenCalled();
    // raw 0 é intermediária de x — edita.
    sendStep(selection, motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(150);
    expect(vars.keyframes[2].x).toBe(300);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('journals step edits and trailing retargets independently — LIFO undo restores each exactly', () => {
    document.body.innerHTML = '<main><div id="ksj"></div></main>';
    const target = document.getElementById('ksj');
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '500');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 300]);
    sendRetarget(selection, motion, '350');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 350]);
    // Undo LIFO: primeiro o retarget (volta ao fim autoral, verbatim)...
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 300]);
    expect(vars.keyframes[2].x).toBe(300);
    // ...depois o step (volta ao autoral do índice, verbatim).
    sendStep(selection, motion, 'x', 1, '200');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200, 300]);
    expect(vars.keyframes[1].x).toBe(200);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('pre-simulates step writes — a cross-unit value that would null the next plan refuses BEFORE mutating (Sol r5)', () => {
    document.body.innerHTML = '<main><div id="ksa"></div></main>';
    const target = document.getElementById('ksa');
    // ['100px','200px','300px']: escrever '250' (sem unidade) no idx1 faz o
    // walk do PRÓXIMO plano comparar '250'×'300px' → ambiguous → plano null →
    // entryBindingState (re-plan structuralOnly) marca o binding stale → o
    // rollback pra '200px' é recusado: mutação aplicada sem inversa (classe r2).
    const vars = {
      keyframes: [
        { x: '100px', duration: 1, parent: {} },
        { x: '200px', duration: 1, parent: {} },
        { x: '300px', duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // Recusa SEM invalidate e sem journal.
    sendStep(selection, motion, 'x', 1, '250');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['100px', '200px', '300px']);
    expect(tween.invalidate).not.toHaveBeenCalled();
    // Mesmo número COM unidade escreve e o rollback restaura verbatim.
    sendStep(selection, motion, 'x', 1, '250px');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['100px', '250px', '300px']);
    sendStep(selection, motion, 'x', 1, '200px');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['100px', '200px', '300px']);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps a collided step editable after re-inspection — UI ownership follows the FROZEN run (Sol r6)', () => {
    document.body.innerHTML = '<main><div id="ksf"></div></main>';
    const target = document.getElementById('ksf');
    // [100,200,300] → step idx1 = 300 (colide com o end): o plano FRESCO
    // engloba 1–2 no run, mas o binding congelou o run = [idx2] e o writer
    // segue aceitando idx1. A UI deve seguir o run CONGELADO — senão trava
    // um step editável e aponta pro end, que edita OUTRO bucket.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300, 300]);

    // RE-INSPEÇÃO pós-colisão: o step 1 continua editável (run congelado),
    // só o terminal é 'final'.
    const regrab = grabMotion(target, messages);
    const xTrack = regrab.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps.map((step) => ({ entryIndex: step.entryIndex, editable: step.editable }))).toEqual([
      { entryIndex: 0, editable: true },
      { entryIndex: 1, editable: true },
      { entryIndex: 2, editable: false },
    ]);

    // E o rollback do step segue funcionando.
    sendStep(regrab.selection ?? selection, regrab.motion, 'x', 1, '200');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200, 300]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps RAW addressing exact around an aliased NON-carrier entry (Sol r7)', () => {
    document.body.innerHTML = '<main><div id="ksn"></div></main>';
    const target = document.getElementById('ksn');
    // [a, shared, shared, z] — o MESMO objeto (sem x) ocupa os índices 1 e 2.
    // Os carriers de x (a=raw 0, z=raw 3) devem manter seus índices exatos;
    // editar raw 0 nunca toca os aliased.
    const shared = { opacity: 0.5, duration: 1, parent: {} };
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        shared,
        shared,
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 4,
    };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps.map((step) => step.entryIndex)).toEqual([0, 3]);
    sendStep(selection, motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(150);
    expect(vars.keyframes[1]).toBe(shared);
    expect(vars.keyframes[2]).toBe(shared);
    expect(shared.x).toBeUndefined();
    sendStep(selection, motion, 'x', 0, '100');
    expect(vars.keyframes[0].x).toBe(100);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks the plan when an aliased entry CARRIES the property — no steps, no writes (Sol r7)', () => {
    document.body.innerHTML = '<main><div id="ksb"></div></main>';
    const target = document.getElementById('ksb');
    // A MESMA entry carregando x em dois índices: identidade repetida de
    // bucket tranca o plano inteiro (guarda r43) — sem steps e o writer
    // recusa qualquer índice.
    const shared = { x: 200, duration: 1, parent: {} };
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        shared,
        shared,
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps).toBeUndefined();
    sendStep(selection, motion, 'x', 1, '250');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200, 200]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks the plan when DISTINCT entries share one css bucket — no steps, no writes (Sol r7)', () => {
    document.body.innerHTML = '<main><div id="ksc"></div></main>';
    const target = document.getElementById('ksc');
    // Duas entries distintas apontando pro MESMO objeto css: escrever uma
    // etapa mudaria as duas — bucket repetido tranca o plano (r43).
    const sharedCss = { x: 60 };
    const vars = {
      keyframes: [
        { css: sharedCss, duration: 1, parent: {} },
        { css: sharedCss, duration: 1, parent: {} },
      ],
      duration: 2,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack?.steps).toBeUndefined();
    sendStep(selection, motion, 'x', 0, '90');
    expect(sharedCss.x).toBe(60);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks the plan when an entry value is a NON-FINITE number — NaN breaks staleness forever (Sol r10)', () => {
    document.body.innerHTML = '<main><div id="ksz2"></div></main>';
    const target = document.getElementById('ksz2');
    // [NaN, 100, 200]: NaN passa em typeof==='number', mas allExpected com NaN
    // faz valuesIntact falhar SEMPRE (NaN!==NaN) → binding stale após o 1º
    // write → rollback recusado com o edit aplicado (quebra de atomicidade).
    // O plano deve falhar FECHADO pra número não-finito: sem steps, sem writes.
    const vars = {
      keyframes: [
        { x: NaN, duration: 1, parent: {} },
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps).toBeUndefined();
    sendStep(selection, motion, 'x', 1, '150');
    expect(vars.keyframes[1].x).toBe(100);
    expect(vars.keyframes[2].x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks the plan when a carrier is INHERITED from the entry prototype — write would shadow, undo would lie (Sol r11)', () => {
    document.body.innerHTML = '<main><div id="ksi"></div></main>';
    const target = document.getElementById('ksi');
    // Entry com x HERDADO (protótipo): o GSAP processa enumeráveis herdadas
    // (for..in mirror), mas escrever cria propriedade PRÓPRIA (sombra) que o
    // undo não remove — mudança posterior no protótipo ficaria mascarada; e o
    // hazard-scan (hasOwnProperty) veria assinatura 'none' vs 'top' congelada.
    // Fail closed: sem steps, sem writes, nada de sombra criada.
    const proto = { x: 200 };
    const inherited = Object.assign(Object.create(proto), { duration: 1, parent: {} });
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        inherited,
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps).toBeUndefined();
    sendStep(selection, motion, 'x', 1, '500');
    expect(Object.prototype.hasOwnProperty.call(inherited, 'x')).toBe(false);
    expect(proto.x).toBe(200);
    expect(vars.keyframes[0].x).toBe(100);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a post-edit authored mutation stales the binding — a step restore in a transaction refuses BEFORE mutating (Sol r12)', () => {
    document.body.innerHTML = '<main><div id="ksm"></div></main>';
    const target = document.getElementById('ksm');
    // Caminho representativo do contraexemplo r12: mutação autoral pós-edit
    // (runBackwards) que faria o WRITE do inverso recusar. O binding estala
    // (gsapEntryBindingDisqualified) → candidato-restore falso → o writer
    // recusa ANTES de mutar; a transação fica atômica com o edit preservado.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '500');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 300]);

    vars.runBackwards = true; // página muda o modo autoral pós-edit
    tween.invalidate.mockClear();

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-ks-runb',
            patches: [{
              id: 'p-ks-runb',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframeStep.x',
              before: { entryIndex: 1, value: '500', exists: true },
              value: { entryIndex: 1, value: '200', exists: true },
            }],
          },
        },
      },
    }));
    const validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(false);
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 300]); // intocado
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('pre-simulates STEP RESTORES too — an out-of-order restore that would null the plan refuses; LIFO still works (Sol r13)', () => {
    document.body.innerHTML = '<main><div id="ksq"></div></main>';
    const target = document.getElementById('ksq');
    // ['10px','50%','100%'] → idx0='20%' (walk quebra antes de idx0) →
    // idx1='100%' (estende o hold). Restore FORA-DE-ORDEM de idx0 pra '10px'
    // criaria ['10px','100%','100%']: o walk agora atravessa idx1 (igual ao
    // end) e examina px×% no idx0 → plano null → binding stale → o undo DO
    // RESTORE seria recusado (restore aplicado sem inversa). O restore deve
    // pré-simular como o write; a ordem LIFO segue funcionando.
    const vars = {
      keyframes: [
        { width: '10px', duration: 1, parent: {} },
        { width: '50%', duration: 1, parent: {} },
        { width: '100%', duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'width', 0, '20%');
    // A UI relê o payload refrescado entre edits (token por estado-da-verdade).
    const grab2 = grabMotion(target, messages);
    sendStep(grab2.selection, grab2.motion, 'width', 1, '100%');
    expect(vars.keyframes.map((entry) => entry.width)).toEqual(['20%', '100%', '100%']);

    // Fora de ordem: recusa ANTES de mutar.
    tween.invalidate.mockClear();
    sendStep(grab2.selection, grab2.motion, 'width', 0, '10px');
    expect(vars.keyframes.map((entry) => entry.width)).toEqual(['20%', '100%', '100%']);
    expect(tween.invalidate).not.toHaveBeenCalled();

    // LIFO: idx1 primeiro, depois idx0 — ambos restauram verbatim (journal
    // já tocado → gate de exposição não se aplica).
    sendStep(grab2.selection, grab2.motion, 'width', 1, '50%');
    expect(vars.keyframes.map((entry) => entry.width)).toEqual(['20%', '50%', '100%']);
    sendStep(grab2.selection, grab2.motion, 'width', 0, '10px');
    expect(vars.keyframes.map((entry) => entry.width)).toEqual(['10px', '50%', '100%']);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('pre-simulates the END restore too — a restore whose hold reaches a cross-unit step refuses; LIFO works (Sol r14)', () => {
    document.body.innerHTML = '<main><div id="ksy"></div></main>';
    const target = document.getElementById('ksy');
    // ['10px','50px','100px'] → step idx0='20%' (abaixo do break) → END='200px'
    // → step idx1='100px' (= end ORIGINAL). Restore do END pra '100px' criaria
    // ['20%','100px','100px']: o walk atravessa o hold novo e examina %×px no
    // idx0 → plano null → binding stale → a inversa do restore ('200px') seria
    // recusada. O restore do END pré-simula (run congelado → originals).
    const vars = {
      keyframes: [
        { x: '10px', duration: 1, parent: {} },
        { x: '50px', duration: 1, parent: {} },
        { x: '100px', duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 0, '20%');
    sendRetarget(selection, motion, '200px');
    const grab2 = grabMotion(target, messages);
    sendStep(grab2.selection, grab2.motion, 'x', 1, '100px');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['20%', '100px', '200px']);

    // Passo 5: restore do END fora de ordem — recusa ANTES de mutar.
    tween.invalidate.mockClear();
    sendRetarget(grab2.selection, grab2.motion, '100px');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['20%', '100px', '200px']);
    expect(tween.invalidate).not.toHaveBeenCalled();

    // LIFO: idx1 → END → idx0, tudo verbatim (journal já tocado).
    sendStep(grab2.selection, grab2.motion, 'x', 1, '50px');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['20%', '50px', '200px']);
    sendRetarget(grab2.selection, grab2.motion, '100px');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['20%', '50px', '100px']);
    sendStep(grab2.selection, grab2.motion, 'x', 0, '10px');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['10px', '50px', '100px']);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a bucket turned NON-WRITABLE after the freeze stales the binding — STEP restore refuses instead of no-op "success" (Sol r15)', () => {
    document.body.innerHTML = '<main><div id="ksd"></div></main>';
    const target = document.getElementById('ksd');
    // defineProperty(writable:false) pós-freeze mantém o VALOR intacto (a
    // staleness por valores passa), mas o assignment do restore falha em
    // silêncio (sloppy mode) → invalidate roda e o undo confirmaria sem
    // restaurar. O descriptor deve ser revalidado: mudou → stale → recusa
    // antes de qualquer assignment/invalidate.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '500');
    expect(vars.keyframes[1].x).toBe(500);

    Object.defineProperty(vars.keyframes[1], 'x', { value: 500, enumerable: true, configurable: true, writable: false });
    tween.timeline = {}; // outage
    tween.invalidate.mockClear();

    sendStep(selection, motion, 'x', 1, '200');
    expect(vars.keyframes[1].x).toBe(500); // nada restaurado (esperado)...
    expect(tween.invalidate).not.toHaveBeenCalled(); // ...e NADA confirmado

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a bucket turned NON-WRITABLE after the freeze stales the binding — END restore refuses too (Sol r15)', () => {
    document.body.innerHTML = '<main><div id="kse2"></div></main>';
    const target = document.getElementById('kse2');
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '350');
    expect(vars.keyframes[2].x).toBe(350);

    Object.defineProperty(vars.keyframes[2], 'x', { value: 350, enumerable: true, configurable: true, writable: false });
    tween.timeline = {}; // outage
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300');
    expect(vars.keyframes[2].x).toBe(350);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('random() surgindo pós-freeze em OUTRA propriedade stales o binding — restores de STEP e END recusam (Sol r16)', () => {
    document.body.innerHTML = '<main><div id="ksr2"></div></main>';
    const target = document.getElementById('ksr2');
    // O invalidate do restore re-sortearia o random da página. A guarda vive
    // na STALENESS (gsapHasRandomizedValue nas entries congeladas, r103/104):
    // random observado → stale → recusa antes de assignment/invalidate.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '500');
    sendRetarget(selection, motion, '350');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 350]);

    // Página adiciona random noutra propriedade de uma entry viva congelada.
    vars.keyframes[0].opacity = 'random(0,1)';
    tween.invalidate.mockClear();

    sendStep(selection, motion, 'x', 1, '200'); // undo do step
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 350]);
    sendRetarget(selection, motion, '300'); // undo do end
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 350]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a REPLACED child.vars detaches the frozen bucket — restores refuse even in outage (Sol r17)', () => {
    document.body.innerHTML = '<main><div id="ksv2"></div></main>';
    const target = document.getElementById('ksv2');
    // child.vars substituído = a entry congelada virou bucket MORTO: o restore
    // escreveria nele (reader mente) e o invalidate reprocessa o vars NOVO
    // (contrato do GSAP) — re-sorteando random que o scan das entries
    // congeladas nunca vê. Identidade child.vars === entry é obrigatória,
    // inclusive na outage (child ref congelado, leitura sem timeline).
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);
    const childFor = (entry, start) => ({ vars: entry, startTime: () => start, duration: () => 1, _initted: true });
    const children = [childFor(vars.keyframes[0], 0), childFor(vars.keyframes[1], 1), childFor(vars.keyframes[2], 2)];
    tween.timeline = { duration: () => 3, getChildren: () => children };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '500');
    sendRetarget(selection, motion, '350');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 350]);

    // Página substitui o vars do child 1 (entry congelada vira bucket morto).
    children[1].vars = { ...children[1].vars, opacity: 'random(0,1)' };
    tween.timeline.getChildren = undefined; // outage
    tween.invalidate.mockClear();

    sendStep(selection, motion, 'x', 1, '200'); // undo do step
    expect(vars.keyframes[1].x).toBe(500); // bucket morto intocado
    sendRetarget(selection, motion, '300'); // undo do end
    expect(vars.keyframes[2].x).toBe(350);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('random/função TOP-LEVEL irmã surgindo pós-freeze também stala — restores recusam (Sol r18)', () => {
    document.body.innerHTML = '<main><div id="kst2"></div></main>';
    const target = document.getElementById('kst2');
    // Vetores restantes da classe r16/r18: random STRING e FUNÇÃO em var
    // top-level IRMÃ (vars.y), sem tocar buckets congelados. O scan de
    // staleness caminha o vars root (r103/r115) → stale → recusa.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '500');
    expect(vars.keyframes[1].x).toBe(500);

    vars.y = 'random(0,100)'; // string random irmã
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 1, '200');
    expect(vars.keyframes[1].x).toBe(500);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete vars.y;
    // Mesmo removida, a memória POSITIVA durável (r103) mantém o hazard: o
    // PropTween pode segurar o valor sorteado. Segue recusando.
    sendStep(selection, motion, 'x', 1, '200');
    expect(vars.keyframes[1].x).toBe(500);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a NON-carrier reorder after the freeze stales the binding — the edit lands on the SHOWN entry (Sol r20)', () => {
    document.body.innerHTML = '<main><div id="ksu"></div></main>';
    const target = document.getElementById('ksu');
    // [x100, opacity, x200, x300, x400]: edit idx2 (200→500) congela o
    // binding; a página move a entry de opacity pro fim (carriers idênticos —
    // a staleness por buckets não via). Re-inspeção mostra idx2 = x300; editar
    // esse step pra '200' colidia com o journal ANTIGO (original 200 do idx2
    // congelado) → restore lane restaurava a entry ERRADA (x500→200) com
    // histórico falso. allEntries integral na staleness: reorder → stale →
    // prune → o write novo edita a entry EXPOSTA.
    const e0 = { x: 100, duration: 1, parent: {} };
    const eOp = { opacity: 0.5, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const e3 = { x: 300, duration: 1, parent: {} };
    const e4 = { x: 400, duration: 1, parent: {} };
    const vars = { keyframes: [e0, eOp, e2, e3, e4], duration: 5 };
    const tween = buildArrayKeyframesTween(target, vars);
    const childFor = (entry, start) => ({ vars: entry, startTime: () => start, duration: () => 1, _initted: true });
    let children = [childFor(e0, 0), childFor(eOp, 1), childFor(e2, 1), childFor(e3, 2), childFor(e4, 3)];
    tween.timeline = { duration: () => 5, getChildren: () => children };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 2, '500');
    expect(e2.x).toBe(500);

    // Página move a non-carrier pro fim (ordem viva muda; carriers idênticos).
    children = [childFor(e0, 0), childFor(e2, 1), childFor(e3, 2), childFor(e4, 3), childFor(eOp, 4)];
    tween.timeline.getChildren = () => children;

    const regrab = grabMotion(target, messages);
    const xTrack = regrab.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps.map((step) => [step.entryIndex, step.value])).toEqual([
      [0, '100'], [1, '500'], [2, '300'], [3, '400'],
    ]);

    sendStep(regrab.selection, regrab.motion, 'x', 2, '200');
    expect(e3.x).toBe(200); // a entry MOSTRADA
    expect(e2.x).toBe(500); // o edit antigo fica

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('clamped equivalence never masks a step WRITE as restore — opacity 2→3 edits the ramp (Sol r21)', () => {
    document.body.innerHTML = '<main><div id="ksop"></div></main>';
    const target = document.getElementById('ksop');
    // O clamp visual (2≡3 no ENDPOINT renderizado) é correto pro walk/pré-sim,
    // mas num step INTERMEDIÁRIO o valor cru molda a RAMPA (a 1/4 de 0→2 a
    // opacidade é 0.5; de 0→3 seria 0.75). Detecção de restore usa igualdade
    // SEM clamp do valor journalado.
    const vars = {
      keyframes: [
        { opacity: 0, duration: 1, parent: {} },
        { opacity: 2, duration: 1, parent: {} },
        { opacity: 0, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'opacity', 1, '3');
    expect(vars.keyframes[1].opacity).toBe(3); // WRITE, nunca no-op de restore
    sendStep(selection, motion, 'opacity', 1, '2');
    expect(vars.keyframes[1].opacity).toBe(2); // rollback verbatim (número)

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a persisted step patch REPLAYS across a bridge reload — the token is a stable truth fingerprint (Sol r22)', () => {
    document.body.innerHTML = '<main><div id="ra2"></div><div id="rc2"></div><div id="rb2"></div></main>';
    const targetA = document.getElementById('ra2');
    const targetC = document.getElementById('rc2');
    const targetB = document.getElementById('rb2');
    // Um contador efêmero por instância morre no reload: A inspecionado antes
    // de B no bridge 1 (token de B = 2), bridge novo só inspeciona B (token 1)
    // → replay do patch persistido de B recusado → edição confirmada some.
    // O token deve ser um FINGERPRINT estrutural da verdade exposta —
    // determinístico entre bridges quando a página re-carrega igual.
    const varsA = { keyframes: [{ x: 10, duration: 1, parent: {} }, { x: 20, duration: 1, parent: {} }, { x: 30, duration: 1, parent: {} }], duration: 3 };
    const varsC = { keyframes: [{ x: 40, duration: 1, parent: {} }, { x: 50, duration: 1, parent: {} }, { x: 60, duration: 1, parent: {} }], duration: 3 };
    const varsB = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }, { x: 300, duration: 1, parent: {} }], duration: 3 };
    const makeTween = (vars) => ({
      targets: () => [vars === varsA ? targetA : vars === varsC ? targetC : targetB],
      vars,
      duration: () => 3,
      delay: () => 0, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressMock(p) { if (p === undefined) return progressMock.current || 0; progressMock.current = p; return this; }),
      invalidate: vi.fn(function invalidateMock() { return this; }),
    });
    const tweenA = makeTween(varsA);
    const tweenC = makeTween(varsC);
    const tweenB = makeTween(varsB);
    window.gsap = {
      globalTimeline: { getChildren: () => [tweenA, tweenC, tweenB] },
      getProperty: () => '0',
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    // Bridge 1: A e C primeiro (avançariam um contador efêmero), depois B.
    grabMotion(targetA, messages);
    grabMotion(targetC, messages);
    const grabbedB = grabMotion(targetB, messages);
    const trackB = grabbedB.motion.tracks.find((track) => track.property === 'x');
    const persistedToken = trackB.steps.find((step) => step.entryIndex === 1).token;
    const persistedPatch = {
      elementId: grabbedB.selection.payload.element.id,
      kind: 'motion',
      motionId: grabbedB.motion.id,
      property: 'keyframeStep.x',
      before: { entryIndex: 1, token: persistedToken, value: '200', exists: true },
      value: { entryIndex: 1, token: persistedToken, value: '555', exists: true },
    };
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'apply-patch', payload: { patch: persistedPatch } },
    }));
    expect(varsB.keyframes[1].x).toBe(555);

    // "Reload": página volta ao pristino, bridge novo, SÓ B re-inspecionado.
    varsB.keyframes[1].x = 200;
    try { window.__uncraftMotionBridge?.teardown?.(); } catch (_) {}
    window.eval(getRuntimeBridgeSource());
    // Bridge novo re-inspeciona na mesma ordem de boot que o prod (A antes de
    // B; C fica de fora — um contador efêmero divergiria aqui), ids estáveis.
    grabMotion(targetA, messages);
    grabMotion(targetB, messages);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'apply-patch', payload: { patch: persistedPatch } },
    }));
    expect(varsB.keyframes[1].x).toBe(555); // replay aplicado no bridge novo

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a pre-first-write VALUE mutation refuses — the token is checked against the LIVE truth, not the stored record (Sol r23)', () => {
    document.body.innerHTML = '<main><div id="ksl"></div></main>';
    const target = document.getElementById('ksl');
    // [0,10,100]: a página muda o bucket de 10→20 (identidade/ordem intactas)
    // antes do 1º write. Token pedido × token GRAVADO são ambos o T velho —
    // sem recomputar contra a verdade VIVA, o journal congelaria 20 com
    // before=10 e o undo sobrescreveria a mudança externa. Deve recusar e
    // exigir re-inspeção.
    const vars = {
      keyframes: [
        { x: 0, duration: 1, parent: {} },
        { x: 10, duration: 1, parent: {} },
        { x: 100, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    vars.keyframes[1].x = 20; // mutação externa pré-1º-write
    sendStep(selection, motion, 'x', 1, '30');
    expect(vars.keyframes[1].x).toBe(20); // intocado
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Re-inspeção re-expõe a verdade — o edit funciona e o undo é exato.
    const regrab = grabMotion(target, messages);
    sendStep(regrab.selection, regrab.motion, 'x', 1, '30');
    expect(vars.keyframes[1].x).toBe(30);
    sendStep(regrab.selection, regrab.motion, 'x', 1, '20');
    expect(vars.keyframes[1].x).toBe(20);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('the exposure gate runs at the FIRST TOUCH of each index even on an END-created binding (Sol r24)', () => {
    document.body.innerHTML = '<main><div id="ksx"></div></main>';
    const target = document.getElementById('ksx');
    // [A{10}, B{10}, C{100}]: patch do step idx0 retido (token T); página troca
    // A/B; o END cria o binding fresco sobre [B,A,C]; o patch retido chegava
    // com binding existente e pulava o gate — editando B com a UI tendo
    // mostrado A. O gate roda no 1º toque de cada índice.
    const entryA = { x: 10, duration: 1, parent: {} };
    const entryB = { x: 10, duration: 2, parent: {} };
    const entryC = { x: 100, duration: 1, parent: {} };
    const vars = { keyframes: [entryA, entryB, entryC], duration: 4 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // Página troca A/B ANTES de qualquer write.
    vars.keyframes[0] = entryB;
    vars.keyframes[1] = entryA;
    // END cria o binding compartilhado sobre a ordem NOVA.
    sendRetarget(selection, motion, '200');
    expect(entryC.x).toBe(200);

    // Patch retido do step idx0 (token da exposição VELHA) — recusa.
    sendStep(selection, motion, 'x', 0, '20');
    expect(entryA.x).toBe(10);
    expect(entryB.x).toBe(10);

    // Re-inspeção destrava o índice novo.
    const regrab = grabMotion(target, messages);
    sendStep(regrab.selection, regrab.motion, 'x', 0, '20');
    expect(entryB.x).toBe(20); // idx0 atual = B
    expect(entryA.x).toBe(10);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a hash COLLISION cannot smuggle a stale patch through the gate — the token is the exact shape (Sol r25)', () => {
    document.body.innerHTML = '<main><div id="ksh2"></div></main>';
    const target = document.getElementById('ksh2');
    // FNV-1a 32-bit é forjável por página adversarial (birthday ≈ 77k
    // tentativas). Geramos DOIS valores de x cujos shapes colidem sob o hash:
    // mutação + re-inspeção manteria o token idêntico e o patch retido
    // passaria, sobrescrevendo a mutação. O token deve ser o SHAPE exato.
    // Par pré-computado cujos SHAPES (formato canônico atual) colidem sob
    // FNV-1a 32-bit — prova que hash não implementa o contrato exato.
    const fnv = (value) => {
      let result = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
      }
      return result >>> 0;
    };
    const entryShape = (n) => JSON.stringify([['duration', 'number:1'], ['x', `number:${n}`]]);
    const shapeFor = (headX) => JSON.stringify([entryShape(headX), entryShape(500001), entryShape(1000001)]);
    const xA = 220809;
    const xB = 1012896;
    expect(fnv(shapeFor(xA))).toBe(fnv(shapeFor(xB))); // colisão real
    expect(shapeFor(xA)).not.toBe(shapeFor(xB)); // shapes exatos divergem

    const vars = {
      keyframes: [
        { x: xA, duration: 1, parent: {} },
        { x: 500001, duration: 1, parent: {} },
        { x: 1000001, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // Página muda pro valor COLIDENTE e a UI re-inspeciona (token colidiria).
    vars.keyframes[0].x = xB;
    grabMotion(target, messages);

    // Patch retido da exposição VELHA — precisa recusar.
    sendStep(selection, motion, 'x', 0, '777');
    expect(vars.keyframes[0].x).toBe(xB);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('the shape serializes NESTED namespaces deeply — attr-only differences distinguish entries (Sol r26)', () => {
    document.body.innerHTML = '<main><div id="ksn2"></div></main>';
    const target = document.getElementById('ksn2');
    // A e B diferem SÓ em attr.data-owner: um serializer raso colapsa ambos em
    // "[object Object]" → shapes idênticos → swap atravessa o gate e o patch
    // retido edita outra entry.
    const entryA = { x: 100, attr: { 'data-owner': 'A' }, duration: 1, parent: {} };
    const entryB = { x: 100, attr: { 'data-owner': 'B' }, duration: 1, parent: {} };
    const entryC = { x: 300, duration: 1, parent: {} };
    const vars = { keyframes: [entryA, entryB, entryC], duration: 3 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // Página troca A/B; UI re-inspeciona (token re-mintado da verdade nova).
    vars.keyframes[0] = entryB;
    vars.keyframes[1] = entryA;
    grabMotion(target, messages);

    // Patch retido da exposição VELHA — token deve divergir → recusa.
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 0, '777');
    expect(entryA.x).toBe(100);
    expect(entryB.x).toBe(100);
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Exposição fresca edita o ocupante atual do índice.
    const regrab = grabMotion(target, messages);
    sendStep(regrab.selection, regrab.motion, 'x', 0, '777');
    expect(entryB.x).toBe(777);
    expect(entryA.x).toBe(100);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a swapped easing FUNCTION diverges the shape by source — stale patch refuses, unchanged ease edits (Sol r27)', () => {
    document.body.innerHTML = '<main><div id="ksf2"></div></main>';
    const target = document.getElementById('ksf2');
    // ease funcional na raiz é config BENIGNA (plano vivo, steps expostos) —
    // mas colapsá-la em 'fn' deixava um swap p=>p → p=>p*p invisível ao token.
    // Serialização por SOURCE diverge o shape; ease intacta segue editável.
    const vars = {
      keyframes: [
        { x: 100, ease: (p) => p, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // Página troca a ease ANTES do 1º write, preservando entry/índice/valores.
    vars.keyframes[0].ease = (p) => p * p;
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(100);
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Re-inspeção (ease nova exposta) → edit funciona.
    const regrab = grabMotion(target, messages);
    sendStep(regrab.selection, regrab.motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(150);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('same-SOURCE closure swaps are caught by function IDENTITY — pre-write and post-binding (Sol r28)', () => {
    document.body.innerHTML = '<main><div id="ksc2"></div></main>';
    const target = document.getElementById('ksc2');
    // makeEase(1) e makeEase(2) têm o MESMO source — o token não muda, mas o
    // invalidate re-renderiza com a curva nova, deslocando canal INTOCADO que
    // o journal não desfaz. Identidade === registrada na exposição e congelada
    // no binding pega o swap nos dois momentos.
    const makeEase = (power) => (p) => p ** power;
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, ease: makeEase(1), duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // Swap silencioso pré-1º-write (mesmo source): recusa.
    vars.keyframes[1].ease = makeEase(2);
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(100);
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Re-inspeção destrava; edit + binding congelam as identidades novas.
    const regrab = grabMotion(target, messages);
    sendStep(regrab.selection, regrab.motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(150);

    // Swap PÓS-binding: o restore (journal-hit) também recusa via staleness.
    vars.keyframes[1].ease = makeEase(3);
    tween.invalidate.mockClear();
    sendStep(regrab.selection, regrab.motion, 'x', 0, '100');
    expect(vars.keyframes[0].x).toBe(150);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('exposures with config FUNCTIONS are session-bound — cross-bridge replay refuses (Sol r29)', () => {
    document.body.innerHTML = '<main><div id="ksb2"></div></main>';
    const target = document.getElementById('ksb2');
    // Identidades === morrem no reload; source não distingue makeEase(1) de
    // makeEase(2). Não há identidade cross-sessão estável pra closures →
    // token de exposição COM função ganha nonce da instância do bridge:
    // replay persistido recusa e exige re-inspeção consciente.
    const makeEase = (power) => (p) => p ** power;
    const vars = {
      keyframes: [
        { x: 100, ease: makeEase(1), duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const grabbed = grabMotion(target, messages);
    const track = grabbed.motion.tracks.find((candidate) => candidate.property === 'x');
    const persistedToken = track.steps.find((step) => step.entryIndex === 1).token;
    const persistedPatch = {
      elementId: grabbed.selection.payload.element.id,
      kind: 'motion',
      motionId: grabbed.motion.id,
      property: 'keyframeStep.x',
      before: { entryIndex: 1, token: persistedToken, value: '200', exists: true },
      value: { entryIndex: 1, token: persistedToken, value: '555', exists: true },
    };

    // "Reload": página reconstrói com makeEase(2) — MESMO source, curva outra.
    vars.keyframes[0].ease = makeEase(2);
    try { window.__uncraftMotionBridge?.teardown?.(); } catch (_) {}
    window.eval(getRuntimeBridgeSource());
    grabMotion(target, messages);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'apply-patch', payload: { patch: persistedPatch } },
    }));
    expect(vars.keyframes[1].x).toBe(200); // replay recusado

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('NESTED parent keys are DATA and enter the shape — only the root backedge is excluded (Sol r30)', () => {
    document.body.innerHTML = '<main><div id="ksp"></div></main>';
    const target = document.getElementById('ksp');
    // attr.parent é canal animado legítimo (r110/r114 fase-1) — a exclusão do
    // backedge só vale na RAIZ da entry. Mutar attr.parent pré-write deve
    // divergir o shape e recusar o patch retido.
    const vars = {
      keyframes: [
        { x: 100, attr: { parent: 'A' }, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    vars.keyframes[0].attr.parent = 'B'; // mutação de DADO aninhado
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(100);
    expect(tween.invalidate).not.toHaveBeenCalled();

    const regrab = grabMotion(target, messages);
    sendStep(regrab.selection, regrab.motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(150);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an EXTERNAL startAt mutation stales the binding — restores refuse; the own START writer does not stale (Sol r31)', () => {
    document.body.innerHTML = '<main><div id="kss"></div></main>';
    const target = document.getElementById('kss');
    // startAt latente injetado pela página não re-renderiza até o PRÓXIMO
    // invalidate — o restore o materializaria, deslocando o segmento anterior
    // (rollback inexato). O estado do startAt entra no binding e é revalidado;
    // o writer de START do próprio bridge atualiza o esperado (não estala).
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '250');
    expect(vars.keyframes[1].x).toBe(250);

    // Página injeta startAt SEM invalidar: restore deve recusar.
    vars.startAt = { x: 50 };
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 1, '200');
    expect(vars.keyframes[1].x).toBe(250);
    expect(tween.invalidate).not.toHaveBeenCalled();
    delete vars.startAt;

    // O writer de START do bridge (keyframe.x offset 0) atualiza o esperado —
    // o step continua editável/restaurável depois.
    const regrab = grabMotion(target, messages);
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: regrab.selection.payload.element.id,
            kind: 'motion',
            motionId: regrab.motion.id,
            property: 'keyframe.x',
            before: { offset: 0, value: '', exists: true },
            value: { offset: 0, value: '40', exists: true },
          },
        },
      },
    }));
    expect(vars.startAt).toEqual({ x: '40' });
    sendStep(regrab.selection, regrab.motion, 'x', 1, '200');
    expect(vars.keyframes[1].x).toBe(200);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a PRE-FIRST-WRITE startAt injection is caught by the exposure gate — token stale, no binding created (Sol r32)', () => {
    document.body.innerHTML = '<main><div id="ksj2"></div></main>';
    const target = document.getElementById('ksj2');
    // Diferente da r31 (binding já criado): aqui a injeção acontece ANTES do
    // 1º sendStep. O token velho (sem startAt) casa com o registro velho e o
    // recompute só cobria o shape das ENTRIES — a injeção do startAt escapava
    // e o binding congelava o startAt já injetado. O gate do 1º toque deve
    // revalidar o startAt vivo contra o exposto.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // Injeção ANTES de qualquer write — token na mão é o antigo (sem startAt).
    vars.startAt = { x: 50 };
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 1, '250');
    expect(vars.keyframes[1].x).toBe(200); // nada escrito
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Re-inspeção (startAt agora exposto) → edit funciona.
    delete vars.startAt;
    const regrab = grabMotion(target, messages);
    sendStep(regrab.selection, regrab.motion, 'x', 1, '250');
    expect(vars.keyframes[1].x).toBe(250);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a START edit of ANOTHER property does not poison the step binding — step(x) -> START(y) -> restore(x) (Sol r33)', () => {
    document.body.innerHTML = '<main><div id="ksxy"></div></main>';
    const target = document.getElementById('ksxy');
    // A escrita de START(y) troca o container vars.startAt inteiro; o snapshot
    // de x (que congela vars.startAt por referência) ficava stale e recusava
    // o restore de x como "página mudou". A escrita PRÓPRIA do bridge é
    // esperada: refresca o startAtState de todos os bindings ainda válidos.
    const vars = {
      keyframes: [
        { x: 100, y: 10, duration: 1, parent: {} },
        { x: 200, y: 20, duration: 1, parent: {} },
        { x: 300, y: 30, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // step(x) cria o binding de x.
    sendStep(selection, motion, 'x', 1, '250');
    expect(vars.keyframes[1].x).toBe(250);

    // START(y) — escrita própria do bridge, troca vars.startAt.
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
            property: 'keyframe.y',
            before: { offset: 0, value: '', exists: true },
            value: { offset: 0, value: '5', exists: true },
          },
        },
      },
    }));
    expect(vars.startAt).toEqual({ y: '5' });

    // restore(x) — o binding de x NÃO deve estar envenenado.
    sendStep(selection, motion, 'x', 1, '200');
    expect(vars.keyframes[1].x).toBe(200);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a NESTED startAt mutation (startAt.attr.parent) stales the binding — restore refuses (Sol r34)', () => {
    document.body.innerHTML = '<main><div id="ksna"></div></main>';
    const target = document.getElementById('ksna');
    // gsapStartAtState serializava objetos aninhados do startAt via
    // gsapStepEntryShape, cuja exclusão de 'parent' na RAIZ colapsava
    // startAt.attr.parent — 'A' e 'B' davam o mesmo shape. O restore
    // materializaria B num canal fora do journal. A exclusão de parent só
    // vale numa entry GSAP real; objetos de startAt incluem parent.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      startAt: { attr: { parent: 'A' } },
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '250');
    expect(vars.keyframes[1].x).toBe(250);

    // Mutação aninhada IN-PLACE (mesma ref de container e de attr): só o valor
    // profundo muda.
    vars.startAt.attr.parent = 'B';
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 1, '200');
    expect(vars.keyframes[1].x).toBe(250); // restore recusado
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an UNSERIALIZABLE nested startAt locks the entry writers — no undoable-less edit (Sol r35)', () => {
    document.body.innerHTML = '<main><div id="ksu2"></div></main>';
    const target = document.getElementById('ksu2');
    // startAt com função ANINHADA (attr.title) → shape null → o binding
    // nasceria permanentemente stale e o END-undo seria recusado (edição sem
    // desfazer). Fail closed: sem shape estável do startAt, os writers de
    // entrada (END e step) recusam a criação do binding — nada é mutado.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
      ],
      startAt: { attr: { title: () => 'x' } },
      duration: 2,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // END-write recusado — sem binding, sem mutação, sem invalidate.
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Step channel já travado pelo token null: steps publicados mas nenhum
    // editável e sem token.
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps.every((step) => step.editable === false && step.token === undefined)).toBe(true);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a startAt ACCESSOR is fingerprinted without invocation — shape null, writers locked, zero getter calls (Sol r36)', () => {
    document.body.innerHTML = '<main><div id="ksac"></div></main>';
    const target = document.getElementById('ksac');
    // gsapStartAtState lia vars.startAt direto (invoca getter) e um accessor
    // retornando primitivo dava shape não-nulo → token + binding, furando o
    // fechamento r35. Descriptor-based: accessor → shape null SEM invocar; e
    // uma leitura do editor jamais executa código stateful da página.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
      ],
      duration: 2,
    };
    const tween = buildArrayKeyframesTween(target, vars);
    let getterCalls = 0;
    Object.defineProperty(vars, 'startAt', {
      configurable: true,
      enumerable: true,
      get() { getterCalls += 1; return 0; },
    });

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // Inspeção JAMAIS executou o getter da página (descriptor-based em toda
    // parte: o plano fail-fecha no accessor sem invocar; gsapStartAtState idem).
    expect(getterCalls).toBe(0);
    // O plano tranca inteiro no accessor → sem steps.
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.steps).toBeUndefined();
    // END-write recusado antes de binding/mutação, ainda sem invocar o getter.
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(tween.invalidate).not.toHaveBeenCalled();
    expect(getterCalls).toBe(0);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a same-source config-fn swap re-versions the token — a retained patch under f1 refuses under f2 (Sol r37)', () => {
    document.body.innerHTML = '<main><div id="ksv3"></div></main>';
    const target = document.getElementById('ksv3');
    // O token de sessão usava String(fn) — f1 e f2 same-source davam o mesmo
    // token, e a re-inspeção sobrescrevia allEntryConfigFns com f2, lavando o
    // registro. Identidade de SESSÃO (id monotônico por ===) dobrada no token:
    // swap → token novo → patch retido sob f1 recusa.
    const makeEase = (power) => (p) => p ** power;
    const f1 = makeEase(1);
    const f2 = makeEase(2);
    expect(String(f1)).toBe(String(f2)); // same source, closures distintos
    const vars = {
      keyframes: [
        { x: 100, ease: f1, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const grabbed = grabMotion(target, messages);
    const track = grabbed.motion.tracks.find((candidate) => candidate.property === 'x');
    const retainedToken = track.steps.find((step) => step.entryIndex === 0).token;
    const retainedPatch = {
      elementId: grabbed.selection.payload.element.id,
      kind: 'motion',
      motionId: grabbed.motion.id,
      property: 'keyframeStep.x',
      before: { entryIndex: 0, token: retainedToken, value: '100', exists: true },
      value: { entryIndex: 0, token: retainedToken, value: '150', exists: true },
    };

    // Swap same-source + re-inspeção (token seria lavado sob a source igual).
    vars.keyframes[0].ease = f2;
    grabMotion(target, messages);

    // Patch retido sob f1 — recusa (token re-versionado).
    tween.invalidate.mockClear();
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'apply-patch', payload: { patch: retainedPatch } },
    }));
    expect(vars.keyframes[0].x).toBe(100);
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Re-inspeção sob f2 emite token novo → edit consciente funciona.
    const regrab = grabMotion(target, messages);
    const freshToken = regrab.motion.tracks.find((candidate) => candidate.property === 'x')
      .steps.find((step) => step.entryIndex === 0).token;
    expect(freshToken).not.toBe(retainedToken);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a latent vars.ease mutation stales the binding — the step invalidate cannot materialize collateral (Sol r38)', () => {
    document.body.innerHTML = '<main><div id="ksez"></div></main>';
    const target = document.getElementById('ksez');
    // vars.ease (ease do TWEEN) fora do token/binding: a página troca ease sem
    // invalidar; o invalidate do step materializaria a nova ease, mudando
    // canais top-level intocados (z) que o journal não cobre. Estado colateral
    // de vars (tudo menos keyframes/startAt) congelado e validado.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      z: 100,
      ease: 'none',
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // Página troca a ease do tween SEM invalidar.
    vars.ease = 'power4.in';
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(100); // recusado, sem materializar a ease
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Re-inspeção sob a ease nova destrava.
    const regrab = grabMotion(target, messages);
    sendStep(regrab.selection, regrab.motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(150);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a top-level retarget refreshes the step binding collateral — LIFO undo step(x) after retarget(z) restores x (Sol r39)', () => {
    document.body.innerHTML = '<main><div id="ksrz"></div></main>';
    const target = document.getElementById('ksrz');
    // O retarget de z (canal top-level) muta vars.z; sem refrescar o colateral
    // do binding de x, a edição PRÓPRIA do bridge era lida como mutação da
    // página e o undo do step de x era recusado. O retarget.final entra no
    // mesmo ciclo capture-before/refresh-after.
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      z: 10,
      duration: 3,
    };
    const rendered = { x: 0, z: 0 };
    const tween = {
      targets: () => [target],
      vars,
      duration: () => 3,
      delay: () => 0, repeat: () => 0, repeatDelay: () => 0,
      yoyo: () => false, reversed: () => false, paused: () => false,
      scrollTrigger: null,
      progress: vi.fn(function progressMock(p) {
        if (p === undefined) return progressMock.current || 0;
        progressMock.current = p;
        return tween;
      }),
      invalidate: vi.fn(() => tween),
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [tween] },
      getProperty: (element, prop) => String(prop === 'z' ? vars.z : rendered[prop] ?? ''),
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // (2) step x[0]: 100 → 150.
    sendStep(selection, motion, 'x', 0, '150');
    expect(vars.keyframes[0].x).toBe(150);

    // (3) retarget z: 10 → 20 (canal top-level, muta vars.z).
    const retargetZ = (before, after) => window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'apply-patch',
        payload: { patch: {
          elementId: selection.payload.element.id, kind: 'motion', motionId: motion.id,
          property: 'retarget.final',
          before: { schemaVersion: 2, semanticProperty: 'z', runtimeProperty: 'z', value: before },
          value: { schemaVersion: 2, semanticProperty: 'z', runtimeProperty: 'z', value: after,
            writeModel: 'absolute', responsiveScope: 'shared',
            owner: { channelId: `${motion.id}:z`, motionId: motion.id } },
        } },
      },
    }));
    retargetZ('10', '20');
    expect(Number(vars.z)).toBe(20);

    // (4) undo z: 20 → 10.
    retargetZ('20', '10');
    expect(Number(vars.z)).toBe(10);

    // (5) undo step x: 150 → 100 (binding-x não podado nem stale).
    sendStep(selection, motion, 'x', 0, '100');
    expect(vars.keyframes[0].x).toBe(100);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a latent SIBLING-channel mutation inside the entries stales the step binding (Sol r40)', () => {
    document.body.innerHTML = '<main><div id="ksib"></div></main>';
    const target = document.getElementById('ksib');
    // Entries carregam x E opacity. Editar step-x congela o binding; a página
    // muda entry.opacity sem invalidar; o undo de x materializaria essa
    // mudança latente de opacity (canal fora do journal). O estado dos campos
    // colaterais DENTRO das entries é congelado e validado na staleness.
    const vars = {
      keyframes: [
        { x: 100, opacity: 0.1, duration: 1, parent: {} },
        { x: 200, opacity: 0.5, duration: 1, parent: {} },
        { x: 300, opacity: 1, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '250');
    expect(vars.keyframes[1].x).toBe(250);

    // Página muda opacity latente (mesma entry).
    vars.keyframes[1].opacity = 0.9;
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 1, '200'); // undo do step
    expect(vars.keyframes[1].x).toBe(250); // recusado — não materializa opacity
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a LEGIT bridge edit of another keyframe channel keeps the step binding usable (Sol r40 cross)', () => {
    document.body.innerHTML = '<main><div id="ksib2"></div></main>';
    const target = document.getElementById('ksib2');
    // Editar opacity via o próprio bridge (step-opacity) é esperado — o undo
    // de x depois continua funcionando (refresh cruzado dos entryOtherShapes).
    const vars = {
      keyframes: [
        { x: 100, opacity: 0.1, duration: 1, parent: {} },
        { x: 200, opacity: 0.5, duration: 1, parent: {} },
        { x: 300, opacity: 1, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '250');
    expect(vars.keyframes[1].x).toBe(250);

    // A UI re-inspeciona entre edits (token fresco por estado-da-verdade).
    const r2 = grabMotion(target, messages);
    // Edição LEGÍTIMA de opacity (step-opacity, índice 0 = intermediário).
    sendStep(r2.selection, r2.motion, 'opacity', 0, '0.3');
    expect(vars.keyframes[0].opacity).toBe(0.3);

    // Undo de x segue funcionando (entryOtherShapes de x refrescado pela
    // edição própria do bridge em opacity).
    sendStep(r2.selection, r2.motion, 'x', 1, '200');
    expect(vars.keyframes[1].x).toBe(200);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a nested FUNCTION in a sibling entry field fails closed — no undoable-less END edit (Sol r41)', () => {
    document.body.innerHTML = '<main><div id="ksnf"></div></main>';
    const target = document.getElementById('ksnf');
    // Entry carrega y + modifiers:{x:fn} (função ANINHADA num campo irmão).
    // Serializar fn por String(value) deixaria f1/f2 same-source com o mesmo
    // shape → o invalidate incorporaria o modifier novo fora do journal.
    // Fail closed: função aninhada → shape null → o binding recusa.
    const makeModifier = (power) => (value) => value * power;
    const vars = {
      keyframes: [
        { y: 10, modifiers: { x: makeModifier(1) }, duration: 1, parent: {} },
        { y: 20, duration: 1, parent: {} },
      ],
      duration: 2,
    };
    const tween = buildArrayKeyframesTween(target, vars);
    // getProperty reporta y (o x é dirigido por modifiers).
    window.gsap.getProperty = (element, prop) => String(prop === 'y' ? 0 : 0);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    // END de y recusado — sem binding, sem mutação (função aninhada = fail closed).
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'apply-patch',
        payload: { patch: {
          elementId: selection.payload.element.id, kind: 'motion', motionId: motion.id,
          property: 'retarget.final',
          before: { schemaVersion: 2, semanticProperty: 'y', runtimeProperty: 'y', value: '20' },
          value: { schemaVersion: 2, semanticProperty: 'y', runtimeProperty: 'y', value: '99',
            writeModel: 'absolute', responsiveScope: 'shared',
            owner: { channelId: `${motion.id}:y`, motionId: motion.id }, keyframe: { position: 'final-existing' } },
        } },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.y)).toEqual([10, 20]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an entry carrying the property in BOTH top-level and css locks the plan — no binding forms (Sol r42)', () => {
    document.body.innerHTML = '<main><div id="ksbo"></div></main>';
    const target = document.getElementById('ksbo');
    // {x:10, css:{x:30}}: com css:{} presente, o top-level x vira writer
    // genérico (el.x) e css.x é a transform — DOIS writers homônimos vivos.
    // A assinatura 'both' tranca o plano (r61/r62) ANTES de qualquer binding,
    // então gsapEntryOtherFieldsShape (que exclui x dos dois namespaces) nunca
    // é chamado pra uma entry 'both'. Fail closed por construção.
    const vars = {
      keyframes: [
        { x: 10, css: { x: 30 }, duration: 1, parent: {} },
        { x: 20, css: { x: 60 }, duration: 1, parent: {} },
      ],
      duration: 2,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    // Sem steps expostos (plano trancado por 'both').
    expect(xTrack?.steps).toBeUndefined();
    // END recusado — nada mutado.
    sendRetarget(selection, motion, '99');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([10, 20]);
    expect(vars.keyframes.map((entry) => entry.css.x)).toEqual([30, 60]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a non-enumerable ARRAY index mutation in a sibling field stales the binding (Sol r43)', () => {
    document.body.innerHTML = '<main><div id="ksar"></div></main>';
    const target = document.getElementById('ksar');
    // endArray:[10,20] num campo irmão. for...in omite length/holes/índices
    // não-enumeráveis — defineProperty(a,2,{enumerable:false}) muda a.length
    // pra 3 mas o shape via for...in fica igual; o invalidate reinicia o
    // EndArrayPlugin que percorre length → cria o writer do índice 2 fora do
    // journal. O serializer trata arrays por length + descriptor por índice.
    const a = [10, 20];
    const vars = {
      keyframes: [
        { x: 100, endArray: a, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '250');
    expect(vars.keyframes[1].x).toBe(250);

    // Índice não-enumerável adicionado ao array irmão (length 2 → 3).
    Object.defineProperty(a, 2, { value: 30, enumerable: false, writable: true, configurable: true });
    expect(a.length).toBe(3);
    tween.invalidate.mockClear();
    sendStep(selection, motion, 'x', 1, '200'); // undo
    expect(vars.keyframes[1].x).toBe(250); // recusado — não materializa o índice 2
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('refuses RELATIVE and RANDOM values on step edits before any mutation', () => {
    document.body.innerHTML = '<main><div id="ksg"></div></main>';
    const target = document.getElementById('ksg');
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '+=10');
    sendStep(selection, motion, 'x', 1, 'random(0,100)');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('restores a step through an inner-timeline OUTAGE via the frozen binding (binding-first lane)', () => {
    document.body.innerHTML = '<main><div id="kso2"></div></main>';
    const target = document.getElementById('kso2');
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);
    const childFor = (entry, start) => ({ vars: entry, startTime: () => start, duration: () => 1, _initted: true });
    tween.timeline = {
      duration: () => 3,
      getChildren: () => [
        childFor(vars.keyframes[0], 0),
        childFor(vars.keyframes[1], 1),
        childFor(vars.keyframes[2], 2),
      ],
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '500');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 300]);

    // OUTAGE: a timeline interna some do ar — o rollback NUNCA depende de
    // plano fresco (lane binding-first); write NOVO é recusado.
    tween.timeline.getChildren = () => { throw new Error('gone'); };
    sendStep(selection, motion, 'x', 1, '700');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 300]);
    sendStep(selection, motion, 'x', 1, '200');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200, 300]);
    expect(vars.keyframes[1].x).toBe(200);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('reads an intermediate STEP from its entry so transactions can roll it back', () => {
    document.body.innerHTML = '<main><div id="ksv"></div></main>';
    const target = document.getElementById('ksv');
    // Sem reader do canal, validate-transaction canonicaliza before como
    // inexistente e o rollback vira no-op com o edit aplicado (classe Sol r1).
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const stepToken = motion.tracks.find((track) => track.property === 'x').steps
      .find((step) => step.entryIndex === 1).token;
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-ks-step',
            patches: [{
              id: 'p-ks-step',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframeStep.x',
              before: { entryIndex: 1, token: stepToken, value: '200', exists: true },
              value: { entryIndex: 1, token: stepToken, value: '160', exists: true },
            }],
          },
        },
      },
    }));
    const validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(true);
    // A transação-sonda não deixa NADA: entradas restauradas exatamente.
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200, 300]);
    expect(vars.keyframes[1].x).toBe(200);
    expect(vars.x).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an outage STEP restore inside a transaction is rejected BEFORE mutating (r82 lane)', () => {
    document.body.innerHTML = '<main><div id="ksw"></div></main>';
    const target = document.getElementById('ksw');
    const vars = {
      keyframes: [
        { x: 100, duration: 1, parent: {} },
        { x: 200, duration: 1, parent: {} },
        { x: 300, duration: 1, parent: {} },
      ],
      duration: 3,
    };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendStep(selection, motion, 'x', 1, '500');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 300]);

    tween.timeline = {}; // outage: timeline presente, getChildren ausente
    tween.invalidate.mockClear();

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-ks-outage',
            patches: [{
              id: 'p-ks-outage',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframeStep.x',
              before: { entryIndex: 1, value: '500', exists: true },
              value: { entryIndex: 1, value: '200', exists: true },
            }],
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 500, 300]); // intocado
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('refuses RELATIVE desired values on entry-edits before any mutation (Sol r2)', () => {
    document.body.innerHTML = '<main><div id="kfr"></div></main>';
    const target = document.getElementById('kfr');
    // Writing '+=10' into an entry would invalidate the plan itself on the next
    // read/write (relative entry values are unplannable) — the rollback would
    // then be refused and the edit would stick. The write must be rejected
    // BEFORE mutating anything.
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
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
            before: { offset: 1, value: '200', exists: true },
            value: { offset: 1, value: '+=10', exists: true },
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    sendRetarget(selection, motion, '-=25');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);

    // And a probe transaction with a relative value must leave nothing behind.
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-kf-rel',
            patches: [{
              id: 'p-kf-rel',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframe.x',
              before: { offset: 1, value: '200', exists: true },
              value: { offset: 1, value: '+=10', exists: true },
            }],
          },
        },
      },
    }));
    const validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(false);
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('discards a stale frozen binding when the page mutates a run entry externally (Sol r3)', () => {
    document.body.innerHTML = '<main><div id="kfx"></div></main>';
    const target = document.getElementById('kfx');
    // [200,200] -> edit 300 -> page mutates the LAST entry to 250. The frozen
    // binding no longer describes reality: writing through it would set BOTH
    // entries and a rollback would produce [250,250] instead of [300,250].
    // The binding must be detected stale and replaced by a fresh plan (run =
    // last entry only), keeping validate/undo atomic.
    const vars = { keyframes: [{ x: 200, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([300, 300]);

    vars.keyframes[1].x = 250; // external page mutation

    const sendStaleValidate = (id) => window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id,
            patches: [{
              id: `p-${id}`,
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframe.x',
              before: { offset: 1, value: '250', exists: true },
              value: { offset: 1, value: '400', exists: true },
            }],
          },
        },
      },
    }));

    // While the stale binding stands, the write is REFUSED atomically — never
    // silently reinterpreted (Sol r5) — and nothing mutates.
    sendStaleValidate('tx-kf-stale');
    let validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(false);
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([300, 250]);

    // Re-inspection refreshes the truth (stale binding pruned): the same probe
    // is now a NEW edit against the current entries and validates cleanly.
    grabMotion(target, messages);
    sendStaleValidate('tx-kf-stale-2');
    validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(true);
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([300, 250]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('invalidates a frozen binding on structural changes: appended entries and post-binding both-places (Sol r4)', () => {
    document.body.innerHTML = '<main><div id="kfy"></div><div id="kfz"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);

    // (a) APPEND: a raw entry pushed into the live array is INERT — GSAP builds
    // the inner timeline at construction and never processes it (no injected
    // `parent`; probe _probe-kf-append.mjs: it never renders). It must not
    // become a bucket: the frozen binding stays valid, an undo replay restores
    // the REAL end exactly (writing the appended slot would give [100,500,200]
    // rendering 500 — Sol r5), and later edits keep landing on the real end.
    const appendTarget = document.getElementById('kfy');
    const appendVars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    buildArrayKeyframesTween(appendTarget, appendVars);
    window.eval(getRuntimeBridgeSource());
    const append = grabMotion(appendTarget, messages);
    sendRetarget(append.selection, append.motion, '500');
    expect(appendVars.keyframes.map((entry) => entry.x)).toEqual([100, 500]);
    appendVars.keyframes.push({ x: 400, duration: 1 }); // external page mutation (raw, unprocessed)
    sendRetarget(append.selection, append.motion, '200'); // undo replay
    expect(appendVars.keyframes.map((entry) => entry.x)).toEqual([100, 200, 400]);
    sendRetarget(append.selection, append.motion, '600'); // new edit
    expect(appendVars.keyframes.map((entry) => entry.x)).toEqual([100, 600, 400]);

    // (b) BOTH-PLACES appearing post-binding: vars.x written by the page after
    // our first edit reopens the probe-H resurrection — the binding must die
    // and the write must be refused without mutating anything.
    const bothTarget = document.getElementById('kfz');
    const bothVars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    const bothTween = buildArrayKeyframesTween(bothTarget, bothVars);
    const both = grabMotion(bothTarget, messages);
    sendRetarget(both.selection, both.motion, '300');
    expect(bothVars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);
    bothVars.x = 50; // external page mutation
    bothTween.invalidate.mockClear();
    sendRetarget(both.selection, both.motion, '400');
    expect(bothVars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);
    expect(bothVars.x).toBe(50);
    expect(bothTween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('derives segment order from the INNER TIMELINE, surviving external array reorder (Sol r7)', () => {
    document.body.innerHTML = '<main><div id="kfo2"></div></main>';
    const target = document.getElementById('kfo2');
    // GSAP builds one child tween per processed entry at construction —
    // child.vars IS the entry object, children are in TIME order, and
    // reordering the array never reorders the rendered segments (probe
    // _probe-kf-reorder.mjs). After a reverse(), the array's last item is the
    // rendered FIRST segment: writing it would corrupt an intermediate while
    // the real end lives elsewhere.
    const first = { x: 100, duration: 1, parent: {} };
    const last = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [first, last], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = { getChildren: () => [{ vars: first }, { vars: last }] };
    vars.keyframes.reverse(); // external page mutation: array now [last, first]

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    // The REAL end segment (`last`) gets the write — never the array's last item.
    expect(last.x).toBe(300);
    expect(first.x).toBe(100);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps a removed-but-live entry in the inventory and locks post-removal both-places (Sol r8)', () => {
    document.body.innerHTML = '<main><div id="kfrm"></div></main>';
    const target = document.getElementById('kfrm');
    // GSAP builds the inner timeline once: splicing the only x-carrying entry
    // out of the ARRAY leaves its child alive and rendering. Detection must be
    // the UNION of array and children (fail-closed) or x vanishes from the
    // inventory — invisible writer -> unowned -> style patch stomped (the
    // furo-#1 lie) — and a later vars.x falls into the unsafe plain writer.
    const ex = { x: 100, duration: 1, parent: {} };
    const ey = { y: 5, duration: 1, parent: {} };
    const vars = { keyframes: [ex, ey], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = { getChildren: () => [{ vars: ex }, { vars: ey }] };
    vars.keyframes.splice(0, 1); // page removes the only x-carrying entry

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(true);

    // The write reaches the LIVE segment (the removed entry the child holds).
    sendRetarget(selection, motion, '300');
    expect(ex.x).toBe(300);
    expect(vars.x).toBeUndefined();
    expect(vars.startAt).toBeUndefined();

    // vars.x appearing afterwards = both-places: the plain writer must never
    // run (probe-H resurrection) and nothing may mutate.
    vars.x = 50;
    sendRetarget(selection, motion, '400');
    expect(ex.x).toBe(300);
    expect(vars.x).toBe(50);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps live children editable after the page DELETES vars.keyframes entirely (Sol r9)', () => {
    document.body.innerHTML = '<main><div id="kfdel"></div></main>';
    const target = document.getElementById('kfdel');
    // GSAP keeps the inner timeline (and its live, rendering entries) after
    // `delete vars.keyframes` (probe _probe-kf-delete.mjs). Detection and both
    // writers must consult the children INDEPENDENTLY of the array's presence,
    // or the property vanishes from the inventory and later falls into the
    // plain vars writer — the furo-#1 lie all over again. Provenance is cached
    // at the inspection BEFORE the delete (the product flow: selection inspects
    // long before a page script could mutate).
    const ex = { x: 100, duration: 1, parent: {} };
    const ey = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [ex, ey], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = { getChildren: () => [{ vars: ex }, { vars: ey }] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // provenance observed: array
    delete vars.keyframes; // external page mutation
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(true);

    // retarget channel: the write reaches the live end entry, never vars.x.
    sendRetarget(selection, motion, '300');
    expect(ey.x).toBe(300);
    expect(ex.x).toBe(100);
    expect(vars.x).toBeUndefined();

    // step channel: same — the plain vars writer must never run.
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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '160', exists: true },
          },
        },
      },
    }));
    expect(ey.x).toBe(160);
    expect(vars.x).toBeUndefined();
    expect(vars.startAt).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('inventories-but-locks entry-shaped children whose origin was never observed (Sol r9+r10)', () => {
    document.body.innerHTML = '<main><div id="kfun"></div></main>';
    const target = document.getElementById('kfun');
    // Deleted BEFORE any inspection: no provenance. Ownership decides, not key
    // shape (an entry may legitimately author `stagger: 0` — GSAP passes
    // entries to tl.to() verbatim, Sol r11): a child carrying a prop the
    // tween's vars does NOT own has no other writer, so the track stays
    // inventoried and the plain writer stays blocked (fail-closed) — but the
    // write plan demands PROOF of the array form, so both edit channels refuse.
    const ex = { x: 100, duration: 1, stagger: 0, parent: {} };
    const ey = { x: 200, duration: 1, stagger: 0, parent: {} };
    const vars = { duration: 2 }; // deleted before first inspection
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = { getChildren: () => [{ vars: ex }, { vars: ey }] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);
    expect(xTrack.keyframeEditReason).toBe('keyframes');

    sendRetarget(selection, motion, '300');
    expect(ey.x).toBe(200);
    expect(vars.x).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('applies unproven-origin ownership PER PROPERTY on mixed children (Sol r12)', () => {
    document.body.innerHTML = '<main><div id="kfmx"></div></main>';
    const target = document.getElementById('kfmx');
    // Unproven origin, MIXED child {x owned by vars, y unowned}: x keeps its
    // live plain writer (retargetable, plain write path), while y — which has
    // no other writer — stays inventoried and locked. Whole-child filtering
    // would drag x into the lock (the r10/r11 generalized-lock violation).
    const child = { x: 100, y: 200, duration: 2, parent: {} };
    const vars = { x: 100, duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = { getChildren: () => [{ vars: child }] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    const yTrack = motion.tracks.find((track) => track.property === 'y');
    expect(xTrack.ownership.retargetable).toBe(true);
    expect(xTrack.keyframeEditable).toBe(true);
    expect(yTrack).toBeTruthy();
    expect(yTrack.ownership.retargetable).toBe(false);
    expect(yTrack.keyframeEditable).toBe(false);

    // x keeps the plain vars write path; y refuses without mutating.
    sendRetarget(selection, motion, '300');
    expect(vars.x).toBe(300);
    expect(child.x).toBe(100);
    expect(child.y).toBe(200);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps a plain top-level prop step-editable beside keyframes of ANOTHER prop (Sol r13)', () => {
    document.body.innerHTML = '<main><div id="kfra"></div></main>';
    const target = document.getElementById('kfra');
    // {x:100, keyframes:[{y}...]}: x is entirely plain — probe
    // _probe-rides-along.mjs: writing vars.x and startAt.x preserves y's path
    // completely. Gating the step channel on vars.keyframes ALONE locked it
    // (generalized lock). Ownership is per PROPERTY on this channel too.
    const vars = { x: 100, keyframes: [{ y: 50, duration: 1, parent: {} }, { y: 100, duration: 1, parent: {} }], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.keyframeEditable).toBe(true);
    expect(xTrack.keyframeEditReason).toBeUndefined();

    const sendKeyframe = (offset, value) => window.dispatchEvent(new MessageEvent('message', {
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
            before: { offset, value: '', exists: true },
            value: { offset, value, exists: true },
          },
        },
      },
    }));

    sendKeyframe(1, '150');
    expect(vars.x).toBe('150');
    sendKeyframe(0, '20');
    expect(vars.startAt).toEqual({ x: '20' });
    // y's entries stay untouched by x's plain writes.
    expect(vars.keyframes.map((entry) => entry.y)).toEqual([50, 100]);
    expect(tween.invalidate).toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('never lets an INERT appended slot claim ownership of a plain prop (Sol r14)', () => {
    document.body.innerHTML = '<main><div id="kfin"></div></main>';
    const target = document.getElementById('kfin');
    // {x:100, keyframes:[{y}...]} + raw push({x:200}): the appended slot never
    // renders (r5 probe — inert), so it must not mark the PLAIN x as
    // keyframe-owned; that would null the plan (vars.x = both-places) and lock
    // the legitimate writer with no cure. Ownership of the array form reads
    // PROCESSED entries only.
    const vars = { x: 100, keyframes: [{ y: 50, duration: 1, parent: {} }, { y: 100, duration: 1, parent: {} }], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    vars.keyframes.push({ x: 200 }); // raw external append — inert

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(true);
    expect(xTrack.keyframeEditable).toBe(true);

    sendRetarget(selection, motion, '300');
    expect(vars.x).toBe(300);
    expect(vars.keyframes[2].x).toBe(200); // inert slot untouched
    expect(vars.keyframes.map((entry) => entry.y)).toEqual([50, 100, undefined]);
    expect(tween.invalidate).toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps ownership frozen when the page REPLACES vars.keyframes with another shape (Sol r15)', () => {
    document.body.innerHTML = '<main><div id="kfr1"></div><div id="kfr2"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);

    // (a) array → object replacement: the old array's children keep rendering.
    // The truthy impostor must not flip the cached provenance — x stays
    // inventoried and LOCKED; a stale retarget must never reach the plain
    // writer (vars.x would resurrect probe-H corruption).
    const ex = { x: 100, duration: 1, parent: {} };
    const ey = { x: 200, duration: 1, parent: {} };
    const arrVars = { keyframes: [ex, ey], duration: 2 };
    const arrTween = buildArrayKeyframesTween(document.getElementById('kfr1'), arrVars);
    arrTween.timeline = { getChildren: () => [{ vars: ex }, { vars: ey }] };

    // (b) object → array replacement: the original object's children keep
    // rendering; the impostor array must not unlock the write plan.
    const gen1 = { x: 0, duration: 1, parent: {} };
    const gen2 = { x: 60, duration: 1, parent: {} };
    const objVars = { keyframes: { x: [0, 60] }, duration: 2 };
    const objTween = buildArrayKeyframesTween(document.getElementById('kfr2'), objVars);
    objTween.timeline = { getChildren: () => [{ vars: gen1 }, { vars: gen2 }] };
    // buildArrayKeyframesTween replaces window.gsap each call — expose BOTH tweens.
    window.gsap.globalTimeline = { getChildren: () => [arrTween, objTween] };

    window.eval(getRuntimeBridgeSource());

    grabMotion(document.getElementById('kfr1'), messages); // provenance: array
    arrVars.keyframes = { y: [0, 60] }; // external replacement (inert impostor)
    const arr = grabMotion(document.getElementById('kfr1'), messages);
    const arrTrack = arr.motion.tracks.find((track) => track.property === 'x');
    expect(arrTrack).toBeTruthy();
    expect(arrTrack.ownership.retargetable).toBe(false);
    sendRetarget(arr.selection, arr.motion, '300');
    expect(arrVars.x).toBeUndefined();
    expect(ey.x).toBe(200);

    grabMotion(document.getElementById('kfr2'), messages); // provenance: other
    objVars.keyframes = [{ x: 100 }]; // external replacement (inert impostor array)
    const obj = grabMotion(document.getElementById('kfr2'), messages);
    const objTrack = obj.motion.tracks.find((track) => track.property === 'x');
    expect(objTrack).toBeTruthy();
    expect(objTrack.ownership.retargetable).toBe(false);
    sendRetarget(obj.selection, obj.motion, '300');
    expect(objVars.x).toBeUndefined();
    expect(gen2.x).toBe(60);
    expect(objVars.keyframes[0].x).toBe(100); // impostor untouched

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps in-place mutations of the object source from hiding live segments (Sol r16)', () => {
    document.body.innerHTML = '<main><div id="kfip"></div></main>';
    const target = document.getElementById('kfip');
    // The frozen provenance must freeze CONTENT too: `delete source.x` in
    // place keeps the reference identical while the children keep rendering
    // x — losing it from the inventory lets a stale patch write vars.x and
    // report success while the path still ends at 60 (false write).
    const gen1 = { x: 0, duration: 1, parent: {} };
    const gen2 = { x: 60, duration: 1, parent: {} };
    const vars = { keyframes: { x: [0, 60] }, duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = { getChildren: () => [{ vars: gen1 }, { vars: gen2 }] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // provenance frozen (shape, source, props)
    delete vars.keyframes.x; // external in-place mutation — reference unchanged
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '160');
    expect(vars.x).toBeUndefined();
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
    expect(vars.startAt).toBeUndefined();
    expect(gen2.x).toBe(60);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('never surfaces GSAP reserved keys inside entries as editable tracks (Sol r17)', () => {
    document.body.innerHTML = '<main><div id="kfrv"></div></main>';
    const target = document.getElementById('kfrv');
    // yoyoEase/easeReverse/repeatRefresh/autoRevert/stringFilter are RESERVED
    // (GSAP 3.15 _reservedProps, extracted verbatim from the fixture source) —
    // treating them as animated props creates a FALSE control whose edits
    // validate while changing nothing visual.
    const vars = {
      keyframes: [
        { x: 100, yoyoEase: true, duration: 1, parent: {} },
        { x: 200, easeReverse: 'power1', repeatRefresh: true, onCompleteParams: [1], duration: 1, parent: {} },
      ],
      duration: 2,
    };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    expect(motion.tracks.map((track) => track.property)).toEqual(['x']);

    // A patch against a reserved key must not mutate anything.
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
            property: 'keyframe.yoyoEase',
            before: { offset: 1, value: 'true', exists: true },
            value: { offset: 1, value: 'power2', exists: true },
          },
        },
      },
    }));
    expect(vars.keyframes[0].yoyoEase).toBe(true);
    expect(vars.yoyoEase).toBeUndefined();
    expect(vars.startAt).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('rolls back a startAt edit by RENDER-equivalent restore, never a naive delete (Sol r18)', () => {
    document.body.innerHTML = '<main><div id="kfsr"></div></main>';
    const target = document.getElementById('kfsr');
    // GSAP materializes _startAt on first render: deleting vars.startAt does
    // NOT un-materialize it (probe _probe-startat-rollback.mjs — the start
    // stays 40 while validate reports restored). The rollback must write the
    // ORIGINAL start value (sampled at progress 0 before the first edit) back.
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-startat',
            patches: [{
              id: 'p-startat',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframe.x',
              before: { offset: 0, exists: false },
              value: { offset: 0, value: '40', exists: true },
            }],
          },
        },
      },
    }));
    const validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(true);
    // Render-equivalent restore: the original start value written back —
    // never a dangling {x:'40'} nor a naive delete the _startAt outlives.
    expect(vars.startAt).toEqual({ x: '0' });

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps a target-owned onOverwrite animatable — it is NOT in GSAP 3.15 _reservedProps (Sol r18)', () => {
    document.body.innerHTML = '<main><div id="kfoo"></div></main>';
    const target = document.getElementById('kfoo');
    // onOverwrite is absent from the fixture's verbatim _reservedProps string:
    // GSAP genuinely animates a target-owned property with that name. Treating
    // it as reserved recreated an invisible writer.
    const vars = { onOverwrite: 100, duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { motion } = grabMotion(target, messages);
    const track = motion.tracks.find((candidate) => candidate.property === 'onOverwrite');
    expect(track).toBeTruthy();
    expect(track.ownership.retargetable).toBe(true);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks entries that spawn NESTED facades (stagger/fn-timing inside an entry) (Sol r19)', () => {
    document.body.innerHTML = '<main><div id="kfnf"></div></main>';
    const target = document.getElementById('kfnf');
    // GSAP passes each entry to tl.to(), which re-processes stagger and
    // fn/string timing: the entry's child grows its OWN inner timeline and the
    // real animation lives a level deeper — writing the outer entry renders
    // NOTHING (probe _probe-r19.mjs: end stayed 200 after x:900).
    const e1 = { x: 100, stagger: 0.1, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = { getChildren: () => [{ vars: e1, timeline: {} }, { vars: e2, timeline: {} }] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy(); // still inventoried — the writer is alive
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '900');
    expect(e2.x).toBe(200);
    expect(vars.x).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks the step channel on multi-target tweens — startAt cannot restore per-target starts (Sol r19)', () => {
    document.body.innerHTML = '<main><div id="kmt1"></div><div id="kmt2"></div></main>';
    const t1 = document.getElementById('kmt1');
    const t2 = document.getElementById('kmt2');
    // vars.startAt is ONE shared object: an offset-0 edit flattens distinct
    // per-target starts and the single-value rollback cannot restore them
    // ([10,20] -> [10,10], probe _probe-r19.mjs).
    const vars = { x: 100, duration: 2 };
    const tween = buildArrayKeyframesTween(t1, vars, { targets: [t1, t2] });

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(t1, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.keyframeEditable).toBe(false);
    expect(xTrack.keyframeEditReason).toBe('multi-target');

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
            before: { offset: 0, exists: false },
            value: { offset: 0, value: '40', exists: true },
          },
        },
      },
    }));
    expect(vars.startAt).toBeUndefined();
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('computes the trailing run by NUMERIC equivalence, locking unprovable unit mixes (Sol r20)', () => {
    document.body.innerHTML = '<main><div id="kfnum"></div><div id="kfamb"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);

    // [0, "200.0", 200] renders as a HOLD at 200 — a textual run would edit
    // only the last entry and turn the hold into a ramp (intermediate path
    // corruption). Numeric equivalence must extend the run over both.
    const numVars = { keyframes: [{ x: 0, duration: 1, parent: {} }, { x: '200.0', duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 3 };
    const numTween = buildArrayKeyframesTween(document.getElementById('kfnum'), numVars);

    // [.., "200px", 200] MAY render as a hold (px is the length default) but
    // the equivalence is unprovable without per-property knowledge — locked.
    const ambVars = { keyframes: [{ x: '200px', duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    const ambTween = buildArrayKeyframesTween(document.getElementById('kfamb'), ambVars);
    window.gsap.globalTimeline = { getChildren: () => [numTween, ambTween] };

    window.eval(getRuntimeBridgeSource());

    const num = grabMotion(document.getElementById('kfnum'), messages);
    expect(num.motion.tracks.find((track) => track.property === 'x').ownership.retargetable).toBe(true);
    sendRetarget(num.selection, num.motion, '300');
    // Type preserved per bucket (the authored string stays a string) — GSAP
    // renders '300' and 300 identically; what matters is the hold held.
    expect(numVars.keyframes.map((entry) => entry.x)).toEqual([0, '300', 300]);

    const amb = grabMotion(document.getElementById('kfamb'), messages);
    const ambTrack = amb.motion.tracks.find((track) => track.property === 'x');
    expect(ambTrack.ownership.retargetable).toBe(false);
    expect(ambTrack.keyframeEditable).toBe(false);
    sendRetarget(amb.selection, amb.motion, '300');
    expect(ambVars.keyframes.map((entry) => entry.x)).toEqual(['200px', 200]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('refuses a desired value that would leave the run AMBIGUOUS against its neighbors (Sol r21)', () => {
    document.body.innerHTML = '<main><div id="kfsim"></div></main>';
    const target = document.getElementById('kfsim');
    // ['100px','200px'] + bare '100': the write would land '100' beside
    // '100px' — same number, different unit spelling — nulling the next plan
    // and stranding the edit beyond any rollback (the r2 failure class). The
    // simulation must reject BEFORE mutating; a unit-consistent '100px' is
    // accepted and extends the hold.
    const vars = { keyframes: [{ x: '100px', duration: 1, parent: {} }, { x: '200px', duration: 1, parent: {} }], duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    expect(motion.tracks.find((track) => track.property === 'x').ownership.retargetable).toBe(true);

    sendRetarget(selection, motion, '100');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['100px', '200px']);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-amb',
            patches: [{
              id: 'p-amb',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'retarget.final',
              before: { schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value: '200px' },
              value: {
                schemaVersion: 2,
                semanticProperty: 'translateX',
                runtimeProperty: 'x',
                value: '100',
                writeModel: 'absolute',
                responsiveScope: 'shared',
                owner: { channelId: `${motion.id}:translateX`, motionId: motion.id },
                keyframe: { position: 'final-existing' },
              },
            }],
          },
        },
      },
    }));
    const validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(false);
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['100px', '200px']);

    // Unit-consistent write stays accepted.
    sendRetarget(selection, motion, '100px');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['100px', '100px']);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('treats CROSS-UNIT neighbors as ambiguous regardless of the numbers (Sol r22)', () => {
    document.body.innerHTML = '<main><div id="kfxu"></div></main>';
    const target = document.getElementById('kfxu');
    // '16px' and '1rem' may render EQUAL (a hold) — numeric comparison across
    // units is unprovable in either direction, so the pair must lock the plan,
    // never be read as 'different' (which would edit only the last bucket and
    // turn the hold into a ramp).
    const vars = { keyframes: [{ x: '16px', duration: 1, parent: {} }, { x: '1rem', duration: 1, parent: {} }], duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual(['16px', '1rem']);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('treats UNPARSABLE value pairs as ambiguous — colors can alias each other (Sol r23)', () => {
    document.body.innerHTML = '<main><div id="kfcl"></div><div id="kfcs"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);

    // '#fff' and 'rgb(255,255,255)' render EQUAL (a hold): reading them as
    // 'different' edits only the last entry and turns the hold into a fade.
    // Distinctness of unparsable values is equally unprovable ('#00f' IS
    // 'blue') — any parse failure on a differing pair locks the plan.
    const holdVars = { keyframes: [{ backgroundColor: '#fff', duration: 1, parent: {} }, { backgroundColor: 'rgb(255,255,255)', duration: 1, parent: {} }], duration: 2 };
    const holdTween = buildArrayKeyframesTween(document.getElementById('kfcl'), holdVars);
    // A SINGLE color entry has no neighbor to misread — stays editable.
    const singleVars = { keyframes: [{ backgroundColor: 'red', duration: 1, parent: {} }], duration: 1 };
    const singleTween = buildArrayKeyframesTween(document.getElementById('kfcs'), singleVars);
    window.gsap.globalTimeline = { getChildren: () => [holdTween, singleTween] };

    window.eval(getRuntimeBridgeSource());

    const hold = grabMotion(document.getElementById('kfcl'), messages);
    const holdTrack = hold.motion.tracks.find((track) => track.property === 'backgroundColor');
    expect(holdTrack.ownership.retargetable).toBe(false);
    expect(holdTrack.keyframeEditable).toBe(false);

    const single = grabMotion(document.getElementById('kfcs'), messages);
    const singleTrack = single.motion.tracks.find((track) => track.property === 'backgroundColor');
    expect(singleTrack.ownership.retargetable).toBe(true);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('compares opacity through its render clamp — out-of-range values hold at 1 (Sol r24)', () => {
    document.body.innerHTML = '<main><div id="kfop"></div></main>';
    const target = document.getElementById('kfop');
    // opacity 2 and 3 BOTH compute to 1 (CSS clamps to [0,1]): a raw numeric
    // comparison reads 'different', edits only the last entry and turns the
    // visual hold into a fade. The clamp-aware run must edit BOTH.
    const vars = { keyframes: [{ opacity: 2, duration: 1, parent: {} }, { opacity: 3, duration: 1, parent: {} }], duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
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
            before: { schemaVersion: 2, semanticProperty: 'opacity', runtimeProperty: 'opacity', value: '3' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'opacity',
              runtimeProperty: 'opacity',
              value: '0',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:opacity`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.opacity)).toEqual([0, 0]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('normalizes percents, honors autoAlpha visibility, and restores AUTHORED ends on rollback (Sol r25)', () => {
    document.body.innerHTML = '<main><div id="kfpc"></div><div id="kfaa"></div><div id="kfrb"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);

    // '2%' and '3%' convert to 0.02/0.03 — a REAL ramp, never a clamped hold.
    const pctVars = { keyframes: [{ opacity: '2%', duration: 1, parent: {} }, { opacity: '3%', duration: 1, parent: {} }], duration: 2 };
    const pctTween = buildArrayKeyframesTween(document.getElementById('kfpc'), pctVars);
    // autoAlpha 0 means visibility:hidden; -1 does NOT — discrete state differs.
    const aaVars = { keyframes: [{ autoAlpha: -1, duration: 1, parent: {} }, { autoAlpha: 0, duration: 1, parent: {} }], duration: 2 };
    const aaTween = buildArrayKeyframesTween(document.getElementById('kfaa'), aaVars);
    // Rollback of [2,3]: the reader reports the AUTHORED '3', the sampled end
    // is the clamped 1 — landing back on the authored end must restore
    // verbatim, never uniform-write [3,3].
    const rbVars = { keyframes: [{ opacity: 2, duration: 1, parent: {} }, { opacity: 3, duration: 1, parent: {} }], duration: 2 };
    const rbTween = buildArrayKeyframesTween(document.getElementById('kfrb'), rbVars);
    window.gsap.globalTimeline = { getChildren: () => [pctTween, aaTween, rbTween] };

    window.eval(getRuntimeBridgeSource());

    const sendPropRetarget = (grabbed, property, before, value) => window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-patch',
        payload: {
          patch: {
            elementId: grabbed.selection.payload.element.id,
            kind: 'motion',
            motionId: grabbed.motion.id,
            property: 'retarget.final',
            before: { schemaVersion: 2, semanticProperty: property, runtimeProperty: property, value: before },
            value: {
              schemaVersion: 2,
              semanticProperty: property,
              runtimeProperty: property,
              value,
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${grabbed.motion.id}:${property}`, motionId: grabbed.motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));

    const pct = grabMotion(document.getElementById('kfpc'), messages);
    sendPropRetarget(pct, 'opacity', '3%', '50%');
    expect(pctVars.keyframes.map((entry) => entry.opacity)).toEqual(['2%', '50%']);

    const aa = grabMotion(document.getElementById('kfaa'), messages);
    sendPropRetarget(aa, 'autoAlpha', '0', '1');
    expect(aaVars.keyframes.map((entry) => entry.autoAlpha)).toEqual([-1, 1]);

    const rb = grabMotion(document.getElementById('kfrb'), messages);
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-clamp-rb',
            patches: [{
              id: 'p-clamp-rb',
              elementId: rb.selection.payload.element.id,
              kind: 'motion',
              motionId: rb.motion.id,
              property: 'keyframe.opacity',
              before: { offset: 1, value: '3', exists: true },
              value: { offset: 1, value: '0', exists: true },
            }],
          },
        },
      },
    }));
    const validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(true);
    expect(rbVars.keyframes.map((entry) => entry.opacity)).toEqual([2, 3]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('detects external mutation of NON-run buckets — a live hold must never become a ramp (Sol r26)', () => {
    document.body.innerHTML = '<main><div id="kfnr"></div></main>';
    const target = document.getElementById('kfnr');
    // [100,200] -> we write 300 -> page mutates the FIRST entry to 300: the
    // page created a live hold [300,300]. A binding that only watches its own
    // run bucket still validates, writes 400 into the last entry alone and
    // turns the hold into a ramp [300,400]. The whole carrying set is frozen:
    // external divergence anywhere -> atomic refusal; re-inspection re-plans
    // and the next edit covers the full hold.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    e1.x = 300; // external page mutation of a NON-run bucket — live hold now

    sendRetarget(selection, motion, '400'); // must refuse atomically
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([300, 300]);

    grabMotion(target, messages); // re-inspection prunes the stale binding
    sendRetarget(selection, motion, '400'); // fresh plan covers the whole hold
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([400, 400]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks the plan when a live PropTween lost its vars slot (hidden terminal carrier) (Sol r27)', () => {
    document.body.innerHTML = '<main><div id="kfhc"></div></main>';
    const target = document.getElementById('kfhc');
    // Deleting x from the LAST entry (no invalidate yet) leaves its PropTween
    // ALIVE — the end still renders 200 while the entry no longer declares x
    // (probe _probe-r27.mjs: _ptLookup keeps the key). The plan would then
    // treat a NON-terminal entry as the end and corrupt the path on write.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { duration: 1, parent: {} }; // x deleted in place
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = {
      getChildren: () => [
        { vars: e1, _initted: true, _ptLookup: [{ x: {} }] },
        { vars: e2, _initted: true, _ptLookup: [{ x: {} }] }, // live, undeclared
      ],
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e1.x).toBe(100);
    expect(vars.x).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks ALL channels of an animation with a KILLED writer — invalidate would resurrect it (Sol r28)', () => {
    document.body.innerHTML = '<main><div id="kfkl"></div></main>';
    const target = document.getElementById('kfkl');
    // After t.kill(target,'x') the entries still DECLARE x but the PropTween
    // is dead (probe _probe-r28.mjs: ptLookup only has y). Our invalidate —
    // fired by an edit of ANY channel, y included — re-inits from vars and
    // RESURRECTS x, stomping whatever animation took the channel over
    // (x: 999 -> 200 in the probe). Declaration<->lookup asymmetry poisons the
    // whole animation's entry plan.
    const e1 = { x: 100, y: 5, duration: 1, parent: {} };
    const e2 = { x: 200, y: 10, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = {
      getChildren: () => [
        { vars: e1, _initted: true, _ptLookup: [{ y: {} }] },
        { vars: e2, _initted: true, _ptLookup: [{ y: {} }] },
      ],
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const yTrack = motion.tracks.find((track) => track.property === 'y');
    expect(yTrack.ownership.retargetable).toBe(false);
    expect(yTrack.keyframeEditable).toBe(false);

    // Editing y must refuse WITHOUT invalidating (resurrection vector).
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
            before: { schemaVersion: 2, semanticProperty: 'y', runtimeProperty: 'y', value: '10' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'y',
              runtimeProperty: 'y',
              value: '50',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:y`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(e2.y).toBe(10);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks even RIDES-ALONG channels when a killed writer haunts the animation (Sol r29)', () => {
    document.body.innerHTML = '<main><div id="kfrz"></div></main>';
    const target = document.getElementById('kfrz');
    // {z:100, keyframes:[{x}...]} with x's PropTween killed: editing the
    // top-level z rides the PLAIN path — which also fires invalidate and
    // resurrects the dead x writer. The hazard is per ANIMATION, not per
    // property: every channel must refuse before any mutation/invalidate.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { z: 100, keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = {
      getChildren: () => [
        { vars: e1, _initted: true, _ptLookup: [{}] }, // x killed
        { vars: e2, _initted: true, _ptLookup: [{}] },
      ],
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const zTrack = motion.tracks.find((track) => track.property === 'z');
    expect(zTrack.ownership.retargetable).toBe(false);
    expect(zTrack.keyframeEditable).toBe(false);

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
            before: { schemaVersion: 2, semanticProperty: 'z', runtimeProperty: 'z', value: '100' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'z',
              runtimeProperty: 'z',
              value: '300',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:z`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(vars.z).toBe(100);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('never flags ALIASED props as killed writers — autoAlpha materializes as opacity+visibility (Sol r30)', () => {
    document.body.innerHTML = '<main><div id="kfal"></div></main>';
    const target = document.getElementById('kfal');
    // GSAP normalizes aliases in _ptLookup (probe _probe-r30.mjs): autoAlpha
    // -> visibility+opacity, alpha -> opacity, scale -> scale/scaleX/scaleY.
    // Literal comparison read a HEALTHY child as a killed writer and locked
    // the whole animation.
    const e1 = { autoAlpha: 0.5, duration: 1, parent: {} };
    const e2 = { autoAlpha: 1, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = {
      getChildren: () => [
        { vars: e1, _initted: true, _ptLookup: [{ opacity: {}, visibility: {} }] },
        { vars: e2, _initted: true, _ptLookup: [{ opacity: {}, visibility: {} }] },
      ],
    };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { motion } = grabMotion(target, messages);
    const track = motion.tracks.find((candidate) => candidate.property === 'autoAlpha');
    expect(track.ownership.retargetable).toBe(true);
    expect(track.keyframeEditable).toBe(true);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('models aliases as synonyms vs compounds — partial kills stay hazards (Sol r31)', () => {
    document.body.innerHTML = '<main><div id="kfs1"></div><div id="kfs2"></div><div id="kfs3"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);

    // Healthy SYNONYM: declared `rotate` materializes as `rotation` (probe
    // _probe-r31.mjs) — never a hazard.
    const r1 = { rotate: 45, duration: 1, parent: {} };
    const r2 = { rotate: 90, duration: 1, parent: {} };
    const rotVars = { keyframes: [r1, r2], duration: 2 };
    const rotTween = buildArrayKeyframesTween(document.getElementById('kfs1'), rotVars);
    rotTween.timeline = { getChildren: () => [{ vars: r1, _initted: true, _ptLookup: [{ rotation: {} }] }, { vars: r2, _initted: true, _ptLookup: [{ rotation: {} }] }] };

    // COMPOUND partial kill: autoAlpha with only `visibility` left (opacity
    // killed) — .some() would read healthy; ALL expansions are required.
    const a1 = { autoAlpha: 0.5, duration: 1, parent: {} };
    const a2 = { autoAlpha: 1, duration: 1, parent: {} };
    const aaVars = { keyframes: [a1, a2], duration: 2 };
    const aaTween = buildArrayKeyframesTween(document.getElementById('kfs2'), aaVars);
    aaTween.timeline = { getChildren: () => [{ vars: a1, _initted: true, _ptLookup: [{ visibility: {} }] }, { vars: a2, _initted: true, _ptLookup: [{ visibility: {} }] }] };

    // COMPOUND partial kill: scale with scaleX killed — the leftover literal
    // `scale` key must NOT serve as a shortcut (probe: ['scaleY','scale']).
    const s1 = { scale: 1.5, duration: 1, parent: {} };
    const s2 = { scale: 1, duration: 1, parent: {} };
    const scVars = { keyframes: [s1, s2], duration: 2 };
    const scTween = buildArrayKeyframesTween(document.getElementById('kfs3'), scVars);
    scTween.timeline = { getChildren: () => [{ vars: s1, _initted: true, _ptLookup: [{ scaleY: {}, scale: {} }] }, { vars: s2, _initted: true, _ptLookup: [{ scaleY: {}, scale: {} }] }] };

    window.gsap.globalTimeline = { getChildren: () => [rotTween, aaTween, scTween] };
    window.eval(getRuntimeBridgeSource());

    const rot = grabMotion(document.getElementById('kfs1'), messages);
    expect(rot.motion.tracks.find((track) => track.property === 'rotate').ownership.retargetable).toBe(true);

    const aa = grabMotion(document.getElementById('kfs2'), messages);
    expect(aa.motion.tracks.find((track) => track.property === 'autoAlpha').ownership.retargetable).toBe(false);
    expect(aa.motion.tracks.find((track) => track.property === 'autoAlpha').keyframeEditable).toBe(false);

    const sc = grabMotion(document.getElementById('kfs3'), messages);
    expect(sc.motion.tracks.find((track) => track.property === 'scale').ownership.retargetable).toBe(false);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('sees hidden carriers through ALIASES — terminal deletion of autoAlpha/rotate stays locked (Sol r32)', () => {
    document.body.innerHTML = '<main><div id="kfh1"></div><div id="kfh2"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);

    // autoAlpha deleted from the TERMINAL entry: the live writers are keyed
    // opacity+visibility, never 'autoAlpha' — a literal lookup check misses
    // them and the plan edits a non-terminal entry as the end.
    const a1 = { autoAlpha: 0.5, duration: 1, parent: {} };
    const a2 = { duration: 1, parent: {} }; // autoAlpha deleted in place
    const aaVars = { keyframes: [a1, a2], duration: 2 };
    const aaTween = buildArrayKeyframesTween(document.getElementById('kfh1'), aaVars);
    aaTween.timeline = { getChildren: () => [
      { vars: a1, _initted: true, _ptLookup: [{ opacity: {}, visibility: {} }] },
      { vars: a2, _initted: true, _ptLookup: [{ opacity: {}, visibility: {} }] },
    ] };

    // Same through a SYNONYM: rotate materializes as 'rotation'.
    const r1 = { rotate: 45, duration: 1, parent: {} };
    const r2 = { duration: 1, parent: {} }; // rotate deleted in place
    const rotVars = { keyframes: [r1, r2], duration: 2 };
    const rotTween = buildArrayKeyframesTween(document.getElementById('kfh2'), rotVars);
    rotTween.timeline = { getChildren: () => [
      { vars: r1, _initted: true, _ptLookup: [{ rotation: {} }] },
      { vars: r2, _initted: true, _ptLookup: [{ rotation: {} }] },
    ] };

    window.gsap.globalTimeline = { getChildren: () => [aaTween, rotTween] };
    window.eval(getRuntimeBridgeSource());

    const aa = grabMotion(document.getElementById('kfh1'), messages);
    const aaTrack = aa.motion.tracks.find((track) => track.property === 'autoAlpha');
    expect(aaTrack.ownership.retargetable).toBe(false);
    expect(aaTrack.keyframeEditable).toBe(false);

    const rot = grabMotion(document.getElementById('kfh2'), messages);
    const rotTrack = rot.motion.tracks.find((track) => track.property === 'rotate');
    expect(rotTrack.ownership.retargetable).toBe(false);
    expect(rotTrack.keyframeEditable).toBe(false);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('resolves the transform AGGREGATE by parsing the entry value (Sol r33)', () => {
    document.body.innerHTML = '<main><div id="kft1"></div><div id="kft2"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);

    // transform:'translateX(...)' materializes as the `x` writer — no
    // 'transform' key ever exists in _ptLookup. A fixed-key resolver read a
    // HEALTHY tween as hazardous and locked even the plain opacity track.
    const h1 = { transform: 'translateX(10px)', duration: 1, parent: {} };
    const h2 = { transform: 'translateX(20px)', duration: 1, parent: {} };
    const healthyVars = { opacity: 0.5, keyframes: [h1, h2], duration: 2 };
    const healthyTween = buildArrayKeyframesTween(document.getElementById('kft1'), healthyVars);
    healthyTween.timeline = { getChildren: () => [
      { vars: h1, _initted: true, _ptLookup: [{ x: {} }] },
      { vars: h2, _initted: true, _ptLookup: [{ x: {} }] },
    ] };

    // Same shape with the x writer KILLED: a real hazard again.
    const k1 = { transform: 'translateX(10px)', duration: 1, parent: {} };
    const k2 = { transform: 'translateX(20px)', duration: 1, parent: {} };
    const killedVars = { opacity: 0.5, keyframes: [k1, k2], duration: 2 };
    const killedTween = buildArrayKeyframesTween(document.getElementById('kft2'), killedVars);
    killedTween.timeline = { getChildren: () => [
      { vars: k1, _initted: true, _ptLookup: [{}] },
      { vars: k2, _initted: true, _ptLookup: [{}] },
    ] };

    window.gsap.globalTimeline = { getChildren: () => [healthyTween, killedTween] };
    window.eval(getRuntimeBridgeSource());

    const healthy = grabMotion(document.getElementById('kft1'), messages);
    const healthyOpacity = healthy.motion.tracks.find((track) => track.property === 'opacity');
    expect(healthyOpacity.ownership.retargetable).toBe(true);
    expect(healthyOpacity.keyframeEditable).toBe(true);

    const killed = grabMotion(document.getElementById('kft2'), messages);
    const killedOpacity = killed.motion.tracks.find((track) => track.property === 'opacity');
    expect(killedOpacity.ownership.retargetable).toBe(false);
    expect(killedOpacity.keyframeEditable).toBe(false);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('freezes a positive writer BASELINE per child — later kills are exact, one-arg translate is healthy (Sol r34)', () => {
    document.body.innerHTML = '<main><div id="kfb1"></div><div id="kfb2"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);

    // translate3d-style writers (x,y,z) cannot be reconstructed from function
    // names — the baseline is OBSERVED at first sight; killing x afterwards
    // must read as a hazard on re-inspection.
    const b1 = { transform: 'translate3d(1px,2px,3px)', duration: 1, parent: {} };
    const b2 = { transform: 'translate3d(4px,5px,6px)', duration: 1, parent: {} };
    const blVars = { opacity: 0.5, keyframes: [b1, b2], duration: 2 };
    const blTween = buildArrayKeyframesTween(document.getElementById('kfb1'), blVars);
    const lookup1 = { x: {}, y: {}, z: {} };
    const lookup2 = { x: {}, y: {}, z: {} };
    // Children are STABLE objects in real GSAP — the baseline is keyed on them.
    const blChild1 = { vars: b1, _initted: true, _ptLookup: [lookup1] };
    const blChild2 = { vars: b2, _initted: true, _ptLookup: [lookup2] };
    blTween.timeline = { getChildren: () => [blChild1, blChild2] };

    // translate(10px) creates only x — demanding y would lock a healthy tween.
    const o1 = { transform: 'translate(10px)', duration: 1, parent: {} };
    const o2 = { transform: 'translate(20px)', duration: 1, parent: {} };
    const oneVars = { opacity: 0.5, keyframes: [o1, o2], duration: 2 };
    const oneTween = buildArrayKeyframesTween(document.getElementById('kfb2'), oneVars);
    oneTween.timeline = { getChildren: () => [
      { vars: o1, _initted: true, _ptLookup: [{ x: {} }] },
      { vars: o2, _initted: true, _ptLookup: [{ x: {} }] },
    ] };

    window.gsap.globalTimeline = { getChildren: () => [blTween, oneTween] };
    window.eval(getRuntimeBridgeSource());

    const first = grabMotion(document.getElementById('kfb1'), messages);
    expect(first.motion.tracks.find((track) => track.property === 'opacity').ownership.retargetable).toBe(true);

    delete lookup1.x; // page kills x AFTER the baseline was frozen
    delete lookup2.x;
    const second = grabMotion(document.getElementById('kfb1'), messages);
    const lockedOpacity = second.motion.tracks.find((track) => track.property === 'opacity');
    expect(lockedOpacity.ownership.retargetable).toBe(false);
    expect(lockedOpacity.keyframeEditable).toBe(false);

    const one = grabMotion(document.getElementById('kfb2'), messages);
    expect(one.motion.tracks.find((track) => track.property === 'opacity').ownership.retargetable).toBe(true);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('grows the baseline MONOTONICALLY — writers observed later are watched too (Sol r35)', () => {
    document.body.innerHTML = '<main><div id="kfmg"></div></main>';
    const target = document.getElementById('kfmg');
    // Baseline {x} -> page adds a y writer (observed on re-inspection) -> page
    // kills y. A frozen-only baseline never watched y, reads healthy, and the
    // next edit resurrects it.
    const e1 = { transform: 'translateX(10px)', duration: 1, parent: {} };
    const e2 = { transform: 'translateX(20px)', duration: 1, parent: {} };
    const vars = { opacity: 0.5, keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const lookup1 = { x: {} };
    const lookup2 = { x: {} };
    const child1 = { vars: e1, _initted: true, _ptLookup: [lookup1] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [lookup2] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // baseline frozen: {x}
    lookup1.y = {}; // page grows a y writer
    lookup2.y = {};
    const grown = grabMotion(target, messages); // healthy — y joins the baseline
    expect(grown.motion.tracks.find((track) => track.property === 'opacity').ownership.retargetable).toBe(true);

    delete lookup1.y; // page kills the LATER writer
    delete lookup2.y;
    const killed = grabMotion(target, messages);
    const lockedOpacity = killed.motion.tracks.find((track) => track.property === 'opacity');
    expect(lockedOpacity.ownership.retargetable).toBe(false);
    expect(lockedOpacity.keyframeEditable).toBe(false);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('re-validates DECLARATIONS on every inspection — a new unmaterialized prop is a hazard (Sol r36)', () => {
    document.body.innerHTML = '<main><div id="kfnd"></div></main>';
    const target = document.getElementById('kfnd');
    // Baseline {x} healthy; the page then DECLARES entry.y without a live
    // writer (never materialized, or materialized-and-killed between
    // inspections). x is still present, so a vanish-only check reads healthy —
    // but our invalidate would MATERIALIZE y and stomp that channel's owner.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const first = grabMotion(target, messages);
    expect(first.motion.tracks.find((track) => track.property === 'x').ownership.retargetable).toBe(true);

    e1.y = 5; // page declares y in place — no live writer yet
    e2.y = 10;
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('promotes hidden live carriers to an ANIMATION hazard — editing y with an orphaned x refuses (Sol r37)', () => {
    document.body.innerHTML = '<main><div id="kfoc"></div></main>';
    const target = document.getElementById('kfoc');
    // Entries {x,y} healthy; the page deletes entry.x in place — x's
    // PropTweens stay alive (orphans). A per-property check only locks the x
    // track: editing y still invalidates and KILLS the orphan mid-flight
    // (x drops to 0) — cross-channel corruption. Any lookup key no longer
    // explained by the declarations must lock every channel.
    const e1 = { x: 50, y: 5, duration: 1, parent: {} };
    const e2 = { x: 100, y: 10, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {}, y: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {}, y: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const first = grabMotion(target, messages);
    expect(first.motion.tracks.find((track) => track.property === 'y').ownership.retargetable).toBe(true);

    delete e1.x; // page orphans the x writers
    delete e2.x;
    const { selection, motion } = grabMotion(target, messages);
    const yTrack = motion.tracks.find((track) => track.property === 'y');
    expect(yTrack.ownership.retargetable).toBe(false);
    expect(yTrack.keyframeEditable).toBe(false);

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
            before: { schemaVersion: 2, semanticProperty: 'y', runtimeProperty: 'y', value: '10' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'y',
              runtimeProperty: 'y',
              value: '50',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:y`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(e2.y).toBe(10);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('attributes plugin keys individually — mixed entries keep orphan detection (Sol r38)', () => {
    document.body.innerHTML = '<main><div id="kfmx2"></div></main>';
    const target = document.getElementById('kfmx2');
    // Mixed entry {x, y, attr:{...}}: exempting the WHOLE entry because of the
    // plugin hides an orphaned x. Only the keys attributed to the plugin at
    // freeze time (lookup keys unexplained by non-plugin declarations) are
    // exempt; x orphaned later must still lock everything.
    const e1 = { x: 50, y: 5, attr: { 'data-n': 1 }, duration: 1, parent: {} };
    const e2 = { x: 100, y: 10, attr: { 'data-n': 2 }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {}, y: {}, 'data-n': { d: { name: 'attr' } } }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {}, y: {}, 'data-n': { d: { name: 'attr' } } }] };
    tween.timeline = { getChildren: () => [child1, child2] };
    window.gsap.core = { globals: () => ({ AttrPlugin: { prop: 'attr' } }) };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const first = grabMotion(target, messages);
    expect(first.motion.tracks.find((track) => track.property === 'y').ownership.retargetable).toBe(true);

    delete e1.x; // page orphans x inside the MIXED entry
    delete e2.x;
    const { selection, motion } = grabMotion(target, messages);
    const yTrack = motion.tracks.find((track) => track.property === 'y');
    expect(yTrack.ownership.retargetable).toBe(false);
    expect(yTrack.keyframeEditable).toBe(false);

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
            before: { schemaVersion: 2, semanticProperty: 'y', runtimeProperty: 'y', value: '10' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'y',
              runtimeProperty: 'y',
              value: '50',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:y`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(e2.y).toBe(10);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('detects an orphaned writer even BEFORE the first inspection — attribution is positive (Sol r39)', () => {
    document.body.innerHTML = '<main><div id="kfpo"></div></main>';
    const target = document.getElementById('kfpo');
    // x was orphaned before we ever inspected: negative attribution would file
    // it under the plugin. The PropTween carries its driver's name (probe
    // _probe-r39.mjs: d.name 'css' / 'attr') — an unexplained css-driven key
    // is an orphan at FIRST sight.
    const e1 = { y: 5, attr: { 'data-n': 1 }, duration: 1, parent: {} };
    const e2 = { y: 10, attr: { 'data-n': 2 }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const lookup = () => ({ x: { d: { name: 'css' } }, y: { d: { name: 'css' } }, 'data-n': { d: { name: 'attr' } } });
    const child1 = { vars: e1, _initted: true, _ptLookup: [lookup()] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [lookup()] };
    tween.timeline = { getChildren: () => [child1, child2] };
    window.gsap.core = { globals: () => ({ AttrPlugin: { prop: 'attr' } }) };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const yTrack = motion.tracks.find((track) => track.property === 'y');
    expect(yTrack.ownership.retargetable).toBe(false);
    expect(yTrack.keyframeEditable).toBe(false);

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
            before: { schemaVersion: 2, semanticProperty: 'y', runtimeProperty: 'y', value: '10' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'y',
              runtimeProperty: 'y',
              value: '50',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:y`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(e2.y).toBe(10);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks entries carrying runBackwards — their values are STARTS, not ends (Sol r40)', () => {
    document.body.innerHTML = '<main><div id="kfrb2"></div></main>';
    const target = document.getElementById('kfrb2');
    // GSAP applies entry-level runBackwards to the child: the entry's value is
    // the FROM, not the end — editing it as an end corrupts the path while
    // reporting success. Any such entry locks the whole animation.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, runBackwards: true, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps stagger+keyframes tweens inventoried — facade copies carry no animated props (Claude final)', () => {
    document.body.innerHTML = '<main><div id="kfsg1"></div><div id="kfsg2"></div></main>';
    const t1 = document.getElementById('kfsg1');
    const t2 = document.getElementById('kfsg2');
    // gsap.to('.s', {keyframes:[...], stagger}) builds per-target FACADE
    // copies whose vars carry the `keyframes` key itself and NO animated props
    // (probe on real GSAP 3.15): reading ownership from those children yields
    // zero tracks — the furo-#1 unowned lie — and the retarget guard lets the
    // plain vars writer through. The authored ARRAY is the ownership truth.
    const entries = [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }];
    const vars = { keyframes: entries, stagger: 0.3, duration: 2 };
    const tween = buildArrayKeyframesTween(t1, vars, { targets: [t1, t2] });
    const copy1 = { keyframes: entries, stagger: 0.3, duration: 2, delay: 0, overwrite: 'auto', parent: {} };
    const copy2 = { keyframes: entries, stagger: 0.3, duration: 2, delay: 0.3, overwrite: 'auto', parent: {} };
    tween.timeline = { getChildren: () => [{ vars: copy1 }, { vars: copy2 }] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(t1, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy(); // inventoried — never invisible
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    // The retarget must refuse via the keyframes guard — never write vars.x.
    sendRetarget(selection, motion, '300');
    expect(vars.x).toBeUndefined();
    expect(entries[1].x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('restores a FUNCTION-valued startAt verbatim on rollback — never its stringification (Sol r41)', () => {
    document.body.innerHTML = '<main><div id="kfsf"></div></main>';
    const target = document.getElementById('kfsf');
    // Authored startAt:{x:()=>40}: the reader must never serialize the
    // function (String(fn) written back on rollback replaces it with garbage
    // and the start renders wrong DURING validation). The binding freezes the
    // authored existence+value; landing back restores the function IDENTITY.
    const startFn = () => 40;
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], startAt: { x: startFn }, duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-startfn',
            patches: [{
              id: 'p-startfn',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframe.x',
              before: { offset: 0, value: '40', exists: true },
              value: { offset: 0, value: '80', exists: true },
            }],
          },
        },
      },
    }));
    const validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(true);
    // Identity restored — never a stringified function, never a leftover '80'.
    expect(vars.startAt.x).toBe(startFn);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('rebases the startAt binding when the page replaces the authored value (Sol r42)', () => {
    document.body.innerHTML = '<main><div id="kfsb"></div></main>';
    const target = document.getElementById('kfsb');
    // After a validated edit over fnA, the page swaps in fnB. A frozen binding
    // would roll the NEXT transaction back to fnA (or a sampled string),
    // destroying fnB with a false success. The binding tracks what the bridge
    // last wrote and REBASES from the live state when it diverged.
    const fnA = () => 40;
    const fnB = () => 60;
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], startAt: { x: fnA }, duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const validateStart = (id, value) => window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id,
            patches: [{
              id: `p-${id}`,
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframe.x',
              before: { offset: 0, value: '0', exists: true },
              value: { offset: 0, value, exists: true },
            }],
          },
        },
      },
    }));

    validateStart('tx-sa1', '80');
    expect(vars.startAt.x).toBe(fnA); // first transaction restores fnA

    vars.startAt.x = fnB; // external page replacement

    validateStart('tx-sa2', '90');
    const validation = messages.filter((message) => message.type === 'validation-result').pop();
    expect(validation.payload.valid).toBe(true);
    expect(vars.startAt.x).toBe(fnB); // rebased — fnB survives, never a string

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks ALIASED entries — the same object at two positions cannot be edited safely (Sol r43)', () => {
    document.body.innerHTML = '<main><div id="kfae"></div></main>';
    const target = document.getElementById('kfae');
    // keyframes:[shared, {x:100}, shared]: writing the trailing bucket also
    // mutates the FIRST occurrence through shared identity ([300,100,300] —
    // the non-trailing duplicate guarantee breaks). Repeated bucket identity
    // locks the plan.
    const shared = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [shared, { x: 100, duration: 1, parent: {} }, shared], duration: 3 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(shared.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('inspects EVERY occurrence of an aliased entry — a kill in the first child is a hazard (Sol r44)', () => {
    document.body.innerHTML = '<main><div id="kfao"></div></main>';
    const target = document.getElementById('kfao');
    // [shared, middle, shared]: an entry->child map keeps only the LAST child,
    // so a kill in the FIRST occurrence goes unseen and a top-level z edit
    // invalidates and resurrects it. The hazard must walk {entry, child}
    // PAIRS.
    const shared = { x: 100, y: 5, duration: 1, parent: {} };
    const middle = { x: 150, y: 8, duration: 1, parent: {} };
    const vars = { z: 1, keyframes: [shared, middle, shared], duration: 3 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: shared, _initted: true, _ptLookup: [{ y: {} }] }; // x killed HERE
    const child2 = { vars: middle, _initted: true, _ptLookup: [{ x: {}, y: {} }] };
    const child3 = { vars: shared, _initted: true, _ptLookup: [{ x: {}, y: {} }] };
    tween.timeline = { getChildren: () => [child1, child2, child3] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const zTrack = motion.tracks.find((track) => track.property === 'z');
    expect(zTrack.ownership.retargetable).toBe(false);
    expect(zTrack.keyframeEditable).toBe(false);

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
            before: { schemaVersion: 2, semanticProperty: 'z', runtimeProperty: 'z', value: '1' },
            value: {
              schemaVersion: 2,
              semanticProperty: 'z',
              runtimeProperty: 'z',
              value: '9',
              writeModel: 'absolute',
              responsiveScope: 'shared',
              owner: { channelId: `${motion.id}:z`, motionId: motion.id },
              keyframe: { position: 'final-existing' },
            },
          },
        },
      },
    }));
    expect(vars.z).toBe(1);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks buckets shared BETWEEN tweens — editing A must never rewrite B (Sol r45)', () => {
    document.body.innerHTML = '<main><div id="kfx1"></div><div id="kfx2"></div></main>';
    const tA = document.getElementById('kfx1');
    const tB = document.getElementById('kfx2');
    // Two tweens reuse the SAME keyframes array (GSAP preserves identity):
    // writing A's trailing bucket rewrites B's source, and B re-renders the
    // edit on its next invalidate. Cross-tween sharing locks the plan.
    const sharedEntries = [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }];
    const varsA = { keyframes: sharedEntries, duration: 2 };
    const varsB = { keyframes: sharedEntries, duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, varsA);
    const tweenB = buildArrayKeyframesTween(tB, varsB);
    window.gsap.globalTimeline = { getChildren: () => [tweenA, tweenB] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const a = grabMotion(tA, messages);
    const xTrack = a.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(a.selection, a.motion, '300');
    expect(sharedEntries[1].x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('still sees cross-tween sharing after B deletes its source — live children carry the identity (Sol r46)', () => {
    document.body.innerHTML = '<main><div id="kfy1"></div><div id="kfy2"></div></main>';
    const tA = document.getElementById('kfy1');
    const tB = document.getElementById('kfy2');
    // A and B share entries; B then deletes vars.keyframes. B's CHILDREN stay
    // alive rendering the shared entries (nested global walk exposes them) —
    // A must stay locked or editing A rewrites what B still renders.
    const sharedEntries = [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }];
    const varsA = { keyframes: sharedEntries, duration: 2 };
    const varsB = { keyframes: sharedEntries, duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, varsA);
    const tweenB = buildArrayKeyframesTween(tB, varsB);
    const bChild1 = { vars: sharedEntries[0], _initted: true, _ptLookup: [{ x: {} }] };
    const bChild2 = { vars: sharedEntries[1], _initted: true, _ptLookup: [{ x: {} }] };
    // The GLOBAL walk does NOT recurse into a Tween's inner timeline — B's
    // children are reachable ONLY through tweenB.timeline (Sol r47).
    tweenB.timeline = { getChildren: () => [bChild1, bChild2] };
    delete varsB.keyframes; // B's source gone; children remain live
    window.gsap.globalTimeline = { getChildren: () => [tweenA, tweenB] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const a = grabMotion(tA, messages);
    const xTrack = a.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(a.selection, a.motion, '300');
    expect(sharedEntries[1].x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('sees sharing through FACADE children carrying the array in child.vars.keyframes (Sol r48)', () => {
    document.body.innerHTML = '<main><div id="kfz1"></div><div id="kfz2"></div><div id="kfz3"></div></main>';
    const tA = document.getElementById('kfz1');
    // B is stagger+keyframes over two targets: its facade children hold the
    // SHARED array in child.vars.keyframes. After B's source is deleted (no
    // cached provenance), only that nested reference betrays the sharing —
    // A must stay locked.
    const sharedEntries = [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }];
    const varsA = { keyframes: sharedEntries, duration: 2 };
    const varsB = { keyframes: sharedEntries, stagger: 0.3, duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, varsA);
    const tweenB = buildArrayKeyframesTween(document.getElementById('kfz2'), varsB, { targets: [document.getElementById('kfz2'), document.getElementById('kfz3')] });
    const facade1 = { vars: { keyframes: sharedEntries, stagger: 0.3, duration: 2, delay: 0, overwrite: 'auto', parent: {} } };
    const facade2 = { vars: { keyframes: sharedEntries, stagger: 0.3, duration: 2, delay: 0.3, overwrite: 'auto', parent: {} } };
    tweenB.timeline = { getChildren: () => [facade1, facade2] };
    delete varsB.keyframes; // source gone BEFORE any provenance was cached
    window.gsap.globalTimeline = { getChildren: () => [tweenA, tweenB] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const a = grabMotion(tA, messages);
    const xTrack = a.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(a.selection, a.motion, '300');
    expect(sharedEntries[1].x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('descends into facade GRANDCHILDREN — shared entries deep in B lock A (Sol r49)', () => {
    document.body.innerHTML = '<main><div id="kfw1"></div><div id="kfw2"></div><div id="kfw3"></div></main>';
    const tA = document.getElementById('kfw1');
    // A and B use DISTINCT arrays that share entry objects. B is a stagger
    // facade whose children have their OWN inner timelines: the segments live
    // in the GRANDCHILDREN. With both sources deleted/emptied and B never
    // inspected, only the recursive descent sees the sharing.
    const shared1 = { x: 100, duration: 1, parent: {} };
    const shared2 = { x: 200, duration: 1, parent: {} };
    const arrA = [shared1, shared2];
    const arrB = [shared1, shared2];
    const varsA = { keyframes: arrA, duration: 2 };
    const varsB = { keyframes: arrB, stagger: 0.3, duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, varsA);
    const tweenB = buildArrayKeyframesTween(document.getElementById('kfw2'), varsB, { targets: [document.getElementById('kfw2'), document.getElementById('kfw3')] });
    const grand1 = { vars: shared1, _initted: true, _ptLookup: [{ x: {} }] };
    const grand2 = { vars: shared2, _initted: true, _ptLookup: [{ x: {} }] };
    const facade = {
      vars: { stagger: 0.3, duration: 2, delay: 0, overwrite: 'auto', parent: {} },
      timeline: { getChildren: () => [grand1, grand2] },
    };
    tweenB.timeline = { getChildren: () => [facade] };
    delete varsB.keyframes; // sources gone before any provenance
    arrB.length = 0;
    window.gsap.globalTimeline = { getChildren: () => [tweenA, tweenB] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const a = grabMotion(tA, messages);
    const xTrack = a.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(a.selection, a.motion, '900');
    expect(shared2.x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('sees sharing when another tween ROOT vars IS one of our entries (Sol r50)', () => {
    document.body.innerHTML = '<main><div id="kfv1"></div><div id="kfv2"></div></main>';
    const tA = document.getElementById('kfv1');
    const tB = document.getElementById('kfv2');
    // The page reuses A's terminal ENTRY as the vars of a plain tween B:
    // editing A's end rewrites B.vars.x and B renders it on its next
    // invalidate. The root of the shared-tree walk must be compared too.
    const terminal = { x: 200, duration: 1, parent: {} };
    const varsA = { keyframes: [{ x: 100, duration: 1, parent: {} }, terminal], duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, varsA);
    const tweenB = buildArrayKeyframesTween(tB, { x: 50, duration: 1 });
    tweenB.vars = terminal; // B's vars IS the shared entry object
    window.gsap.globalTimeline = { getChildren: () => [tweenA, tweenB] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const a = grabMotion(tA, messages);
    const xTrack = a.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(a.selection, a.motion, '300');
    expect(terminal.x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('sees sharing through another tween startAt (Sol r51)', () => {
    document.body.innerHTML = '<main><div id="kfq1"></div><div id="kfq2"></div></main>';
    const tA = document.getElementById('kfq1');
    const tB = document.getElementById('kfq2');
    // B uses A's terminal entry as its startAt: editing A's end rewrites
    // B.vars.startAt.x and B's start moves on its next invalidate.
    const terminal = { x: 200, duration: 1, parent: {} };
    const varsA = { keyframes: [{ x: 100, duration: 1, parent: {} }, terminal], duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, varsA);
    const tweenB = buildArrayKeyframesTween(tB, { x: 50, startAt: terminal, duration: 1 });
    window.gsap.globalTimeline = { getChildren: () => [tweenA, tweenB] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const a = grabMotion(tA, messages);
    const xTrack = a.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(a.selection, a.motion, '300');
    expect(terminal.x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('sees sharing nested inside plugin wrappers of startAt (Sol r52)', () => {
    document.body.innerHTML = '<main><div id="kfp1"></div><div id="kfp2"></div></main>';
    const tA = document.getElementById('kfp1');
    const tB = document.getElementById('kfp2');
    // B reuses A's terminal entry NESTED inside a plugin wrapper:
    // startAt:{attr: entry}. A shallow startAt check misses it; editing A
    // would rewrite B.vars.startAt.attr.x.
    const terminal = { x: 200, duration: 1, parent: {} };
    const varsA = { keyframes: [{ x: 100, duration: 1, parent: {} }, terminal], duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, varsA);
    const tweenB = buildArrayKeyframesTween(tB, { x: 50, startAt: { attr: terminal }, duration: 1 });
    window.gsap.globalTimeline = { getChildren: () => [tweenA, tweenB] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const a = grabMotion(tA, messages);
    const xTrack = a.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(a.selection, a.motion, '300');
    expect(terminal.x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('fails CLOSED when the sharing walk hits a throwing getter (Sol r53)', () => {
    document.body.innerHTML = '<main><div id="kfg1"></div><div id="kfg2"></div></main>';
    const tA = document.getElementById('kfg1');
    const tB = document.getElementById('kfg2');
    // B shares A's terminal entry via startAt AND carries a throwing
    // enumerable getter: an exception during inspection must mean "assume
    // shared" — never abort-and-unlock.
    const terminal = { x: 200, duration: 1, parent: {} };
    const varsA = { keyframes: [{ x: 100, duration: 1, parent: {} }, terminal], duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, varsA);
    const varsB = { x: 50, duration: 1, startAt: { attr: terminal } };
    Object.defineProperty(varsB, 'boom', { enumerable: true, get() { throw new Error('trap'); } });
    const tweenB = buildArrayKeyframesTween(tB, { x: 1, duration: 1 });
    tweenB.vars = varsB;
    window.gsap.globalTimeline = { getChildren: () => [tweenA, tweenB] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const a = grabMotion(tA, messages);
    const xTrack = a.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(a.selection, a.motion, '300');
    expect(terminal.x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('fails CLOSED when a nested getChildren throws during the sharing walk (Sol r54)', () => {
    document.body.innerHTML = '<main><div id="kfn1"></div><div id="kfn2"></div></main>';
    const tA = document.getElementById('kfn1');
    const tB = document.getElementById('kfn2');
    // B's inner timeline cannot be inspected (getChildren throws): whatever
    // hides in there is unknowable — the plan must lock, never unlock on a
    // swallowed failure.
    const varsA = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, varsA);
    const tweenB = buildArrayKeyframesTween(tB, { x: 50, duration: 1 });
    tweenB.timeline = { getChildren: () => { throw new Error('trap'); } };
    window.gsap.globalTimeline = { getChildren: () => [tweenA, tweenB] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const a = grabMotion(tA, messages);
    const xTrack = a.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(a.selection, a.motion, '300');
    expect(varsA.keyframes[1].x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks when OUR OWN inner timeline is uninspectable — never fall back to the array (Sol r55)', () => {
    document.body.innerHTML = '<main><div id="kfu2"></div></main>';
    const target = document.getElementById('kfu2');
    // A.timeline exists but getChildren throws: the REAL segment structure is
    // unknowable — the array fallback (meant for an ABSENT API) must not
    // engage; both channels lock, detection keeps the track inventoried.
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = { getChildren: () => { throw new Error('trap'); } };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy(); // still inventoried
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(vars.keyframes[1].x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('treats a PRESENT timeline without getChildren as uninspectable — never the array fallback (Sol r56)', () => {
    document.body.innerHTML = '<main><div id="kfu3"></div></main>';
    const target = document.getElementById('kfu3');
    // Page reorders the array AND strips getChildren: the array order is a
    // lie and the truth is unreachable. `null` may only mean "no timeline
    // ever existed" (plain tween, falsy 0) — a present-but-API-less timeline
    // is uninspectable and locks.
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    vars.keyframes.reverse(); // external reorder
    tween.timeline = {}; // timeline present, getChildren gone

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([200, 100]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('fails CLOSED when the global timeline becomes uninspectable after selection (Sol r57)', () => {
    document.body.innerHTML = '<main><div id="kfgt"></div></main>';
    const target = document.getElementById('kfgt');
    // After inspection the page strips globalTimeline.getChildren: sharing can
    // no longer be ruled out — the write must refuse, never proceed.
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    window.gsap.globalTimeline = {}; // API gone post-selection

    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps observed sharing locked after the other tween detaches from the global timeline (Sol r58)', () => {
    document.body.innerHTML = '<main><div id="kfd1"></div><div id="kfd2"></div></main>';
    const tA = document.getElementById('kfd1');
    const tB = document.getElementById('kfd2');
    // Sharing observed once must be REMEMBERED: B completes/detaches from the
    // global timeline but stays restartable — a fresh snapshot no longer sees
    // it, yet editing A would still rewrite B's source.
    const sharedEntries = [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }];
    const varsA = { keyframes: sharedEntries, duration: 2 };
    const varsB = { keyframes: sharedEntries, duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, varsA);
    const tweenB = buildArrayKeyframesTween(tB, varsB);
    let attached = [tweenA, tweenB];
    window.gsap.globalTimeline = { getChildren: () => attached };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const first = grabMotion(tA, messages); // sharing observed here
    expect(first.motion.tracks.find((track) => track.property === 'x').ownership.retargetable).toBe(false);

    attached = [tweenA]; // B detaches (completed) but remains restartable
    const second = grabMotion(tA, messages);
    const xTrack = second.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(second.selection, second.motion, '300');
    expect(sharedEntries[1].x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('transient uncertainty locks WITHOUT contaminating the durable memory (Sol r59)', () => {
    document.body.innerHTML = '<main><div id="kft3"></div><div id="kft4"></div></main>';
    const tA = document.getElementById('kft3');
    const tB = document.getElementById('kft4');
    // B has NO shared identity — only a throwing getter. The lock must be
    // transient: once the page removes the getter (and B detaches), a
    // re-inspection unlocks A. Only PROVEN identity may be remembered forever.
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, vars);
    const varsB = { x: 50, duration: 1 };
    Object.defineProperty(varsB, 'boom', { enumerable: true, configurable: true, get() { throw new Error('trap'); } });
    const tweenB = buildArrayKeyframesTween(tB, { x: 1, duration: 1 });
    tweenB.vars = varsB;
    let attached = [tweenA, tweenB];
    window.gsap.globalTimeline = { getChildren: () => attached };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const first = grabMotion(tA, messages);
    expect(first.motion.tracks.find((track) => track.property === 'x').ownership.retargetable).toBe(false); // transient lock

    delete varsB.boom; // page removes the hostile getter
    attached = [tweenA]; // and B detaches
    const second = grabMotion(tA, messages);
    const xTrack = second.motion.tracks.find((track) => track.property === 'x');
    expect(xTrack.ownership.retargetable).toBe(true); // unlocked — no contamination
    expect(xTrack.keyframeEditable).toBe(true);

    sendRetarget(second.selection, second.motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('preserves the frozen binding through TRANSIENT sharing uncertainty — undo stays exact (Sol r60)', () => {
    document.body.innerHTML = '<main><div id="kfe1"></div><div id="kfe2"></div></main>';
    const tA = document.getElementById('kfe1');
    const tB = document.getElementById('kfe2');
    // Collision edit freezes the run; a hostile getter on an UNRELATED tween
    // makes sharing 'unknown'. That must lock writes transiently WITHOUT
    // pruning the binding — else the post-uncertainty undo recomputes the run
    // and flattens the collision ([200,200] instead of [100,200]).
    const vars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };
    const tweenA = buildArrayKeyframesTween(tA, vars);
    const varsB = { x: 50, duration: 1 };
    const tweenB = buildArrayKeyframesTween(tB, { x: 1, duration: 1 });
    tweenB.vars = varsB;
    window.gsap.globalTimeline = { getChildren: () => [tweenA, tweenB] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const first = grabMotion(tA, messages);
    sendRetarget(first.selection, first.motion, '100'); // collision edit — binding frozen
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 100]);

    Object.defineProperty(varsB, 'boom', { enumerable: true, configurable: true, get() { throw new Error('trap'); } });
    grabMotion(tA, messages); // re-inspection during uncertainty must NOT prune
    delete varsB.boom; // uncertainty clears

    const second = grabMotion(tA, messages);
    sendRetarget(second.selection, second.motion, '200'); // undo replay
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]); // exact — never [200,200]

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('locks entries carrying a property in BOTH namespaces (entry.x AND entry.css.x) (Sol r61)', () => {
    document.body.innerHTML = '<main><div id="kfns"></div></main>';
    const target = document.getElementById('kfns');
    // With css:{} present, the CSSPlugin drives the wrapper while remaining
    // top-level props ride the generic writer: entry.x and entry.css.x can be
    // TWO distinct writers of homonymous channels. Picking one silently
    // leaves the other alive and uninventoried.
    const e1 = { x: 10, css: { x: 30 }, duration: 1, parent: {} };
    const e2 = { x: 20, css: { x: 60 }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(20);
    expect(e2.css.x).toBe(60);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps the dual-namespace lock after one namespace is deleted post-init (Sol r62)', () => {
    document.body.innerHTML = '<main><div id="kfns2"></div></main>';
    const target = document.getElementById('kfns2');
    // {x, css:{x}} observed BOTH -> the page deletes entry.css.x: the CSS
    // PropTween keeps rendering while the entry now looks single-namespace.
    // The frozen signature must keep the lock for the tween's life.
    const e1 = { x: 10, css: { x: 30 }, duration: 1, parent: {} };
    const e2 = { x: 20, css: { x: 60 }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // signature frozen: both
    delete e1.css.x; // page strips ONE namespace post-init
    delete e2.css.x;
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(20);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('freezes namespace signatures on EVERY inspection — even while other guards lock (Sol r63)', () => {
    document.body.innerHTML = '<main><div id="kfns3"></div></main>';
    const target = document.getElementById('kfns3');
    // {x:50, keyframes:[{x}...]} is initially locked by both-places — but the
    // signature 'top' must be frozen anyway. The page then deletes vars.x and
    // MOVES entry.x into entry.css.x without a rebuild: the old top-level
    // PropTweens stay alive, and treating 'css' as the original signature
    // would unlock a corrupting write.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { x: 50, keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // locked by both-places; signatures frozen 'top'
    delete vars.x;
    e1.css = { x: e1.x }; delete e1.x; // page moves top -> css, no rebuild
    e2.css = { x: e2.x }; delete e2.x;
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e2.css.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('freezes signatures from the SOURCE when the timeline is transiently uninspectable (Sol r64)', () => {
    document.body.innerHTML = '<main><div id="kfns4"></div></main>';
    const target = document.getElementById('kfns4');
    // First inspection happens while getChildren throws: the signature scan
    // must still freeze 'both' from the processed SOURCE entries (same
    // objects) — else a later css.x removal + API restore baselines 'top' and
    // unlocks a corrupting write.
    const e1 = { x: 10, css: { x: 30 }, duration: 1, parent: {} };
    const e2 = { x: 20, css: { x: 60 }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    tween.timeline = { getChildren: () => { throw new Error('trap'); } };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // uninspectable — but signatures freeze 'both'
    delete e1.css.x; // page strips one namespace
    delete e2.css.x;
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] }; // API restored
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(20);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('marks signature-unknown when a live child escaped the blind scan window (Sol r65)', () => {
    document.body.innerHTML = '<main><div id="kfns5"></div></main>';
    const target = document.getElementById('kfns5');
    // e2 is spliced out of the source, then the FIRST inspection runs blind
    // (getChildren down) — e2's 'both' signature is never observed. The page
    // strips e2.css.x (both->top) and restores the API: e2's live child was
    // never scanned, so its current signature must NOT become a baseline.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, css: { x: 60 }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    vars.keyframes.splice(1, 1); // e2 leaves the source; its child stays live
    tween.timeline = { getChildren: () => { throw new Error('trap'); } };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // blind scan — covers e1 only
    delete e2.css.x; // both -> top while unobserved
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] }; // API restored
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('recognizes the source fallback as a BLIND scan when the timeline is falsy (Sol r66)', () => {
    document.body.innerHTML = '<main><div id="kfns6"></div></main>';
    const target = document.getElementById('kfns6');
    // Same escape as r65, but the timeline is FALSY (stashed as 0) instead of
    // throwing: the source-based scan is still blind — a live child surfacing
    // later without identity coverage must mark signature-unknown.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, css: { x: 60 }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    vars.keyframes.splice(1, 1); // e2 leaves the source; its child stays live
    tween.timeline = 0; // page stashes the timeline (falsy — like a plain tween)

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // blind scan via source — covers e1 only
    delete e2.css.x; // both -> top while unobserved
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] }; // restored
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps a live child in the set after its parent METADATA is deleted (Sol r67)', () => {
    document.body.innerHTML = '<main><div id="kfpm"></div></main>';
    const target = document.getElementById('kfpm');
    // `parent` is mutable metadata: deleting it from the terminal entry must
    // not shrink the live set — the child keeps rendering, and the retarget
    // must reach the REAL terminal.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] };
    delete e2.parent; // page strips the injected metadata

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300); // the REAL terminal — never the previous entry
    expect(e1.x).toBe(100);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('freezes signatures for parent-less LIVE children too (Sol r68)', () => {
    document.body.innerHTML = '<main><div id="kfns7"></div></main>';
    const target = document.getElementById('kfns7');
    // r63+r67 combo: the terminal entry lost its `parent` metadata AND the
    // tween is initially locked by both-places vars.x. The signature scan
    // must still freeze the terminal's 'top' — else a later vars.x removal +
    // top->css move baselines 'css' and unlocks a corrupting write.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1 }; // parent metadata stripped
    const vars = { x: 50, keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // locked; signatures must freeze anyway
    delete vars.x;
    e2.css = { x: e2.x }; delete e2.x; // top -> css without rebuild
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e2.css.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('preserves the frozen binding through a transient TIMELINE outage — undo stays exact (Sol r69)', () => {
    document.body.innerHTML = '<main><div id="kfe3"></div></main>';
    const target = document.getElementById('kfe3');
    // Collision edit freezes the run; getChildren then throws during a
    // re-inspection. That uncertainty must not prune the binding — the
    // post-recovery undo must restore [100,200], never re-plan to [200,200].
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const first = grabMotion(target, messages);
    sendRetarget(first.selection, first.motion, '100'); // collision — binding frozen
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 100]);

    tween.timeline = { getChildren: () => { throw new Error('trap'); } };
    grabMotion(target, messages); // re-inspection during outage must NOT prune
    tween.timeline = 0; // API recovered (no inner timeline exposed again)

    const second = grabMotion(target, messages);
    sendRetarget(second.selection, second.motion, '200'); // undo replay
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]); // exact

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('demands a FULL plan immediately before a non-restore write (Sol r70)', () => {
    document.body.innerHTML = '<main><div id="kfe4"></div></main>';
    const target = document.getElementById('kfe4');
    // Divergence + outage arriving between router and writer: the normal
    // write must refuse (a uniform write would turn the page's hold into a
    // ramp), while the binding survives for a later restore.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    e1.x = 300; // page creates a live hold [300,300]
    tween.timeline = { getChildren: () => { throw new Error('trap'); } }; // outage

    tween.invalidate.mockClear();
    sendRetarget(selection, motion, '400'); // must refuse — never [300,400]
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([300, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('denies writes when the timeline HIDES after children were observed (Sol r71)', () => {
    document.body.innerHTML = '<main><div id="kfhd"></div></main>';
    const target = document.getElementById('kfhd');
    // Children [e1,e2] observed; the page then reverses the source AND stashes
    // the timeline (falsy). The array is a lie — the write-grade path must
    // refuse until the children reappear.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // children observed
    vars.keyframes.reverse(); // page reorders the source
    tween.timeline = 0; // and hides the timeline
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy();
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(e1.x).toBe(100);
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('remembers properties observed in LIVE children while the timeline hides (Sol r72)', () => {
    document.body.innerHTML = '<main><div id="kfob"></div></main>';
    const target = document.getElementById('kfob');
    // {y} observed first; the page then materializes x on the entry (seen
    // live), later removes the carrier and hides the timeline. x was OBSERVED
    // — it must stay inventoried and locked, never fall to the plain writer.
    const ey = { y: 5, duration: 1, parent: {} };
    const vars = { keyframes: [ey], duration: 1 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child = { vars: ey, _initted: true, _ptLookup: [{ y: {} }] };
    tween.timeline = { getChildren: () => [child] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // observes {y}
    ey.x = 100; // page materializes x
    child._ptLookup = [{ y: {}, x: {} }];
    grabMotion(target, messages); // observes {x, y}
    delete ey.x; // carrier removed
    child._ptLookup = [{ y: {}, x: {} }]; // x writer still alive
    tween.timeline = 0; // and the timeline hides
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy(); // inventoried — never invisible
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(vars.x).toBeUndefined();
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps feeding observed props AFTER signature-unknown (Sol r73)', () => {
    document.body.innerHTML = '<main><div id="kfob2"></div></main>';
    const target = document.getElementById('kfob2');
    // r65 marks the animation signature-unknown; x is then materialized and
    // OBSERVED live; later its carrier leaves and the timeline hides. x must
    // stay inventoried (locked) — the unknown early-return must not starve
    // the monotonic observed set.
    const e1 = { y: 5, duration: 1, parent: {} };
    const e2 = { y: 8, css: { y: 3 }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    vars.keyframes.splice(1, 1); // e2 leaves the source
    tween.timeline = { getChildren: () => { throw new Error('trap'); } };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    grabMotion(target, messages); // blind — covers e1 only
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ y: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ y: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] };
    grabMotion(target, messages); // e2 escaped the blind window -> signature-unknown

    e1.x = 100; // page materializes x — OBSERVED live below
    child1._ptLookup = [{ y: {}, x: {} }];
    grabMotion(target, messages);

    delete e1.x; // carrier removed
    tween.timeline = 0; // timeline hides
    const { selection, motion } = grabMotion(target, messages);
    const xTrack = motion.tracks.find((track) => track.property === 'x');
    expect(xTrack).toBeTruthy(); // inventoried — never the furo-#1 lie
    expect(xTrack.ownership.retargetable).toBe(false);
    expect(xTrack.keyframeEditable).toBe(false);

    sendRetarget(selection, motion, '300');
    expect(vars.x).toBeUndefined();
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('routes frozen-binding RESTORES past the gates during an outage (Sol r74)', () => {
    document.body.innerHTML = '<main><div id="kfro"></div></main>';
    const target = document.getElementById('kfro');
    // Collision edit freezes the binding; the timeline then throws. A rollback
    // to the ORIGINAL end must still reach the writer restore path (frozen
    // buckets, authored payload) — both on retarget.final and keyframe.x.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '100'); // collision — binding frozen
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 100]);

    tween.timeline = { getChildren: () => { throw new Error('trap'); } }; // outage

    sendRetarget(selection, motion, '200'); // rollback to the original end
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]); // exact restore

    tween.timeline = 0; // outage lifts
    sendRetarget(selection, motion, '100'); // collision again
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 100]);
    tween.timeline = { getChildren: () => { throw new Error('trap'); } }; // outage again
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
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('random() under an authored key NAMED parent still locks the animation (Sol r100)', () => {
    document.body.innerHTML = '<main><div id="kfsv"></div></main>';
    const target = document.getElementById('kfsv');
    // attr:{parent:'random(...)'} is an AUTHORED attribute value — GSAP
    // processes every key of the attr namespace, including one named
    // "parent". Backedge suppression applies only to OBJECT values (real
    // backedges into the GSAP graph); strings are authored and must be
    // scanned.
    const e1 = { x: 100, attr: { parent: 'random(0,100)' }, duration: 1, parent: {} };
    const e2 = { x: 200, attr: { parent: 'random(0,100)' }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget x — refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a css-wrapper parent alias to another css bucket locks writes and restores (Sol r125)', () => {
    document.body.innerHTML = '<main><div id="kfud"></div></main>';
    const target = document.getElementById('kfud');
    // e1.css.parent === e2.css (the terminal css bucket): the alias is found
    // inside the canonical css branch — the flag must be consumed there, not
    // only after another stack object drains.
    const w2 = { x: 200 };
    const e1 = { css: { x: 100, parent: w2 }, duration: 1, parent: {} };
    const e2 = { css: w2, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // write — refuse
    expect(w2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('own-vars alias via attr.parent locks writes and outage restores (Sol r124)', () => {
    document.body.innerHTML = '<main><div id="kfub"></div></main>';
    const target = document.getElementById('kfub');
    // vars.attr.parent = terminalEntry: nested `parent` is authored/animated
    // (attr namespace), not a structural backedge — the identity check must
    // cover it (no-descent policy kept).
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    vars.attr = { parent: e2 }; // page aliases through a namespace parent key
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '400'); // non-restore — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    tween.timeline = {}; // outage: frozen restore must refuse too
    sendRetarget(selection, motion, '200');
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an entry-level attr.parent alias locks writes too (Sol r124)', () => {
    document.body.innerHTML = '<main><div id="kfuc"></div></main>';
    const target = document.getElementById('kfuc');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    e1.attr = { parent: e2 }; // alias through the entry's namespace
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('own-vars alias via _phase locks writes and outage restores (Sol r123)', () => {
    document.body.innerHTML = '<main><div id="kftz"></div></main>';
    const target = document.getElementById('kftz');
    // vars._phase = terminalEntry (and entry0._phase = terminalEntry): the
    // _-key is animatable (r111/r113) — writing the bucket also writes the
    // animated _phase payload. The own-vars walker must identity-check these
    // edges instead of skipping them.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    vars._phase = e2; // page aliases the terminal entry under a _-key
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '400'); // non-restore — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    tween.timeline = {}; // outage: frozen restore must refuse too
    sendRetarget(selection, motion, '200');
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an entry-level _phase alias locks writes too (Sol r123)', () => {
    document.body.innerHTML = '<main><div id="kfua"></div></main>';
    const target = document.getElementById('kfua');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    e1._phase = e2; // alias under a _-key at the entry root
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('sharing identity uses the FROZEN origin, not the mutable keyframes pointer (Sol r122)', () => {
    document.body.innerHTML = '<main><div id="kftx"></div></main>';
    const target = document.getElementById('kftx');
    // After the page replaces vars.keyframes, the authority is the FROZEN
    // origin.source. B aliasing the frozen array must refuse the restore;
    // B aliasing only the inert replacement must NOT block it.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const originalArray = [e1, e2];
    const vars = { keyframes: originalArray, duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // origin frozen here
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    const replacement = [{ x: 999, duration: 1 }];
    vars.keyframes = replacement; // page swaps the source pointer

    const riderFrozen = { vars: { _phase: originalArray, duration: 1 } };
    window.gsap.globalTimeline.getChildren = () => [tween, riderFrozen];
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // frozen-origin alias — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an alias to only the inert REPLACEMENT array does not block the restore (Sol r122)', () => {
    document.body.innerHTML = '<main><div id="kfty"></div></main>';
    const target = document.getElementById('kfty');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    const replacement = [{ x: 999, duration: 1 }];
    vars.keyframes = replacement; // inert swap
    const riderImpostor = { vars: { data: replacement, duration: 1 } };
    window.gsap.globalTimeline.getChildren = () => [tween, riderImpostor];

    sendRetarget(selection, motion, '200'); // impostor alias — restore APPLIES
    expect(e2.x).toBe(200);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('cross-tween sharing via _phase or attr.parent refuses the restore (Sol r121)', () => {
    document.body.innerHTML = '<main><div id="kftw"></div></main>';
    const target = document.getElementById('kftw');
    // B holds A's terminal bucket under _phase (animatable at root — r111)
    // and under attr.parent (animated in a namespace — r100). The sharing
    // walker must be contextual: only the injected root `parent` is skipped.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    const riderPhase = { vars: { _phase: e2, duration: 1 } };
    window.gsap.globalTimeline.getChildren = () => [tween, riderPhase];
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // restore — refuse (_phase sharing)
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    const riderAttr = { vars: { attr: { parent: e2 }, duration: 1 } };
    window.gsap.globalTimeline.getChildren = () => [tween, riderAttr];

    sendRetarget(selection, motion, '200'); // restore — refuse (attr.parent sharing)
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a cross-tween INHERITED startAt sharing a bucket refuses the restore (Sol r120)', () => {
    document.body.innerHTML = '<main><div id="kftv"></div></main>';
    const target = document.getElementById('kftv');
    // Tween B inherits an enumerable startAt pointing at A's terminal entry:
    // GSAP's for..in processes it, so restoring A's bucket silently rewrites
    // B's config. The sharing walker must enumerate the chain.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    const rider = { vars: Object.assign(Object.create({ startAt: e2 }), { duration: 1 }) };
    window.gsap.globalTimeline.getChildren = () => [tween, rider];
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // restore — refuse (inherited sharing)
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an INHERITED flat property is still inventoried as a track (Sol r119)', () => {
    document.body.innerHTML = '<main><div id="kftt"></div></main>';
    const target = document.getElementById('kftt');
    // GSAP creates a PropTween for the inherited x (for..in) — omitting it
    // from the inventory resurrects the furo-#1 invisible-writer lie.
    const vars = Object.assign(Object.create({ x: 200 }), { duration: 2 });
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { motion } = grabMotion(target, messages);
    const track = motion?.tracks?.find((candidate) => candidate.property === 'x') || null;
    expect(track).not.toBeNull(); // inherited x IS a live channel

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an INHERITED entry property is still inventoried as keyframe-driven (Sol r119)', () => {
    document.body.innerHTML = '<main><div id="kftu"></div></main>';
    const target = document.getElementById('kftu');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = Object.assign(Object.create({ y: 50 }), { x: 200, duration: 1, parent: {} });
    const vars = { keyframes: [e1, e2], duration: 2 };
    buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { motion } = grabMotion(target, messages);
    const track = motion?.tracks?.find((candidate) => candidate.property === 'y') || null;
    expect(track).not.toBeNull(); // inherited y IS a live keyframe channel

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an INHERITED startAt aliasing the terminal entry locks both channels (Sol r118)', () => {
    document.body.innerHTML = '<main><div id="kfts"></div></main>';
    const target = document.getElementById('kfts');
    // vars inherits an enumerable startAt pointing at the terminal entry:
    // GSAP processes it (for..in), so writing e2.x also rewrites the START.
    // The alias walker must enumerate the whole chain.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = Object.assign(Object.create({ startAt: e2 }), { keyframes: [e1, e2], duration: 2 });
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget x — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '200', exists: true },
            value: { offset: 1, value: '300', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(200); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an INHERITED enumerable top-level prop counts as both-places (Sol r117)', () => {
    document.body.innerHTML = '<main><div id="kftq"></div></main>';
    const target = document.getElementById('kftq');
    // GSAP processes vars with for..in — an inherited enumerable x IS a
    // top-level carrier (probe-H both-places on invalidate). hasOwnProperty
    // misses it; the guards must mirror GSAP's enumeration.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = Object.assign(Object.create({ x: 50 }), { keyframes: [e1, e2], duration: 2 });
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget x — refuse (inherited both-places)
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '200', exists: true },
            value: { offset: 1, value: '300', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(200); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an INHERITED sibling function locks other properties (Sol r117)', () => {
    document.body.innerHTML = '<main><div id="kftr"></div></main>';
    const target = document.getElementById('kftr');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = Object.assign(Object.create({ y: () => 50 }), { keyframes: [e1, e2], duration: 2 });
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // edit x — refuse (inherited y fn)
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('the keyframe channel blocks even the OWN function property (Sol r116)', () => {
    document.body.innerHTML = '<main><div id="kftp"></div></main>';
    const target = document.getElementById('kftp');
    // The self-exemption belongs to retarget.final (function-offset model).
    // keyframe.y writes vars.y = value — destroying the authored function;
    // the transactional reader only captured String(fn), so a rollback would
    // write source code as a string. Both offsets must refuse.
    const authoredFn = () => 50;
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { y: authoredFn, keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    const sendKeyframeY = (offset, value) => window.dispatchEvent(new MessageEvent('message', {
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
            property: 'keyframe.y',
            before: { offset, value: '50', exists: true },
            value: { offset, value: '30', exists: true },
          },
        },
      },
    }));

    sendKeyframeY(1, '30'); // step END on the fn prop — refuse
    expect(vars.y).toBe(authoredFn);
    expect(tween.invalidate).not.toHaveBeenCalled();

    sendKeyframeY(0, '10'); // step START — refuse, startAt untouched
    expect(vars.startAt).toBeUndefined();
    expect(vars.y).toBe(authoredFn);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a SIBLING top-level function locks edits on other properties (Sol r115)', () => {
    document.body.innerHTML = '<main><div id="kfto"></div></main>';
    const target = document.getElementById('kfto');
    // vars.y is a stateful function beside keyframes of x: editing x
    // invalidates and re-executes y (and the rollback a third time). Only the
    // property EFFECTIVELY covered by the function-model writer is exempt
    // from its own function — siblings are an animation hazard.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { y: () => 50, keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // observed here
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // edit x — refuse (sibling y fn)
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '200', exists: true },
            value: { offset: 1, value: '300', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(200); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an entry REUSED as a namespace is re-walked in its nested context (Sol r114)', () => {
    document.body.innerHTML = '<main><div id="kftn"></div></main>';
    const target = document.getElementById('kftn');
    // sharedEntry is BOTH a canonical entry (root: its `parent` key is a
    // config slot) and e1.attr (nested: attr.parent is an ANIMATED channel).
    // Context must travel with the PATH — the same identity reappearing under
    // a namespace is walked again, finding the random array.
    const shared = { y: 10, parent: ['random(0,100)'], duration: 1 };
    const e1 = { x: 100, attr: shared, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, shared, e2], duration: 3 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // observed here
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // edit x (not carried by shared) — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a random-array under an underscore expando locks — entry root and vars root (Sol r113)', () => {
    document.body.innerHTML = '<main><div id="kftk"></div><div id="kftl"></div></main>';
    const targetA = document.getElementById('kftk');
    // _phase is NOT reserved: GSAP animates it and re-rolls the array's
    // random() on every invalidate. Only the PROVEN backedge (structural
    // `parent`) is suppressed — _-keyed objects are walked.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, _phase: ['random(0,100)'], duration: 1, parent: {} };
    const varsA = { keyframes: [e1, e2], duration: 2 };
    const tweenA = buildArrayKeyframesTween(targetA, varsA);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(targetA, messages);
    tweenA.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // entry-root expando — refuse
    expect(e2.x).toBe(200);
    expect(tweenA.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a random-array under a vars-root underscore expando locks the flat track (Sol r113)', () => {
    document.body.innerHTML = '<main><div id="kftm"></div></main>';
    const target = document.getElementById('kftm');
    const e1 = { y: 10, duration: 1, parent: {} };
    const e2 = { y: 20, duration: 1, parent: {} };
    const vars = { x: 50, _phase: ['random(0,100)'], keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // flat x beside vars-root expando — refuse
    expect(vars.x).toBe(50);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a random-array under attr.parent (object in a namespace) still locks (Sol r112)', () => {
    document.body.innerHTML = '<main><div id="kftj"></div></main>';
    const target = document.getElementById('kftj');
    // The array hides under attr.parent — inside an animated namespace the
    // parent key is an ATTRIBUTE, not a backedge; object suppression applies
    // only at structural roots, and the array's random string must be found.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, attr: { parent: ['random(0,100)'] }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // observed here
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget x — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a function under an underscore expando at the entry root still locks (Sol r111)', () => {
    document.body.innerHTML = '<main><div id="kfti"></div></main>';
    const target = document.getElementById('kfti');
    // GSAP animates arbitrary target expandos including _-prefixed ones:
    // {x, _phase: () => ...} at the entry ROOT is an animated channel — the
    // backedge branch must apply the same contextual predicate (_phase is not
    // a config key).
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, _phase: () => 5, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // observed here
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget x — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a function under attr.parent (namespace key with reserved name) still locks (Sol r110)', () => {
    document.body.innerHTML = '<main><div id="kfth"></div></main>';
    const target = document.getElementById('kfth');
    // The function hides under a namespace subkey NAMED like a reserved key:
    // attr.parent is an ANIMATED attribute — the config exemption applies
    // only at the entry ROOT, and the backedge branch must not silently pass
    // functions through.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, attr: { parent: () => 5 }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // observed here
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget x — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a FUNCTION-valued entry property locks the animation like random() (Sol r109)', () => {
    document.body.innerHTML = '<main><div id="kftg"></div></main>';
    const target = document.getElementById('kftg');
    // y is function-valued inside the keyframes entries: any invalidate
    // re-executes it (stateful functions drift) — editing x would mutate y
    // without exact rollback. Animation-level hazard with durable provenance,
    // same as random().
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, y: () => 50, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // observed here
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget x — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    e2.y = 5; // page concretizes WITHOUT invalidating — durable memory holds
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('observed random prevails over a REVOKED proxy sibling (Sol r108)', () => {
    document.body.innerHTML = '<main><div id="kftf"></div></main>';
    const target = document.getElementById('kftf');
    // A revoked Proxy makes Array.isArray itself throw. It sits beside a
    // random string on the same entry: the revoked node degrades alone, the
    // random is observed and the memory survives concretization.
    const revocable = Proxy.revocable([], {});
    revocable.revoke();
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, y: 'random(0,100)', data: revocable.proxy, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // scan runs here
    e2.y = 5; // page concretizes...
    e2.data = [1]; // ...and swaps the revoked proxy, WITHOUT invalidating
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // durable memory — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('observed random prevails over a proxy-array with throwing descriptor trap (Sol r107)', () => {
    document.body.innerHTML = '<main><div id="kfte"></div></main>';
    const target = document.getElementById('kfte');
    // A Proxy-array whose descriptor trap throws sits beside a plain random
    // string on the SAME entry. Per-candidate isolation must keep draining:
    // the random is observed, the memory is fed, and the hazard survives the
    // page later concretizing and dropping the proxy without invalidating.
    const proxied = new Proxy(['x'], {
      getOwnPropertyDescriptor(inner, key) {
        if (key === '0') throw new Error('trap');
        return Reflect.getOwnPropertyDescriptor(inner, key);
      },
    });
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, y: 'random(0,100)', pts: proxied, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // scan runs here
    e2.y = 5; // page concretizes...
    e2.pts = [1]; // ...and drops the proxy, WITHOUT invalidating
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // durable memory — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('observed random prevails over a THROWING array-index getter (Sol r106)', () => {
    document.body.innerHTML = '<main><div id="kftd"></div></main>';
    const target = document.getElementById('kftd');
    // The random string sits at index 0; a throwing getter at index 1 must
    // not abort the whole scan to unknown — arrays are walked via
    // descriptors, failures isolated per node, and the observation feeds the
    // durable memory.
    const trapped = ['random(0,100)'];
    Object.defineProperty(trapped, 1, { get() { throw new Error('trap'); }, enumerable: true, configurable: true });
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, pts: trapped, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // scan runs here
    e2.pts = [5]; // page concretizes WITHOUT invalidating
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // durable memory — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('observed random prevails over an accessor in the same scan (Sol r105)', () => {
    document.body.innerHTML = '<main><div id="kftc"></div></main>';
    const target = document.getElementById('kftc');
    // The entry holds BOTH x random and an enumerable getter. The scan must
    // keep walking past the accessor and return OBSERVED (feeding the durable
    // memory) — not abort to transient unknown. After the page concretizes
    // and removes the accessor without invalidating, the edit still refuses.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, y: 'random(0,100)', duration: 1, parent: {} };
    Object.defineProperty(e2, 'z', { get() { return 1; }, enumerable: true, configurable: true });
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages); // scan runs here
    e2.y = 5; // page concretizes the random...
    // ...and swaps the accessor for a plain data property (same namespace —
    // no signature change masks the random-memory path), WITHOUT invalidating
    Object.defineProperty(e2, 'z', { value: 1, writable: true, enumerable: true, configurable: true });
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // durable memory — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('random observed on a SPLICED entry via the binding feeds the durable memory (Sol r104)', () => {
    document.body.innerHTML = '<main><div id="kftb"></div></main>';
    const target = document.getElementById('kftb');
    // The spliced entry lives only in binding.allEntries: random appears
    // there, is observed during the outage (binding invalidation), then the
    // page swaps it for a concrete value without invalidating and restores
    // the timeline. The observation must have fed the durable memory — the
    // next edit still refuses (the PropTween holds the rolled value).
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    vars.keyframes.splice(1, 1); // e2 leaves the source but stays frozen
    e2.y = 'random(0,100)'; // random appears on the spliced entry
    tween.timeline = {}; // outage
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // restore attempt — refused, random OBSERVED
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    e2.y = 5; // page swaps to a concrete value WITHOUT invalidating...
    const lookup1 = { x: {} };
    const lookup2 = { x: {}, y: {} };
    tween.timeline = { getChildren: () => [
      { vars: e1, _initted: true, _ptLookup: [lookup1] },
      { vars: e2, _initted: true, _ptLookup: [lookup2] },
    ] }; // ...and restores the timeline

    sendRetarget(selection, motion, '400'); // durable memory — still refused
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('observed random() stays a hazard after the page swaps the value without invalidating (Sol r103)', () => {
    document.body.innerHTML = '<main><div id="kfsz"></div><div id="kfta"></div></main>';
    const targetA = document.getElementById('kfsz');
    const targetB = document.getElementById('kfta');
    // random() was OBSERVED at inspection; the page then sets vars.x=50
    // without invalidate — the PropTweens still hold the rolled ends. The
    // hazard is durable provenance, not a live re-read: unchain must still
    // refuse (a relink would replace two rolled ends with [50,50]).
    const vars = { x: 'random(0,100)', duration: 2 };
    const tween = buildArrayKeyframesTween(targetA, vars, { targets: [targetA, targetB] });
    tween.kill = vi.fn();
    window.gsap.to = vi.fn(() => ({ progress: vi.fn(), kill: vi.fn() }));

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(targetA, messages); // random observed here
    vars.x = 50; // page swaps the value WITHOUT invalidating
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
            property: 'link.detach',
            before: { detached: false },
            value: { detached: true },
          },
        },
      },
    }));
    expect(window.gsap.to).not.toHaveBeenCalled(); // zero clone
    expect(tween.kill).not.toHaveBeenCalled(); // zero kill
    expect(tween.invalidate).not.toHaveBeenCalled(); // zero invalidate

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('unchain (link.detach) refuses on a randomized shared tween (Sol r102)', () => {
    document.body.innerHTML = '<main><div id="kfsx"></div><div id="kfsy"></div></main>';
    const targetA = document.getElementById('kfsx');
    const targetB = document.getElementById('kfsy');
    // Detach re-creates the tween from authored vars — re-rolling random();
    // relink invalidates and re-rolls BOTH targets. The hazard must gate the
    // whole unchain path: zero clone, zero kill, zero invalidate.
    const vars = { x: 'random(0,100)', duration: 2 };
    const tween = buildArrayKeyframesTween(targetA, vars, { targets: [targetA, targetB] });
    tween.kill = vi.fn();
    window.gsap.to = vi.fn(() => ({ progress: vi.fn(), kill: vi.fn() }));

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(targetA, messages);
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
            property: 'link.detach',
            before: { detached: false },
            value: { detached: true },
          },
        },
      },
    }));
    expect(window.gsap.to).not.toHaveBeenCalled(); // zero clone
    expect(tween.kill).not.toHaveBeenCalled(); // zero kill
    expect(tween.invalidate).not.toHaveBeenCalled(); // zero invalidate

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a FLAT rides-along track is locked when keyframes carry random() (Sol r101)', () => {
    document.body.innerHTML = '<main><div id="kfsw"></div></main>';
    const target = document.getElementById('kfsw');
    // vars.x=50 beside keyframes:[{y:'random(...)'}]: the flat x writer also
    // invalidates, and the invalidate re-rolls y. The random hazard is
    // ANIMATION-level and must gate every invalidating writer, including
    // rides-along flat tracks.
    const e1 = { y: 'random(0,100)', duration: 1, parent: {} };
    const e2 = { y: 'random(0,100)', duration: 1, parent: {} };
    const vars = { x: 50, keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // flat retarget of x — refuse
    expect(vars.x).toBe(50);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '50', exists: true },
            value: { offset: 1, value: '300', exists: true },
          },
        },
      },
    }));
    expect(vars.x).toBe(50); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('random() inside a PLUGIN namespace (attr) locks the animation (Sol r99)', () => {
    document.body.innerHTML = '<main><div id="kfst"></div></main>';
    const target = document.getElementById('kfst');
    // The randomized value hides inside attr:{} — a plugin container the old
    // scan never entered. Editing x still re-rolls the attribute on every
    // invalidate: the scan must walk ALL authored containers.
    const e1 = { x: 100, attr: { 'data-n': 'random(0,100)' }, duration: 1, parent: {} };
    const e2 = { x: 200, attr: { 'data-n': 'random(0,100)' }, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget x — refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 0, value: '0', exists: false },
            value: { offset: 0, value: '40', exists: true },
          },
        },
      },
    }));
    expect(vars.startAt).toBeUndefined(); // offset 0 — refuse, nothing written
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('plugin-namespace random() appearing post-binding voids the outage restore (Sol r99)', () => {
    document.body.innerHTML = '<main><div id="kfsu"></div></main>';
    const target = document.getElementById('kfsu');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    e2.attr = { 'data-n': 'random(0,100)' }; // page randomizes via plugin ns...
    tween.timeline = {}; // ...and the outage starts
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // restore — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('random() on ANY animated property locks the whole animation (Sol r98)', () => {
    document.body.innerHTML = '<main><div id="kfsq"></div></main>';
    const target = document.getElementById('kfsq');
    // y is randomized; editing x still invalidates the WHOLE tween and
    // re-rolls y — cross-property mutation with inexact rollback. The random
    // hazard is animation-level, not per-property.
    const e1 = { x: 100, y: 'random(0,100)', duration: 1, parent: {} };
    const e2 = { x: 200, y: 'random(0,100)', duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget x — refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '200', exists: true },
            value: { offset: 1, value: '300', exists: true },
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('random() appearing post-binding voids the outage restore (Sol r98)', () => {
    document.body.innerHTML = '<main><div id="kfsr"></div></main>';
    const target = document.getElementById('kfsr');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    e2.y = 'random(0,100)'; // page randomizes another channel post-binding...
    tween.timeline = {}; // ...and the outage starts
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // restore — refuse (would re-roll y)
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a random() desired at offset 0 is refused before touching startAt (Sol r98)', () => {
    document.body.innerHTML = '<main><div id="kfss"></div></main>';
    const target = document.getElementById('kfss');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
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
            property: 'keyframe.x',
            before: { offset: 0, value: '0', exists: false },
            value: { offset: 0, value: 'random(0,50)', exists: true },
          },
        },
      },
    }));
    expect(vars.startAt).toBeUndefined(); // refuse — nothing written
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('random() entry values lock the plan and random() desired is refused (Sol r97)', () => {
    document.body.innerHTML = '<main><div id="kfso"></div></main>';
    const target = document.getElementById('kfso');
    // GSAP re-resolves random(...) on every PropTween init and invalidate()
    // re-rolls it: two textually equal random() strings are NOT a hold, and a
    // verbatim rollback re-rolls instead of restoring. Both directions fail
    // closed before any mutation.
    const e1 = { x: 'random(0,100)', duration: 1, parent: {} };
    const e2 = { x: 'random(0,100)', duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget.final — refuse
    expect(e1.x).toBe('random(0,100)');
    expect(e2.x).toBe('random(0,100)');
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: 'random(0,100)', exists: true },
            value: { offset: 1, value: '300', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe('random(0,100)'); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a random() DESIRED value is refused before mutating clean entries (Sol r97)', () => {
    document.body.innerHTML = '<main><div id="kfsp"></div></main>';
    const target = document.getElementById('kfsp');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, 'random(0,300)'); // desired random — refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('authored paused:false / reversed:false stay EDITABLE with a forward-active child (Sol r96)', () => {
    document.body.innerHTML = '<main><div id="kfsn"></div></main>';
    const target = document.getElementById('kfsn');
    // Falsy authored paused/reversed are benign — GSAP only applies the
    // setters for truthy values. With a confrontable forward-active child the
    // effective trio decides; key presence alone must NOT lock (product rule
    // against generalized locks).
    const e1 = { x: 100, duration: 1, paused: false, parent: {} };
    const e2 = { x: 200, duration: 1, reversed: false, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }], _ts: 1, _rts: 1, _ps: false };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }], _ts: 1, _rts: 1, _ps: false };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300'); // must APPLY
    expect(e2.x).toBe(300);

    sendRetarget(selection, motion, '200'); // rollback must APPLY too
    expect(e2.x).toBe(200);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a REVERSED child locks the plan — the rendered end is not the authored end (Sol r95)', () => {
    document.body.innerHTML = '<main><div id="kfsl"></div></main>';
    const target = document.getElementById('kfsl');
    // child.reversed(true) flips _ts/_rts to -1 without touching vars: the
    // segment renders backwards and the visual end is not the authored end.
    // Editing "the end" would move an intermediate peak with false success.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }], _ts: -1, _rts: -1 };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget.final — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '200', exists: true },
            value: { offset: 1, value: '300', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(200); // keyframe.x (step-edit) — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a child PAUSED post-binding voids the outage restore (Sol r95)', () => {
    document.body.innerHTML = '<main><div id="kfsm"></div></main>';
    const target = document.getElementById('kfsm');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    child2._ps = true; // page calls child.paused(true) — vars untouched
    child2._ts = 0;
    tween.timeline = { getChildren: () => { throw new Error('outage'); } };
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // restore — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('effective child _repeat/_yoyo lock the plan even with authored keys deleted (Sol r94)', () => {
    document.body.innerHTML = '<main><div id="kfsj"></div></main>';
    const target = document.getElementById('kfsj');
    // GSAP keeps the EFFECTIVE temporal state in child._repeat/_yoyo; deleting
    // entry.repeat/yoyo post-init leaves own-keys absent while the child still
    // yoyos. The predicate must confront the child, not just the entry.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }], _repeat: 1, _yoyo: true };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget.final — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '200', exists: true },
            value: { offset: 1, value: '300', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(200); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('post-binding child.repeat()/yoyo() setters void the outage restore (Sol r94)', () => {
    document.body.innerHTML = '<main><div id="kfsk"></div></main>';
    const target = document.getElementById('kfsk');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const child1 = { vars: e1, _initted: true, _ptLookup: [{ x: {} }] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [{ x: {} }] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    child2._repeat = 1; // page calls child.repeat(1).yoyo(true) — vars untouched
    child2._yoyo = true;
    tween.timeline = { getChildren: () => { throw new Error('outage'); } };
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // restore — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('entry-level repeat/yoyo locks the plan — rendered end is not the authored end (Sol r93)', () => {
    document.body.innerHTML = '<main><div id="kfsh"></div></main>';
    const target = document.getElementById('kfsh');
    // {x:200, repeat:1, yoyo:true} RENDERS its segment back to the start: the
    // visual end is 100, not 200 — editing "the end" would move an
    // intermediate peak while reporting success. Temporal modifiers per entry
    // void the plan, and one appearing post-binding voids the binding.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, repeat: 1, yoyo: true, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget.final — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '200', exists: true },
            value: { offset: 1, value: '300', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(200); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('repeat/yoyo appearing on an entry post-binding voids the outage restore (Sol r93)', () => {
    document.body.innerHTML = '<main><div id="kfsi"></div></main>';
    const target = document.getElementById('kfsi');
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    e2.yoyo = true; // page adds a temporal modifier post-binding...
    e2.repeat = 1;
    tween.timeline = {}; // ...and the outage starts
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // restore — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a non-carrier entry GAINING the property voids the outage restore (Sol r92)', () => {
    document.body.innerHTML = '<main><div id="kfsg"></div></main>';
    const target = document.getElementById('kfsg');
    // A {css:{y:50}} entry gains css.x=50 during the outage — a brand-new x
    // carrier invisible to the frozen carriers. The binding freezes the
    // namespace of ALL entries (including 'none'); any none→top/css
    // transition makes it stale: the restore's invalidate would materialize
    // the new writer (the r36 class).
    const e0 = { css: { y: 50 }, duration: 1, parent: {} };
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e0, e1, e2], duration: 3 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    e0.css.x = 50; // none → css: a new x carrier appears...
    tween.timeline = {}; // ...and the outage starts
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo via retarget.final — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(300); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a stolen css wrapper on a non-carrier entry voids the outage restore (Sol r91)', () => {
    document.body.innerHTML = '<main><div id="kfsf"></div></main>';
    const target = document.getElementById('kfsf');
    // Page splices a non-carrier entry and gives it e0.css = e2.css: the css
    // edge is canonical ONLY for the exact frozen (carrier, bucket) pair — a
    // shared wrapper on any other entry is an active alias (the restore's
    // invalidate would materialize x into e0's segment too).
    const e0 = { y: 50, duration: 1, parent: {} };
    const e1 = { css: { x: 100 }, duration: 1, parent: {} };
    const e2 = { css: { x: 200 }, duration: 1, parent: {} };
    const vars = { keyframes: [e0, e1, e2], duration: 3 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.css.x).toBe(300);

    vars.keyframes.splice(0, 1); // page removes the y-entry from the source...
    e0.css = e2.css; // ...and steals the terminal wrapper
    tween.timeline = {}; // outage
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo via retarget.final — refuse
    expect(e2.css.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));
    expect(e2.css.x).toBe(300); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a spliced NON-carrier entry aliasing a bucket voids the outage restore (Sol r90)', () => {
    document.body.innerHTML = '<main><div id="kfse"></div></main>';
    const target = document.getElementById('kfse');
    // A live entry WITHOUT x is spliced from the array and given
    // startAt = terminalBucket: it sits outside the current source AND outside
    // binding.carriers. The binding must persist ALL entries it planned over,
    // so the alias is still seen during the outage.
    const e0 = { y: 50, duration: 1, parent: {} };
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e0, e1, e2], duration: 3 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    vars.keyframes.splice(0, 1); // page removes the y-entry from the source...
    e0.startAt = e2; // ...and aliases the terminal bucket through it
    tween.timeline = {}; // outage
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo via retarget.final — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(300); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an entry-level startAt aliasing another entry locks both channels (Sol r89)', () => {
    document.body.innerHTML = '<main><div id="kfsd"></div></main>';
    const target = document.getElementById('kfsd');
    // GSAP treats each entry as a to() vars — entry.startAt is ACTIVE. With
    // e1.startAt === e2, writing e2.x also rewrites e1's start values; the
    // invalidate materializes that new start. The walker must allow buckets
    // only at their canonical occurrence (array slot / entry.css) and flag any
    // re-encounter through entry sub-fields.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    e1.startAt = e2; // page aliases the terminal INSIDE the keyframes subtree
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '300'); // retarget.final — refuse
    expect(e2.x).toBe(200);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '200', exists: true },
            value: { offset: 1, value: '300', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(200); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Alias removed → editable again (transient lock, no durable memory)...
    delete e1.startAt;
    sendRetarget(selection, motion, '300');
    expect(e2.x).toBe(300);

    // ...then re-aliased + outage: the frozen restore must refuse too.
    e1.startAt = e2;
    tween.timeline = {};
    tween.invalidate.mockClear();
    sendRetarget(selection, motion, '200'); // restore — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a bucket aliased in the tween OWN vars graph locks writes and restores (Sol r88)', () => {
    document.body.innerHTML = '<main><div id="kfsc"></div></main>';
    const target = document.getElementById('kfsc');
    // Page does vars.startAt = terminalEntry after the binding froze: writing
    // the bucket now ALSO writes startAt.x, and invalidatePreservingStart
    // materializes that new start — the path corrupts while every r87 check
    // (namespace, identity, value) still passes.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    vars.startAt = e2; // page aliases the terminal entry into its own vars
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '400'); // non-restore write — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    sendRetarget(selection, motion, '200'); // restore — refuse too
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(300); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a REPLACED css wrapper detaches the frozen bucket — restore refuses (Sol r87)', () => {
    document.body.innerHTML = '<main><div id="kfsb"></div></main>';
    const target = document.getElementById('kfsb');
    // Page swaps entry.css for a NEW object after the edit; the frozen bucket
    // is detached. Namespace still reads 'css' and the old bucket still holds
    // the expected value — but writing it changes nothing that renders. The
    // binding must freeze BUCKET IDENTITY per carrier.
    const w1 = { x: 100 };
    const w2 = { x: 200 };
    const e1 = { css: w1, duration: 1, parent: {} };
    const e2 = { css: w2, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.css.x)).toEqual([100, 300]);

    const detached = e2.css; // the frozen bucket...
    e2.css = { x: 300 }; // ...replaced by a fresh wrapper (same value)
    tween.timeline = {}; // outage
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo via retarget.final — refuse
    expect(detached.x).toBe(300); // detached bucket untouched
    expect(e2.css.x).toBe(300); // live wrapper untouched
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));
    expect(detached.x).toBe(300); // keyframe.x — refuse
    expect(e2.css.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('runBackwards on a frozen carrier entry voids the restore during an outage (Sol r86)', () => {
    document.body.innerHTML = '<main><div id="kfsa"></div></main>';
    const target = document.getElementById('kfsa');
    // Page splices the terminal entry out of the array (child stays alive —
    // supported) and flips runBackwards on it, then the outage starts. Values
    // still match ('300'), but the restore's invalidate would reverse the
    // path — carrier-entry state is frozen in the binding and revalidated.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    vars.keyframes.splice(1, 1); // page removes the terminal from the SOURCE...
    e2.runBackwards = true; // ...and reverses the live entry
    tween.timeline = {}; // outage
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo via retarget.final — refuse
    expect(e2.x).toBe(300);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));
    expect(e2.x).toBe(300); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('vars[property] appearing post-binding voids the restore even during an outage (Sol r85)', () => {
    document.body.innerHTML = '<main><div id="kfrz"></div></main>';
    const target = document.getElementById('kfrz');
    // Page adds vars.x=50 AFTER the binding froze, then the outage starts. The
    // frozen restore's invalidate would materialize the both-places probe-H
    // corruption (restored path starts at 50, not 0) — vars.x is directly
    // observable without the timeline and must void the binding.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    vars.x = 50; // page adds a top-level carrier post-binding...
    tween.timeline = {}; // ...and the outage starts
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo via retarget.final — refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an externally mutated bucket makes the binding STALE even during an outage (Sol r84)', () => {
    document.body.innerHTML = '<main><div id="kfry"></div></main>';
    const target = document.getElementById('kfry');
    // Two-bucket trailing run; the page mutates the NON-terminal bucket, then
    // the outage starts. The frozen restore would wipe the page's 250 — the
    // value check needs no timeline and must run even while uninspectable.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const e3 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2, e3], duration: 3 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300'); // collision run freezes BOTH buckets
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300, 300]);

    e2.x = 250; // page mutates the non-terminal bucket...
    tween.timeline = {}; // ...and the outage starts
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // restore attempt — must refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 250, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-transaction',
        payload: {
          transaction: {
            id: 'tx-r84',
            patches: [{
              id: 'p-r84',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframe.x',
              before: { offset: 1, value: '300', exists: true },
              value: { offset: 1, value: '200', exists: true },
            }],
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 250, 300]); // still refused
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a committed outage restore keeps TRUTHFUL history and rolls back exactly after recovery (Sol r83)', () => {
    document.body.innerHTML = '<main><div id="kfrw"></div></main>';
    const target = document.getElementById('kfrw');
    // The LAST patch of a commit may ride the frozen-restore lane during an
    // outage — but its ACK must canonicalize the REAL values (300→200) via the
    // frozen binding, never {exists:false} on both sides (whose persisted
    // inverse no-ops forever). After the timeline recovers, rollback-transaction
    // must restore 300 exactly.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    tween.timeline = {}; // outage: timeline present, getChildren missing

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-transaction',
        payload: {
          transaction: {
            id: 'tx-r83',
            patches: [{
              id: 'p-r83',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframe.x',
              before: { offset: 1, value: '300', exists: true },
              value: { offset: 1, value: '200', exists: true },
            }],
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]); // committed restore
    const ack = messages.filter((message) => message.type === 'transaction-committed').pop();
    const canonical = ack.payload.transaction.patches[0];
    expect(canonical.before.exists).toBe(true);
    expect(canonical.before.value).toBe('300'); // truthful history via the binding
    expect(canonical.value.exists).toBe(true);
    expect(canonical.value.value).toBe('200');

    // Timeline recovers with healthy children.
    const lookup1 = { x: {} };
    const lookup2 = { x: {} };
    const child1 = { vars: e1, _initted: true, _ptLookup: [lookup1] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [lookup2] };
    tween.timeline = { getChildren: () => [child1, child2] };

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'rollback-transaction',
        payload: { targetTransactionId: 'tx-r83' },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]); // exact rollback

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a MULTIPATCH commit whose final patch is an outage restore stays atomic and truthful (Sol r83)', () => {
    document.body.innerHTML = '<main><div id="kfrx"></div></main>';
    const target = document.getElementById('kfrx');
    // Earlier reversible patches + the restore LAST: allowed (the final patch
    // of a commit never needs its own rollback), with truthful canonical
    // history for the restore.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    tween.timeline = {}; // outage

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'apply-transaction',
        payload: {
          transaction: {
            id: 'tx-r83-multi',
            patches: [
              {
                id: 'p-r83-hint',
                elementId: selection.payload.element.id,
                kind: 'motion',
                motionId: motion.id,
                property: 'ownership.hint',
                before: null,
                value: { semanticProperty: 'translateX', motionId: motion.id },
              },
              {
                id: 'p-r83-final',
                elementId: selection.payload.element.id,
                kind: 'motion',
                motionId: motion.id,
                property: 'keyframe.x',
                before: { offset: 1, value: '300', exists: true },
                value: { offset: 1, value: '200', exists: true },
              },
            ],
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]); // committed
    const ack = messages.filter((message) => message.type === 'transaction-committed').pop();
    expect(ack.payload.transaction.id).toBe('tx-r83-multi');
    const canonical = ack.payload.transaction.patches[1];
    expect(canonical.before.exists).toBe(true);
    expect(canonical.before.value).toBe('300');
    expect(canonical.value.value).toBe('200');

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('an outage restore inside a transaction is rejected BEFORE mutating (Sol r82)', () => {
    document.body.innerHTML = '<main><div id="kfrv"></div></main>';
    const target = document.getElementById('kfrv');
    // During an outage the frozen-binding restore is the ONLY lane: it can be
    // APPLIED but never ROLLED BACK (re-writing the pre-transaction value is a
    // blocked non-restore). validate-transaction applies then restores — so it
    // must reject upfront, leaving the tween untouched.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    tween.timeline = {}; // outage: timeline present, getChildren missing
    tween.invalidate.mockClear();

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-r82-kf',
            patches: [{
              id: 'p-r82-kf',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'keyframe.x',
              before: { offset: 1, value: '300', exists: true },
              value: { offset: 1, value: '200', exists: true },
            }],
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]); // untouched

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'validate-transaction',
        payload: {
          transaction: {
            id: 'tx-r82-rt',
            patches: [{
              id: 'p-r82-rt',
              elementId: selection.payload.element.id,
              kind: 'motion',
              motionId: motion.id,
              property: 'retarget.final',
              before: { schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value: '300' },
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
            }],
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]); // untouched
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a broken inner timeline on ANOTHER tween makes sharing unknown — restore refuses (Sol r81)', () => {
    document.body.innerHTML = '<main><div id="kfru"></div></main>';
    const target = document.getElementById('kfru');
    // B carries a truthy timeline WITHOUT getChildren: its children (which may
    // target A's buckets) are unreachable. "Cannot inspect" must read as
    // unknown — never as "not shared".
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    const rider = { vars: { duration: 1 }, timeline: {} }; // uninspectable subtree
    window.gsap.globalTimeline.getChildren = () => [tween, rider];
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo via retarget.final — refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a restore refuses when another tween TARGETS one of the buckets (Sol r80)', () => {
    document.body.innerHTML = '<main><div id="kfrt"></div></main>';
    const target = document.getElementById('kfrt');
    // GSAP animates arbitrary objects: B = gsap.to(entryOfA, {...}) holds the
    // entry only in targets(), never in vars. The restore must identity-check
    // targets() too — otherwise it rewrites B's animated object (r45 class).
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    // Page creates B animating A's entry OBJECT — visible only via targets().
    const rider = { vars: { x: 500, duration: 1 }, targets: () => [e2] };
    window.gsap.globalTimeline.getChildren = () => [tween, rider];
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo via retarget.final — refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a restore refuses when sharing arose AFTER the binding froze (Sol r79)', () => {
    document.body.innerHTML = '<main><div id="kfrs"></div></main>';
    const target = document.getElementById('kfrs');
    // Edit A, page creates tween B reusing A's entry object, undo A: the
    // frozen-bucket restore would silently rewrite B's segment (the r45
    // cross-motionId corruption). Proven sharing fails the restore closed on
    // BOTH channels; the binding stays for a later attempt.
    const e1 = { x: 100, duration: 1, parent: {} };
    const e2 = { x: 200, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    // Page creates B riding on A's entry object AFTER the binding froze.
    const rider = { vars: { startAt: e2, duration: 1 } };
    window.gsap.globalTimeline.getChildren = () => [tween, rider];
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo via retarget.final — refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

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
            before: { offset: 1, value: '300', exists: true },
            value: { offset: 1, value: '200', exists: true },
          },
        },
      },
    }));
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]); // keyframe.x — refuse
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a filtered-out child makes the snapshot uninspectable — never healthy (Sol r78)', () => {
    document.body.innerHTML = '<main><div id="kfrr"></div></main>';
    const target = document.getElementById('kfrr');
    // proven → page injects a vars-less child among otherwise-healthy ones.
    // The silent filter must NOT let the survivors count as a full healthy
    // snapshot and clear the proven memory: any discard = uninspectable.
    const e1 = { x: 100, y: 5, duration: 1, parent: {} };
    const e2 = { x: 200, y: 10, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const lookup1 = { x: {}, y: {} };
    const lookup2 = { x: {}, y: {} };
    const child1 = { vars: e1, _initted: true, _ptLookup: [lookup1] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [lookup2] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    delete lookup1.y; // page kills y — PROVEN...
    delete lookup2.y;
    sendRetarget(selection, motion, '500'); // ...observed by this refused edit
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    // Page "recovers" the survivors but a corrupted vars-less child rides
    // along — the snapshot is NOT integrally inspectable.
    lookup1.y = {};
    lookup2.y = {};
    const corrupted = { vars: null, _initted: true, _ptLookup: [] };
    tween.timeline.getChildren = () => [child1, child2, corrupted];
    sendRetarget(selection, motion, '500'); // must refuse, must not clear memory
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    tween.timeline.getChildren = () => { throw new Error('outage'); };
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo during outage — must refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('proven memory survives an INCOMPLETE inspection and clears only on a healthy one (Sol r77)', () => {
    document.body.innerHTML = '<main><div id="kfrq"></div></main>';
    const target = document.getElementById('kfrq');
    // proven → non-initted inspection (scan false, but NOT healthy) → outage:
    // the restore must still refuse. Only a FULL healthy inspection (all
    // children initted, complete lookups, every check passing) clears the
    // memory and reopens the restore lane.
    const e1 = { x: 100, y: 5, duration: 1, parent: {} };
    const e2 = { x: 200, y: 10, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const lookup1 = { x: {}, y: {} };
    const lookup2 = { x: {}, y: {} };
    const child1 = { vars: e1, _initted: true, _ptLookup: [lookup1] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [lookup2] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    delete lookup1.y; // page kills y — PROVEN...
    delete lookup2.y;
    sendRetarget(selection, motion, '500'); // ...observed by this refused edit
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    child1._initted = false; // page re-inits: children present but NOT initted
    child2._initted = false; // scan sees no hazard — but proves nothing
    sendRetarget(selection, motion, '500'); // incomplete inspection, refused
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    const liveGetChildren = tween.timeline.getChildren;
    tween.timeline.getChildren = () => { throw new Error('outage'); };
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo during outage — must refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    // Page genuinely recovers: children re-initted with COMPLETE lookups.
    tween.timeline.getChildren = liveGetChildren;
    child1._initted = true;
    child2._initted = true;
    lookup1.y = {};
    lookup2.y = {};
    sendRetarget(selection, motion, '200'); // healthy → memory cleared → restore
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 200]);

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('a PROVEN hazard never downgrades to unknown through an outage (Sol r76)', () => {
    document.body.innerHTML = '<main><div id="kfrp"></div></main>';
    const target = document.getElementById('kfrp');
    // x edited, page kills y's writers (PROVEN), THEN an outage hides the
    // children. The proven memory must survive the outage: the undo of x
    // still refuses instead of riding the outage-unknown restore lane.
    const e1 = { x: 100, y: 5, duration: 1, parent: {} };
    const e2 = { x: 200, y: 10, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const lookup1 = { x: {}, y: {} };
    const lookup2 = { x: {}, y: {} };
    const child1 = { vars: e1, _initted: true, _ptLookup: [lookup1] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [lookup2] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    delete lookup1.y; // page kills y's writers — PROVEN hazard...
    delete lookup2.y;
    sendRetarget(selection, motion, '500'); // ...observed by this refused edit
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    tween.timeline.getChildren = () => { throw new Error('outage'); };
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo during outage — must refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('refuses a restore under a PROVEN resurrection hazard — only outage-unknown passes (Sol r75)', () => {
    document.body.innerHTML = '<main><div id="kfrh"></div></main>';
    const target = document.getElementById('kfrh');
    // x edited, then the page KILLS y's PropTween (proven hazard): undoing x
    // would invalidate the whole tween and resurrect y. The restore must
    // refuse; only outage-born uncertainty may pass.
    const e1 = { x: 100, y: 5, duration: 1, parent: {} };
    const e2 = { x: 200, y: 10, duration: 1, parent: {} };
    const vars = { keyframes: [e1, e2], duration: 2 };
    const tween = buildArrayKeyframesTween(target, vars);
    const lookup1 = { x: {}, y: {} };
    const lookup2 = { x: {}, y: {} };
    const child1 = { vars: e1, _initted: true, _ptLookup: [lookup1] };
    const child2 = { vars: e2, _initted: true, _ptLookup: [lookup2] };
    tween.timeline = { getChildren: () => [child1, child2] };

    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());

    const { selection, motion } = grabMotion(target, messages);
    sendRetarget(selection, motion, '300');
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);

    delete lookup1.y; // page kills y's writers — PROVEN hazard
    delete lookup2.y;
    tween.invalidate.mockClear();

    sendRetarget(selection, motion, '200'); // undo of x — must refuse
    expect(vars.keyframes.map((entry) => entry.x)).toEqual([100, 300]);
    expect(tween.invalidate).not.toHaveBeenCalled();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('never mistakes a plain tween with an inner timeline for a keyframes tween (Sol r10)', () => {
    document.body.innerHTML = '<main><div id="kfpl"></div><div id="kfob"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);

    // A PLAIN tween gets an inner timeline too when duration/delay is a
    // function or string (probe _probe-plain-fnduration.mjs) — its children's
    // vars are per-target COPIES carrying the animated prop + injected parent.
    // Treating them as keyframes entries would lock a legitimate plain tween
    // (generalized lock — product rule violation). Keyframes treatment needs
    // POSITIVE provenance: vars.keyframes observed on this animation.
    const plainTarget = document.getElementById('kfpl');
    const plainVars = { x: 100, duration: 2 };
    const plainTween = buildArrayKeyframesTween(plainTarget, plainVars);
    plainTween.timeline = {
      getChildren: () => [{ vars: { x: 100, overwrite: 'auto', ease: 'none', stagger: 0, duration: 2, delay: 0, parent: {} } }],
    };

    window.eval(getRuntimeBridgeSource());

    const plain = grabMotion(plainTarget, messages);
    const plainTrack = plain.motion.tracks.find((track) => track.property === 'x');
    expect(plainTrack.ownership.retargetable).toBe(true);
    expect(plainTrack.keyframeEditable).toBe(true);
    expect(plainTrack.keyframeEditReason).toBeUndefined();
    sendRetarget(plain.selection, plain.motion, '300');
    expect(plainVars.x).toBe(300); // the plain vars writer stays the write path

    // Opposite direction: an OBJECT-form tween seen before the page deletes
    // vars.keyframes keeps its provenance — detection stays (fail-closed),
    // the write plan stays denied (no proven ARRAY origin).
    const objTarget = document.getElementById('kfob');
    const objEntry = { x: 60, duration: 2, parent: {} };
    const objVars = { keyframes: { x: [0, 60] }, duration: 2 };
    const objTween = buildArrayKeyframesTween(objTarget, objVars);
    objTween.timeline = { getChildren: () => [{ vars: objEntry }] };
    const objBefore = grabMotion(objTarget, messages); // provenance observed: 'other'
    expect(objBefore.motion.tracks.find((track) => track.property === 'x').ownership.retargetable).toBe(false);
    delete objVars.keyframes; // external page mutation
    const objAfter = grabMotion(objTarget, messages);
    const objTrack = objAfter.motion.tracks.find((track) => track.property === 'x');
    expect(objTrack).toBeTruthy(); // still inventoried — invisible-writer lie stays dead
    expect(objTrack.ownership.retargetable).toBe(false);
    sendRetarget(objAfter.selection, objAfter.motion, '160');
    expect(objEntry.x).toBe(60);
    expect(objVars.x).toBeUndefined();

    delete window.gsap;
    window.postMessage = originalPostMessage;
  });

  it('keeps every unproven keyframes shape locked: property-array, stops, relative entries, looping retarget', () => {
    document.body.innerHTML = '<main><div id="kf1"></div><div id="kf2"></div><div id="kf3"></div><div id="kf4"></div></main>';
    const messages = [];
    const originalPostMessage = window.postMessage;

    const classify = (target, vars, options) => {
      const tween = buildArrayKeyframesTween(target, vars, options);
      const { selection, motion } = grabMotion(target, messages);
      return { tween, selection, motion, track: motion.tracks.find((track) => track.property === 'x') };
    };

    window.postMessage = (message) => messages.push(message);

    // property-array form {x:[...]}: no proven entry path -> locked on both channels.
    const propArrayVars = { keyframes: { x: [0, 60] }, duration: 2 };
    // stops form {"50%":{...}}: locked on both channels.
    const stopsVars = { keyframes: { '50%': { x: 30 }, '100%': { x: 60 } }, duration: 2 };
    // relative-valued entries: replacing '+=' semantics with an absolute is unproven -> locked.
    const relativeVars = { keyframes: [{ x: '+=50', duration: 1, parent: {} }, { x: '+=100', duration: 1, parent: {} }], duration: 2 };
    // looping array form: the additive-base loop write has no entry path -> NOT
    // retargetable, but the END step edit is probe-proven (D) -> stays editable.
    const loopingVars = { keyframes: [{ x: 100, duration: 1, parent: {} }, { x: 200, duration: 1, parent: {} }], duration: 2 };

    window.eval(getRuntimeBridgeSource());

    const propArray = classify(document.getElementById('kf1'), propArrayVars);
    expect(propArray.track.ownership.retargetable).toBe(false);
    expect(propArray.track.keyframeEditable).toBe(false);
    expect(propArray.track.keyframeEditReason).toBe('keyframes');
    sendRetarget(propArray.selection, propArray.motion, '160');
    expect(propArrayVars.keyframes.x).toEqual([0, 60]);

    const stops = classify(document.getElementById('kf2'), stopsVars);
    expect(stops.track.ownership.retargetable).toBe(false);
    expect(stops.track.keyframeEditable).toBe(false);
    sendRetarget(stops.selection, stops.motion, '160');
    expect(stopsVars.keyframes['100%']).toEqual({ x: 60 });

    const relative = classify(document.getElementById('kf3'), relativeVars);
    expect(relative.track.ownership.retargetable).toBe(false);
    expect(relative.track.keyframeEditable).toBe(false);
    sendRetarget(relative.selection, relative.motion, '160');
    expect(relativeVars.keyframes.map((entry) => entry.x)).toEqual(['+=50', '+=100']);

    const looping = classify(document.getElementById('kf4'), loopingVars, { repeat: -1 });
    expect(looping.track.ownership.retargetable).toBe(false);
    expect(looping.track.keyframeEditable).toBe(true);

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
      vars: { keyframes: [{ y: 0, duration: 1, parent: {} }, { y: 60, duration: 1, parent: {} }] },
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
    // The pure ARRAY form now has a safe step path (entry-edit + startAt,
    // probe 2026-07-29) — editable, and it enables the derived clip capability.
    expect(kfMotion.tracks.find((track) => track.property === 'y').keyframeEditable).toBe(true);
    expect(kfMotion.tracks.find((track) => track.property === 'y').keyframeEditReason).toBeUndefined();
    expect(kfMotion.capabilities.keyframes).toBe(true);

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
      keyframes: [{ css: { x: 0 }, duration: 1, parent: {} }, { css: { x: 100 }, duration: 1, parent: {} }],
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
    // Entry-level css wrappers are the write bucket of the array-form entry
    // plan (probe E, 2026-07-29) — this shape retargets safely now.
    expect(motion.tracks[0].ownership.retargetable).toBe(true);

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
