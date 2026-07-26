/*
 * Source injected into an untrusted native-clone iframe. Keep this file free
 * of imports: getRuntimeBridgeSource serializes the function into the cloned
 * document, where it runs inside the iframe's opaque sandbox origin.
 */
function nativeMotionRuntimeBridge() {
  const PROTOCOL = 'uncraft-motion-editor/v1';
  const PROTOCOL_V2 = 'uncraft-motion-editor/v2';
  const SUPPORTED_PROTOCOLS = [PROTOCOL_V2, PROTOCOL];
  const TRANSACTION_LIMITS = {
    maxPatches: 100,
    maxBytes: 256 * 1024,
    maxPreviewUpdates: 120,
    maxExecutionMs: 2000,
  };
  let runtimeConfig = {};
  try {
    const configNode = document.querySelector('[data-uncraft-' + 'runtime-config]');
    runtimeConfig = configNode ? JSON.parse(configNode.textContent || '{}') : {};
  } catch (_) {}
  const randomIdentity = (prefix) => {
    try { return `${prefix}-${crypto.randomUUID()}`; } catch (_) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  };
  const sessionNonce = typeof runtimeConfig.sessionNonce === 'string' && runtimeConfig.sessionNonce.length >= 8
    ? runtimeConfig.sessionNonce
    : randomIdentity('lab-nonce');
  const bundleId = runtimeConfig.initialManifest?.baseBundleId || runtimeConfig.bundleId || 'motion-lab-bundle';
  const runtimeSessionId = runtimeConfig.runtimeSessionId || 'motion-lab-session';
  const runtimeFingerprint = runtimeConfig.runtimeFingerprint || null;
  const runtimeGeneration = Math.max(1, Number(window.__uncraftMotionRuntimeGeneration || 0) + 1);
  window.__uncraftMotionRuntimeGeneration = runtimeGeneration;
  let negotiatedProtocol = PROTOCOL;
  let trustedHostOrigin = null;
  let heartbeatTimer = null;
  const processedRequests = new Map();
  const committedTransactions = new Map();
  const activeGestures = new Map();
  const SELECTABLE = [
    '[data-w-id]', '[data-wf-target]',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote',
    'a', 'button', 'label', 'input', 'textarea', 'select',
    'img', 'picture', 'video', 'canvas', 'svg', 'li',
    'section', 'article', 'header', 'footer', 'nav', 'main', 'div'
  ].join(',');
  const TEXT_BLOCK = 'h1,h2,h3,h4,h5,h6,p,blockquote,a,button,label,li,figcaption,dt,dd';
  // Split-text fragments come in many dialects: SplitText's .char/.word/.line,
  // Webflow attributes, and site-authored classes like "gsap_split_line" —
  // clicking those lines must climb to the text block, never select a
  // transient fragment (found live: "most fertilizers…" was unselectable).
  const SPLIT_TOKEN = '.char,.word,.line,[data-split-text],[data-split-type],[text-split],[text-split-delay],[class*="split_line"],[class*="split-line"],[class*="split_word"],[class*="split-word"],[class*="split_char"],[class*="split-char"]';
  let mode = 'edit';
  let tool = 'select';
  let selectedId = null;
  let speed = 1;
  let hoveredElement = null;
  // Hosts of the LAST emitted timeline rows — selection resolves against what
  // the UI is actually showing, not a freshly re-derived (drift-prone) index.
  let lastRowHosts = new Set();
  // First-seen reveal points per row (elementId → page px). Cleared on layout
  // changes so strips stay FIXED while the user scrubs.
  const revealAtCache = new Map();
  let lastKnownScrollHeight = 0;
  // Persistent row list (elementId → row + arrival seq): the timeline's rows
  // keep their slots while the user scrubs, even as runtimes mint new tweens.
  const rowCache = new Map();
  let rowSeq = 0;
  let hoverFrame = null;
  let dragState = null;
  let suppressClickUntil = 0;
  let textEditState = null;
  let motionSequence = 0;
  let activeTimelineId = null;
  let timelineFrame = null;
  let lastTimelineEmit = 0;
  let editState = 'navigating';
  let scopedSettlement = null;
  let previewState = null;
  let scrubActive = false;
  let settlementSequence = 0;
  let viewportTimer = null;
  let recoveryTimer = null;
  const animationIds = new WeakMap();
  const motionRegistry = new Map();
  const runtimeOwnershipHints = new Map();
  const gsapFunctionRetargets = new WeakMap();
  // Every listener this instance installs hangs off one controller, so a
  // re-injected bridge can remove ALL of them at once. Leaving even the DOM
  // listeners behind makes a stale instance keep emitting selections with ids
  // the live instance does not know.
  const listeners = new AbortController();
  const on = (target, type, handler, options) => {
    const base = options === true ? { capture: true } : (options || {});
    target.addEventListener(type, handler, { ...base, signal: listeners.signal });
  };

  function emit(type, payload, context = {}) {
    const protocol = context.protocol || negotiatedProtocol;
    const requestId = context.requestId || randomIdentity('runtime-event');
    const message = {
      protocol,
      protocolVersion: protocol,
      supportedProtocols: SUPPORTED_PROTOCOLS,
      source: 'runtime',
      type,
      sessionNonce,
      requestId,
      runtimeGeneration,
      bundleId,
      sessionId: runtimeSessionId,
      payload,
    };
    window.parent.postMessage(message, trustedHostOrigin || '*');
    return message;
  }

  function reply(message, type, payload, context = {}) {
    if (message?.protocol === PROTOCOL_V2 && message.requestId && context.cache !== false) {
      processedRequests.set(message.requestId, { type, payload });
      if (processedRequests.size > 500) processedRequests.delete(processedRequests.keys().next().value);
    }
    return emit(type, payload, {
      protocol: context.protocol || (message?.protocol === PROTOCOL_V2 ? PROTOCOL_V2 : negotiatedProtocol),
      requestId: message?.requestId,
    });
  }

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function domFingerprint(element) {
    const parts = [];
    let current = element;
    while (current && current !== document.body && parts.length < 8) {
      let position = 1;
      let sibling = current;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === current.tagName) position += 1;
      }
      const classes = Array.from(current.classList || []).slice(0, 3).join('.');
      parts.unshift(`${current.tagName.toLowerCase()}${classes ? `.${classes}` : ''}:nth-${position}`);
      current = current.parentElement;
    }
    return parts.join('>');
  }

  function ensureElementId(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    if (element.dataset.uncraftId) return element.dataset.uncraftId;
    const webflowId = element.getAttribute('data-w-id');
    const authoredId = element.id;
    const seed = webflowId
      ? `webflow:${webflowId}`
      : authoredId
        ? `id:${authoredId}`
        : `path:${domFingerprint(element)}`;
    const id = `el-${hash(seed)}`;
    element.dataset.uncraftId = id;
    return id;
  }

  function findElement(elementId) {
    if (!elementId) return null;
    return Array.from(document.querySelectorAll('[data-uncraft-id]'))
      .find((element) => element.dataset.uncraftId === elementId) || null;
  }

  function rawText(element) {
    if (!element) return '';
    if (element.matches('input,textarea')) return element.value || '';
    return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function directText(element) {
    if (!element) return '';
    if (element.matches('input,textarea')) return element.value || '';
    const splitLabel = element.querySelector(SPLIT_TOKEN) && element.getAttribute('aria-label');
    if (splitLabel) return splitLabel.trim();
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() || (element.children.length <= 24 ? rawText(element) : '');
  }

  function textRoot(element) {
    if (!(element instanceof Element)) return null;
    if (element.matches(TEXT_BLOCK)) return element;
    const block = element.closest(TEXT_BLOCK);
    if (block) return block;
    const splitToken = element.matches(SPLIT_TOKEN) ? element : element.closest(SPLIT_TOKEN);
    if (splitToken) {
      const splitContainer = splitToken.closest('[aria-label],[data-split-text],[text-split],[text-split-delay]');
      if (splitContainer && splitContainer !== document.body) return splitContainer;
      let group = splitToken.parentElement;
      let depth = 0;
      while (group && group !== document.body && depth < 6) {
        if (group.querySelectorAll(SPLIT_TOKEN).length > 1) return group;
        group = group.parentElement;
        depth += 1;
      }
    }
    return null;
  }

  function isEditableText(element) {
    if (!element || element.matches('input,textarea,select')) return false;
    if (element.matches(TEXT_BLOCK)) return true;
    return Boolean(directText(element)) && !element.matches('img,picture,video,canvas,svg,section,article,header,footer,nav,main');
  }

  function pageOrigin() {
    const generator = document.querySelector('meta[name="generator"]')?.content || '';
    if (document.documentElement.hasAttribute('data-wf-page') || window.Webflow) return 'webflow';
    if (/framer/i.test(generator) || document.querySelector('[data-framer-name],[data-framer-component-type]')) return 'framer';
    return 'native';
  }

  function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function semanticProperty(property) {
    const camel = String(property || '').replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    const aliases = {
      x: 'translateX',
      y: 'translateY',
      xPercent: 'translateX',
      yPercent: 'translateY',
      rotation: 'rotate',
      rotationZ: 'rotate',
    };
    return aliases[camel] || camel;
  }

  function motionBehavior({ name, id, driver, iterations }) {
    const text = `${name || ''} ${id || ''}`.toLowerCase();
    if (driver === 'pointer' || /hover|pointer|mouse/.test(text)) return 'hover';
    if (driver === 'scroll' || /scroll|parallax/.test(text)) return 'scroll';
    if (iterations === Infinity || /loop|marquee|ticker/.test(text)) return 'loop';
    if (/click|tap|press|interaction/.test(text)) return 'interaction';
    if (/entrance|intro|reveal|fade.?in|load|hero/.test(text)) return 'entrance';
    return 'playback';
  }

  function gsapWriteModel(value, looping) {
    if (looping) return 'additive-base';
    if (typeof value === 'function') return 'function-offset';
    if (/^[+-]=/.test(String(value || '').trim())) return 'relative';
    return 'absolute';
  }

  function safeSourceValue(value) {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    return null;
  }

  function writerOwnership({
    clipId,
    animation,
    target,
    property,
    behavior,
    order,
    sequenceId = null,
    writeModel = 'absolute',
    retargetable = true,
    sourceValue = null,
    targetCount = 1,
    stagger = null,
  }) {
    const normalized = semanticProperty(property);
    return {
      channelId: `${clipId}:${normalized}`,
      animationId: clipId,
      targetId: ensureElementId(target),
      runtimeProperty: property,
      behavior,
      order: finite(order),
      sequenceId,
      relationship: sequenceId ? 'sequential' : 'independent',
      writeModel,
      retargetable,
      sourceValue,
      affectedTargetCount: Math.max(1, targetCount),
      ...(stagger ? { stagger } : {}),
    };
  }

  function motionIdFor(animation, prefix, seed) {
    if (animationIds.has(animation)) return animationIds.get(animation);
    const id = `${prefix}-${seed ? hash(seed) : ++motionSequence}`;
    animationIds.set(animation, id);
    return id;
  }

  function keyframeTracks(effect) {
    if (!effect || typeof effect.getKeyframes !== 'function') return [];
    let frames = [];
    try { frames = effect.getKeyframes(); } catch (_) { return []; }
    const ignored = new Set(['offset', 'computedOffset', 'easing', 'composite']);
    const properties = Array.from(new Set(frames.flatMap((frame) => Object.keys(frame).filter((key) => !ignored.has(key)))));
    return properties.map((property) => ({
      property,
      keyframes: frames
        .filter((frame) => frame[property] != null)
        .map((frame) => ({
          offset: finite(frame.computedOffset, finite(frame.offset, 0)),
          value: String(frame[property]),
          easing: frame.easing || null,
        })),
    }));
  }

  // Grouping facts only the runtime can see: which split-text root a per-char
  // tween belongs to, which GSAP timeline parents a tween, who the DOM parent is.
  // The host collapses the flat motion list into semantic rows from this alone.
  function clipGroupMeta(animation, primaryTarget, targets) {
    const meta = {
      targetId: null,
      parentId: null,
      splitRootId: null,
      splitRootLabel: null,
      timelineId: null,
      timelineLabel: null,
      timelineScroll: false,
      targetCount: 1,
    };
    // Metadata is a bonus — a throw anywhere here must never escape into
    // describe() and kill selection on an exotic page.
    try {
      if (primaryTarget instanceof Element) {
        meta.targetId = ensureElementId(primaryTarget);
        if (primaryTarget.parentElement) meta.parentId = ensureElementId(primaryTarget.parentElement);
      }
      meta.targetCount = Math.max(1, (targets || []).filter((item) => item instanceof Element).length);
    } catch (_) {}
    try {
      if (primaryTarget instanceof Element && primaryTarget.matches(SPLIT_TOKEN)) {
        const root = textRoot(primaryTarget);
        if (root && root !== primaryTarget) {
          meta.splitRootId = ensureElementId(root);
          meta.splitRootLabel = directText(root).slice(0, 60) || null;
        }
      }
    } catch (_) {}
    try {
      const parent = animation.parent;
      if (parent && parent !== window.gsap?.globalTimeline) {
        // Seed from the authored timeline id when present: the host keys UI state
        // (expanded groups) by this, and it must survive a bridge re-injection.
        const authored = parent.vars?.id || parent.scrollTrigger?.vars?.id || null;
        meta.timelineId = motionIdFor(parent, 'timeline', authored ? `tl:${authored}` : null);
        meta.timelineLabel = authored;
        meta.timelineScroll = Boolean(parent.scrollTrigger || parent.vars?.scrollTrigger);
      }
    } catch (_) {}
    return meta;
  }

  function browserMotionClip(animation, index, selectedElement) {
    const effect = animation.effect;
    const rawTiming = effect && typeof effect.getTiming === 'function' ? effect.getTiming() : {};
    const computed = effect && typeof effect.getComputedTiming === 'function' ? effect.getComputedTiming() : {};
    const keyframeName = animation.animationName || '';
    const engine = keyframeName ? 'CSS' : 'WAAPI';
    const target = effect?.target instanceof Element ? effect.target : selectedElement;
    const timelineName = animation.timeline?.constructor?.name || '';
    const driverType = /scroll|view/i.test(timelineName) ? 'scroll' : 'time';
    const id = motionIdFor(animation, engine.toLowerCase(), `${ensureElementId(target)}:${keyframeName || animation.id || index}`);
    const iterations = rawTiming.iterations ?? 1;
    const behavior = motionBehavior({
      name: keyframeName || animation.id,
      id,
      driver: driverType,
      iterations,
    });
    const tracks = keyframeTracks(effect).map((track, trackIndex) => ({
      ...track,
      ownership: writerOwnership({
        clipId: id,
        animation,
        target,
        property: track.property,
        behavior,
        order: index + (trackIndex / 1000),
        writeModel: iterations === Infinity ? 'additive-base' : 'absolute',
        retargetable: typeof effect?.setKeyframes === 'function'
          && track.keyframes.some((keyframe) => Number(keyframe.offset) >= 0.999),
        sourceValue: track.keyframes.at(-1)?.value ?? null,
      }),
    }));
    const clip = {
      id,
      engine,
      // Name the clip after the thing on the page. "Animation 105" is an engine
      // fact and means nothing to whoever is editing.
      name: elementLabel(target) || keyframeName || animation.id || `Animation ${index + 1}`,
      editability: 'direct',
      driver: { type: driverType },
      trigger: { type: keyframeName ? 'css-rule' : 'runtime' },
      playState: animation.playState,
      currentTime: Number.isFinite(animation.currentTime) ? Math.round(animation.currentTime) : null,
      timing: {
        delay: finite(rawTiming.delay),
        duration: finite(computed.duration, finite(rawTiming.duration)),
        endDelay: finite(rawTiming.endDelay),
        iterations,
        direction: rawTiming.direction || 'normal',
        fill: rawTiming.fill || 'none',
        easing: rawTiming.easing || 'linear',
        yoyo: rawTiming.direction === 'alternate' || rawTiming.direction === 'alternate-reverse',
        repeatDelay: 0,
      },
      tracks,
      group: clipGroupMeta(animation, target, [target]),
      scroll: driverType === 'scroll' ? { start: 'timeline start', end: 'timeline end', scrub: true, pin: false, snap: false } : null,
      capabilities: { timing: true, easing: true, keyframes: true, trigger: false, scroll: driverType === 'scroll' },
      source: { engine, animationName: keyframeName || null, timeline: timelineName || null, writeback: 'native' },
    };
    motionRegistry.set(id, { type: 'browser', animation, target });
    return clip;
  }

  function gsapEditableTracks(animation, vars, target, animatedProps) {
    const gsap = window.gsap;
    const ease = typeof vars.ease === 'string' ? vars.ease : null;
    const endOnly = () => ({
      keyframes: false,
      tracks: animatedProps.map((property) => ({
        property,
        keyframes: [{ offset: 1, value: typeof vars[property] === 'function' ? '' : String(vars[property]), easing: ease }],
      })),
    });
    if (!gsap || typeof gsap.getProperty !== 'function' || typeof animation.progress !== 'function') {
      return endOnly();
    }
    // Sampling RENDERS the tween. suppressEvents silences callbacks, not plugin
    // side effects: a `clearProps` tween wipes style.cssText when it completes, and
    // restoring progress cannot rebuild unrelated inline styles. So snapshot every
    // target's inline style and put it back — inspection must never mutate the page.
    const touched = [];
    try {
      const list = typeof animation.targets === 'function' ? animation.targets() : [];
      list.forEach((item) => { if (item instanceof Element) touched.push([item, item.style.cssText]); });
    } catch (_) {}
    if (target instanceof Element && !touched.some(([item]) => item === target)) {
      touched.push([target, target.style.cssText]);
    }
    const restoreInlineStyles = () => {
      touched.forEach(([item, cssText]) => { try { item.style.cssText = cssText; } catch (_) {} });
    };

    let restore = null;
    try {
      const current = animation.progress();
      restore = Number.isFinite(current) ? current : 0;
      animation.progress(0, true);
      const startValues = animatedProps.map((property) => String(gsap.getProperty(target, property)));
      animation.progress(1, true);
      const endValues = animatedProps.map((property) => String(gsap.getProperty(target, property)));
      animation.progress(restore, true);
      restoreInlineStyles();
      return {
        keyframes: true,
        tracks: animatedProps.map((property, index) => ({
          property,
          keyframes: [
            { offset: 0, value: startValues[index], easing: ease },
            { offset: 1, value: endValues[index], easing: null },
          ],
        })),
      };
    } catch (_) {
      if (restore != null) { try { animation.progress(restore, true); } catch (_) {} }
      restoreInlineStyles();
      return endOnly();
    }
  }

  function gsapAnimationsFor(element) {
    try {
      const timeline = window.gsap && window.gsap.globalTimeline;
      if (!timeline || typeof timeline.getChildren !== 'function') return [];
      const owner = safeHost(element);
      return timeline.getChildren(true, true, true).flatMap((animation, index) => {
        const targets = (typeof animation.targets === 'function' ? animation.targets() : [])
          // A detached target no longer renders through this tween — its row
          // must list the standalone clone instead.
          .filter((target) => !(target instanceof Element) || !isDetached(animation, target));
        // Ownership mirrors the row model: a tween belongs to the host of its
        // own target — containers never absorb their children's tweens.
        const ownsTarget = targets.some((target) =>
          target === element ||
          (target instanceof Element && safeHost(target) === owner)
        );
        if (!ownsTarget) return [];
        const vars = animation.vars || {};
        const scrollTrigger = animation.scrollTrigger || vars.scrollTrigger || null;
        const engine = scrollTrigger ? 'ScrollTrigger' : 'GSAP';
        const primaryTarget = targets.find((target) => target instanceof Element) || element;
        const id = motionIdFor(animation, engine === 'GSAP' ? 'gsap' : 'scroll', `${ensureElementId(primaryTarget)}:${vars.id || index}`);
        const ignored = new Set([
          'id', 'parent', 'duration', 'delay', 'ease', 'repeat', 'repeatDelay', 'yoyo', 'scrollTrigger',
          'stagger', 'immediateRender', 'startAt', 'overwrite', 'runBackwards', 'lazy', 'paused', 'reversed',
          'callbackScope', 'onComplete', 'onInterrupt', 'onRepeat', 'onReverseComplete', 'onStart', 'onUpdate',
          // GSAP internal/config vars — never real animatable properties
          'force3D', 'data', 'autoRound', 'inherit', 'defaults', 'smoothChildTiming', 'keyframes', 'clearProps',
        ]);
        const animatedProps = Object.keys(vars)
          .filter((property) => !ignored.has(property));
        const sampled = gsapEditableTracks(animation, vars, primaryTarget, animatedProps);
        const group = clipGroupMeta(animation, primaryTarget, targets);
        const iterations = animation.repeat?.() === -1 ? Infinity : (Number.isFinite(animation.repeat?.()) ? animation.repeat() + 1 : 1);
        const driverType = scrollTrigger && primaryTarget instanceof HTMLMediaElement && animatedProps.includes('currentTime')
          ? 'media'
          : scrollTrigger ? 'scroll' : 'time';
        const behavior = motionBehavior({
          name: vars.id || scrollTrigger?.vars?.id || scrollTrigger?.id || elementLabel(primaryTarget),
          id,
          driver: driverType,
          iterations,
        });
        const order = finite(animation.globalTime?.(0), finite(animation.startTime?.(), index)) * 1000;
        const tracks = sampled.tracks.map((track, trackIndex) => {
          const rawValue = vars[track.property];
          const looping = iterations === Infinity;
          const writeModel = gsapWriteModel(rawValue, looping);
          const targetCount = Math.max(1, targets.filter((target) => target instanceof Element).length);
          const functionSupported = typeof rawValue !== 'function' || targetCount === 1;
          const scopeSafe = targetCount === 1;
          return {
            ...track,
            ownership: writerOwnership({
              clipId: id,
              animation,
              target: primaryTarget,
              property: track.property,
              behavior,
              order: order + (trackIndex / 1000),
              sequenceId: group.timelineId,
              writeModel,
              retargetable: sampled.keyframes && !vars.runBackwards && functionSupported && scopeSafe,
              sourceValue: safeSourceValue(rawValue),
              targetCount,
              stagger: vars.stagger != null ? { mode: 'staggered', targetCount } : null,
            }),
          };
        });
        const clip = {
          id,
          engine,
          name: elementLabel(primaryTarget) || vars.id || scrollTrigger?.vars?.id || scrollTrigger?.id || `Animation ${index + 1}`,
          editability: 'adapter',
          // A scroll-SCRUBBED video is the cleanest case of the whole model:
          // one track whose value is currentTime, driven by scroll → MEDIA.
          // Without a trigger it is just a timed seek — a plain time clip.
          driver: { type: driverType },
          trigger: {
            type: scrollTrigger ? 'scroll' : 'runtime',
            target: scrollTrigger?.trigger?.className || scrollTrigger?.trigger?.id || vars.scrollTrigger?.trigger?.className || vars.scrollTrigger?.trigger?.id || null,
          },
          playState: animation.paused?.() ? 'paused' : 'running',
          timing: {
            delay: Math.round((animation.delay?.() || 0) * 1000),
            duration: Math.round((animation.duration?.() || 0) * 1000),
            endDelay: 0,
            iterations,
            direction: animation.reversed?.() ? 'reverse' : 'normal',
            fill: 'both',
            easing: typeof vars.ease === 'string' ? vars.ease : 'power1.out',
            yoyo: Boolean(animation.yoyo?.()),
            repeatDelay: Math.round((animation.repeatDelay?.() || 0) * 1000),
          },
          tracks,
          group,
          scroll: scrollTrigger ? {
            start: String(scrollTrigger.start ?? scrollTrigger.vars?.start ?? 'top bottom'),
            end: String(scrollTrigger.end ?? scrollTrigger.vars?.end ?? 'bottom top'),
            scrub: Boolean(scrollTrigger.vars?.scrub ?? vars.scrollTrigger?.scrub),
            pin: Boolean(scrollTrigger.pin || (scrollTrigger.vars?.pin ?? vars.scrollTrigger?.pin)),
            snap: Boolean(scrollTrigger.vars?.snap ?? vars.scrollTrigger?.snap),
          } : null,
          // gsap.from(): vars hold the FROM, not the end — a keyframe write
          // labelled "end" would silently retarget the start. Read-only until
          // the writeback understands runBackwards.
          capabilities: { timing: true, easing: true, keyframes: sampled.keyframes && !vars.runBackwards, trigger: false, scroll: Boolean(scrollTrigger) },
          source: { engine, writeback: 'adapter' },
        };
        motionRegistry.set(id, {
          type: 'gsap',
          animation,
          scrollTrigger,
          target: primaryTarget,
          targets: targets.filter((target) => target instanceof Element),
        });
        return [clip];
      });
    } catch (_) {
      return [];
    }
  }

  // ---- Viewport-scoped motion rows -------------------------------------------------
  // The timeline lists what is ON SCREEN, identified by element (name + type), not
  // every animation object on the page. Scrolling the site changes the list, which is
  // what turns the site frame into a control surface rather than a viewer.

  function elementKind(element) {
    if (!(element instanceof Element)) return 'container';
    if (element.matches('img,picture')) return 'image';
    if (element.matches('video')) return 'video';
    if (element.matches('canvas')) return 'canvas';
    if (element.matches('svg')) return 'svg';
    if (element.matches(TEXT_BLOCK)) return 'text';
    return directText(element) ? 'text' : 'container';
  }

  function elementLabel(element) {
    // A row must read as a THING ON THE PAGE. For unnamed containers the first
    // meaningful class ("croptab-lottie") beats a bare tag ("div").
    const namedClass = Array.from(element.classList || [])
      .find((name) => !/^(w-|uncraft-|is-|has-)/.test(name) && name.length > 2);
    return element.getAttribute('aria-label')
      || element.getAttribute('alt')
      || directText(element).slice(0, 60)
      || element.id
      || namedClass
      || element.tagName.toLowerCase();
  }

  function intersectsViewport(element) {
    let rect = null;
    try { rect = element.getBoundingClientRect(); } catch (_) { return false; }
    if (!rect || (!rect.width && !rect.height)) return false;
    const height = window.innerHeight || document.documentElement.clientHeight || 0;
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    return rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width;
  }

  function visibilityFor(element) {
    let rect = null;
    try { rect = element?.getBoundingClientRect?.(); } catch (_) {}
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!rect || !rect.width || !rect.height || !viewportWidth || !viewportHeight) {
      return { ratio: 0, visibleWidth: 0, visibleHeight: 0, meaningful: false, reason: 'empty' };
    }
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const ratio = (visibleWidth * visibleHeight) / Math.max(1, rect.width * rect.height);
    if (ratio >= 0.25) return { ratio, visibleWidth, visibleHeight, meaningful: true, reason: 'ratio' };
    if (visibleWidth >= 32 && visibleHeight >= 32) {
      return { ratio, visibleWidth, visibleHeight, meaningful: true, reason: 'pixels' };
    }
    return {
      ratio,
      visibleWidth,
      visibleHeight,
      meaningful: false,
      reason: visibleWidth && visibleHeight ? 'sliver' : 'offscreen',
    };
  }

  function pageMetrics() {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const scrollHeight = Math.max(viewportHeight, document.documentElement.scrollHeight || 0);
    return {
      scrollY: Math.max(0, Math.round(window.scrollY || 0)),
      viewportHeight,
      scrollHeight,
      maxScroll: Math.max(0, scrollHeight - viewportHeight),
    };
  }

  // Split-text runtimes animate every letter/word as its own element — often
  // with NO class at all (real Webflow: unnamed letter divs inside
  // gsap_split_word wrappers). A fragment is recognised structurally: it has a
  // split-ish class, or it is a short piece of text sitting among short
  // siblings. The row host is the first non-fragment ancestor (the text block).
  function splitFragmentHost(element) {
    // Whatever the split dialect did (classed .char/.word, BARE divs, masks),
    // an animated fragment inside a heading/paragraph belongs to THE TEXT —
    // one row per h2/p, never one per letter (live fixture had one-letter rows
    // from classless SplitText chars).
    try {
      // Media/embed elements inside rich text are THINGS of their own — only
      // text-ish fragments roll up into the block.
      if (!element.matches?.('img,picture,video,canvas,svg,svg *,iframe,figure,object,embed')) {
        const textBlock = element.closest?.('h1,h2,h3,h4,h5,h6,p,blockquote');
        if (textBlock) return textBlock;
      }
    } catch (_) {}
    const splitClassed = (node) => {
      try { return node.matches(SPLIT_TOKEN) || /(^|[\s_-])split/i.test(String(node.className || '')); } catch (_) { return false; }
    };
    const shortText = (node) => {
      // Cheap reject before serializing text: a real fragment is a tiny node —
      // never a container with many children (textContent walks the subtree).
      if (node.childElementCount > 8) return false;
      const text = (node.textContent || '').trim();
      return text.length > 0 && text.length < 12;
    };
    const isFragment = (node) => {
      if (!(node instanceof Element) || node.matches('section,article,main,body,html')) return false;
      // A text ROOT is never a fragment, even when the split marker sits ON it
      // ([text-split] on the heading is the common Webflow pattern). Climbing
      // past it would fuse neighbouring text blocks into one row.
      if (node.matches(TEXT_BLOCK) || node.matches('[text-split],[data-split-text],[text-split-delay],[aria-label]')) return false;
      if (splitClassed(node)) return true;
      const parent = node.parentElement;
      if (!parent) return false;
      // An unnamed piece INSIDE a split wrapper is a fragment regardless of
      // siblings — a one-letter word has a single child in its wrapper.
      if (splitClassed(parent)) return true;
      if (!shortText(node)) return false;
      const kids = Array.from(parent.children);
      return kids.length >= 2 && kids.filter(shortText).length >= Math.ceil(kids.length * 0.6);
    };
    let host = element;
    let depth = 0;
    while (depth < 8 && isFragment(host) && host.parentElement && host.parentElement !== document.body) {
      host = host.parentElement;
      depth += 1;
    }
    return host;
  }

  // ONE pass over both engines per emit. Per-member timeline walks are
  // quadratic — with hundreds of animated fragments (345 on farmminerals) a
  // single debounced emit would re-scan every tween hundreds of times inside
  // the third-party page.
  function buildMotionSummaryIndex() {
    const index = new Map();
    const entryFor = (element) => {
      if (!index.has(element)) {
        index.set(element, {
          count: 0, engines: [], scrollDriven: false, timeDriven: false, scrollExotic: false, loop: false,
          delayMs: Infinity, endMs: 0, marks: new Set(),
          scrollStart: Infinity, scrollEnd: -Infinity,
          introStartMs: Infinity, introEndMs: -Infinity, introEligible: false,
          links: new Set(), animKeys: new Set(),
        });
      }
      return index.get(element);
    };
    const addEngine = (record, name) => { if (!record.engines.includes(name)) record.engines.push(name); };
    const envelope = (record, delay, duration) => {
      record.delayMs = Math.min(record.delayMs, Math.max(0, delay));
      record.endMs = Math.max(record.endMs, Math.max(0, delay) + Math.max(0, duration));
    };
    try {
      (typeof document.getAnimations === 'function' ? document.getAnimations() : []).forEach((animation, animationIndex) => {
        const target = animation?.effect?.target;
        if (!(target instanceof Element)) return;
        const record = entryFor(target);
        record.count += 1;
        // Anonymous animations need an index in the seed — a shared fallback
        // string would mint ONE id for two different animations on the same
        // element, and the registry would route edits to the wrong one.
        record.animKeys.add(motionIdFor(animation, 'css', `${ensureElementId(target)}:${animation.animationName || animation.id || `anim-${animationIndex}`}`));
        record.timeDriven = true;
        addEngine(record, 'CSS');
        const timing = animation.effect?.getTiming?.() || {};
        if (timing.iterations === Infinity) record.loop = true;
        const computed = animation.effect?.getComputedTiming?.() || {};
        envelope(record, finite(timing.delay), finite(computed.duration, finite(timing.duration)));
        try {
          (animation.effect?.getKeyframes?.() || []).forEach((frame) => {
            record.marks.add(Number(finite(frame.computedOffset, finite(frame.offset, 0)).toFixed(3)));
          });
        } catch (_) {}
      });
    } catch (_) {}
    try {
      (window.gsap?.globalTimeline?.getChildren?.(true, true, true) || []).forEach((tween, tweenIndex) => {
        const rawTargets = typeof tween.targets === 'function' ? tween.targets() : [];
        // Detached targets no longer render through this tween — skip them.
        const targets = rawTargets.filter((target) => !(target instanceof Element) || !isDetached(tween, target));
        const elementTargets = targets.filter((target) => target instanceof Element);
        if (!elementTargets.length) return;
        const trigger = tween.scrollTrigger || tween.vars?.scrollTrigger || null;
        // Indexed fallback: two anonymous tweens on one element must never
        // share an id (the WeakMap dedupes per OBJECT, not per seed).
        const tweenKey = motionIdFor(tween, trigger ? 'scroll' : 'gsap', `${ensureElementId(elementTargets[0])}:${tween.vars?.id || `tween-${tweenIndex}`}`);
        // One TIME tween animating SEVERAL elements chains their rows together —
        // editing it moves all of them. Surface that link so the UI can show
        // (and break) the chain. Scroll-driven groups are not offered: a clone
        // without the ScrollTrigger would freeze instead of animating.
        const sharedLinkId = !trigger && elementTargets.length > 1 ? tweenKey : null;
        targets.forEach((target) => {
          if (!(target instanceof Element)) return;
          const record = entryFor(target);
          record.count += 1;
          record.animKeys.add(tweenKey);
          if (!trigger) record.timeDriven = true;
          if (tween.repeat?.() === -1) record.loop = true;
          if (sharedLinkId) record.links.add(sharedLinkId);
          if (!trigger) {
            const span = introTweenSpans.get(tween);
            if (span) {
              record.introEligible = true;
              record.introStartMs = Math.min(record.introStartMs, span.startMs);
              record.introEndMs = Math.max(record.introEndMs, span.endMs);
            }
          }
          if (trigger) {
            record.scrollDriven = true;
            // A horizontal or custom-scroller trigger's pixels belong to another
            // axis/domain — never plot or edit them against the page's vertical ruler.
            const exotic = Boolean(trigger.vars?.horizontal || trigger.horizontal)
              || (trigger.scroller != null && trigger.scroller !== window
                && trigger.scroller !== document.documentElement && trigger.scroller !== document.body);
            if (exotic) record.scrollExotic = true;
            else {
              if (Number.isFinite(trigger.start)) record.scrollStart = Math.min(record.scrollStart, trigger.start);
              if (Number.isFinite(trigger.end)) record.scrollEnd = Math.max(record.scrollEnd, trigger.end);
            }
          }
          addEngine(record, trigger ? 'ScrollTrigger' : 'GSAP');
          envelope(record, finite(tween.delay?.()) * 1000, finite(tween.duration?.()) * 1000);
          record.marks.add(0);
          record.marks.add(1);
        });
      });
    } catch (_) {}
    return index;
  }

  function motionHosts() {
    // One row per letter is unreadable — attribute each animated fragment to
    // its text root and merge the members' summaries into one legible row.
    const index = buildMotionSummaryIndex();
    const hosts = new Map();
    index.forEach((memberSummary, element) => {
      let host = element;
      try { host = splitFragmentHost(element); } catch (_) {}
      if (!hosts.has(host)) hosts.set(host, []);
      hosts.get(host).push(memberSummary);
    });
    return hosts;
  }

  function resolveHostRowId(element) {
    // The click resolver (textRoot/chooseElement) and the row keying
    // (splitFragmentHost) can land on DIFFERENT nodes of the same widget.
    // Resolve here, where the DOM is reachable — the UI only compares ids.
    try {
      // FIRST match against the rows the UI is actually displaying: host
      // attribution can DRIFT between emits (runtimes add split markers
      // lazily), so a fresh index may name a host the timeline never listed —
      // verified live on the fixture, where that mismatch kept every row dark.
      for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
        if (lastRowHosts.has(node)) return ensureElementId(node);
      }
      const hosts = motionHosts();
      if (!hosts.size && !lastRowHosts.size) return null;
      // Walk from the element ITSELF: a split fragment reaches its host by
      // ancestry anyway, and starting from splitFragmentHost() could jump OVER
      // an element that is already a row host.
      for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
        if (hosts.has(node)) return ensureElementId(node);
      }
      const inside = new Set();
      lastRowHosts.forEach((host) => { if (element.contains(host)) inside.add(host); });
      hosts.forEach((_members, host) => { if (element.contains(host)) inside.add(host); });
      // A wrapper holding SEVERAL animated hosts maps to no single row —
      // picking one arbitrarily would contradict the ownership model.
      if (inside.size !== 1) return null;
      let found = null;
      inside.forEach((host) => { found = host; });
      return found ? ensureElementId(found) : null;
    } catch (_) { return null; }
  }

  function viewportMotionRows(page) {
    // Full-page inventory (Figma Motion model): every animated element is a
    // row, ordered by page position. Offscreen rows are FLAGGED, not hidden —
    // hiding them re-scoped the list on every scrub, which made strips appear
    // to move with the playhead.
    const hosts = motionHosts();
    const emittedHosts = new Set();
    const hostByRowId = new Map();
    const rows = [];
    hosts.forEach((members, element) => {
      // A row is a PLACE on the page. Detached or laid-out-to-nothing targets
      // (display:none, unmounted runtime clones) have no place — listing them
      // would resurrect the junk the old viewport filter hid by accident.
      if (!element.isConnected) return;
      let box = null;
      try { box = element.getBoundingClientRect(); } catch (_) { return; }
      if (!box || (!box.width && !box.height)) return;
      const inViewport = intersectsViewport(element);
      const merged = members.reduce((accumulator, item) => accumulator ? {
        count: accumulator.count + item.count,
        engines: Array.from(new Set([...accumulator.engines, ...item.engines])),
        scrollDriven: accumulator.scrollDriven || item.scrollDriven,
        timeDriven: accumulator.timeDriven || item.timeDriven,
        scrollExotic: accumulator.scrollExotic || item.scrollExotic,
        loop: accumulator.loop || item.loop,
        delayMs: Math.min(accumulator.delayMs, item.delayMs),
        endMs: Math.max(accumulator.endMs, item.endMs),
        marks: new Set([...accumulator.marks, ...item.marks]),
        scrollStart: Math.min(accumulator.scrollStart, item.scrollStart),
        scrollEnd: Math.max(accumulator.scrollEnd, item.scrollEnd),
        introStartMs: Math.min(accumulator.introStartMs, item.introStartMs),
        introEndMs: Math.max(accumulator.introEndMs, item.introEndMs),
        introEligible: accumulator.introEligible || item.introEligible,
        links: new Set([...accumulator.links, ...item.links]),
        animKeys: new Set([...accumulator.animKeys, ...item.animKeys]),
      } : item, null);
      if (!merged || !merged.count) return;
      const summary = {
        // DISTINCT animations, not target-portions: one tween staggering 40
        // letters is ONE animation — a chevron promising 40 was a lie.
        count: merged.animKeys.size || merged.count,
        engines: merged.engines,
        driver: merged.scrollDriven ? 'scroll' : 'time',
        timeDriven: merged.timeDriven === true,
        loop: merged.loop === true,
        delayMs: Number.isFinite(merged.delayMs) ? merged.delayMs : 0,
        durationMs: Math.max(0, merged.endMs - (Number.isFinite(merged.delayMs) ? merged.delayMs : 0)),
        marks: Array.from(merged.marks).sort((a, b) => a - b),
        scrollStart: Number.isFinite(merged.scrollStart) ? Math.round(merged.scrollStart) : null,
        scrollEnd: Number.isFinite(merged.scrollEnd) ? Math.round(merged.scrollEnd) : null,
        scrollEditable: merged.scrollDriven && !merged.scrollExotic
          && Number.isFinite(merged.scrollStart) && Number.isFinite(merged.scrollEnd),
        introEligible: merged.introEligible === true && !merged.scrollDriven,
        introStartMs: Number.isFinite(merged.introStartMs) ? Math.round(merged.introStartMs) : null,
        introEndMs: Number.isFinite(merged.introEndMs) ? Math.round(merged.introEndMs) : null,
        links: Array.from(merged.links),
      };
      let top = 0;
      try { top = Math.round(element.getBoundingClientRect().top); } catch (_) {}
      // Where the strip lives on the page-scroll ruler. Scroll-driven rows use
      // the trigger's own pixels; time-driven rows are placed at the scroll
      // point where the element enters the viewport (a point, not a range).
      // That reveal point is LATCHED on first sight: rect-derived positions
      // drift on pinned/parallax pages, and re-deriving them per emit made
      // strips crawl along with the scrubber.
      const rowId = ensureElementId(element);
      let scrollStart;
      if (summary.driver === 'scroll' && summary.scrollStart != null) {
        scrollStart = summary.scrollStart;
      } else if (revealAtCache.has(rowId)) {
        scrollStart = revealAtCache.get(rowId);
      } else {
        scrollStart = Math.max(0, Math.min(page.maxScroll, top + page.scrollY - page.viewportHeight));
        revealAtCache.set(rowId, scrollStart);
      }
      const scrollEnd = summary.driver === 'scroll'
        ? (summary.scrollEnd != null ? summary.scrollEnd : Math.min(page.maxScroll, scrollStart + page.viewportHeight))
        : null;
      emittedHosts.add(element);
      hostByRowId.set(rowId, element);
      rows.push({
        elementId: rowId,
        label: elementLabel(element),
        kind: elementKind(element),
        top,
        inViewport,
        count: summary.count,
        engines: summary.engines,
        driver: summary.driver,
        timeDriven: summary.timeDriven,
        loop: summary.loop,
        delayMs: summary.delayMs,
        durationMs: summary.durationMs,
        marks: summary.marks,
        scrollStart,
        scrollEnd,
        scrollEditable: summary.scrollEditable === true,
        // Intro rows live on the TIME segment before the page-scroll axis:
        // load-time animations on elements that were on screen at scroll 0.
        isIntro: summary.introEligible && summary.driver === 'time' && scrollStart === 0
          && summary.introStartMs != null && summary.introEndMs != null,
        introStartMs: summary.introStartMs,
        introEndMs: summary.introEndMs,
        links: summary.links,
      });
    });

    // The list itself must be STABLE while the user scrubs: rows are ordered
    // by ARRIVAL — a row keeps its slot forever, and animations the runtime
    // mints later APPEND at the bottom, never insert mid-list (inserting at
    // their axis position read as "strips relocating" while scrubbing).
    // Within one snapshot, newcomers enter in page order.
    rows.sort((a, b) => ((a.scrollStart || 0) - (b.scrollStart || 0)) || (a.top - b.top));
    rows.forEach((row) => {
      const existing = rowCache.get(row.elementId);
      rowCache.set(row.elementId, { ...row, seq: existing ? existing.seq : rowSeq++, host: hostByRowId.get(row.elementId) || existing?.host || null });
    });
    const output = [];
    rowCache.forEach((entry, id) => {
      if (entry.host && !entry.host.isConnected) {
        rowCache.delete(id);
        return;
      }
      if (entry.host) emittedHosts.add(entry.host);
      const { seq, host, ...row } = entry;
      // Refresh visibility for cached rows that were not in this snapshot.
      if (host) row.inViewport = intersectsViewport(host);
      output.push({ row, seq });
    });
    lastRowHosts = emittedHosts;
    return output
      .sort((a, b) => a.seq - b.seq)
      .map((entry) => entry.row);
  }

  function emitViewportMotion() {
    // Idempotent, and repeated here because GSAP may finish loading AFTER the
    // bridge was installed.
    syncEditConventions();
    // Latch the load-time schedule BEFORE anything replays or scrubs it — the
    // intro lane's positions must come from the page's own opening sequence.
    registerIntroTimeline();
    const page = pageMetrics();
    // A real layout change (content grew/shrank) invalidates latched reveal
    // points; plain scrolling never does.
    // Pin-spacers make scrollHeight jitter by a few px while scrubbing — only a
    // SUBSTANTIAL change (>2% of the page) is a real layout change worth
    // re-deriving latched positions for.
    const heightDelta = Math.abs((page.scrollHeight || 0) - lastKnownScrollHeight);
    if (lastKnownScrollHeight === 0 || heightDelta > Math.max(48, (page.scrollHeight || 0) * 0.02)) {
      revealAtCache.clear();
      rowCache.clear();
      lastKnownScrollHeight = page.scrollHeight || 0;
    }
    emit('viewport-motion-changed', { page, rows: viewportMotionRows(page) });
  }

  function safeHost(node) {
    try { return splitFragmentHost(node); } catch (_) { return node; }
  }

  function inspectMotion(element) {
    // A clip belongs to ONE row: the host of its own target. Without this,
    // container rows re-listed every descendant's animation (an icon layer
    // showing the neighbouring text's tween).
    const owner = safeHost(element);
    const owns = (target) => target === element
      || (target instanceof Element && safeHost(target) === owner);
    const native = typeof element.getAnimations === 'function'
      ? element.getAnimations({ subtree: true })
        .filter((animation) => owns(animation?.effect?.target))
        .map((animation, index) => browserMotionClip(animation, index, element))
      : [];
    return [...native, ...gsapAnimationsFor(element)];
  }

  function emitEditState(next, details = {}) {
    editState = next;
    document.documentElement.dataset.uncraftEditState = next;
    emit('edit-state-changed', {
      state: next,
      selectionId: selectedId,
      ...details,
    });
  }

  function motionIsLooping(clip) {
    return clip?.timing?.iterations === Infinity
      || clip?.timing?.iterations === 'Infinity'
      || clip?.timing?.playbackMode === 'loop'
      || clip?.timing?.playbackMode === 'ping-pong';
  }

  function writerTargetsAreScoped(record, element) {
    if (!record || record.type === 'browser') return true;
    let targets = [];
    try { targets = record.animation?.targets?.().filter((target) => target instanceof Element) || []; } catch (_) {}
    if (targets.length <= 1) return true;
    return targets.every((target) => target === element || element.contains(target));
  }

  function browserCycleDuration(animation) {
    const timing = animation.effect?.getTiming?.() || {};
    const computed = animation.effect?.getComputedTiming?.() || {};
    const duration = Math.max(1, finite(computed.duration, finite(timing.duration, 1)));
    return Math.max(1, finite(timing.delay) + duration + finite(timing.endDelay));
  }

  function captureWriter(clip, element) {
    const record = motionRegistry.get(clip.id);
    if (!record || !writerTargetsAreScoped(record, element)) return null;
    const loop = motionIsLooping(clip);
    if (record.type === 'browser') {
      const animation = record.animation;
      const duration = browserCycleDuration(animation);
      const rawTime = finite(animation.currentTime);
      return {
        motionId: clip.id,
        type: 'browser',
        animation,
        loop,
        progress: Math.max(0, Math.min(1, (rawTime > duration ? rawTime % duration : rawTime) / duration)),
        currentTime: animation.currentTime,
        playbackRate: animation.playbackRate,
        playState: animation.playState,
        endTime: (() => {
          const timing = animation.effect?.getTiming?.() || {};
          const computed = animation.effect?.getComputedTiming?.() || {};
          const activeDuration = finite(computed.activeDuration, finite(computed.duration, finite(timing.duration, 1)) * Math.max(1, finite(timing.iterations, 1)));
          return Math.max(0, finite(computed.endTime, finite(timing.delay) + activeDuration + finite(timing.endDelay)));
        })(),
      };
    }
    const animation = record.animation;
    const trigger = record.scrollTrigger || animation.scrollTrigger || null;
    return {
      motionId: clip.id,
      type: 'gsap',
      animation,
      trigger,
      loop,
      progress: Math.max(0, Math.min(1, finite(animation.progress?.()))),
      totalProgress: finite(animation.totalProgress?.(), finite(animation.progress?.())),
      time: finite(animation.time?.()),
      totalTime: finite(animation.totalTime?.(), finite(animation.time?.())),
      paused: Boolean(animation.paused?.()),
      reversed: Boolean(animation.reversed?.()),
      timeScale: finite(animation.timeScale?.(), 1) || 1,
      triggerProgress: trigger ? finite(trigger.progress) : null,
      triggerEnabled: trigger ? trigger.enabled !== false : null,
    };
  }

  function applyWriterSettlement(writer, freezeCurrent = false, restoreFrozenFrame = false) {
    if (writer.type === 'browser') {
      writer.animation.pause?.();
      if (restoreFrozenFrame) writer.animation.currentTime = writer.currentTime;
      if (!writer.loop && !freezeCurrent) writer.animation.currentTime = writer.endTime;
      return;
    }
    writer.trigger?.disable?.(false, false);
    writer.animation.pause?.();
    if (restoreFrozenFrame) {
      if (typeof writer.animation.totalTime === 'function') writer.animation.totalTime(writer.totalTime, true);
      else if (typeof writer.animation.time === 'function') writer.animation.time(writer.time, true);
      else writer.animation.progress?.(writer.progress, true);
    }
    if (!writer.loop && !freezeCurrent) {
      if (typeof writer.animation.totalProgress === 'function') writer.animation.totalProgress(1, true);
      else writer.animation.progress?.(1, true);
    }
  }

  function restoreWriter(writer) {
    if (writer.type === 'browser') {
      if (Number.isFinite(writer.playbackRate)) writer.animation.playbackRate = writer.playbackRate;
      writer.animation.currentTime = writer.currentTime;
      if (writer.playState === 'running') writer.animation.play?.();
      else writer.animation.pause?.();
      return;
    }
    if (Number.isFinite(writer.timeScale)) writer.animation.timeScale?.(writer.timeScale);
    writer.animation.reversed?.(writer.reversed);
    if (typeof writer.animation.totalTime === 'function') writer.animation.totalTime(writer.totalTime, true);
    else if (typeof writer.animation.time === 'function') writer.animation.time(writer.time, true);
    else writer.animation.progress?.(writer.progress, true);
    if (writer.trigger && writer.triggerEnabled) writer.trigger.enable?.(false, false);
    writer.trigger?.update?.();
    if (writer.paused) writer.animation.pause?.();
    else writer.animation.play?.();
  }

  function restoreScopedSettlement() {
    const settlement = scopedSettlement;
    scopedSettlement = null;
    if (!settlement) return null;
    settlement.writers.slice().reverse().forEach((writer) => {
      try { restoreWriter(writer); } catch (_) {}
    });
    return settlement;
  }

  function reapplyScopedSettlement(settlement) {
    if (!settlement) return false;
    try {
      settlement.writers.forEach((writer) => applyWriterSettlement(
        writer,
        settlement.manualFrame === true,
        writer.loop || settlement.manualFrame === true,
      ));
      scopedSettlement = settlement;
      emitEditState('editing-frozen', {
        operationId: settlement.operationId,
        loop: settlement.loop,
        progress: settlement.writers.find((writer) => writer.loop)?.progress ?? null,
        manualFrame: settlement.manualFrame === true,
      });
      emitTimelineState(true);
      return true;
    } catch (_) {
      scopedSettlement = null;
      return false;
    }
  }

  function settlementIdentity(elementId, clips) {
    return `${elementId}:${clips.map((clip) => clip.id).sort().join(',')}`;
  }

  function settleSelection(element, { recoveryAttempt = 0 } = {}) {
    if (mode !== 'edit' || scrubActive || !element || ensureElementId(element) !== selectedId) return;
    const visibility = visibilityFor(element);
    const clips = inspectMotion(element);
    const identity = settlementIdentity(selectedId, clips);
    if (scopedSettlement?.identity === identity) {
      const loopWriter = scopedSettlement.writers.find((writer) => writer.loop);
      emitEditState('editing-frozen', {
        operationId: scopedSettlement.operationId,
        loop: scopedSettlement.loop,
        progress: loopWriter?.progress ?? 1,
        visibility,
      });
      emit('selection-settled', {
        elementId: selectedId,
        operationId: scopedSettlement.operationId,
        loop: scopedSettlement.loop,
        progress: loopWriter?.progress ?? 1,
        writerCount: scopedSettlement.writers.length,
        visibility,
        duplicate: true,
      });
      return;
    }
    if (!visibility.meaningful || !clips.length) {
      emitEditState('editing-frozen', {
        operationId: null,
        loop: clips.some(motionIsLooping),
        reason: visibility.meaningful ? 'no-motion' : 'not-meaningfully-visible',
        visibility,
      });
      emit('selection-settlement-skipped', {
        elementId: selectedId,
        reason: visibility.meaningful ? 'no-motion' : 'not-meaningfully-visible',
        visibility,
      });
      return;
    }

    const writers = clips.map((clip) => captureWriter(clip, element));
    if (writers.some((writer) => !writer)) {
      emitEditState('editing-frozen', { reason: 'shared-writer', loop: clips.some(motionIsLooping), visibility });
      emit('selection-settlement-skipped', { elementId: selectedId, reason: 'shared-writer', visibility });
      return;
    }

    const operationId = `settlement-${++settlementSequence}`;
    emitEditState('settling', { operationId, visibility });
    const startedAt = Date.now();
    try {
      restoreScopedSettlement();
      writers
        .sort((first, second) => {
          const firstClip = clips.find((clip) => clip.id === first.motionId);
          const secondClip = clips.find((clip) => clip.id === second.motionId);
          const end = (clip) => finite(clip?.timing?.delay) + finite(clip?.timing?.duration) + finite(clip?.timing?.endDelay);
          return end(firstClip) - end(secondClip);
        })
        .forEach((writer) => applyWriterSettlement(writer));
      if (Date.now() - startedAt > 800) throw bridgeError('settlement_timeout', 'Settlement exceeded its time bound.');
      scopedSettlement = {
        identity,
        elementId: selectedId,
        operationId,
        writers,
        loop: writers.some((writer) => writer.loop),
        scrollY: Math.max(0, finite(window.scrollY)),
      };
      const loopWriter = writers.find((writer) => writer.loop);
      emitEditState('editing-frozen', {
        operationId,
        loop: scopedSettlement.loop,
        progress: loopWriter?.progress ?? 1,
        visibility,
      });
      emit('selection-settled', {
        elementId: selectedId,
        operationId,
        loop: scopedSettlement.loop,
        progress: loopWriter?.progress ?? 1,
        writerCount: writers.length,
        visibility,
      });
      emitTimelineState(true);
    } catch (error) {
      writers.slice().reverse().forEach((writer) => { try { restoreWriter(writer); } catch (_) {} });
      const code = error?.code || 'settlement_failed';
      emitEditState('recovering', { operationId, code });
      emit('selection-settlement-recovering', { elementId: selectedId, operationId, code });
      if (recoveryTimer) clearTimeout(recoveryTimer);
      if (recoveryAttempt < 1) {
        recoveryTimer = setTimeout(() => {
          recoveryTimer = null;
          if (mode === 'edit' && selectedId === ensureElementId(element)) settleSelection(element, { recoveryAttempt: 1 });
        }, 160);
      } else {
        emitEditState('editing-frozen', { operationId, code, reason: 'recovery-exhausted' });
      }
    }
  }

  function freezeSelectionAtCurrent() {
    const element = findElement(selectedId);
    if (!element || mode !== 'edit') return;
    restoreScopedSettlement();
    const visibility = visibilityFor(element);
    const clips = inspectMotion(element);
    const writers = clips.map((clip) => captureWriter(clip, element));
    if (!visibility.meaningful || !writers.length || writers.some((writer) => !writer)) {
      emitEditState('editing-frozen', {
        loop: clips.some(motionIsLooping),
        reason: visibility.meaningful ? 'shared-writer' : 'not-meaningfully-visible',
      });
      return;
    }
    writers.forEach((writer) => applyWriterSettlement(writer, true));
    const operationId = `scrub-freeze-${++settlementSequence}`;
    scopedSettlement = {
      identity: `${settlementIdentity(selectedId, clips)}:manual:${operationId}`,
      elementId: selectedId,
      operationId,
      writers,
      loop: writers.some((writer) => writer.loop),
      scrollY: Math.max(0, finite(window.scrollY)),
      manualFrame: true,
    };
    emitEditState('editing-frozen', {
      operationId,
      loop: scopedSettlement.loop,
      progress: writers.find((writer) => writer.loop)?.progress ?? null,
      manualFrame: true,
    });
  }

  function editableKeyframes(effect) {
    if (!effect || typeof effect.getKeyframes !== 'function') return [];
    return effect.getKeyframes().map((frame) => {
      const { computedOffset, ...editable } = frame;
      return {
        ...editable,
        offset: finite(frame.offset, finite(computedOffset)),
      };
    });
  }

  function applyBrowserKeyframe(effect, property, descriptor) {
    if (typeof effect?.setKeyframes !== 'function') throw new Error('This animation does not expose editable keyframes.');
    const offset = Math.max(0, Math.min(1, Number(descriptor?.offset) || 0));
    const frames = editableKeyframes(effect);
    const index = frames.findIndex((frame) => Math.abs(finite(frame.offset) - offset) < 0.0005);
    const ignored = new Set(['offset', 'easing', 'composite']);

    if (descriptor?.exists === false) {
      if (index < 0) return;
      delete frames[index][property];
      const hasAnimatedValue = Object.keys(frames[index]).some((key) => !ignored.has(key));
      if (!hasAnimatedValue) frames.splice(index, 1);
    } else {
      const frame = index >= 0 ? frames[index] : { offset };
      frame[property] = String(descriptor?.value ?? '');
      if (Object.prototype.hasOwnProperty.call(descriptor || {}, 'easing')) {
        if (descriptor.easing) frame.easing = descriptor.easing;
        else delete frame.easing;
      }
      if (index < 0) frames.push(frame);
    }

    frames.sort((a, b) => finite(a.offset) - finite(b.offset));
    effect.setKeyframes(frames);
  }

  function runtimeNumber(value, fallback = 0) {
    const result = Number.parseFloat(String(value ?? ''));
    return Number.isFinite(result) ? result : fallback;
  }

  function runtimeRound(value) {
    if (!Number.isFinite(value)) return 0;
    const result = Math.round(value * 1000000) / 1000000;
    return Object.is(result, -0) ? 0 : result;
  }

  function runtimeArgs(value) {
    return String(value || '').trim().split(/\s*,\s*|\s+/).filter(Boolean);
  }

  function parseRuntimeTransform(value) {
    const source = String(value || 'none').trim() || 'none';
    if (source === 'none') return { format: 'functions', operations: [] };
    if (/matrix3d|translate3d|translateZ|scale3d|scaleZ|rotate3d|rotateX|rotateY|perspective|var\(|calc\(/i.test(source)) return null;
    const matrix = source.match(/^matrix\(\s*([^)]+)\)$/i);
    if (matrix) {
      const values = runtimeArgs(matrix[1]).map(Number);
      if (values.length !== 6 || values.some((item) => !Number.isFinite(item))) return null;
      const [a, b, c, d, e, f] = values;
      const scaleX = Math.hypot(a, b);
      if (scaleX < 1e-9) return null;
      return {
        format: 'matrix',
        components: {
          translateX: e,
          translateY: f,
          scaleX,
          scaleY: ((a * d) - (b * c)) / scaleX,
          rotate: Math.atan2(b, a) * (180 / Math.PI),
          skewX: Math.atan2((a * c) + (b * d), scaleX * scaleX) * (180 / Math.PI),
          skewY: 0,
        },
      };
    }
    const operations = [];
    const pattern = /([a-zA-Z][a-zA-Z0-9]*)\(([^()]*)\)/g;
    let consumed = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (source.slice(consumed, match.index).trim()) return null;
      if (!['translate', 'translateX', 'translateY', 'scale', 'scaleX', 'scaleY', 'rotate', 'skew', 'skewX', 'skewY'].includes(match[1])) return null;
      operations.push({ type: match[1], args: runtimeArgs(match[2]) });
      consumed = pattern.lastIndex;
    }
    if (!operations.length || source.slice(consumed).trim()) return null;
    return { format: 'functions', operations };
  }

  function runtimeComponentValue(value, component) {
    const parsed = parseRuntimeTransform(value);
    if (!parsed) return null;
    if (parsed.format === 'matrix') {
      const numeric = parsed.components[component];
      if (component.startsWith('translate')) return `${runtimeRound(numeric)}px`;
      if (component === 'rotate' || component.startsWith('skew')) return `${runtimeRound(numeric)}deg`;
      return String(runtimeRound(numeric));
    }
    const defaultValue = component.startsWith('scale') ? '1'
      : component.startsWith('translate') ? '0px' : '0deg';
    for (let index = parsed.operations.length - 1; index >= 0; index -= 1) {
      const operation = parsed.operations[index];
      if (operation.type === component) return operation.args[0] || defaultValue;
      if (operation.type === 'translate' && component === 'translateX') return operation.args[0] || '0px';
      if (operation.type === 'translate' && component === 'translateY') return operation.args[1] || '0px';
      if (operation.type === 'scale' && component === 'scaleX') return operation.args[0] || '1';
      if (operation.type === 'scale' && component === 'scaleY') return operation.args[1] || operation.args[0] || '1';
      if (operation.type === 'skew' && component === 'skewX') return operation.args[0] || '0deg';
      if (operation.type === 'skew' && component === 'skewY') return operation.args[1] || '0deg';
    }
    return defaultValue;
  }

  function runtimeValueWithUnit(value, fallbackUnit = '') {
    const text = String(value ?? '').trim();
    if (!text) return `0${fallbackUnit}`;
    return /[a-z%]$/i.test(text) || !fallbackUnit ? text : `${text}${fallbackUnit}`;
  }

  function updateRuntimeTransform(value, component, nextValue) {
    const parsed = parseRuntimeTransform(value);
    if (!parsed) throw bridgeError('unsafe_transform', 'This transform cannot be decomposed safely.');
    if (parsed.format === 'matrix') {
      const components = parsed.components;
      components[component] = runtimeNumber(nextValue, component.startsWith('scale') ? 1 : 0);
      const radians = components.rotate * (Math.PI / 180);
      const skew = Math.tan(components.skewX * (Math.PI / 180));
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const a = cos * components.scaleX;
      const b = sin * components.scaleX;
      const c = ((cos * skew) - sin) * components.scaleY;
      const d = ((sin * skew) + cos) * components.scaleY;
      return `matrix(${[a, b, c, d, components.translateX, components.translateY].map(runtimeRound).join(', ')})`;
    }
    const unit = component.startsWith('translate') ? 'px'
      : component === 'rotate' || component.startsWith('skew') ? 'deg' : '';
    const formatted = runtimeValueWithUnit(nextValue, unit);
    let updated = false;
    for (let index = parsed.operations.length - 1; index >= 0; index -= 1) {
      const operation = parsed.operations[index];
      if (operation.type === component) {
        operation.args[0] = formatted;
        updated = true;
        break;
      }
      if (operation.type === 'translate' && ['translateX', 'translateY'].includes(component)) {
        operation.args = [
          component === 'translateX' ? formatted : operation.args[0] || '0px',
          component === 'translateY' ? formatted : operation.args[1] || '0px',
        ];
        updated = true;
        break;
      }
      if (operation.type === 'scale' && ['scaleX', 'scaleY'].includes(component)) {
        operation.args = [
          component === 'scaleX' ? formatted : operation.args[0] || '1',
          component === 'scaleY' ? formatted : operation.args[1] || operation.args[0] || '1',
        ];
        updated = true;
        break;
      }
      if (operation.type === 'skew' && ['skewX', 'skewY'].includes(component)) {
        operation.args = [
          component === 'skewX' ? formatted : operation.args[0] || '0deg',
          component === 'skewY' ? formatted : operation.args[1] || '0deg',
        ];
        updated = true;
        break;
      }
    }
    if (!updated) parsed.operations.push({ type: component, args: [formatted] });
    return parsed.operations.map((operation) => `${operation.type}(${operation.args.join(', ')})`).join(' ') || 'none';
  }

  function runtimeOriginComponent(value, component) {
    const parts = runtimeArgs(value || '50% 50%');
    return component === 'transformOriginY' ? parts[1] || '50%' : parts[0] || '50%';
  }

  function updateRuntimeOrigin(value, component, nextValue) {
    const parts = runtimeArgs(value || '50% 50%');
    const next = [parts[0] || '50%', parts[1] || '50%'];
    next[component === 'transformOriginY' ? 1 : 0] = String(nextValue);
    return next.join(' ');
  }

  function numericCss(value) {
    const match = String(value ?? '').trim().match(/^(-?(?:\d+|\d*\.\d+))([a-z%]*)$/i);
    return match ? { value: Number(match[1]), unit: match[2] || '' } : null;
  }

  function shiftCssValue(value, delta) {
    const parsed = numericCss(value);
    if (!parsed) throw bridgeError('unsupported_value', 'This animation value cannot be shifted safely.');
    return `${runtimeRound(parsed.value + delta)}${parsed.unit}`;
  }

  function retargetDescriptorValue(descriptor, rawValue) {
    if (descriptor.component === 'transformOriginX' || descriptor.component === 'transformOriginY') {
      return runtimeOriginComponent(rawValue, descriptor.component);
    }
    if (descriptor.component && descriptor.runtimeProperty === 'transform') {
      return runtimeComponentValue(rawValue, descriptor.component);
    }
    return rawValue;
  }

  function browserFinalFrame(effect, property) {
    const frames = editableKeyframes(effect);
    let ownerIndex = -1;
    let ownerOffset = -Infinity;
    frames.forEach((frame, index) => {
      if (frame[property] == null) return;
      const offset = finite(frame.offset);
      if (offset >= ownerOffset) {
        ownerOffset = offset;
        ownerIndex = index;
      }
    });
    return { frames, ownerIndex };
  }

  function browserVisibleRetargetValue(record, descriptor, fallback) {
    const target = record.target;
    if (!(target instanceof Element)) return fallback;
    try {
      const computed = getComputedStyle(target);
      const property = descriptor.runtimeProperty;
      const cssProperty = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
      const rawValue = computed[property] || computed.getPropertyValue(cssProperty);
      const value = retargetDescriptorValue(descriptor, rawValue);
      return value == null || value === '' ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function readBrowserRetarget(record, descriptor) {
    const property = descriptor.runtimeProperty;
    const { frames, ownerIndex } = browserFinalFrame(record.animation.effect, property);
    if (ownerIndex < 0) throw bridgeError('motion_owner_missing', 'The animation no longer writes this property.');
    const rawValue = frames[ownerIndex][property];
    const finalValue = retargetDescriptorValue(descriptor, rawValue);
    return {
      ...cloneValue(descriptor),
      value: descriptor.writeModel === 'additive-base'
        ? browserVisibleRetargetValue(record, descriptor, finalValue)
        : finalValue,
    };
  }

  function applyBrowserRetarget(record, descriptor) {
    const effect = record.animation.effect;
    if (typeof effect?.setKeyframes !== 'function') throw bridgeError('unsupported_patch', 'This animation does not expose editable keyframes.');
    const property = descriptor.runtimeProperty;
    const { frames, ownerIndex } = browserFinalFrame(effect, property);
    if (ownerIndex < 0) throw bridgeError('motion_owner_missing', 'The animation no longer writes this property.');
    if (descriptor.writeModel === 'additive-base') {
      const finalValue = retargetDescriptorValue(descriptor, frames[ownerIndex][property]);
      const current = browserVisibleRetargetValue(record, descriptor, finalValue);
      const from = numericCss(current);
      const to = numericCss(descriptor.value);
      if (!from || !to || from.unit !== to.unit) throw bridgeError('unsupported_value', 'This loop value cannot be shifted safely.');
      const delta = to.value - from.value;
      frames.forEach((frame) => {
        if (frame[property] == null) return;
        if (descriptor.component && property === 'transform') {
          const componentValue = runtimeComponentValue(frame[property], descriptor.component);
          frame[property] = updateRuntimeTransform(frame[property], descriptor.component, shiftCssValue(componentValue, delta));
        } else {
          frame[property] = shiftCssValue(frame[property], delta);
        }
      });
    } else if (descriptor.component === 'transformOriginX' || descriptor.component === 'transformOriginY') {
      frames[ownerIndex][property] = updateRuntimeOrigin(frames[ownerIndex][property], descriptor.component, descriptor.value);
    } else if (descriptor.component && property === 'transform') {
      frames[ownerIndex][property] = updateRuntimeTransform(frames[ownerIndex][property], descriptor.component, descriptor.value);
    } else {
      frames[ownerIndex][property] = String(descriptor.value);
    }
    effect.setKeyframes(frames);
  }

  // invalidate() clears the tween's recorded values; the NEXT render re-records
  // the implicit from-value from whatever the DOM currently shows. For a tween
  // parked mid-animation that silently shifts the start to the parked value
  // (probe-verified on GSAP 3.15: start 10 became 55). Render the true start
  // BEFORE invalidating, then restore the parked position.
  function invalidatePreservingStart(animation) {
    let parked = null;
    try {
      const current = animation.progress?.();
      if (Number.isFinite(current) && current > 0) {
        parked = current;
        animation.progress(0, true);
      }
    } catch (_) {}
    animation.invalidate?.();
    if (parked != null) {
      try { animation.progress(parked, true); } catch (_) {}
    }
  }

  function sampleGsapValue(record, property, progress = 1) {
    const animation = record.animation;
    const target = record.target || record.targets?.[0];
    const gsap = window.gsap;
    const touched = [];
    (record.targets || [target]).forEach((item) => {
      if (item instanceof Element && !touched.some(([element]) => element === item)) {
        touched.push([item, item.style.cssText]);
      }
    });
    let parked = null;
    try {
      parked = animation.progress?.();
      if (Number.isFinite(progress)) animation.progress?.(progress, true);
      let value;
      if (gsap && typeof gsap.getProperty === 'function' && target) value = gsap.getProperty(target, property);
      else value = animation.vars?.[property];
      return value;
    } finally {
      if (Number.isFinite(parked)) {
        try { animation.progress?.(parked, true); } catch (_) {}
      }
      touched.forEach(([element, cssText]) => {
        try { element.style.cssText = cssText; } catch (_) {}
      });
    }
  }

  function readGsapRetarget(record, descriptor) {
    const property = descriptor.runtimeProperty;
    let value;
    if (descriptor.component === 'transformOriginX' || descriptor.component === 'transformOriginY') {
      value = runtimeOriginComponent(sampleGsapValue(record, property, 1), descriptor.component);
    } else if (descriptor.component && property === 'transform') {
      value = runtimeComponentValue(sampleGsapValue(record, property, 1), descriptor.component);
    } else if (descriptor.component && property === 'scale') {
      value = sampleGsapValue(record, descriptor.component, 1);
    } else if (descriptor.writeModel === 'additive-base') {
      value = sampleGsapValue(record, property, finite(record.animation.progress?.()));
    } else {
      value = sampleGsapValue(record, property, 1);
    }
    const rawValue = record.animation.vars?.[property];
    return {
      ...cloneValue(descriptor),
      value: String(value ?? ''),
      sourceValue: safeSourceValue(rawValue),
    };
  }

  function assignGsapAbsolute(record, descriptor) {
    const animation = record.animation;
    const vars = animation.vars || (animation.vars = {});
    const property = descriptor.runtimeProperty;
    const desired = descriptor.value;
    if (descriptor.component === 'transformOriginX' || descriptor.component === 'transformOriginY') {
      vars[property] = updateRuntimeOrigin(sampleGsapValue(record, property, 1), descriptor.component, desired);
      return;
    }
    if (descriptor.component && property === 'transform') {
      vars[property] = updateRuntimeTransform(sampleGsapValue(record, property, 1), descriptor.component, desired);
      return;
    }
    if (descriptor.component && property === 'scale') {
      const other = descriptor.component === 'scaleX' ? 'scaleY' : 'scaleX';
      vars[other] = sampleGsapValue(record, other, 1);
      vars[descriptor.component] = Number.isFinite(Number(desired)) ? Number(desired) : desired;
      delete vars.scale;
      return;
    }
    vars[property] = typeof vars[property] === 'number' && Number.isFinite(Number(desired))
      ? Number(desired)
      : desired;
  }

  function applyGsapRelative(record, descriptor) {
    const animation = record.animation;
    const vars = animation.vars || (animation.vars = {});
    const property = descriptor.runtimeProperty;
    const raw = String(vars[property] ?? descriptor.sourceValue ?? '').trim();
    const relative = raw.match(/^([+-])=(-?(?:\d+|\d*\.\d+))([a-z%]*)$/i);
    const current = numericCss(sampleGsapValue(record, property, 1));
    const desired = numericCss(descriptor.value);
    if (!relative || !current || !desired || current.unit !== desired.unit) {
      throw bridgeError('unsupported_value', 'This relative animation value cannot be retargeted safely.');
    }
    const signed = (relative[1] === '-' ? -1 : 1) * Number(relative[2]);
    const next = signed + (desired.value - current.value);
    vars[property] = `${next < 0 ? '-=' : '+='}${runtimeRound(Math.abs(next))}${relative[3] || desired.unit}`;
  }

  function applyGsapFunctionOffset(record, descriptor) {
    const animation = record.animation;
    const vars = animation.vars || (animation.vars = {});
    const property = descriptor.runtimeProperty;
    let bindings = gsapFunctionRetargets.get(animation);
    if (!bindings) {
      bindings = new Map();
      gsapFunctionRetargets.set(animation, bindings);
    }
    let binding = bindings.get(property);
    if (!binding) {
      const original = vars[property];
      if (typeof original !== 'function') throw bridgeError('unsupported_value', 'The function-based animation value is no longer available.');
      const current = numericCss(sampleGsapValue(record, property, 1));
      if (!current) throw bridgeError('unsupported_value', 'The function-based animation value cannot be measured.');
      binding = { original, baseFinal: current };
      bindings.set(property, binding);
    }
    const desired = numericCss(descriptor.value);
    if (!desired || desired.unit !== binding.baseFinal.unit) {
      throw bridgeError('unsupported_value', 'The function-based animation value uses an incompatible unit.');
    }
    const delta = desired.value - binding.baseFinal.value;
    const wrapper = function uncraftRetargetedValue(...args) {
      return shiftCssValue(binding.original.apply(this, args), delta);
    };
    vars[property] = wrapper;
  }

  function applyGsapLoopBase(record, descriptor) {
    const animation = record.animation;
    const vars = animation.vars || (animation.vars = {});
    const property = descriptor.runtimeProperty;
    if (typeof vars[property] === 'function' || /^[+-]=/.test(String(vars[property] || ''))) {
      throw bridgeError('unsupported_value', 'This loop base cannot be shifted safely.');
    }
    const current = numericCss(sampleGsapValue(record, property, finite(animation.progress?.())));
    const desired = numericCss(descriptor.value);
    const start = numericCss(sampleGsapValue(record, property, 0));
    const end = numericCss(sampleGsapValue(record, property, 1));
    if (!current || !desired || !start || !end || current.unit !== desired.unit || start.unit !== current.unit || end.unit !== current.unit) {
      throw bridgeError('unsupported_value', 'This loop base cannot be measured safely.');
    }
    const delta = desired.value - current.value;
    vars.startAt = { ...(vars.startAt || {}), [property]: `${runtimeRound(start.value + delta)}${start.unit}` };
    vars[property] = `${runtimeRound(end.value + delta)}${end.unit}`;
  }

  function applyGsapRetarget(record, descriptor) {
    const targetCount = Math.max(1, record.targets?.length || 1);
    if (targetCount > 1 && Number(descriptor.affectedTargetCount || 1) !== targetCount) {
      throw bridgeError('scope_mismatch', 'This animation controls more targets than the patch declares.');
    }
    if (descriptor.writeModel === 'relative') applyGsapRelative(record, descriptor);
    else if (descriptor.writeModel === 'function-offset') applyGsapFunctionOffset(record, descriptor);
    else if (descriptor.writeModel === 'additive-base') applyGsapLoopBase(record, descriptor);
    else assignGsapAbsolute(record, descriptor);
    invalidatePreservingStart(record.animation);
  }

  function applyGsapKeyframe(animation, property, descriptor) {
    const vars = animation.vars || (animation.vars = {});
    if (vars.runBackwards) {
      throw new Error('gsap.from() keyframes are read-only — vars hold the start, not the end.');
    }
    // A staggered tween is a facade over internal per-target tweens: writing
    // vars/startAt on it silently changes NOTHING (probe-verified — the edit
    // read back the old value). Fail loudly and point at the way out.
    if (vars.stagger != null) {
      throw new Error('This value is shared by a staggered group — unchain the layer (chain icon) to edit it independently.');
    }
    const offset = Math.max(0, Math.min(1, Number(descriptor?.offset) || 0));
    if (descriptor?.exists === false) {
      if (offset <= 0.001 && vars.startAt) delete vars.startAt[property];
      invalidatePreservingStart(animation);
      return;
    }
    const value = String(descriptor?.value ?? '');
    if (offset >= 0.999) {
      vars[property] = value; // end target
    } else if (offset <= 0.001) {
      vars.startAt = { ...(vars.startAt || {}), [property]: value }; // explicit start
    } else {
      throw new Error('Intermediate GSAP keyframes are not editable on this tween yet.');
    }
    invalidatePreservingStart(animation);
  }

  // Break ONE element out of a shared multi-target tween (stagger chains like
  // the four `.green-line` bars): mint an equivalent standalone tween for this
  // element, then remove the element from the shared one. The siblings keep
  // their animation; the detached element gets its own independent control.
  function detachCloneId(rowTargets) {
    return `gsap-${hash(`${ensureElementId(rowTargets[0])}:detached`)}`;
  }

  function detachElementFromSharedTween(record, element) {
    const gsap = window.gsap;
    const tween = record.animation;
    if (!gsap || !tween || typeof tween.targets !== 'function') {
      throw new Error('This animation cannot be detached.');
    }
    if (tween.scrollTrigger || tween.vars?.scrollTrigger) {
      throw new Error('This group rides a scroll trigger — unchaining scroll-driven groups is not supported yet.');
    }
    const targets = tween.targets().filter((item) => item instanceof Element && !isDetached(tween, item));
    // The row may own SEVERAL of the tween's targets (split-text fragments):
    // the whole element detaches, or unchaining a headline would strand all
    // but its first letter in the shared tween.
    const rowTargets = targets.filter((item) => item === element || element.contains(item));
    if (!rowTargets.length || rowTargets.length === targets.length) {
      throw new Error('This element is not part of a shared animation.');
    }
    const progress = finite(tween.progress?.());
    const vars = { ...(tween.vars || {}) };
    [
      'scrollTrigger', 'id', 'parent', 'paused', 'delay', 'duration', 'overwrite',
      'onComplete', 'onStart', 'onUpdate', 'onRepeat', 'onReverseComplete', 'onInterrupt', 'callbackScope',
    ].forEach((key) => delete vars[key]);
    if (rowTargets.length === 1) delete vars.stagger;
    // A staggered facade lies about timing: duration() is the FULL SPAN
    // (duration + spread — probe-verified 0.95 for 0.5+3×0.15) and delay()
    // drops the target's slot. The inner timeline holds the per-target truth.
    const inner = tween.timeline && typeof tween.timeline.getChildren === 'function'
      ? tween.timeline.getChildren() : null;
    const innerChild = inner
      ? inner.find((child) => { try { return (child.targets?.() || []).includes(rowTargets[0]); } catch (_) { return false; } })
      : null;
    const clone = gsap.to(rowTargets.length === 1 ? rowTargets[0] : rowTargets, {
      ...vars,
      duration: Math.max(0.001, innerChild ? finite(innerChild.duration?.(), finite(tween.duration?.())) : finite(tween.duration?.())),
      delay: Math.max(0, finite(tween.delay?.()) + (innerChild ? finite(innerChild.startTime?.()) : 0)),
      paused: true,
    });
    try { clone.progress(progress, true); } catch (_) {}
    rowTargets.forEach((item) => { try { tween.kill(item); } catch (_) {} });
    const detachedSet = detachedTargets.get(tween) || new Set();
    rowTargets.forEach((item) => detachedSet.add(item));
    detachedTargets.set(tween, detachedSet);
    const cloneId = motionIdFor(clone, 'gsap', `${ensureElementId(rowTargets[0])}:detached`);
    motionRegistry.set(cloneId, {
      type: 'gsap',
      animation: clone,
      scrollTrigger: null,
      target: rowTargets[0],
      targets: rowTargets,
    });
    // Keep the intro lane coherent: the clone inherits the original tween's
    // latched span, so its strip stays put and intro scrub keeps driving it.
    const span = introTweenSpans.get(tween);
    if (span) {
      introTweenSpans.set(clone, span);
      introRoots.set(clone, {
        startSec: span.startMs / 1000,
        durSec: Math.max(0.001, finite(clone.totalDuration?.(), finite(clone.duration?.()))),
      });
    }
  }

  // Undo of link.detach. Probe-verified on real GSAP 3.15: invalidate() on a
  // PLAIN multi-target tween rebuilds PropTweens for a target removed with
  // kill(target) — but a STAGGERED tween's internal child stays dead, so a
  // staggered unchain is honestly irreversible without a reload.
  function relinkElementToSharedTween(record, element) {
    const tween = record.animation;
    const set = detachedTargets.get(tween);
    const rowTargets = set ? Array.from(set).filter((item) => item === element || element.contains(item)) : [];
    if (!rowTargets.length) throw new Error('This element is not detached from this animation.');
    if ((tween.vars || {}).stagger != null) {
      throw new Error('A staggered group cannot be re-chained after unchaining — reload the page to restore it.');
    }
    const cloneId = detachCloneId(rowTargets);
    const cloneRecord = motionRegistry.get(cloneId);
    if (cloneRecord?.animation) {
      introRoots.delete(cloneRecord.animation);
      try { cloneRecord.animation.kill(); } catch (_) {}
    }
    motionRegistry.delete(cloneId);
    rowTargets.forEach((item) => set.delete(item));
    if (!set.size) detachedTargets.delete(tween);
    invalidatePreservingStart(tween);
  }

  function applyMotionPatch(patch, element) {
    if (!motionRegistry.has(patch.motionId)) inspectMotion(element);
    const record = motionRegistry.get(patch.motionId);
    if (!record) throw new Error('The selected animation is no longer available.');
    const value = patch.value;

    if (patch.property === 'ownership.hint') {
      const descriptor = value && typeof value === 'object' ? value : patch.before;
      const semantic = descriptor?.semanticProperty;
      if (!semantic) throw bridgeError('invalid_value', 'The ownership hint has no property.');
      const key = `${patch.elementId}:${semantic}`;
      if (value?.motionId) runtimeOwnershipHints.set(key, cloneValue(value));
      else runtimeOwnershipHints.delete(key);
      return;
    }

    if (patch.property === 'retarget.final') {
      if (!value || value.schemaVersion !== 2 || !value.runtimeProperty) {
        throw bridgeError('invalid_value', 'The final-target patch is invalid.');
      }
      if (value.owner?.motionId && value.owner.motionId !== patch.motionId) {
        throw bridgeError('motion_owner_mismatch', 'The selected motion no longer owns this value.');
      }
      if (record.type === 'browser') applyBrowserRetarget(record, value);
      else applyGsapRetarget(record, value);
      return;
    }

    if (record.type === 'browser') {
      const effect = record.animation.effect;
      if (!effect || typeof effect.updateTiming !== 'function') throw new Error('This animation does not expose editable timing.');
      if (patch.property.startsWith('keyframe.')) {
        applyBrowserKeyframe(effect, patch.property.slice('keyframe.'.length), value);
        return;
      }
      if (patch.property === 'timing.playbackMode') {
        const playbackMode = ['loop', 'ping-pong'].includes(value) ? value : 'once';
        effect.updateTiming({
          iterations: playbackMode === 'once' ? 1 : Infinity,
          direction: playbackMode === 'ping-pong' ? 'alternate' : 'normal',
        });
        return;
      }
      const timingMap = {
        'timing.delay': 'delay', 'timing.duration': 'duration', 'timing.endDelay': 'endDelay',
        'timing.iterations': 'iterations', 'timing.direction': 'direction', 'timing.fill': 'fill', 'timing.easing': 'easing',
      };
      const key = timingMap[patch.property];
      if (!key) throw new Error(`Unsupported browser motion property: ${patch.property}`);
      const numeric = ['delay', 'duration', 'endDelay', 'iterations'].includes(key);
      effect.updateTiming({ [key]: numeric ? Number(value) : value });
      return;
    }

    const animation = record.animation;
    if (patch.property.startsWith('keyframe.')) {
      applyGsapKeyframe(animation, patch.property.slice('keyframe.'.length), value);
    } else if (patch.property === 'timing.playbackMode') {
      const playbackMode = ['loop', 'ping-pong'].includes(value) ? value : 'once';
      animation.repeat?.(playbackMode === 'once' ? 0 : -1);
      animation.yoyo?.(playbackMode === 'ping-pong');
    } else if (patch.property === 'timing.duration') { animation.duration?.(Math.max(0, Number(value)) / 1000); refreshIntroLatch(animation); }
    else if (patch.property === 'timing.delay') { animation.delay?.(Number(value) / 1000); refreshIntroLatch(animation); }
    else if (patch.property === 'timing.iterations') animation.repeat?.(Math.max(0, Number(value) - 1));
    else if (patch.property === 'timing.repeatDelay') animation.repeatDelay?.(Math.max(0, Number(value)) / 1000);
    else if (patch.property === 'timing.yoyo') animation.yoyo?.(Boolean(value));
    else if (patch.property === 'scroll.start' || patch.property === 'scroll.end') {
      // Verified on real GSAP 3.15 (probe-scrolltrigger-range.mjs): numeric px in
      // vars.start/end + refresh() retargets the trigger and the tween tracks the
      // new range exactly. Only a LIVE ScrollTrigger instance can refresh — a
      // config object cannot, and the edit must fail loudly, not silently.
      const trigger = record.scrollTrigger;
      if (!trigger || typeof trigger.refresh !== 'function') {
        throw new Error('This animation has no live scroll trigger to adjust.');
      }
      trigger.vars[patch.property === 'scroll.start' ? 'start' : 'end'] = Math.max(0, Number(value) || 0);
    } else if (patch.property === 'timing.easing') {
      // Setting vars.ease alone does NOT change the curve — GSAP resolved the ease
      // when the tween was built. Parse it and install the resolved function.
      // Deliberately no invalidate(): it re-bases the tween's start onto whatever
      // value happens to be on screen, silently corrupting the animation.
      animation.vars.ease = value;
      try {
        const parsed = window.gsap?.parseEase?.(value);
        if (parsed) animation._ease = parsed;
      } catch (_) {}
    } else if (patch.property === 'link.detach') {
      if (value && value.detached === true) detachElementFromSharedTween(record, element);
      else relinkElementToSharedTween(record, element);
    } else {
      throw new Error(`Unsupported GSAP motion property: ${patch.property}`);
    }
    record.scrollTrigger?.refresh?.();
  }

  function rgbToHex(value) {
    const match = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return value || '';
    return `#${[match[1], match[2], match[3]]
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')}`;
  }

  function collectDocumentProfile() {
    const colorCounts = new Map();
    const fontCounts = new Map();
    const elements = Array.from(document.querySelectorAll('body *')).slice(0, 1400);
    const addColor = (value) => {
      const normalized = String(value || '').trim();
      if (!normalized || normalized === 'rgba(0, 0, 0, 0)' || normalized === 'transparent') return;
      const hex = rgbToHex(normalized);
      colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
    };
    elements.forEach((element) => {
      const style = getComputedStyle(element);
      addColor(style.color);
      addColor(style.backgroundColor);
      addColor(style.borderTopColor);
      const family = style.fontFamily?.split(',')[0]?.replace(/["']/g, '').trim();
      if (family) fontCounts.set(family, (fontCounts.get(family) || 0) + 1);
    });
    const rank = (map, limit) => Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));
    return {
      origin: pageOrigin(),
      colors: rank(colorCounts, 16),
      fonts: rank(fontCounts, 8),
    };
  }

  function assetLabel(element, fallback) {
    return element.getAttribute('alt') || element.getAttribute('aria-label') || element.id || fallback;
  }

  function collectAssets() {
    const assets = [];
    const seen = new Set();
    const push = (entry) => {
      const key = `${entry.kind}:${entry.elementId}:${entry.source}`;
      if (!entry.source || seen.has(key)) return;
      seen.add(key);
      assets.push(entry);
    };

    document.querySelectorAll('img').forEach((element, index) => {
      push({
        elementId: ensureElementId(element), kind: 'image',
        label: assetLabel(element, `Image ${index + 1}`),
        source: element.currentSrc || element.getAttribute('src') || '',
        property: 'src', width: element.naturalWidth || null, height: element.naturalHeight || null,
      });
    });
    document.querySelectorAll('video').forEach((element, index) => {
      const source = element.currentSrc || element.getAttribute('src') || element.querySelector('source')?.getAttribute('src') || '';
      push({
        elementId: ensureElementId(element), kind: 'video',
        label: assetLabel(element, `Video ${index + 1}`), source, property: 'src',
        poster: element.getAttribute('poster') || '', width: element.videoWidth || null, height: element.videoHeight || null,
      });
    });
    document.querySelectorAll('svg').forEach((element, index) => {
      const markup = element.outerHTML;
      push({
        elementId: ensureElementId(element), kind: 'svg',
        label: assetLabel(element, `SVG ${index + 1}`),
        source: `inline-svg:${index + 1}`, property: null, markup: markup.slice(0, 60000),
      });
    });
    document.querySelectorAll('[data-animation-type="lottie"][data-src],.w-lottie[data-src]').forEach((element, index) => {
      push({
        elementId: ensureElementId(element), kind: 'lottie',
        label: assetLabel(element, `Lottie ${index + 1}`),
        source: element.getAttribute('data-src') || '', property: 'data-src',
      });
    });
    Array.from(document.querySelectorAll('body *')).slice(0, 1400).forEach((element, index) => {
      const background = getComputedStyle(element).backgroundImage;
      if (!background || background === 'none') return;
      for (const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        push({
          elementId: ensureElementId(element), kind: 'background',
          label: assetLabel(element, `Background ${index + 1}`),
          source: match[1], property: 'background-image',
        });
      }
    });
    return assets.slice(0, 300);
  }

  function describe(element) {
    if (!element) return null;
    const id = ensureElementId(element);
    const computed = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const splitText = Boolean(element.matches(SPLIT_TOKEN) || element.querySelector(SPLIT_TOKEN));
    const canEditText = isEditableText(element);
    return {
      id,
      tag: element.tagName.toLowerCase(),
      label: element.getAttribute('aria-label') || element.alt || directText(element).slice(0, 80) || element.tagName.toLowerCase(),
      text: directText(element),
      canEditText,
      imageSrc: element.matches('img') ? element.getAttribute('src') || '' : '',
      classes: Array.from(element.classList || []).filter((name) => !/^uncraft-/.test(name)),
      authoredId: element.id || '',
      webflowId: element.getAttribute('data-w-id') || '',
      rect: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
      },
      styles: {
        color: computed.color,
        colorHex: rgbToHex(computed.color),
        backgroundColor: computed.backgroundColor,
        backgroundColorHex: rgbToHex(computed.backgroundColor),
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        lineHeight: computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        textAlign: computed.textAlign,
        textTransform: computed.textTransform,
        textDecoration: computed.textDecorationLine,
        fontStyle: computed.fontStyle,
        borderRadius: computed.borderRadius,
        opacity: computed.opacity,
        display: computed.display,
        position: computed.position,
        transform: computed.transform,
        transformOrigin: computed.transformOrigin,
      },
      motion: inspectMotion(element),
      hostRowId: resolveHostRowId(element),
      warnings: splitText ? ['Text is split by the animation runtime. A production save must rebuild its split instance.'] : [],
    };
  }

  // EDIT-MODE convention: whenever the playhead (or a plain site scroll)
  // passes over a time-driven strip, its animation replays — even when the
  // site authored it to run once. Nothing persists: leaving edit mode simply
  // stops re-triggering, so the site's own behaviour returns untouched.
  let lastReplayScrollY = Math.max(0, Math.round((typeof window !== 'undefined' && window.scrollY) || 0));

  // GSAP garbage-collects one-shot tweens the moment they complete
  // (globalTimeline.autoRemoveChildren) — after that there is nothing left to
  // replay (measured live: 27 → 15 children after one scroll-through). While
  // editing, keep them parked instead; the flag is restored on preview/exit.
  let siteAutoRemoveChildren = null;
  let siteGlobalTimeline = null;

  function gsapChainRoot(animation) {
    const timeline = window.gsap && window.gsap.globalTimeline;
    let root = animation;
    try {
      while (root && root.parent && root.parent !== timeline) root = root.parent;
    } catch (_) {}
    return root || animation;
  }

  // ---- Intro lane (edit-mode convention) -------------------------------------------
  // Animations that PLAY AT LOAD (preloader, transition wipes, hero text) are
  // shown as a sequential time segment BEFORE the page-scroll axis, instead of
  // stacking on top of the hero at scroll 0. Their positions are LATCHED at
  // registration (page-load schedule) so strips never move, even after the
  // replay convention re-schedules the live tweens. Nothing persists: the lane
  // only drives edit-mode preview; save/export read the site's own timing.
  const introRoots = new Map(); // root → { startSec, durSec }
  const introTweenSpans = new WeakMap(); // tween → { startMs, endMs }
  // Targets broken out of a shared tween. GSAP's kill(target) stops rendering
  // the target (probe-verified) but targets() still lists it — track detached
  // pairs here so rows and links read the tween's LIVE reach.
  const detachedTargets = new WeakMap(); // tween → Set(elements)
  function isDetached(tween, target) {
    const set = detachedTargets.get(tween);
    return set ? set.has(target) : false;
  }
  // Roots the edit conventions already re-scheduled (replay restarts move
  // startTime) — a root seen once must never re-latch from its moved schedule.
  const introRejectedRoots = new WeakSet();
  function registerIntroTimeline() {
    const timeline = window.gsap && window.gsap.globalTimeline;
    if (!timeline || typeof timeline.getChildren !== 'function') return;
    try {
      // Incremental: sites mint tweens late (post-preloader heroes). NEW roots
      // latch from their live schedule; roots already latched (or already
      // rejected) keep their first-seen truth so replays can't move strips.
      timeline.getChildren(true, true, true).forEach((tween) => {
        try {
          if (introTweenSpans.has(tween)) return;
          if (tween.scrollTrigger || tween.vars?.scrollTrigger) return;
          const root = gsapChainRoot(tween);
          if (introRejectedRoots.has(root)) return;
          const isNewRoot = !introRoots.has(root);
          if (isNewRoot) {
            if (root.scrollTrigger || root.vars?.scrollTrigger
              // Author-paused chains that never ran are interaction-armed
              // (menus); endless loops (marquees) are ambient, not an intro.
              || (root.paused?.() && (root.totalTime?.() || 0) === 0)
              || root.repeat?.() === -1) {
              introRejectedRoots.add(root);
              return;
            }
            const totalDuration = root.totalDuration?.();
            introRoots.set(root, {
              startSec: Math.max(0, finite(root.startTime?.())),
              durSec: Number.isFinite(totalDuration) ? totalDuration : finite(root.duration?.()),
            });
          }
          if (tween.repeat?.() === -1) return;
          // A late child under an already-replayed root would latch from the
          // MOVED schedule — only trust roots still on their original slot.
          if (!isNewRoot && Math.abs(finite(root.startTime?.()) - introRoots.get(root).startSec) > 0.05) return;
          const startMs = Math.max(0, finite(typeof tween.globalTime === 'function' ? tween.globalTime(0) : 0) * 1000);
          const totalDuration = tween.totalDuration?.();
          const durMs = Math.max(0, (Number.isFinite(totalDuration) ? totalDuration : finite(tween.duration?.())) * 1000);
          introTweenSpans.set(tween, { startMs, endMs: startMs + durMs });
        } catch (_) {}
      });
    } catch (_) {}
  }

  // A timing edit on an intro tween must reshape its latched lane span, or the
  // strip snaps back and the scrub clamps to the stale duration.
  function refreshIntroLatch(animation) {
    const span = introTweenSpans.get(animation);
    if (span) {
      const totalDuration = animation.totalDuration?.();
      const durMs = Math.max(0, (Number.isFinite(totalDuration) ? totalDuration : finite(animation.duration?.())) * 1000);
      introTweenSpans.set(animation, { startMs: span.startMs, endMs: span.startMs + durMs });
    }
    const root = gsapChainRoot(animation);
    const meta = introRoots.get(root);
    if (meta) {
      const totalDuration = root.totalDuration?.();
      meta.durSec = Number.isFinite(totalDuration) ? totalDuration : finite(root.duration?.());
    }
  }

  function scrubIntroTo(timeMs) {
    if (mode !== 'edit') return;
    registerIntroTimeline();
    const targetSec = Math.max(0, Number(timeMs) || 0) / 1000;
    introRoots.forEach((meta, root) => {
      try {
        if (!root || !root.totalTime) return;
        // The lane axis is in load-time GLOBAL seconds; the root's clock runs
        // in local seconds — a timeScale (site's or our speed control) scales
        // between the two.
        const scale = Math.max(0.0001, finite(root.timeScale?.(), 1) || 1);
        const local = Math.max(0, Math.min(meta.durSec, (targetSec - meta.startSec) * scale));
        root.pause?.();
        root.totalTime(local, true);
      } catch (_) {}
    });
  }

  // Leaving edit mode hands the clock back to the site: scrub-parked intros
  // play out to their natural end state.
  function releaseIntroScrub() {
    introRoots.forEach((_meta, root) => {
      try { if (root.paused?.()) root.play?.(); } catch (_) {}
    });
  }

  function enterPreviewMode() {
    if (textEditState) finishInlineTextEdit(true);
    if (mode === 'preview') return;
    const settlement = restoreScopedSettlement();
    previewState = {
      selectionId: selectedId,
      scrollY: Math.max(0, finite(window.scrollY)),
      settlement,
    };
    document.querySelectorAll('[data-uncraft-selected]').forEach((node) => node.removeAttribute('data-uncraft-selected'));
    hover(null);
    mode = 'preview';
    document.documentElement.dataset.uncraftEditorMode = mode;
    syncEditConventions();
    releaseIntroScrub();
    emitEditState('previewing', { loop: settlement?.loop === true });
    emit('mode-changed', { mode });
  }

  function leavePreviewMode() {
    if (mode === 'edit') return;
    const previous = previewState;
    previewState = null;
    mode = 'edit';
    document.documentElement.dataset.uncraftEditorMode = mode;
    syncEditConventions();
    if (previous && Math.abs(finite(window.scrollY) - previous.scrollY) > 1) {
      try { window.scrollTo(0, previous.scrollY); } catch (_) {}
    }
    selectedId = previous?.selectionId || selectedId;
    const element = findElement(selectedId);
    if (element) element.setAttribute('data-uncraft-selected', 'true');
    emit('mode-changed', { mode });
    if (element) {
      emitEditState('selection-pending', { loop: previous?.settlement?.loop === true });
      if (!reapplyScopedSettlement(previous?.settlement)) settleSelection(element);
    } else {
      emitEditState('navigating', { loop: false });
    }
  }

  function releaseEditState() {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = null;
    scrubActive = false;
    restoreScopedSettlement();
    previewState = null;
    document.querySelectorAll('[data-uncraft-selected],[data-uncraft-hovered]').forEach((node) => {
      node.removeAttribute('data-uncraft-selected');
      node.removeAttribute('data-uncraft-hovered');
    });
    selectedId = null;
    mode = 'preview';
    document.documentElement.dataset.uncraftEditorMode = mode;
    syncEditConventions();
    releaseIntroScrub();
    editState = 'navigating';
    document.documentElement.dataset.uncraftEditState = editState;
  }

  function syncEditConventions() {
    try {
      const timeline = window.gsap && window.gsap.globalTimeline;
      if (!timeline) return;
      if (mode === 'edit') {
        if (siteAutoRemoveChildren === null || siteGlobalTimeline !== timeline) {
          siteAutoRemoveChildren = timeline.autoRemoveChildren;
          siteGlobalTimeline = timeline;
        }
        timeline.autoRemoveChildren = false;
        // Retention guard: sites that mint tweens continuously (cursor
        // followers on mousemove) would grow the timeline without bound.
        // Above a sane population, kill completed MICRO tweens — parked
        // one-shot intros (the replay feature's subjects) are longer-lived.
        const children = timeline.getChildren ? timeline.getChildren(true, true, true) : [];
        if (children.length > 600) {
          children.forEach((tween) => {
            try {
              if (tween.scrollTrigger || tween.vars?.scrollTrigger) return;
              if (tween.progress?.() === 1 && (tween.duration?.() || 0) < 0.25) tween.kill();
            } catch (_) {}
          });
        }
      } else if (siteAutoRemoveChildren !== null && siteGlobalTimeline === timeline) {
        timeline.autoRemoveChildren = siteAutoRemoveChildren;
        siteAutoRemoveChildren = null;
        siteGlobalTimeline = null;
      }
    } catch (_) {}
  }
  function replayElementMotion(host) {
    try {
      if (typeof host.getAnimations === 'function') {
        host.getAnimations({ subtree: true }).forEach((animation) => {
          try {
            // Ownership: a nested element that has its OWN row replays on its
            // own crossing, not on every ancestor's.
            const target = animation?.effect?.target;
            if (target instanceof Element && safeHost(target) !== host && target !== host) return;
            animation.currentTime = 0;
            animation.play();
          } catch (_) {}
        });
      }
    } catch (_) {}
    try {
      const timeline = window.gsap && window.gsap.globalTimeline;
      if (timeline && typeof timeline.getChildren === 'function') {
        // Restart the TOP of each chain: a tween inside a paused intro
        // timeline replays nothing on its own — the parent's clock is stopped.
        const roots = new Set();
        timeline.getChildren(true, true, true).forEach((tween) => {
          try {
            if (tween.scrollTrigger || tween.vars?.scrollTrigger) return; // scrubbed by scroll already
            const targets = typeof tween.targets === 'function' ? tween.targets() : [];
            if (!targets.some((target) => target instanceof Element && (target === host || host.contains(target)))) return;
            let root = tween;
            while (root.parent && root.parent !== timeline) root = root.parent;
            if (root.scrollTrigger || root.vars?.scrollTrigger) return;
            // An author-paused chain that NEVER played is waiting for an
            // interaction (menu, hover) — starting it from a scroll crossing
            // would fire it out of context.
            try { if (root.paused?.() && (root.progress?.() || 0) === 0) return; } catch (_) {}
            roots.add(root);
          } catch (_) {}
        });
        roots.forEach((root) => {
          try { root.restart(true, true); } catch (_) { try { root.play?.(0); } catch (_) {} }
        });
      }
    } catch (_) {}
  }

  function replayCrossedAnimations() {
    const now = Math.max(0, Math.round(window.scrollY || 0));
    const previous = lastReplayScrollY;
    lastReplayScrollY = now;
    if (mode !== 'edit' || now === previous) return;
    rowCache.forEach((entry) => {
      // Mixed rows (scroll + time clips) replay their TIME clips too.
      if (entry.driver !== 'time' && entry.timeDriven !== true) return;
      // Intro rows are scrubbed through the intro lane — re-triggering them on
      // every pass over scroll 0 was what kept "eating the hero".
      if (entry.isIntro) return;
      if (!entry.host || !entry.host.isConnected) return;
      const at = Number(entry.scrollStart) || 0;
      const crossed = (previous < at && now >= at) || (previous > at && now <= at);
      if (crossed) replayElementMotion(entry.host);
    });
  }

  function focusElement(element) {
    if (textEditState) finishInlineTextEdit(true);
    const offscreen = !intersectsViewport(element);
    select(element);
    if (offscreen) {
      try { element.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    }
  }

  function chooseElement(target) {
    if (!(target instanceof Element)) return null;
    const textContainer = textRoot(target);
    if (textContainer) return textContainer;
    const exact = target.closest(SELECTABLE);
    if (!exact || exact === document.documentElement || exact === document.body) {
      // EVERYTHING on the page must be selectable (the editor panel operates
      // on any element, animated or not) — fall back to the node actually hit.
      return target === document.documentElement || target === document.body ? null : target;
    }
    if (/^(SPAN|EM|STRONG)$/i.test(exact.tagName)) {
      return exact.closest('h1,h2,h3,h4,h5,h6,p,a,button,label,li,div') || exact;
    }
    return exact;
  }

  function pauseElementMotion(element) {
    const paused = [];
    if (typeof element.getAnimations !== 'function') return paused;
    element.getAnimations({ subtree: true }).forEach((animation) => {
      try {
        if (animation.playState === 'running') {
          animation.pause();
          paused.push(animation);
        }
      } catch (_) {}
    });
    return paused;
  }

  function createInlineTextOverlay(element, value) {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const overlay = document.createElement('div');
    overlay.dataset.uncraftInlineTextOverlay = 'true';
    overlay.textContent = value;
    Object.assign(overlay.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${Math.max(1, rect.width)}px`,
      minHeight: `${Math.max(1, rect.height)}px`,
      zIndex: '2147483646',
      margin: '0',
      padding: computed.padding,
      color: computed.color,
      background: 'transparent',
      font: computed.font,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      textAlign: computed.textAlign,
      textTransform: computed.textTransform,
      whiteSpace: computed.whiteSpace,
      overflowWrap: computed.overflowWrap,
      boxSizing: 'border-box',
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function writeSplitText(element, value) {
    const chars = Array.from(element.querySelectorAll('.char'))
      .filter((node) => !node.querySelector('.char'));
    if (!chars.length) {
      element.textContent = value;
      return;
    }
    const glyphs = Array.from(value);
    chars.forEach((node, index) => { node.textContent = glyphs[index] || ''; });
    if (glyphs.length > chars.length) {
      const template = chars.at(-1);
      for (let index = chars.length; index < glyphs.length; index += 1) {
        const clone = template.cloneNode(false);
        clone.removeAttribute('style');
        clone.textContent = glyphs[index];
        template.parentElement.appendChild(clone);
      }
    }
  }

  function finishInlineTextEdit(commit = true) {
    const state = textEditState;
    if (!state) return;
    textEditState = null;
    const element = state.element;
    const editable = state.editable || element;
    const value = rawText(editable);
    editable.contentEditable = 'false';
    editable.removeAttribute('contenteditable');
    if (state.overlay) {
      state.overlay.remove();
      if (state.beforeVisibility) element.style.setProperty('visibility', state.beforeVisibility, state.beforeVisibilityPriority);
      else element.style.removeProperty('visibility');
    }
    element.removeAttribute('data-uncraft-text-editing');

    if (!commit) {
      if (!state.overlay) element.innerHTML = state.beforeHTML;
      if (state.beforeAriaLabel == null) element.removeAttribute('aria-label');
      else element.setAttribute('aria-label', state.beforeAriaLabel);
    } else if (value !== state.beforeText) {
      if (state.hadSplitText) {
        writeSplitText(element, value);
        element.dataset.uncraftNeedsMotionRebind = 'split-text';
        element.setAttribute('aria-label', value);
      }
      const elementDescription = describe(element);
      if (negotiatedProtocol === PROTOCOL_V2) {
        const transaction = {
          id: randomIdentity('transaction'),
          requestId: randomIdentity('runtime-gesture'),
          source: 'properties',
          createdAt: new Date().toISOString(),
          runtimeGeneration,
          patches: [{
            id: randomIdentity('patch'),
            elementId: state.elementId,
            kind: 'text',
            property: null,
            motionId: null,
            before: state.beforeText,
            value,
          }],
        };
        committedTransactions.set(transaction.id, transaction);
        emit('transaction-committed', {
          transaction,
          operation: 'runtime-gesture',
          originatedByRuntime: true,
          element: elementDescription,
        }, { protocol: PROTOCOL_V2, requestId: transaction.requestId });
      } else {
        emit('inline-text-committed', {
          elementId: state.elementId,
          before: state.beforeText,
          value,
          element: elementDescription,
        });
      }
    }

    state.pausedAnimations.forEach((animation) => {
      try { animation.play(); } catch (_) {}
    });
    if (!commit) emit('selection-changed', { element: describe(element) });
  }

  function enterInlineTextEdit(element) {
    if (!isEditableText(element)) return;
    if (textEditState?.element === element) return;
    if (textEditState) finishInlineTextEdit(true);
    select(element);
    const hadSplitText = Boolean(element.matches(SPLIT_TOKEN) || element.querySelector(SPLIT_TOKEN));
    const overlay = hadSplitText ? createInlineTextOverlay(element, directText(element)) : null;
    textEditState = {
      element,
      editable: overlay || element,
      overlay,
      elementId: ensureElementId(element),
      beforeText: directText(element),
      beforeHTML: element.innerHTML,
      beforeAriaLabel: element.getAttribute('aria-label'),
      beforeVisibility: element.style.getPropertyValue('visibility'),
      beforeVisibilityPriority: element.style.getPropertyPriority('visibility'),
      hadSplitText,
      pausedAnimations: pauseElementMotion(element),
    };
    const editable = textEditState.editable;
    if (overlay) element.style.setProperty('visibility', 'hidden', 'important');
    try { editable.contentEditable = 'plaintext-only'; } catch (_) { editable.contentEditable = 'true'; }
    if (editable.contentEditable !== 'plaintext-only') editable.contentEditable = 'true';
    element.setAttribute('data-uncraft-text-editing', 'true');
    editable.focus({ preventScroll: true });
    try {
      const range = document.createRange();
      range.selectNodeContents(editable);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_) {}
    emit('inline-text-edit-started', { element: describe(element) });
  }

  function select(element) {
    document.querySelectorAll('[data-uncraft-selected]').forEach((node) => node.removeAttribute('data-uncraft-selected'));
    if (!element) {
      restoreScopedSettlement();
      selectedId = null;
      emitEditState('navigating', { loop: false });
      emit('selection-changed', { element: null });
      return;
    }
    const nextId = ensureElementId(element);
    if (selectedId && selectedId !== nextId) restoreScopedSettlement();
    selectedId = nextId;
    element.setAttribute('data-uncraft-selected', 'true');
    emitEditState('selection-pending', { loop: false });
    emit('selection-changed', { element: describe(element) });
    settleSelection(element);
  }

  function hover(element) {
    if (hoveredElement === element) return;
    hoveredElement?.removeAttribute('data-uncraft-hovered');
    hoveredElement = element || null;
    if (hoveredElement && ensureElementId(hoveredElement) !== selectedId) {
      hoveredElement.setAttribute('data-uncraft-hovered', 'true');
    }
  }

  function refreshRuntime() {
    try { window.ScrollTrigger?.refresh?.(true); } catch (_) {}
    try { window.gsap?.plugins?.ScrollTrigger?.refresh?.(true); } catch (_) {}
    window.dispatchEvent(new Event('resize'));
  }

  function safeSvg(markup, elementId) {
    const parsed = new DOMParser().parseFromString(String(markup || ''), 'image/svg+xml');
    const svg = parsed.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return null;
    svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach((node) => node.remove());
    svg.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        if (/^on/i.test(attribute.name) || /^(?:href|xlink:href)$/i.test(attribute.name) && /^\s*javascript:/i.test(attribute.value)) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    svg.setAttribute('data-uncraft-id', elementId);
    return document.importNode(svg, true);
  }

  function bridgeError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  }

  function cloneValue(value) {
    try { return structuredClone(value); } catch (_) {
      if (value == null || typeof value !== 'object') return value;
      try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }
  }

  function readMotionPatchValue(patch, element) {
    if (!motionRegistry.has(patch.motionId)) inspectMotion(element);
    const record = motionRegistry.get(patch.motionId);
    if (!record) throw bridgeError('motion_missing', 'The selected animation is no longer available.');
    const property = patch.property;
    const animation = record.animation;
    if (property === 'ownership.hint') {
      const descriptor = patch.value && typeof patch.value === 'object' ? patch.value : patch.before;
      const semantic = descriptor?.semanticProperty;
      if (!semantic) throw bridgeError('invalid_value', 'The ownership hint has no property.');
      return cloneValue(runtimeOwnershipHints.get(`${patch.elementId}:${semantic}`) || {
        schemaVersion: 1,
        semanticProperty: semantic,
        channelId: null,
        motionId: null,
      });
    }
    if (property === 'retarget.final') {
      const descriptor = patch.value && typeof patch.value === 'object' ? patch.value : patch.before;
      if (!descriptor || descriptor.schemaVersion !== 2 || !descriptor.runtimeProperty) {
        throw bridgeError('invalid_value', 'The final-target patch is invalid.');
      }
      return record.type === 'browser'
        ? readBrowserRetarget(record, descriptor)
        : readGsapRetarget(record, descriptor);
    }
    if (property.startsWith('keyframe.')) {
      const trackProperty = property.slice('keyframe.'.length);
      const descriptor = patch.value && typeof patch.value === 'object' ? patch.value : patch.before;
      const offset = Math.max(0, Math.min(1, Number(descriptor?.offset) || 0));
      if (record.type === 'browser') {
        let frames = [];
        try { frames = animation.effect?.getKeyframes?.() || []; } catch (_) {}
        const frame = frames.find((candidate) => Math.abs(finite(candidate.computedOffset, finite(candidate.offset)) - offset) < 0.0005);
        if (!frame || frame[trackProperty] == null) return { offset, exists: false };
        return {
          offset,
          value: String(frame[trackProperty]),
          ...(frame.easing ? { easing: frame.easing } : {}),
          exists: true,
        };
      }
      const vars = animation.vars || {};
      if (offset <= 0.001) {
        if (vars.startAt?.[trackProperty] == null) return { offset, exists: false };
        return { offset, value: String(vars.startAt[trackProperty]), exists: true };
      }
      if (offset >= 0.999) {
        if (vars[trackProperty] == null) return { offset, exists: false };
        return { offset, value: String(vars[trackProperty]), exists: true };
      }
      return { offset, exists: false };
    }
    if (record.type === 'browser') {
      const timing = animation.effect?.getTiming?.() || {};
      if (property === 'timing.playbackMode') {
        if (timing.direction === 'alternate' && timing.iterations === Infinity) return 'ping-pong';
        return timing.iterations === Infinity ? 'loop' : 'once';
      }
      const timingMap = {
        'timing.delay': 'delay', 'timing.duration': 'duration', 'timing.endDelay': 'endDelay',
        'timing.iterations': 'iterations', 'timing.direction': 'direction', 'timing.fill': 'fill', 'timing.easing': 'easing',
      };
      if (!timingMap[property]) throw bridgeError('unsupported_patch', 'The browser animation property is not supported.');
      return cloneValue(timing[timingMap[property]]);
    }
    if (property === 'timing.playbackMode') {
      if (animation.repeat?.() === -1 && animation.yoyo?.()) return 'ping-pong';
      return animation.repeat?.() === -1 ? 'loop' : 'once';
    }
    if (property === 'timing.duration') return finite(animation.duration?.()) * 1000;
    if (property === 'timing.delay') return finite(animation.delay?.()) * 1000;
    if (property === 'timing.iterations') return Math.max(1, finite(animation.repeat?.()) + 1);
    if (property === 'timing.repeatDelay') return finite(animation.repeatDelay?.()) * 1000;
    if (property === 'timing.yoyo') return Boolean(animation.yoyo?.());
    if (property === 'timing.easing') return animation.vars?.ease || '';
    if (property === 'scroll.start' || property === 'scroll.end') {
      const key = property === 'scroll.start' ? 'start' : 'end';
      return cloneValue(record.scrollTrigger?.vars?.[key] ?? '');
    }
    if (property === 'link.detach') {
      const detached = detachedTargets.get(animation);
      const targets = detached ? Array.from(detached) : [];
      return { detached: targets.some((target) => target === element || element.contains(target)) };
    }
    throw bridgeError('unsupported_patch', 'The GSAP animation property is not supported.');
  }

  function readPatchValue(patch) {
    const element = findElement(patch?.elementId);
    if (!element) throw bridgeError('target_missing', 'The target element is no longer present.');
    if (patch.kind === 'style') return element.style.getPropertyValue(patch.property);
    if (patch.kind === 'attribute') return element.getAttribute(patch.property) ?? '';
    if (patch.kind === 'text') return element.matches('input,textarea') ? element.value : element.textContent;
    if (patch.kind === 'svg') return element.outerHTML;
    if (patch.kind === 'motion') return readMotionPatchValue(patch, element);
    throw bridgeError('unsupported_patch', 'The patch kind is not supported.');
  }

  function applyPatchOrThrow(patch) {
    let element = findElement(patch?.elementId);
    if (!element) throw bridgeError('target_missing', 'The target element is no longer present.');
    try {
      if (patch.kind === 'style') {
        element.style.setProperty(patch.property, patch.value ?? '');
      } else if (patch.kind === 'attribute') {
        if (patch.value === '' || patch.value == null) element.removeAttribute(patch.property);
        else element.setAttribute(patch.property, patch.value);
      } else if (patch.kind === 'text') {
        if (element.matches('input,textarea')) element.value = patch.value;
        else {
          const hadSplitText = Boolean(element.matches(SPLIT_TOKEN) || element.querySelector(SPLIT_TOKEN));
          element.textContent = patch.value;
          if (hadSplitText) {
            element.dataset.uncraftNeedsMotionRebind = 'split-text';
            element.setAttribute('aria-label', patch.value);
          }
        }
      } else if (patch.kind === 'svg') {
        const replacement = safeSvg(patch.value, patch.elementId);
        if (!replacement) throw bridgeError('invalid_value', 'The selected SVG is invalid.');
        element.replaceWith(replacement);
        element = replacement;
      } else if (patch.kind === 'motion') {
        applyMotionPatch(patch, element);
      } else {
        throw bridgeError('unsupported_patch', 'The patch kind is not supported.');
      }
    } catch (error) {
      if (error?.code) throw error;
      throw bridgeError('write_failed', error?.message || 'The change could not be applied.');
    }
    return element;
  }

  function applyPatch(patch, quiet) {
    let element;
    try {
      element = applyPatchOrThrow(patch);
    } catch (error) {
      // Legacy v1 stays readable during migration. Protocol v2 sends only a
      // stable error code and keeps details in its sanitized diagnostics field.
      emit('patch-rejected', { patch, error: error?.message || 'The change could not be applied.' });
      return false;
    }
    refreshRuntime();
    if (!quiet) emit('patch-applied', { patch, element: describe(element) });
    return true;
  }

  function transactionDiagnostic(code, transactionId) {
    return { code, fingerprint: hash(`${code}:${transactionId || 'unknown'}`) };
  }

  function assertTransaction(transaction) {
    if (!transaction || typeof transaction !== 'object' || typeof transaction.id !== 'string' || !transaction.id) {
      throw bridgeError('invalid_transaction', 'The transaction is invalid.');
    }
    if (!Array.isArray(transaction.patches) || !transaction.patches.length) {
      throw bridgeError('invalid_transaction', 'The transaction has no patches.');
    }
    if (transaction.patches.length > TRANSACTION_LIMITS.maxPatches) {
      throw bridgeError('patch_limit_exceeded', 'The transaction has too many patches.');
    }
  }

  function rollbackApplied(applied) {
    let rollbackError = null;
    applied.slice().reverse().forEach((patch) => {
      try { applyPatchOrThrow({ ...patch, value: cloneValue(patch.before) }); }
      catch (error) { rollbackError ||= error; }
    });
    refreshRuntime();
    if (rollbackError) throw bridgeError('rollback_failed', 'The transaction could not be restored.');
  }

  function applyAtomicTransaction(transaction, { restore = false } = {}) {
    assertTransaction(transaction);
    const startedAt = performance.now();
    const applied = [];
    try {
      transaction.patches.forEach((patch) => {
        if (performance.now() - startedAt > TRANSACTION_LIMITS.maxExecutionMs) {
          throw bridgeError('execution_timeout', 'The transaction exceeded its execution limit.');
        }
        const canonical = { ...patch, before: cloneValue(readPatchValue(patch)) };
        applyPatchOrThrow(canonical);
        canonical.value = cloneValue(readPatchValue(canonical));
        applied.push(canonical);
      });
      refreshRuntime();
      const acknowledged = { ...transaction, patches: applied, runtimeGeneration };
      if (restore) rollbackApplied(applied);
      return acknowledged;
    } catch (error) {
      if (applied.length) rollbackApplied(applied);
      throw error;
    }
  }

  function valuesEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (left == null || right == null) return left === right;
    if (typeof left !== 'object' && typeof right !== 'object') return String(left) === String(right);
    try { return JSON.stringify(left) === JSON.stringify(right); } catch (_) { return false; }
  }

  function rejectTransaction(message, transactionId, error) {
    const code = error?.code || 'transaction_failed';
    reply(message, 'transaction-rejected', {
      transactionId: transactionId || null,
      code,
      diagnostics: transactionDiagnostic(code, transactionId),
    });
  }

  function commitTransaction(message, transaction, operation = 'apply') {
    try {
      const acknowledged = applyAtomicTransaction(transaction);
      committedTransactions.set(acknowledged.id, acknowledged);
      reply(message, 'transaction-committed', { transaction: acknowledged, operation });
    } catch (error) {
      rejectTransaction(message, transaction?.id, error);
    }
  }

  function validateTransaction(message, transaction) {
    try {
      const acknowledged = applyAtomicTransaction(transaction, { restore: true });
      const valid = acknowledged.patches.every((patch, index) => valuesEqual(patch.value, transaction.patches[index].value));
      reply(message, 'validation-result', {
        transactionId: acknowledged.id,
        valid,
        restored: true,
        observations: acknowledged.patches.map((patch) => ({ patchId: patch.id, value: cloneValue(patch.value) })),
        ...(valid ? {} : { code: 'effect_mismatch', diagnostics: transactionDiagnostic('effect_mismatch', acknowledged.id) }),
      });
    } catch (error) {
      const code = error?.code || 'validation_failed';
      reply(message, 'validation-result', {
        transactionId: transaction?.id || null,
        valid: false,
        restored: code !== 'rollback_failed',
        code,
        diagnostics: transactionDiagnostic(code, transaction?.id),
      });
    }
  }

  function detectedEngines() {
    const documentAnimations = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
    let scrollTriggers = 0;
    try {
      const plugin = window.ScrollTrigger || window.gsap?.plugins?.ScrollTrigger;
      scrollTriggers = plugin?.getAll?.().length || 0;
    } catch (_) {}
    return {
      gsap: Boolean(window.gsap),
      scrollTrigger: scrollTriggers,
      webflow: Boolean(window.Webflow || document.documentElement.hasAttribute('data-wf-page')),
      lottie: Boolean(window.lottie || document.querySelector('[data-animation-type="lottie"],.w-lottie')),
      browserAnimations: documentAnimations.length,
      lenis: Boolean(window.lenis || document.documentElement.classList.contains('lenis')),
      canvas: document.querySelectorAll('canvas').length,
      video: document.querySelectorAll('video').length,
    };
  }

  function controlPlayback(action, nextSpeed, motionId) {
    if (Number.isFinite(nextSpeed)) speed = Math.max(0.1, Math.min(4, nextSpeed));

    // Scoped transport: act ONLY on the selected motion. A scroll-driven page must keep
    // living — pausing the whole document (plus every video and the smooth-scroll lib)
    // is never what "pause this animation" means. `speed` only re-rates, never plays.
    const scoped = motionId ? (motionRegistry.get(motionId) || timelineRecord(motionId)) : null;
    // A SCOPED request that cannot be resolved must never degrade into the
    // global path (pausing the whole document, its videos and Lenis).
    if (motionId && !scoped) return;
    if (scoped) {
      try {
        const animation = scoped.animation;
        if (scoped.type === 'browser') {
          animation.playbackRate = speed;
          if (action === 'pause') animation.pause();
          if (action === 'play') animation.play();
          if (action === 'restart') { animation.currentTime = 0; animation.play(); }
        } else {
          // A tween inside a paused/completed parent timeline never renders on
          // its own — the chain ROOT owns the clock (probe-verified: intro
          // tweens report running while their root sits paused at 0). Drive
          // the root, unless the root is scroll-owned.
          const root = gsapChainRoot(animation);
          const clock = (root !== animation && !(root.scrollTrigger || root.vars?.scrollTrigger)) ? root : animation;
          clock.timeScale?.(speed);
          if (action === 'pause') clock.pause?.();
          if (action === 'play') {
            if ((clock.progress?.() || 0) >= 1) clock.restart?.(true, true);
            else clock.play?.();
          }
          if (action === 'restart') clock.restart?.(true, true);
          // Scrubbing pauses the SELECTED tween (seekTimeline) — a paused child
          // inside a playing root never advances, so play must unpause it too.
          if (clock !== animation && (action === 'play' || action === 'restart')) animation.play?.();
        }
      } catch (_) {}
      emit('playback-changed', { action, speed, motionId });
      emitTimelineState(true);
      return;
    }

    const animations = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
    animations.forEach((animation) => {
      try {
        animation.playbackRate = speed;
        if (action === 'pause') animation.pause();
        if (action === 'play') animation.play();
        if (action === 'restart') { animation.currentTime = 0; animation.play(); }
      } catch (_) {}
    });
    try {
      const timeline = window.gsap?.globalTimeline;
      timeline?.timeScale?.(speed);
      if (action === 'pause') timeline?.pause?.();
      if (action === 'play') timeline?.play?.();
      if (action === 'restart') timeline?.restart?.();
    } catch (_) {}
    document.querySelectorAll('video').forEach((video) => {
      video.playbackRate = speed;
      if (action === 'pause') video.pause();
      if (action === 'play') video.play().catch(() => {});
      if (action === 'restart') { video.currentTime = 0; video.play().catch(() => {}); }
    });
    try {
      if (action === 'pause') window.lenis?.stop?.();
      if (action === 'play' || action === 'restart') window.lenis?.start?.();
    } catch (_) {}
    emit('playback-changed', { action, speed });
    emitTimelineState(true);
  }

  function timelineRecord(motionId) {
    if (!motionRegistry.has(motionId)) {
      const selected = findElement(selectedId);
      if (selected) inspectMotion(selected);
    }
    return motionRegistry.get(motionId) || null;
  }

  function timelineSnapshot(motionId) {
    const record = timelineRecord(motionId);
    if (!record) return null;
    if (record.type === 'browser') {
      const animation = record.animation;
      const effect = animation.effect;
      const timing = effect?.getTiming?.() || {};
      const computed = effect?.getComputedTiming?.() || {};
      const delay = finite(timing.delay);
      const duration = Math.max(1, finite(computed.duration, finite(timing.duration, 1)));
      const cycleDuration = Math.max(1, delay + duration + finite(timing.endDelay));
      const rawTime = finite(animation.currentTime);
      return {
        motionId,
        currentTime: Math.max(0, Math.min(cycleDuration, rawTime > cycleDuration ? rawTime % cycleDuration : rawTime)),
        duration: cycleDuration,
        playState: animation.playState || 'idle',
        speed,
      };
    }
    const animation = record.animation;
    const delay = Math.max(0, finite(animation.delay?.()) * 1000);
    const duration = Math.max(1, finite(animation.duration?.(), 0.001) * 1000);
    // paused() lies for nested tweens: a child of a paused/completed timeline
    // reports unpaused while nothing renders. isActive() reflects the CHAIN —
    // plus the delay window: a delayed child of a running root is still
    // "playing" from the user's seat, not paused.
    const root = gsapChainRoot(animation);
    const chainRunning = root !== animation && typeof root.isActive === 'function' && root.isActive();
    const active = (typeof animation.isActive === 'function' ? animation.isActive() : !animation.paused?.())
      || (chainRunning && !animation.paused?.() && (animation.totalProgress?.() || 0) < 1);
    return {
      motionId,
      currentTime: Math.max(0, Math.min(delay + duration, delay + finite(animation.time?.()) * 1000)),
      duration: delay + duration,
      playState: active ? 'running' : 'paused',
      speed,
    };
  }

  function emitTimelineState(force = false) {
    if (!activeTimelineId) return;
    const now = Date.now();
    if (!force && now - lastTimelineEmit < 32) return;
    lastTimelineEmit = now;
    const snapshot = timelineSnapshot(activeTimelineId);
    if (snapshot) emit('timeline-changed', snapshot);
  }

  function monitorTimeline() {
    timelineFrame = null;
    if (!activeTimelineId) return;
    emitTimelineState(false);
    if (typeof window.requestAnimationFrame === 'function') {
      timelineFrame = window.requestAnimationFrame(monitorTimeline);
    }
  }

  function setTimelineActive(motionId) {
    activeTimelineId = motionId || null;
    if (timelineFrame != null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(timelineFrame);
      timelineFrame = null;
    }
    if (!activeTimelineId) return;
    emitTimelineState(true);
    monitorTimeline();
  }

  function seekTimeline(motionId, nextTime) {
    const record = timelineRecord(motionId);
    if (!record) return;
    const snapshot = timelineSnapshot(motionId);
    const time = Math.max(0, Math.min(snapshot?.duration || 0, Number(nextTime) || 0));
    if (record.type === 'browser') {
      try {
        record.animation.pause();
        record.animation.currentTime = time;
      } catch (_) {}
    } else {
      const delay = Math.max(0, finite(record.animation.delay?.()) * 1000);
      record.animation.pause?.();
      record.animation.time?.(Math.max(0, time - delay) / 1000, false);
    }
    activeTimelineId = motionId;
    emitTimelineState(true);
  }

  function validNegotiation(message) {
    return message &&
      message.protocol === PROTOCOL &&
      message.source === 'host' &&
      message.type === 'negotiate-protocol' &&
      message.payload?.selectedProtocol === PROTOCOL_V2 &&
      Array.isArray(message.supportedProtocols) &&
      message.supportedProtocols.includes(PROTOCOL_V2) &&
      message.sessionNonce === sessionNonce &&
      message.runtimeGeneration === runtimeGeneration &&
      message.bundleId === bundleId &&
      message.sessionId === runtimeSessionId &&
      typeof message.requestId === 'string' && message.requestId.length > 0;
  }

  function validV2Command(message, eventOrigin) {
    return message &&
      negotiatedProtocol === PROTOCOL_V2 &&
      message.protocol === PROTOCOL_V2 &&
      message.protocolVersion === PROTOCOL_V2 &&
      Array.isArray(message.supportedProtocols) &&
      message.supportedProtocols.includes(PROTOCOL_V2) &&
      message.source === 'host' &&
      typeof message.type === 'string' &&
      typeof message.requestId === 'string' && message.requestId.length > 0 &&
      message.sessionNonce === sessionNonce &&
      message.runtimeGeneration === runtimeGeneration &&
      message.bundleId === bundleId &&
      message.sessionId === runtimeSessionId &&
      eventOrigin === trustedHostOrigin;
  }

  function beginRuntimeGesture(message, payload) {
    const gestureId = payload.gestureId;
    if (typeof gestureId !== 'string' || !gestureId || !payload.patch) {
      rejectTransaction(message, null, bridgeError('invalid_gesture', 'The gesture is invalid.'));
      return;
    }
    try {
      const before = cloneValue(readPatchValue(payload.patch));
      activeGestures.set(gestureId, {
        id: gestureId,
        patch: { ...payload.patch, before, value: before },
        before,
        value: before,
        previewUpdates: 0,
        pendingValue: undefined,
        pendingMessage: null,
        previewFrame: null,
      });
      reply(message, 'gesture-previewed', { gestureId, phase: 'began' });
    } catch (error) {
      rejectTransaction(message, null, error);
    }
  }

  function cancelGestureFrame(gesture) {
    if (gesture?.previewFrame == null) return;
    try {
      if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(gesture.previewFrame);
      else clearTimeout(gesture.previewFrame);
    } catch (_) {}
    gesture.previewFrame = null;
  }

  function flushGesturePreview(gesture) {
    if (gesture.pendingValue === undefined) return;
    const value = gesture.pendingValue;
    gesture.pendingValue = undefined;
    applyPatchOrThrow({ ...gesture.patch, value });
    refreshRuntime();
    gesture.value = cloneValue(readPatchValue(gesture.patch));
  }

  function previewRuntimeGesture(message, payload) {
    const gesture = activeGestures.get(payload.gestureId);
    if (!gesture) {
      rejectTransaction(message, null, bridgeError('gesture_missing', 'The gesture is no longer active.'));
      return;
    }
    try {
      if (gesture.previewUpdates >= TRANSACTION_LIMITS.maxPreviewUpdates) {
        throw bridgeError('preview_limit_exceeded', 'The gesture exceeded its preview limit.');
      }
      gesture.previewUpdates += 1;
      gesture.pendingValue = cloneValue(payload.value);
      gesture.pendingMessage = message;
      if (gesture.previewFrame == null) {
        const schedule = typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : (callback) => setTimeout(callback, 16);
        gesture.previewFrame = schedule(() => {
          gesture.previewFrame = null;
          try { flushGesturePreview(gesture); }
          catch (error) {
            try { applyPatchOrThrow({ ...gesture.patch, value: cloneValue(gesture.before) }); refreshRuntime(); } catch (_) {}
            activeGestures.delete(gesture.id);
            rejectTransaction(gesture.pendingMessage || message, null, error);
          }
        });
      }
      reply(message, 'gesture-previewed', {
        gestureId: gesture.id,
        phase: 'queued',
        coalesced: true,
        previewUpdates: gesture.previewUpdates,
        value: cloneValue(payload.value),
      });
    } catch (error) {
      cancelGestureFrame(gesture);
      try { applyPatchOrThrow({ ...gesture.patch, value: cloneValue(gesture.before) }); refreshRuntime(); } catch (_) {}
      activeGestures.delete(gesture.id);
      rejectTransaction(message, null, error);
    }
  }

  function commitRuntimeGesture(message, payload) {
    const gesture = activeGestures.get(payload.gestureId);
    if (!gesture) {
      rejectTransaction(message, payload.transactionId, bridgeError('gesture_missing', 'The gesture is no longer active.'));
      return;
    }
    try {
      cancelGestureFrame(gesture);
      flushGesturePreview(gesture);
      const after = cloneValue(readPatchValue(gesture.patch));
      if (!valuesEqual(after, gesture.value)) throw bridgeError('effect_mismatch', 'The preview result could not be verified.');
      const transaction = {
        id: payload.transactionId || randomIdentity('transaction'),
        requestId: message.requestId,
        source: payload.source || 'gesture',
        createdAt: new Date().toISOString(),
        runtimeGeneration,
        patches: [{ ...gesture.patch, before: cloneValue(gesture.before), value: after }],
      };
      activeGestures.delete(gesture.id);
      committedTransactions.set(transaction.id, transaction);
      reply(message, 'transaction-committed', { transaction, operation: 'gesture' });
    } catch (error) {
      cancelGestureFrame(gesture);
      try { applyPatchOrThrow({ ...gesture.patch, value: cloneValue(gesture.before) }); refreshRuntime(); } catch (_) {}
      activeGestures.delete(gesture.id);
      rejectTransaction(message, payload.transactionId, error);
    }
  }

  function cancelRuntimeGesture(message, payload) {
    const gesture = activeGestures.get(payload.gestureId);
    if (!gesture) {
      reply(message, 'gesture-canceled', { gestureId: payload.gestureId, restored: true });
      return;
    }
    try {
      cancelGestureFrame(gesture);
      applyPatchOrThrow({ ...gesture.patch, value: cloneValue(gesture.before) });
      refreshRuntime();
      activeGestures.delete(gesture.id);
      reply(message, 'gesture-canceled', { gestureId: gesture.id, restored: true });
    } catch (error) {
      activeGestures.delete(gesture.id);
      rejectTransaction(message, null, bridgeError('rollback_failed', error?.message));
    }
  }

  function handleCommand(event) {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (validNegotiation(message)) {
      trustedHostOrigin = event.origin;
      negotiatedProtocol = PROTOCOL_V2;
      reply(message, 'protocol-negotiated', {
        selectedProtocol: PROTOCOL_V2,
        supportedProtocols: SUPPORTED_PROTOCOLS,
        runtimeGeneration,
        sessionNonce,
        bundleId,
        sessionId: runtimeSessionId,
      }, { protocol: PROTOCOL_V2 });
      return;
    }
    if (message?.protocol === PROTOCOL_V2) {
      if (!validV2Command(message, event.origin)) return;
      let messageBytes = 0;
      try { messageBytes = JSON.stringify(message).length; } catch (_) { messageBytes = TRANSACTION_LIMITS.maxBytes + 1; }
      if (messageBytes > TRANSACTION_LIMITS.maxBytes) {
        rejectTransaction(message, message.payload?.transaction?.id, bridgeError('message_too_large', 'The message is too large.'));
        return;
      }
      const cached = processedRequests.get(message.requestId);
      if (cached) {
        emit(cached.type, cached.payload, { protocol: PROTOCOL_V2, requestId: message.requestId });
        return;
      }
    } else if (!message || message.protocol !== PROTOCOL || message.source !== 'host' || negotiatedProtocol === PROTOCOL_V2) {
      return;
    }
    const payload = message.payload || {};

    if (message.type === 'apply-transaction') {
      commitTransaction(message, payload.transaction, 'apply');
    } else if (message.type === 'rollback-transaction') {
      let transaction = payload.transaction;
      if (!transaction && payload.targetTransactionId) {
        const target = committedTransactions.get(payload.targetTransactionId);
        if (target) {
          transaction = {
            id: payload.transactionId || randomIdentity('rollback'),
            requestId: message.requestId,
            source: 'rollback',
            patches: target.patches.slice().reverse().map((patch) => ({
              ...patch,
              id: `${patch.id || randomIdentity('patch')}:rollback`,
              before: cloneValue(patch.value),
              value: cloneValue(patch.before),
            })),
          };
        }
      }
      if (!transaction) rejectTransaction(message, payload.transactionId, bridgeError('transaction_missing', 'The transaction is no longer available.'));
      else commitTransaction(message, transaction, 'rollback');
    } else if (message.type === 'validate-transaction') {
      validateTransaction(message, payload.transaction);
    } else if (message.type === 'begin-gesture') {
      beginRuntimeGesture(message, payload);
    } else if (message.type === 'preview-gesture') {
      previewRuntimeGesture(message, payload);
    } else if (message.type === 'commit-gesture') {
      commitRuntimeGesture(message, payload);
    } else if (message.type === 'cancel-gesture') {
      cancelRuntimeGesture(message, payload);
    } else if (message.type === 'health-check') {
      reply(message, 'runtime-health', {
        status: 'healthy',
        runtimeGeneration,
        activeGestures: activeGestures.size,
        runtimeFingerprint,
      });
    } else if (message.type === 'set-mode') {
      if (payload.mode === 'preview') enterPreviewMode();
      else leavePreviewMode();
    } else if (message.type === 'begin-scrub') {
      if (mode !== 'edit') return;
      scrubActive = true;
      if (viewportTimer) clearTimeout(viewportTimer);
      viewportTimer = null;
      restoreScopedSettlement();
      emitEditState('scrubbing', { loop: false });
    } else if (message.type === 'end-scrub') {
      if (mode !== 'edit') return;
      scrubActive = false;
      if (viewportTimer) clearTimeout(viewportTimer);
      viewportTimer = null;
      freezeSelectionAtCurrent();
    } else if (message.type === 'release-edit-state') {
      releaseEditState();
      emit('edit-state-released', { released: true });
    } else if (message.type === 'set-tool') {
      tool = payload.tool === 'move' ? 'move' : 'select';
      document.documentElement.dataset.uncraftEditorTool = tool;
      emit('tool-changed', { tool });
    } else if (message.type === 'select-element') {
      if (textEditState) finishInlineTextEdit(true);
      select(findElement(payload.elementId));
    } else if (message.type === 'apply-patch') {
      applyPatch(payload.patch, false);
    } else if (message.type === 'apply-patches') {
      (payload.patches || []).forEach((patch) => applyPatch(patch, true));
      const selected = findElement(selectedId);
      emit('patches-applied', { count: (payload.patches || []).length, element: selected ? describe(selected) : null });
    } else if (message.type === 'playback') {
      controlPlayback(payload.action, payload.speed, payload.motionId);
    } else if (message.type === 'set-timeline-active') {
      setTimelineActive(payload.motionId);
    } else if (message.type === 'seek-motion') {
      seekTimeline(payload.motionId, payload.currentTime);
    } else if (message.type === 'inspect-viewport') {
      emitViewportMotion();
    } else if (message.type === 'describe-element') {
      const element = findElement(payload.elementId);
      if (element) emit('element-described', { element: describe(element) });
    } else if (message.type === 'focus-element') {
      const element = findElement(payload.elementId);
      if (element) focusElement(element);
    } else if (message.type === 'scroll-to') {
      // The timeline ruler drives the site: the page's own scroll IS the playhead.
      const target = Math.max(0, Number(payload.scrollY) || 0);
      try { window.scrollTo(0, target); } catch (_) {}
    } else if (message.type === 'scrub-intro') {
      // Playhead inside the intro lane: scrub the load-time sequence by TIME.
      scrubIntroTo(payload.timeMs);
    } else if (message.type === 'refresh') {
      revealAtCache.clear();
      rowCache.clear();
      refreshRuntime();
      emit('runtime-refreshed', { engines: detectedEngines() });
    } else if (message.type === 'inspect-selected') {
      const selected = findElement(selectedId);
      emit('selection-changed', { element: selected ? describe(selected) : null });
    } else if (message.type === 'refresh-inventory') {
      emit('inventory-changed', { assets: collectAssets(), profile: collectDocumentProfile() });
    }
  }

  function installStyles() {
    const style = document.createElement('style');
    style.dataset.uncraftRuntimeBridge = 'true';
    style.textContent = `
      html[data-uncraft-editor-mode="edit"] [data-uncraft-selected="true"] {
        outline: 2px solid #2966ea !important;
        outline-offset: 2px !important;
        cursor: default !important;
      }
      html[data-uncraft-editor-mode="edit"] [data-uncraft-hovered="true"] {
        outline: 1px solid rgba(41, 102, 234, 0.82) !important;
        outline-offset: 1px !important;
        cursor: default !important;
      }
      html[data-uncraft-editor-mode="edit"][data-uncraft-editor-tool="move"] [data-uncraft-hovered="true"],
      html[data-uncraft-editor-mode="edit"][data-uncraft-editor-tool="move"] [data-uncraft-selected="true"] {
        cursor: move !important;
      }
      html[data-uncraft-editor-mode="edit"] [data-uncraft-text-editing="true"] {
        outline: 2px solid #2966ea !important;
        outline-offset: 2px !important;
        cursor: text !important;
        caret-color: #2966ea !important;
        user-select: text !important;
        -webkit-user-select: text !important;
      }
      [data-uncraft-inline-text-overlay="true"] {
        outline: 2px solid #2966ea !important;
        outline-offset: 2px !important;
        cursor: text !important;
        caret-color: #2966ea !important;
        user-select: text !important;
        -webkit-user-select: text !important;
      }
      html[data-uncraft-editor-mode="edit"],
      html[data-uncraft-editor-mode="edit"] body {
        cursor: default;
      }
    `;
    document.head.appendChild(style);
  }

  function pixelTranslate(value) {
    const match = String(value || '').trim().match(/^(-?\d*\.?\d+)px(?:\s+(-?\d*\.?\d+)px)?$/);
    return match ? { x: Number(match[1]), y: Number(match[2] || 0) } : { x: 0, y: 0 };
  }

  function boot() {
    installStyles();
    document.documentElement.dataset.uncraftEditorMode = mode;
    document.documentElement.dataset.uncraftEditorTool = tool;
    document.documentElement.dataset.uncraftEditState = editState;
    on(document, 'pointermove', (event) => {
      if (dragState) {
        const dx = Math.round(event.clientX - dragState.startX);
        const dy = Math.round(event.clientY - dragState.startY);
        dragState.dx = dx;
        dragState.dy = dy;
        dragState.value = `${dragState.base.x + dx}px ${dragState.base.y + dy}px`;
        dragState.element.style.translate = dragState.value;
        event.preventDefault();
        return;
      }
      if (textEditState) return;
      if (mode !== 'edit') return;
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => hover(chooseElement(event.target)));
    }, true);
    on(document, 'pointerleave', () => hover(null), true);
    on(document, 'pointerdown', (event) => {
      if (mode !== 'edit' || tool !== 'move' || event.button !== 0) return;
      const element = chooseElement(event.target);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      select(element);
      dragState = {
        element,
        elementId: ensureElementId(element),
        startX: event.clientX,
        startY: event.clientY,
        before: element.style.translate || '',
        base: pixelTranslate(element.style.translate),
        value: element.style.translate || '',
        dx: 0,
        dy: 0,
        rect: element.getBoundingClientRect(),
      };
      element.setPointerCapture?.(event.pointerId);
    }, true);
    on(document, 'pointerup', (event) => {
      if (!dragState) return;
      const finished = dragState;
      dragState = null;
      finished.element.releasePointerCapture?.(event.pointerId);
      if (Math.abs(finished.dx) + Math.abs(finished.dy) > 2) {
        suppressClickUntil = Date.now() + 120;
        const layoutIntent = {
          delta: { x: finished.dx, y: finished.dy },
          originalRect: {
            x: Math.round(finished.rect.x), y: Math.round(finished.rect.y),
            width: Math.round(finished.rect.width), height: Math.round(finished.rect.height),
          },
        };
        const elementDescription = describe(finished.element);
        if (negotiatedProtocol === PROTOCOL_V2) {
          const transaction = {
            id: randomIdentity('transaction'),
            requestId: randomIdentity('runtime-gesture'),
            source: 'properties',
            createdAt: new Date().toISOString(),
            runtimeGeneration,
            patches: [{
              id: randomIdentity('patch'),
              elementId: finished.elementId,
              kind: 'style',
              property: 'translate',
              motionId: null,
              before: finished.before,
              value: finished.value,
              layoutIntent,
            }],
          };
          committedTransactions.set(transaction.id, transaction);
          emit('transaction-committed', {
            transaction,
            operation: 'runtime-gesture',
            originatedByRuntime: true,
            element: elementDescription,
          }, { protocol: PROTOCOL_V2, requestId: transaction.requestId });
        } else {
          emit('layout-intent-committed', {
            elementId: finished.elementId,
            before: finished.before,
            value: finished.value,
            ...layoutIntent,
            element: elementDescription,
          });
        }
      }
    }, true);
    on(document, 'click', (event) => {
      if (mode !== 'edit') return;
      if (textEditState) {
        if (textEditState.element.contains(event.target) || textEditState.editable?.contains(event.target)) return;
        finishInlineTextEdit(true);
      }
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const element = chooseElement(event.target);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      select(element);
    }, true);
    on(document, 'dblclick', (event) => {
      if (mode !== 'edit' || tool !== 'select') return;
      const element = chooseElement(event.target);
      if (!element || !isEditableText(element)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      enterInlineTextEdit(element);
    }, true);
    on(document, 'keydown', (event) => {
      if (!textEditState) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finishInlineTextEdit(false);
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        finishInlineTextEdit(true);
      }
    }, true);
    on(document, 'focusout', () => {
      if (!textEditState) return;
      queueMicrotask(() => {
        if (textEditState && !textEditState.editable.contains(document.activeElement)) finishInlineTextEdit(true);
      });
    }, true);
    on(document, 'submit', (event) => {
      if (mode === 'edit') event.preventDefault();
    }, true);
    // Single live instance per document. Re-injecting the bridge (iframe reload,
    // double gateway injection) must REPLACE the previous one — two live bridges
    // handle every command twice: duplicated patches, duplicated playback.
    try { window.__uncraftMotionBridge?.teardown?.(); } catch (_) {}
    document.documentElement.dataset.uncraftEditorMode = mode;
    document.documentElement.dataset.uncraftEditorTool = tool;
    document.documentElement.dataset.uncraftEditState = editState;
    syncEditConventions();
    // Scrolling the site re-scopes the timeline. Debounced to the scroll settling:
    // the list is cheap to build, but rebuilding it on every scroll event is waste.
    const scheduleViewportMotion = () => {
      if (viewportTimer) clearTimeout(viewportTimer);
      viewportTimer = setTimeout(() => {
        viewportTimer = null;
        emitViewportMotion();
        if (mode === 'edit' && !scrubActive) {
          const selected = findElement(selectedId);
          if (selected) {
            emitEditState('selection-pending', { loop: false });
            settleSelection(selected);
          } else {
            emitEditState('navigating', { loop: false });
          }
        }
      }, 120);
    };
    on(window, 'scroll', () => {
      if (mode === 'edit' && !scrubActive) {
        restoreScopedSettlement();
        emitEditState('navigating', { loop: false });
      }
      replayCrossedAnimations();
      scheduleViewportMotion();
    }, { passive: true });
    on(window, 'resize', () => {
      // Reveal points are functions of viewport height — a resize re-derives
      // them (and the row list) from scratch.
      revealAtCache.clear();
      rowCache.clear();
      scheduleViewportMotion();
    });

    on(window, 'message', handleCommand);
    heartbeatTimer = setInterval(() => {
      emit('heartbeat', {
        status: 'healthy',
        runtimeGeneration,
        now: Date.now(),
      });
    }, 1000);
    window.__uncraftMotionBridge = {
      teardown() {
        releaseEditState();
        activeGestures.forEach((gesture) => {
          cancelGestureFrame(gesture);
          try { applyPatchOrThrow({ ...gesture.patch, value: cloneValue(gesture.before) }); } catch (_) {}
        });
        activeGestures.clear();
        try { listeners.abort(); } catch (_) {}
        try { if (heartbeatTimer) clearInterval(heartbeatTimer); } catch (_) {}
        heartbeatTimer = null;
        try { if (viewportTimer) clearTimeout(viewportTimer); } catch (_) {}
        viewportTimer = null;
        try { if (recoveryTimer) clearTimeout(recoveryTimer); } catch (_) {}
        recoveryTimer = null;
        try {
          if (timelineFrame != null && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(timelineFrame);
            timelineFrame = null;
          }
        } catch (_) {}
        activeTimelineId = null;
      },
    };
    emit('runtime-ready', {
      title: document.title || 'Animated website',
      elementCount: document.querySelectorAll('*').length,
      engines: detectedEngines(),
      profile: collectDocumentProfile(),
      assets: collectAssets(),
      supportedProtocols: SUPPORTED_PROTOCOLS,
      selectedProtocol: PROTOCOL,
      sessionNonce,
      runtimeGeneration,
      bundleId,
      sessionId: runtimeSessionId,
      runtimeFingerprint,
    });
  }

  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot, { once: true });
}

export function getRuntimeBridgeSource() {
  return `;(${nativeMotionRuntimeBridge.toString()})();`;
}
