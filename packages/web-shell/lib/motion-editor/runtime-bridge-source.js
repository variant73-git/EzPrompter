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
  const initialControlManifest = runtimeConfig.initialManifest?.controlManifest;
  const controlRegistry = new Map();
  if (initialControlManifest
    && initialControlManifest.bundleId === bundleId
    && initialControlManifest.runtimeFingerprint === runtimeFingerprint
    && Array.isArray(initialControlManifest.controls)) {
    initialControlManifest.controls.forEach((control) => {
      if (control?.status === 'ready' && typeof control.id === 'string' && Array.isArray(control.targets)) {
        controlRegistry.set(control.id, control);
      }
    });
  }
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

  // Vars owned by a GSAP plugin, in either authored shape: structured namespaces
  // (attr:{...}) or SCALAR vars claimed by a REGISTERED plugin (text:"...",
  // scrollTo:500 — probe 2026-07-29: a registered plugin's init runs for its
  // scalar var even beside a css wrapper). The var key is CASE-SENSITIVE and
  // comes from the plugin's declared name — every plugin in gsap.core.globals()
  // publishes it verbatim in `.prop` ({prop:'attr'}, {prop:'Fakeplug'}; probed),
  // so the set is read from there, never derived from the `<Name>Plugin` global
  // key (lossy capitalization — Sol v8). ONE predicate, shared by the classifier
  // and BOTH writers: no vars-write path is proven for plugin vars, so both
  // edit channels lock wherever this is true.
  function gsapRegisteredPluginVars() {
    const names = new Set();
    try {
      const globals = window.gsap?.core?.globals?.() || {};
      Object.values(globals).forEach((value) => {
        const prop = value?.prop;
        if (typeof prop === 'string' && prop) names.add(prop);
      });
    } catch (_) {}
    return names;
  }

  function gsapPluginOwnedVar(vars, property) {
    // Key PRESENCE, not value: GSAP dispatches plugins by enumerated key, so
    // {Fakeplug: undefined} still runs the plugin's init (probe 2026-07-29 —
    // a plugin may treat undefined as its default and keep writing).
    if (!vars || !Object.prototype.hasOwnProperty.call(vars, property)) return false;
    const value = vars[property];
    if (value && typeof value === 'object') return true;
    return gsapRegisteredPluginVars().has(property);
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

  // The component keys a retarget descriptor can carry for each runtime property —
  // mirrored by BOTH the classifier and the writer's bucket lookup so provenance
  // (top-level vars vs css wrapper) can never diverge between them.
  function gsapDescriptorComponentKeys(property) {
    if (property === 'scale') return ['scaleX', 'scaleY'];
    if (property === 'translate') return ['translateX', 'translateY'];
    if (property === 'skew') return ['skewX', 'skewY'];
    if (property === 'transform') return ['translateX', 'translateY', 'scaleX', 'scaleY', 'rotate', 'skewX', 'skewY'];
    if (property === 'transformOrigin') return ['transformOriginX', 'transformOriginY'];
    return [];
  }

  // GSAP config/callback vars — never real animatable properties. Shared between
  // the clip lister and the retarget guard so both agree on what a "property" is.
  const GSAP_CONFIG_VARS = new Set([
    'id', 'parent', 'duration', 'delay', 'ease', 'repeat', 'repeatDelay', 'yoyo', 'scrollTrigger',
    'stagger', 'immediateRender', 'startAt', 'overwrite', 'runBackwards', 'lazy', 'paused', 'reversed',
    'callbackScope', 'onComplete', 'onInterrupt', 'onRepeat', 'onReverseComplete', 'onStart', 'onUpdate',
    'force3D', 'data', 'autoRound', 'inherit', 'defaults', 'smoothChildTiming', 'keyframes', 'clearProps',
    // The rest of GSAP 3.15's _reservedProps — extracted VERBATIM from the
    // fixture source, and nothing beyond it: omitting one surfaces FALSE
    // editable tracks (yoyoEase inside entries validated edits that changed
    // nothing visual — Sol r17), while adding one NOT in the list hides a
    // genuine writer (GSAP really animates a target-owned `onOverwrite` —
    // Sol r18). The reserved lookup is callbacks + their `<name>Params` + the
    // literal tail (fixture: `Tt += t + "," + t + "Params,"` — Sol r19), so
    // the six Params lists ARE reserved.
    'stringFilter', 'yoyoEase', 'repeatRefresh', 'autoRevert', 'easeReverse',
    'onCompleteParams', 'onUpdateParams', 'onStartParams', 'onRepeatParams',
    'onReverseCompleteParams', 'onInterruptParams',
    // Legacy GSAP-2 wrapper — its SUB-KEYS are the real animated properties.
    'css',
  ]);

  // vars.keyframes holds animated properties the top-level vars never mention, in
  // three authored shapes (GSAP 3): entry array [{x, duration}...], property-array
  // {x:[...], easeEach}, and percent/numeric stops {"50%":{x}} / {50:{x}}. Real GSAP MUTATES the entries,
  // injecting config keys (parent/ease/overwrite/delay/duration) beside the animated
  // ones (probe-verified 2026-07-29), so extraction filters through the same ignored
  // set. Without this, keyframes tweens reported ZERO tracks -> the host saw the
  // property as unowned -> wrote a style patch the live tween stomps every tick.
  // for..in mirror for INVENTORY (Sol r119): own + inherited enumerable keys
  // — GSAP creates PropTweens for inherited vars too. Fail-closed direction
  // for inventory is INCLUSION: a partially-enumerable proxy still surfaces
  // whatever keys it yields (the write-side scans fail closed separately).
  function gsapForInKeys(owner) {
    const keys = [];
    try {
      // eslint-disable-next-line guard-for-in
      for (const key in owner) keys.push(key);
    } catch (_) {}
    return keys;
  }

  function gsapKeyframeProps(keyframes, ignored) {
    const names = new Set();
    const collect = (entry) => {
      if (!entry || typeof entry !== 'object') return;
      gsapForInKeys(entry).forEach((key) => {
        // css wrapper INSIDE a keyframes entry is honored by GSAP (probe-verified)
        // — recurse into it or the writer goes invisible again.
        if (key === 'css' && entry.css && typeof entry.css === 'object' && !Array.isArray(entry.css)) {
          collect(entry.css);
          return;
        }
        if (!ignored.has(key) && key !== 'parent' && key !== 'easeEach') names.add(key);
      });
    };
    if (Array.isArray(keyframes)) keyframes.forEach(collect);
    else if (keyframes && typeof keyframes === 'object') {
      gsapForInKeys(keyframes).forEach((key) => {
        const value = keyframes[key];
        if (Array.isArray(value)) {
          if (!ignored.has(key) && key !== 'easeEach') names.add(key);
        } else if (value && typeof value === 'object' && Number.isFinite(parseFloat(key))) {
          // Position-stop keys: GSAP parseFloats them, so "50%", "50" and 50 are all
          // valid stops (probe-verified — % is NOT required).
          collect(value);
        }
      });
    }
    return Array.from(names);
  }

  // The ONLY safe write on a keyframes tween is editing the ENTRIES of the ARRAY
  // form (probe 2026-07-29, _probe-kf-entryedit.mjs, GSAP 3.15 real): trailing-run
  // entry edits + preserved-start invalidate render a clean path — intermediates
  // and non-trailing duplicates intact, entry-level css wrappers honored, post-hoc
  // startAt clean. Everything outside this plan stays locked: property-array and
  // stops forms no-op on entry writes; BOTH-PLACES authoring corrupts (the
  // invalidate RESURRECTS the dead top-level value — probe H); component-decomposed
  // props, plugin props and relative/function entry values have no probed write;
  // and a stagger facade's inner rebuild is unproven. ONE predicate shared by the
  // classifier and both writers (furo #2 lesson): returns the trailing-run write
  // buckets (every consecutive final entry sharing the end value — an entry's css
  // wrapper IS its bucket when the property lives there), or null.
  // The LIVE processed entries of the ARRAY keyframes form, in SEGMENT order.
  // The inner timeline is the truth when exposed: GSAP builds one child tween
  // per processed entry at construction, child.vars IS the entry object, and
  // children sit in TIME order. The array is not the truth — reversing it never
  // reorders the rendered segments, a raw appended entry never becomes a child,
  // and a SPLICED-OUT entry's child stays alive and rendering (probes
  // _probe-kf-reorder.mjs / _probe-kf-append.mjs: after reverse() the path still
  // renders 100→200→300; writing the last CHILD's entry retargets the real end;
  // appended {x:400} never renders). The array (filtered to GSAP-processed
  // entries — it injects `parent` with ease/duration/overwrite/delay into each;
  // raw entries are INERT dead slots) stands in ONLY when getChildren is absent
  // or throws — an EMPTY children list is an answer, not an outage (Sol r8).
  // POSITIVE provenance of the keyframes form, per animation: an inner timeline
  // alone proves NOTHING — a plain tween builds one too when duration/delay is
  // a function or string, and its children's vars are per-target COPIES with
  // the animated prop + injected `parent` (probe _probe-plain-fnduration.mjs),
  // indistinguishable from entries by shape. Treating those as keyframes would
  // lock a legitimate plain tween (Sol r10 — generalized-lock product-rule
  // violation). So the shape is CACHED while vars.keyframes is still present;
  // after the page deletes it, the cache is the proof. An animation first seen
  // only after the delete is treated as plain — the pre-feature status quo.
  // FROZEN at first observation — shape AND source identity. A later truthy
  // REPLACEMENT of vars.keyframes is an impostor (the original source's
  // children keep rendering — inner timeline built once): letting it overwrite
  // the cache abandons the live writers and a stale patch falls through to the
  // plain vars writer, resurrecting the probe-H corruption (Sol r15).
  // Ownership entries for the ARRAY form. A STAGGER facade's outer children
  // are per-target COPIES whose vars carry the `keyframes` key itself and no
  // animated props (probe on GSAP 3.15, Claude final review) — reading
  // ownership from them yields ZERO tracks (the furo-#1 unowned lie) and lets
  // the plain vars writer through. There the authored array is the truth.
  function gsapAuthoredOwnershipEntries(animation, vars, source) {
    const rawChildren = gsapInnerTimelineEntries(animation);
    // Uninspectable timeline: OWNERSHIP (detection) falls back to the source
    // (fail-closed inventory) while the WRITE plan denies separately (Sol r55).
    const children = Array.isArray(rawChildren) ? rawChildren : null;
    const facades = (vars && vars.stagger != null)
      || (children && children.length > 0 && children.every((entry) => entry && entry.keyframes));
    if (!facades && children) return children;
    return Array.isArray(source) ? gsapProcessedEntries(source) : [];
  }

  const gsapKeyframesOriginShapes = new WeakMap();
  function gsapKeyframesOrigin(animation, vars) {
    const cached = gsapKeyframesOriginShapes.get(animation);
    if (cached) return cached;
    if (vars && vars.keyframes) {
      const isArray = Array.isArray(vars.keyframes);
      const origin = {
        shape: isArray ? 'array' : 'other',
        source: vars.keyframes,
        // CONTENT frozen too: an in-place mutation (delete source.x) keeps the
        // reference identical while the children keep rendering — the authored
        // prop set observed here is the durable truth (Sol r16). For the array
        // form the processed entries are the authored truth (raw slots lie).
        props: isArray
          ? gsapKeyframeProps(gsapAuthoredOwnershipEntries(animation, vars, vars.keyframes), GSAP_CONFIG_VARS)
          : gsapKeyframeProps(vars.keyframes, GSAP_CONFIG_VARS),
      };
      gsapKeyframesOriginShapes.set(animation, origin);
      return origin;
    }
    return null;
  }

  function gsapProcessedEntries(list) {
    return list.filter((entry) =>
      entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'parent'));
  }

  // Entries whose child grew its OWN inner timeline: GSAP passes each entry to
  // tl.to(), which re-processes stagger and fn/string timing — the real
  // animation then lives a level deeper, and writing the outer entry renders
  // NOTHING (probe _probe-r19.mjs: end stayed 200 after an outer x:900).
  // Marked here, rejected by the write plan (Sol r19).
  const gsapNestedFacadeEntries = new WeakSet();
  // Entry -> child tween, so the plan can confront what an entry DECLARES with
  // what its child ACTUALLY animates (Sol r27).
  const gsapEntryChildTweens = new WeakMap();

  // The raw child tweens whose vars are processed entries. ALIASED entries
  // (same object at two positions) have DISTINCT children — per-occurrence
  // checks must walk these pairs, never an entry->child map, which keeps only
  // the last occurrence and blinds the hazard to a kill in the first
  // (Sol r44).
  function gsapInnerTimelineChildren(animation) {
    // `null` means ONLY "no timeline ever existed" (a plain tween's timeline
    // is the falsy 0) — a PRESENT timeline whose getChildren is missing or
    // broken hides an unknowable structure and must fail closed, never fall
    // back to the (possibly reordered) array (Sol r56).
    if (!animation.timeline) return null;
    if (typeof animation.timeline.getChildren !== 'function') return 'uninspectable';
    try {
      // Every real child is authoritative BY CONSTRUCTION — the injected
      // `parent` key is mutable metadata, and filtering on it would shrink
      // the live set when the page deletes it, misidentifying the terminal
      // (Sol r67). The parent filter belongs only to the SOURCE fallback,
      // where raw appended entries are genuinely inert.
      const rawChildren = animation.timeline.getChildren();
      if (!Array.isArray(rawChildren)) return 'uninspectable';
      const children = rawChildren.filter((child) =>
        child && child.vars && typeof child.vars === 'object');
      // A discarded child means the snapshot was NOT integrally inspectable —
      // validating only the survivors could certify a partial view as
      // 'healthy' and erase a proven hazard. Any discard fails closed
      // (Sol r78).
      if (children.length !== rawChildren.length) return 'uninspectable';
      children.forEach((child) => {
        gsapEntryChildTweens.set(child.vars, child);
        if (child.timeline) gsapNestedFacadeEntries.add(child.vars);
      });
      gsapLiveObservedAnimations.add(animation);
      return children;
    } catch (_) {
      // Tri-state (Sol r55): an ABSENT API allows the array fallback; a
      // THROWING one means the real structure is unknowable — callers must
      // fail closed, never fall back.
      return 'uninspectable';
    }
  }

  function gsapInnerTimelineEntries(animation) {
    const children = gsapInnerTimelineChildren(animation);
    if (children === 'uninspectable') return 'uninspectable';
    return children ? children.map((child) => child.vars) : null;
  }

  // OWNERSHIP read of the authored keyframes props — the single helper for the
  // classifier and both writer guards. For the ARRAY form, raw slots lie in
  // both directions (a raw appended entry is INERT and never renders — probe
  // _probe-kf-append.mjs), so only PROCESSED entries count: the live children
  // when the inner timeline is exposed, else the parent-injected entries of
  // the array. Counting a raw slot would mark a PLAIN prop keyframe-owned and
  // lock its legitimate writer with no cure (Sol r14). The object/stops forms
  // keep the raw read — GSAP consumes them wholesale.
  function gsapAuthoredKeyframeProps(animation, ignored) {
    const vars = animation?.vars;
    if (!vars) return [];
    const origin = gsapKeyframesOrigin(animation, vars);
    if (!origin) return [];
    // The FROZEN prop set is the floor (in-place source mutations cannot hide
    // live segments — Sol r16); for the array form the live ownership entries
    // union in on top (never a truthy replacement — the inert impostor of Sol
    // r15; never facade copies — Claude final review).
    if (origin.shape === 'other') return origin.props;
    const entries = gsapAuthoredOwnershipEntries(animation, animation.vars, origin.source);
    const observedProps = gsapLiveObservedPropSets.get(animation);
    return Array.from(new Set(origin.props
      .concat(gsapKeyframeProps(entries, ignored))
      .concat(observedProps ? Array.from(observedProps) : [])));
  }

  // WRITE-grade live entries: only for animations with proven ARRAY origin.
  // Consulted independently of vars.keyframes still being present — GSAP keeps
  // the inner timeline (and its live, rendering entries) after the page
  // deletes/replaces the array (probe _probe-kf-delete.mjs); gating on the
  // array would vanish the writer from the inventory and reopen furo #1
  // (Sol r9). A STAGGER facade's children are per-target copies — excluded.
  function gsapLiveKeyframeEntries(animation) {
    const vars = animation?.vars;
    if (!vars) return null;
    const origin = gsapKeyframesOrigin(animation, vars);
    if (vars.stagger != null) return null;
    if (!origin || origin.shape !== 'array') return null;
    const children = gsapInnerTimelineEntries(animation);
    if (children === 'uninspectable') return null; // write-grade fails closed (Sol r55)
    if (children) return children;
    // A HIDDEN timeline after observation is not absence — the array may have
    // been reordered meanwhile; write-grade denies until children reappear
    // (Sol r71).
    if (gsapLiveObservedAnimations.has(animation)) return null;
    // Fallback reads the ORIGINAL source — a replacement array is inert.
    return gsapProcessedEntries(origin.source);
  }

  // DETECTION-grade PROPERTIES: keeps deleted keyframes tweens inventoried
  // (fail-closed) — proven origin of ANY shape qualifies (object/percent forms
  // stay write-denied: no ARRAY proof). For an UNPROVEN origin (deleted before
  // the first inspection), OWNERSHIP decides PER PROPERTY — key-shape
  // heuristics are unsound (GSAP passes entries to tl.to() verbatim, so
  // `stagger: 0` is a legitimate entry key — Sol r11), and whole-child
  // filtering drags plain props into the lock on a mixed child (Sol r12): a
  // per-target COPY only ever mirrors props the tween's own vars (or css
  // wrapper) still carries — those have a live plain writer and stay plain
  // (Sol r10). A property the vars does NOT own has no other writer: it stays
  // inventoried but LOCKED — detection is fail-closed, the write plan still
  // demands proof.
  function gsapDetectionKeyframeProps(animation, ignored) {
    const vars = animation?.vars;
    if (!vars) return [];
    if (vars.stagger != null) return [];
    const origin = gsapKeyframesOrigin(animation, vars);
    const children = gsapInnerTimelineEntries(animation);
    if (!children || children === 'uninspectable') return [];
    const props = gsapKeyframeProps(children, ignored);
    // Proven origin: ALWAYS union the live children — never gate on source
    // identity (a reference can be mutated in place — Sol r16) nor on the
    // truthy key (a replacement is an inert impostor — Sol r15).
    if (origin) return props;
    const wrapper = vars.css && typeof vars.css === 'object' && !Array.isArray(vars.css) ? vars.css : null;
    return props.filter((property) =>
      !Object.prototype.hasOwnProperty.call(vars, property) && !(wrapper && property in wrapper));
  }

  // Properties the renderer NORMALIZES: raw values outside the range compute
  // to the same rendered value (opacity 2 and 3 both render 1 — Sol r24), so
  // equivalence must compare THROUGH the clamp or a visual hold reads as a
  // ramp.
  const GSAP_RENDER_CLAMPS = { opacity: [0, 1], autoAlpha: [0, 1] };

  // Three-state value equivalence, shared by the plan's trailing-run walk and
  // the writer's pre-write simulation (Sol r20/r21). Numbers only compare
  // within the SAME unit: cross-unit pairs are ambiguous in BOTH directions —
  // '16px' vs '1rem' may render equal (a hidden hold) just as '200px' vs 200
  // may — and either misread corrupts the path on retarget (Sol r22).
  function gsapValueEquivalence(property, left, right) {
    if (String(left) === String(right)) return 'equal';
    const parsedLeft = numericCss(String(left));
    const parsedRight = numericCss(String(right));
    // Parse failure on a differing pair is ambiguous in BOTH directions too:
    // '#fff' vs 'rgb(255,255,255)' render EQUAL (a hidden hold) and '#00f' IS
    // 'blue' — neither equality nor distinctness is provable (Sol r23).
    if (!parsedLeft || !parsedRight) return 'ambiguous';
    if (parsedLeft.unit !== parsedRight.unit) return 'ambiguous';
    const clampRange = GSAP_RENDER_CLAMPS[property];
    if (clampRange) {
      // autoAlpha carries a DISCRETE visibility state beside the clamped
      // number: exactly 0 renders visibility:hidden, anything else inherits —
      // -1 and 0 are NOT equivalent (Sol r25).
      if (property === 'autoAlpha' && (parsedLeft.value === 0) !== (parsedRight.value === 0)) return 'different';
      // Percents normalize BEFORE the clamp: '2%' is 0.02, not 2 (Sol r25).
      const rendered = (parsed) => {
        const raw = parsed.unit === '%' ? parsed.value / 100 : parsed.value;
        return Math.min(clampRange[1], Math.max(clampRange[0], raw));
      };
      return rendered(parsedLeft) === rendered(parsedRight) ? 'equal' : 'different';
    }
    return parsedLeft.value === parsedRight.value ? 'equal' : 'different';
  }

  // ANIMATION-level resurrection hazard: an entry that DECLARES a prop whose
  // PropTween was killed (t.kill(target, prop)) is a trap — OUR invalidate,
  // fired by an edit of ANY channel (a rides-along top-level prop included),
  // re-inits from vars and brings the dead writer back, stomping whatever
  // animation took the channel over (probe _probe-r28.mjs: x 999 -> 200 after
  // a y edit — Sol r28/r29). Consulted by the classifier and BOTH writers
  // before any mutation. Plugin vars excluded — their lookup entries are
  // unreliable (furo #2 v10).
  // Aliased props materialize in _ptLookup under their EXPANDED keys, in two
  // distinct shapes (probes _probe-r30.mjs / _probe-r31.mjs — Sol r30/r31):
  // SYNONYMS rename a single writer (rotate/rotationZ -> rotation,
  // translateX -> x, rotateX -> rotationX, alpha -> opacity), while COMPOUNDS
  // fan out into SEVERAL writers that must ALL be alive — a partial kill
  // (opacity of autoAlpha, scaleX of scale) leaves the sibling in the lookup,
  // and .some() would read the trap as healthy; the leftover literal `scale`
  // key is no shortcut either.
  const GSAP_PT_SYNONYMS = {
    rotate: 'rotation', rotateZ: 'rotation', rotationZ: 'rotation',
    rotateX: 'rotationX', rotateY: 'rotationY',
    translateX: 'x', translateY: 'y', translateZ: 'z',
    alpha: 'opacity',
  };
  const GSAP_PT_COMPOUNDS = { autoAlpha: ['opacity', 'visibility'], scale: ['scaleX', 'scaleY'] };

  // The canonical _ptLookup keys a declared property materializes as — the ONE
  // resolver shared by the hazard (every: all writers alive) and the
  // hidden-carrier check (some: any writer still alive) (Sol r31/r32).
  function gsapPtRequiredKeys(property) {
    return GSAP_PT_COMPOUNDS[property] || [GSAP_PT_SYNONYMS[property] || property];
  }

  // The AGGREGATE `transform` materializes VALUE-dependent writers that no
  // static map can reconstruct — GSAP diffs the full start/end caches, so
  // translate3d yields x/y/z and omitted-but-reset components become writers
  // too (Sol r33/r34). Two-tier detection: at FIRST sight the declared model
  // is best-effort (synonyms/compounds exact; `transform` needs only SOME
  // component alive — a partial pre-observation kill is a documented
  // residual); from then on the OBSERVED baseline of each child's lookup keys
  // is the truth — any key that vanishes is a killed writer our invalidate
  // would resurrect.
  const GSAP_TRANSFORM_COMPONENT_KEYS = ['x', 'y', 'z', 'scaleX', 'scaleY', 'rotation', 'rotationX', 'rotationY', 'skewX', 'skewY'];
  const gsapChildLookupBaselines = new WeakMap();

  // Tri-state verdict: false (no hazard), 'unknown' (structure transiently
  // uninspectable — outage), 'proven' (a dead/orphaned writer, runBackwards
  // entry or signature violation was actually OBSERVED). Restores may traverse
  // 'unknown' only — an invalidate under a PROVEN hazard resurrects the killed
  // channel even when the restored payload is authored (Sol r75).
  function gsapResurrectionHazard(animation) {
    return Boolean(gsapResurrectionHazardVerdict(animation));
  }

  // A PROVEN hazard is remembered per animation: the dead writer is still
  // there when an outage later hides the children — the verdict must not
  // downgrade to 'unknown' and open the restore lane (Sol r76). Cleared only
  // after a provably healthy FULL inspection (live children walked, every
  // check passed).
  const gsapProvenHazardAnimations = new WeakSet();

  function gsapResurrectionHazardVerdict(animation) {
    const verdict = gsapResurrectionHazardScan(animation);
    if (verdict === 'proven') {
      gsapProvenHazardAnimations.add(animation);
      return 'proven';
    }
    if (verdict === 'unknown') {
      return gsapProvenHazardAnimations.has(animation) ? 'proven' : 'unknown';
    }
    // Only an explicitly HEALTHY scan (every child initted, complete lookups,
    // every check passing) proves recovery and clears the memory. A plain
    // false (no hazard seen, but validation incomplete — non-initted children,
    // missing lookups) proves nothing: a proven animation stays proven
    // (Sol r77).
    if (verdict === 'healthy') {
      gsapProvenHazardAnimations.delete(animation);
      return false;
    }
    return gsapProvenHazardAnimations.has(animation) ? 'proven' : false;
  }

  function gsapResurrectionHazardScan(animation) {
    // gsap.from() semantics INSIDE an entry (entry-level runBackwards /
    // materialized child._from): the entry's values are STARTS, not ends —
    // editing them as ends corrupts the path while reporting success, and any
    // edit's invalidate re-inits the whole timeline (Sol r40). Scanned over
    // the LIVE entries so it holds with or without an exposed inner timeline.
    // The signature scan must run on EVERY inspection even while the timeline
    // is transiently uninspectable: the processed SOURCE entries are the same
    // objects the children hold, so they carry the identities (Sol r64). The
    // live-vs-blind provenance comes from the CHILDREN read directly — a falsy
    // (stashed) timeline also means BLIND, not just a throwing one (Sol r66).
    // With the source unrecoverable too, the animation is marked
    // signature-unknown durably — no later baseline without proof of a
    // rebuild.
    const hazardOrigin = gsapKeyframesOrigin(animation, animation.vars);
    const hazardChildren = hazardOrigin && hazardOrigin.shape === 'array'
      ? gsapInnerTimelineChildren(animation)
      : null;
    const scanIsLive = Array.isArray(hazardChildren);
    // Live children go in UNFILTERED — the `parent` filter would drop a
    // metadata-stripped child from the signature scan (Sol r67/r68); it
    // belongs only to the source fallback.
    const scanEntries = scanIsLive
      ? hazardChildren.map((child) => child.vars).filter((entry) => entry && typeof entry === 'object')
      : (hazardOrigin && hazardOrigin.shape === 'array' && Array.isArray(hazardOrigin.source)
        ? gsapProcessedEntries(hazardOrigin.source)
        : null);
    if (!scanEntries && hazardOrigin && hazardOrigin.shape === 'array') {
      gsapSignatureUnknownAnimations.add(animation);
    }
    // Observed-prop feed runs BEFORE the unknown early-return: even a
    // signature-unknown animation keeps its inventory truthful for props
    // materialized and seen later (Sol r73).
    if (scanIsLive && Array.isArray(scanEntries)) {
      let observedProps = gsapLiveObservedPropSets.get(animation);
      if (!observedProps) {
        observedProps = new Set();
        gsapLiveObservedPropSets.set(animation, observedProps);
      }
      scanEntries.forEach((entry) => {
        gsapKeyframeProps([entry], GSAP_CONFIG_VARS).forEach((observedProperty) => observedProps.add(observedProperty));
      });
    }
    if (gsapSignatureUnknownAnimations.has(animation)) return 'proven';
    if (Array.isArray(scanEntries)) {
      let coverage = gsapScannedEntryCoverage.get(animation);
      if (!coverage) {
        coverage = new WeakSet();
        gsapScannedEntryCoverage.set(animation, coverage);
      }
      if (!scanIsLive) {
        gsapBlindScannedAnimations.add(animation);
      } else if (gsapBlindScannedAnimations.has(animation)
        && scanEntries.some((entry) => !coverage.has(entry))) {
        // A live child never scanned surfaced after a blind window — its
        // signature history is unknowable (Sol r65).
        gsapSignatureUnknownAnimations.add(animation);
        return 'proven';
      }
      scanEntries.forEach((entry) => coverage.add(entry));
      if (scanEntries.some((entry) => Boolean(entry.runBackwards))) return 'proven';
      // NAMESPACE signatures observed and validated on EVERY inspection —
      // BEFORE any eligibility guard can short-circuit: a tween first seen
      // while locked (both-places etc.) still freezes 'top'/'css' here, so a
      // later top->css move without rebuild (old PropTweens alive) reads as a
      // signature change and stays locked (Sol r61–r63). 'both' locks for the
      // tween's life.
      for (let entryIndex = 0; entryIndex < scanEntries.length; entryIndex += 1) {
        const entry = scanEntries[entryIndex];
        const cssWrap = entry.css && typeof entry.css === 'object' && !Array.isArray(entry.css) ? entry.css : null;
        let signatures = gsapEntryNamespaceSignatures.get(entry);
        if (!signatures) {
          signatures = new Map();
          gsapEntryNamespaceSignatures.set(entry, signatures);
        }
        const propsToCheck = new Set(gsapKeyframeProps([entry], GSAP_CONFIG_VARS));
        signatures.forEach((_, frozenProperty) => propsToCheck.add(frozenProperty));
        for (const checkedProperty of propsToCheck) {
          const inTop = Object.prototype.hasOwnProperty.call(entry, checkedProperty);
          const inCss = Boolean(cssWrap && checkedProperty in cssWrap);
          const currentSignature = inTop && inCss ? 'both' : inCss ? 'css' : inTop ? 'top' : 'none';
          const frozenSignature = signatures.get(checkedProperty);
          if (!frozenSignature) {
            if (currentSignature !== 'none') signatures.set(checkedProperty, currentSignature);
            if (currentSignature === 'both') return 'proven';
            continue;
          }
          if (frozenSignature === 'both' || currentSignature === 'both') return 'proven';
          if (frozenSignature !== currentSignature) return 'proven';
        }
      }
    }
    // Per-OCCURRENCE walk over the real {entry, child} pairs — an entry->child
    // map keeps only the last occurrence of an aliased entry and blinds the
    // guard to a kill in the first (Sol r44).
    const children = gsapInnerTimelineChildren(animation);
    if (children === 'uninspectable') return 'unknown'; // outage: unknowable, not proven (Sol r55/r75)
    if (!children || !children.length) return false;
    if (children.some((child) => Boolean(child._from || (child.vars && child.vars.runBackwards)))) return 'proven';
    const registeredPluginVars = gsapRegisteredPluginVars();
    // 'healthy' (memory-clearing grade) requires EVERY child of this same
    // non-empty snapshot to have been integrally validated — initted, with
    // complete well-formed lookups. Anything skipped keeps the scan at plain
    // false: no hazard observed, but nothing proven either (Sol r77).
    let fullyValidated = true;
    const hazardObserved = children.some((child) => {
      const entry = child.vars;
      if (!(child._initted && Array.isArray(child._ptLookup))) {
        fullyValidated = false;
        return false;
      }
      const lookups = child._ptLookup.filter((lookup) => lookup && typeof lookup === 'object');
      if (!lookups.length || lookups.length !== child._ptLookup.length) {
        fullyValidated = false;
      }
      if (!lookups.length) return false;
      // Declaration<->lookup validation runs on EVERY inspection — a prop
      // DECLARED after the baseline froze may have no live writer yet (or was
      // materialized and killed between inspections); our invalidate would
      // materialize it and stomp that channel's owner (Sol r36).
      const declared = gsapKeyframeProps([entry], GSAP_CONFIG_VARS)
        .filter((declaredProperty) => !registeredPluginVars.has(declaredProperty));
      const declaredHazard = declared.some((declaredProperty) => {
        if (declaredProperty === 'transform') {
          return lookups.some((lookup) =>
            !GSAP_TRANSFORM_COMPONENT_KEYS.some((componentKey) => componentKey in lookup));
        }
        const required = gsapPtRequiredKeys(declaredProperty);
        return required.some((requiredKey) => lookups.some((lookup) => !(requiredKey in lookup)));
      });
      if (declaredHazard) return true;
      const allowedKeys = new Set();
      declared.forEach((declaredProperty) => {
        allowedKeys.add(declaredProperty);
        if (declaredProperty === 'transform') {
          GSAP_TRANSFORM_COMPONENT_KEYS.forEach((componentKey) => allowedKeys.add(componentKey));
        } else {
          gsapPtRequiredKeys(declaredProperty).forEach((requiredKey) => allowedKeys.add(requiredKey));
        }
      });
      // REVERSE direction, animation-wide: a lookup key no longer explained by
      // the current declarations is an ORPHANED live writer — editing ANY
      // channel invalidates and kills it mid-flight, corrupting a channel the
      // user never touched (Sol r37). Attribution is POSITIVE: every PropTween
      // carries its driver's name (probe _probe-r39.mjs — d.name 'css' for CSS
      // keys, the plugin's own name for plugin keys), so a key driven by a
      // DECLARED plugin is explained per key — never by exempting the whole
      // entry (Sol r38) nor by negative attribution at freeze time, which
      // would file a pre-first-inspection orphan under the plugin (Sol r39).
      const declaredPluginNames = new Set(Object.keys(entry)
        .filter((entryKey) => registeredPluginVars.has(entryKey)));
      const orphaned = lookups.some((lookup) =>
        Object.keys(lookup).some((lookupKey) => {
          if (allowedKeys.has(lookupKey)) return false;
          const propTween = lookup[lookupKey];
          const driverName = propTween && propTween.d && typeof propTween.d.name === 'string'
            ? propTween.d.name
            : null;
          return !(driverName && driverName !== 'css' && declaredPluginNames.has(driverName));
        }));
      if (orphaned) return true;
      const baseline = gsapChildLookupBaselines.get(child);
      if (baseline) {
        // Exact from the second sight on: a baseline key missing now was killed.
        const vanished = baseline.some((keySet, index) => {
          const lookup = lookups[index];
          if (!lookup) return true;
          return Array.from(keySet).some((key) => !(key in lookup));
        });
        if (!vanished) {
          // MONOTONIC growth: writers observed later join the watched set, or a
          // later kill of a later-added writer stays invisible (Sol r35).
          lookups.forEach((lookup, index) => {
            if (!baseline[index]) baseline[index] = new Set();
            Object.keys(lookup).forEach((key) => baseline[index].add(key));
          });
        }
        return vanished;
      }
      gsapChildLookupBaselines.set(child, lookups.map((lookup) => new Set(Object.keys(lookup))));
      return false;
    });
    if (hazardObserved) return 'proven';
    return fullyValidated ? 'healthy' : false;
  }

  // True when any of the write buckets is also referenced by ANOTHER live
  // tween's keyframes (same array wholesale, a shared entry, or a shared
  // entry-level css wrapper) — Sol r45. Our own inner children never carry a
  // keyframes array (stagger facades do, but stagger tweens are plan-locked
  // before this check runs).
  // Animations whose LIVE children were observed at least once: a falsy
  // timeline afterwards means the page HID it, not that it never existed —
  // the (possibly reordered) array must not regain write authority until the
  // children reappear (Sol r71). Never-observed animations keep the array
  // fallback (mocks / observation limit, same epistemics as provenance r10).
  const gsapLiveObservedAnimations = new WeakSet();
  // MONOTONIC per-animation set of properties actually observed in LIVE
  // children — unioned into ownership while the timeline hides, so a
  // later-materialized prop never vanishes from the inventory after its
  // carrier leaves the source (Sol r72). Never fed by the source fallback.
  const gsapLiveObservedPropSets = new WeakMap();

  // Animations whose signature window was missed with NO recoverable source —
  // no later baseline is trustworthy without proof of a rebuild (Sol r64).
  const gsapSignatureUnknownAnimations = new WeakSet();
  // Coverage of the signature scans, by identity: which entries each animation
  // has actually scanned, and whether any scan ever ran BLIND (source-based,
  // children unavailable). A live child that surfaces later WITHOUT having
  // been scanned escaped the blind window — its current signature must never
  // become a baseline (Sol r65).
  const gsapScannedEntryCoverage = new WeakMap();
  const gsapBlindScannedAnimations = new WeakSet();

  // Namespace signature of each (entry, property), frozen at first sight —
  // 'both' or a signature CHANGE locks for the tween's life (Sol r61/r62).
  const gsapEntryNamespaceSignatures = new WeakMap();

  // Sharing once OBSERVED is remembered forever: a snapshot of the global
  // timeline cannot prove uniqueness — the other tween may have completed and
  // detached while staying restartable (Sol r58). Buckets seen shared are
  // marked contested durably; sharing never observed remains a documented
  // residual (observation is the limit).
  const gsapContestedBuckets = new WeakSet();

  function gsapBucketsSharedWithOtherTween(animation, buckets) {
    if (buckets.some((bucket) => gsapContestedBuckets.has(bucket))) return true;
    const markContested = () => {
      buckets.forEach((bucket) => gsapContestedBuckets.add(bucket));
      return true;
    };
    try {
      const timeline = window.gsap && window.gsap.globalTimeline;
      // Fail CLOSED (transient): with no inspectable global timeline, sharing
      // cannot be ruled out — "cannot check" must never read as "not shared"
      // (Sol r57).
      if (!timeline || typeof timeline.getChildren !== 'function') return true;
      const bucketSet = new Set(buckets);
      // The authoritative keyframes container is the FROZEN origin.source —
      // after a delete/replace the current pointer is an inert impostor:
      // aliasing the frozen array is real sharing, aliasing only the
      // replacement is not (Sol r122).
      const frozenOriginShape = gsapKeyframesOriginShapes.get(animation);
      const authoritativeKeyframes = frozenOriginShape && Array.isArray(frozenOriginShape.source)
        ? frozenOriginShape.source
        : (Array.isArray(animation.vars?.keyframes) ? animation.vars.keyframes : null);
      const containsBucket = (list) => list.some((entry) => entry
        && (bucketSet.has(entry) || (entry.css && bucketSet.has(entry.css))));
      // Our OWN inner children walk through the nested global list too — they
      // reference our buckets by construction and must not self-flag.
      const ownRaw = gsapInnerTimelineChildren(animation);
      const ownChildren = new Set(Array.isArray(ownRaw) ? ownRaw : []);
      // Recursive descent through the WHOLE inner tree of every other tween:
      // segments can live arbitrarily deep (a stagger facade's children have
      // their OWN inner timelines — the grandchildren hold the entries), and
      // deleted/emptied sources leave those descendants as the only witnesses
      // of the sharing (Sol r46–r49).
      const sharesThroughTree = (root) => {
        const stack = [root];
        const seen = new Set();
        while (stack.length) {
          const node = stack.pop();
          if (!node || seen.has(node)) continue;
          seen.add(node);
          // GSAP animates ARBITRARY objects: a bucket used as another tween's
          // TARGET appears only in targets(), never in vars (Sol r80).
          if (typeof node.targets === 'function') {
            let nodeTargets;
            try { nodeTargets = node.targets(); } catch (_) { return 'unknown'; }
            if (Array.isArray(nodeTargets)) {
              if (nodeTargets.some((nodeTarget) => nodeTarget && bucketSet.has(nodeTarget))) return 'shared';
            } else if (nodeTargets) {
              return 'unknown';
            }
          }
          const nodeVars = node.vars;
          if (nodeVars && typeof nodeVars === 'object') {
            // Identity walk over the WHOLE authored value graph of this vars
            // (root included — Sol r50): buckets can hide at any depth —
            // startAt, entry-level css, PLUGIN wrappers (startAt:{attr:
            // bucket}), arrays (Sol r51/r52). Cycle-safe. CONTEXTUAL backedge
            // suppression (Sol r121): only the injected ROOT `parent` is
            // skipped — `_phase` is animatable at the root (r111/r113) and
            // `attr.parent` is animated inside a namespace (r100), so those
            // edges are walked; objects under nested parent/_* are authored
            // containers here (this graph never enters GSAP's own tree from a
            // vars root). visited is keyed per (object, context).
            const valueStack = [{ value: nodeVars, isRoot: true }];
            const visited = new Map();
            while (valueStack.length) {
              const valueFrame = valueStack.pop();
              const candidate = valueFrame.value;
              if (!candidate || typeof candidate !== 'object') continue;
              const walkContext = valueFrame.isRoot ? 'r' : 'n';
              let seenContexts = visited.get(candidate);
              if (seenContexts && seenContexts.has(walkContext)) continue;
              if (!seenContexts) {
                seenContexts = new Set();
                visited.set(candidate, seenContexts);
              }
              seenContexts.add(walkContext);
              if (bucketSet.has(candidate)) return 'shared';
              if (authoritativeKeyframes && candidate === authoritativeKeyframes) return 'shared';
              // Never EXECUTE accessors: a getter/proxy is inscrutable and the
              // outer catch fails CLOSED — an inspection failure must never
              // become write permission (Sol r53). for..in mirror: GSAP also
              // processes INHERITED enumerable keys — a rider tween whose
              // startAt is inherited still shares the bucket (Sol r120).
              let candidateKeys;
              try {
                candidateKeys = [];
                // eslint-disable-next-line guard-for-in
                for (const enumeratedKey in candidate) candidateKeys.push(enumeratedKey);
              } catch (_) { return 'unknown'; }
              for (let keyIndex = 0; keyIndex < candidateKeys.length; keyIndex += 1) {
                const key = candidateKeys[keyIndex];
                const chainLookup = gsapChainDescriptor(candidate, key);
                if (chainLookup.unknown) return 'unknown';
                const propertyDescriptor = chainLookup.descriptor;
                if (!propertyDescriptor) continue;
                if (propertyDescriptor.get || propertyDescriptor.set) return 'unknown';
                const propertyValue = propertyDescriptor.value;
                if (key === 'parent' || key.charCodeAt(0) === 95) {
                  if (propertyValue && typeof propertyValue === 'object') {
                    if (valueFrame.isRoot && key === 'parent') continue; // injected root backedge
                    // IDENTITY check WITHOUT descent (Sol r121): descending
                    // would enter GSAP's own tree via injected entry.parent
                    // (self-flag on every real tween); the direct alias
                    // (vars._phase = bucket, attr.parent = bucket) is caught
                    // right here. A bucket nested DEEPER under a
                    // backedge-named container stays a documented residual.
                    if (bucketSet.has(propertyValue)
                      || (authoritativeKeyframes && propertyValue === authoritativeKeyframes)) return 'shared';
                    continue;
                  }
                  valueStack.push({ value: propertyValue, isRoot: false });
                  continue;
                }
                valueStack.push({ value: propertyValue, isRoot: false });
              }
            }
          }
          if (node.timeline) {
            // Fail CLOSED: an uninspectable inner timeline may hide the
            // sharing (the r47–r49 class) — a swallowed failure must never
            // unlock (Sol r54). A truthy timeline WITHOUT getChildren hides
            // its subtree just the same — unknown, not "not shared" (Sol r81).
            if (typeof node.timeline.getChildren !== 'function') return 'unknown';
            try { node.timeline.getChildren().forEach((descendant) => stack.push(descendant)); } catch (_) { return 'unknown'; }
          }
        }
        return false;
      };
      // Tri-state per other tween: PROVEN identity ('shared') is remembered
      // forever; inscrutable state ('unknown') locks only THIS inspection —
      // transient uncertainty must never contaminate the durable memory
      // (Sol r59).
      let sawUnknown = false;
      const others = timeline.getChildren(true, true, true);
      for (let otherIndex = 0; otherIndex < others.length; otherIndex += 1) {
        const other = others[otherIndex];
        if (!other || other === animation || ownChildren.has(other)) continue;
        const otherOrigin = gsapKeyframesOriginShapes.get(other);
        if (otherOrigin && Array.isArray(otherOrigin.source) && containsBucket(otherOrigin.source)) return markContested();
        const verdict = sharesThroughTree(other);
        if (verdict === 'shared') return markContested();
        if (verdict === 'unknown') sawUnknown = true;
      }
      return sawUnknown;
    } catch (_) {
      // Fail CLOSED: if the inspection itself blows up (proxies, hostile
      // getters, dead objects), "cannot prove it is NOT shared" must lock the
      // plan — never grant a write on an aborted scan (Sol r53).
      return true;
    }
  }

  // GSAP processes vars with for..in — INHERITED enumerable properties are
  // real carriers/config (Sol r117). These helpers mirror that enumeration,
  // descriptor-based (no getter execution), failing CLOSED on proxies.
  function gsapChainDescriptor(owner, key) {
    // Walks the WHOLE chain including Object.prototype — a page can add
    // enumerable keys there and GSAP's for..in would see them (Sol r118).
    let current = owner;
    const seenLevels = new Set();
    while (current && !seenLevels.has(current)) {
      seenLevels.add(current);
      let levelDescriptor;
      try { levelDescriptor = Object.getOwnPropertyDescriptor(current, key); } catch (_) {
        return { descriptor: null, unknown: true };
      }
      if (levelDescriptor) return { descriptor: levelDescriptor, unknown: false };
      try { current = Object.getPrototypeOf(current); } catch (_) {
        return { descriptor: null, unknown: true };
      }
    }
    return { descriptor: null, unknown: false };
  }

  // True when the key is enumerable ANYWHERE on the chain — GSAP's for..in
  // would process it. Inscrutable state fails closed (counts as present).
  function gsapHasEnumerableProp(owner, key) {
    if (!owner || typeof owner !== 'object') return false;
    const { descriptor, unknown } = gsapChainDescriptor(owner, key);
    if (unknown) return true;
    return Boolean(descriptor && descriptor.enumerable);
  }

  // Timeline-INDEPENDENT disqualifiers — directly observable on vars even
  // while the inner timeline is uninspectable. Consulted by the plan header
  // AND by the frozen-binding validation, so a carrier appearing post-binding
  // (vars.x=50 → both-places probe-H resurrection on invalidate) voids the
  // restore lane during an outage too (Sol r85).
  function gsapEntryBindingDisqualified(animation, property) {
    const vars = animation?.vars;
    if (!vars) return true;
    if (vars.keyframes && !Array.isArray(vars.keyframes)) return true;
    if (vars.stagger != null || vars.runBackwards) return true;
    if (gsapHasEnumerableProp(vars, property)) return true; // for..in mirror (Sol r117)
    const wrapper = vars.css && typeof vars.css === 'object' && !Array.isArray(vars.css) ? vars.css : null;
    if (wrapper && gsapHasEnumerableProp(wrapper, property)) return true;
    if (gsapDescriptorComponentKeys(property).length) return true;
    if (gsapRegisteredPluginVars().has(property)) return true;
    return false;
  }

  // random(...) ANYWHERE on the animation is a REINIT hazard for every
  // channel: invalidatePreservingStart reinitializes the whole tween and
  // re-rolls every randomized PropTween — editing x re-rolls y (Sol r98).
  // Scans top-level vars (startAt/css recursed), plus every canonical entry
  // and its css wrapper.
  // POSITIVE provenance, remembered per animation: once random() was observed
  // the PropTweens hold rolled ends even if the page later swaps the authored
  // value without invalidating — a live re-read would lie (Sol r103). EVERY
  // caller's positive observation feeds it (binding validation and plan
  // included — a spliced entry lives only in binding.allEntries, Sol r104);
  // transient 'unknown' (accessors, scan failures) fails closed WITHOUT
  // contaminating the durable memory (the r59 principle). A new tween
  // identity naturally starts clean (WeakSet); no in-place clearing.
  const gsapRandomObservedAnimations = new WeakSet();

  // Per-animation durable memory of properties OBSERVED function-valued at
  // the top level: the page can swap the function for a concrete value
  // without invalidating while its PropTween still holds the rolled result
  // (same provenance logic as random — Sol r103/r115). Monotonic union.
  const gsapTopFunctionProps = new WeakMap();

  function gsapHasRandomizedValue(animation, entries, editedProperty) {
    if (animation && gsapRandomObservedAnimations.has(animation)) return true;
    const collector = [];
    const verdict = gsapScanRandomizedValue(animation, entries, collector);
    if (animation && collector.length) {
      let observedProps = gsapTopFunctionProps.get(animation);
      if (!observedProps) {
        observedProps = new Set();
        gsapTopFunctionProps.set(animation, observedProps);
      }
      collector.forEach((propName) => observedProps.add(propName));
    }
    if (verdict === 'observed') {
      if (animation) gsapRandomObservedAnimations.add(animation);
      return true;
    }
    if (verdict === 'unknown') return true;
    // Sibling-aware: a top-level function on ANY property other than the one
    // being edited re-executes on the invalidate (Sol r115). The edited
    // property's own function stays covered by the function-model writer.
    const rememberedProps = animation ? gsapTopFunctionProps.get(animation) : null;
    if (rememberedProps) {
      for (const propName of rememberedProps) {
        if (propName !== editedProperty) return true;
      }
    }
    return false;
  }

  function gsapScanRandomizedValue(animation, entries, functionPropCollector) {
    // Recursive, cycle-safe, descriptor-based walk of ALL authored containers
    // — plugin namespaces (attr:{}), wrappers, startAt, arrays — skipping only
    // GSAP backedges (parent/_*). Tri-state: 'observed' | 'unknown'
    // (accessors, scan failures — fail closed transiently) | 'clean'
    // (Sol r99/r104). vars.keyframes raw slots are skipped at the root: the
    // canonical entries arrive via `entries` (raw appended slots are inert).
    // CONTEXT TRAVELS WITH THE PATH, not the object identity: an entry reused
    // as a namespace (e1.attr = sharedEntry) is walked AGAIN in its nested
    // context, where its `parent` key is an animated channel — visited is
    // keyed per (object, context) (Sol r114).
    try {
      const stack = []; // frames: { value, inEntry, isRoot }
      const visited = new Map(); // object -> Set(contextKey)
      let sawUnknown = false;
      // FUNCTION-valued ANIMATED properties inside the keyframes entries are
      // a reinit hazard like random(): every invalidate re-executes them and
      // a stateful function drifts — no exact rollback (Sol r109). Scoped to
      // the ENTRY subtree: top-level flat function values keep their existing
      // function-model machinery, and vars.startAt is preserved by
      // construction (invalidatePreservingStart pins starts). Config keys
      // (GSAP_CONFIG_VARS — ease/duration/callbacks, injected into processed
      // entries) are benign, and only at the entry ROOT — inside animated
      // namespaces a subkey merely NAMED like a reserved key is an animated
      // channel (Sol r110).
      let sawFunctionValue = false;
      // TOP-LEVEL animated function props (vars root and its css wrapper) are
      // collected BY NAME instead of hard-locking: only the property covered
      // by the function-model writer is exempt from its own function —
      // SIBLING functions re-execute on every invalidate and are a hazard
      // for every other property (Sol r115). vars.startAt stays exempt
      // (preserved by construction); deeper vars containers (plugin
      // namespaces) lock unconditionally.
      const topFunctionProps = [];
      const pushValue = (value, inEntry, zone) => stack.push({ value, inEntry, isRoot: false, zone: zone || null });
      const pushOwn = (owner, skipKeyframes, inEntry, isRoot, isStructuralRoot, zone) => {
        // Every reflective read is isolated per candidate/key: a Proxy trap
        // throwing on keys/descriptor must degrade only THIS node to unknown
        // — never abort a positive observation already stacked (Sol r107).
        // for..in mirror: GSAP also processes INHERITED enumerable keys
        // (Sol r117). for..in itself never executes getters; descriptors are
        // then resolved along the chain, per-key fail-closed.
        let ownerKeys;
        try {
          ownerKeys = [];
          // eslint-disable-next-line guard-for-in
          for (const enumeratedKey in owner) ownerKeys.push(enumeratedKey);
        } catch (_) { sawUnknown = true; return; }
        for (let keyIndex = 0; keyIndex < ownerKeys.length; keyIndex += 1) {
          const key = ownerKeys[keyIndex];
          if (skipKeyframes && key === 'keyframes') continue;
          const chainLookup = gsapChainDescriptor(owner, key);
          if (chainLookup.unknown) {
            sawUnknown = true;
            continue;
          }
          const propertyDescriptor = chainLookup.descriptor;
          if (!propertyDescriptor) continue;
          if (propertyDescriptor.get || propertyDescriptor.set) {
            sawUnknown = true; // inscrutable — keep scanning the rest
            continue;
          }
          if (key === 'parent' || key.charCodeAt(0) === 95) {
            const backedgeValue = propertyDescriptor.value;
            if (backedgeValue && typeof backedgeValue === 'object') {
              // Only the PROVEN structural backedge is suppressed: `parent`
              // at a structural root (the GSAP-injected timeline reference).
              // `_...` keys are NOT reserved — an authored
              // _phase:['random(...)'] is animatable and its object must be
              // walked at any depth (Sol r112/r113).
              if (isStructuralRoot && key === 'parent') continue;
              pushValue(backedgeValue, inEntry);
              continue;
            }
            if (typeof backedgeValue === 'function') {
              // An authored FUNCTION under a key named parent/_* is an
              // animated value, not a backedge (Sol r110) — including a
              // _-prefixed expando at the entry ROOT (Sol r111). Same
              // contextual predicate as the normal branch.
              if (inEntry && (!isRoot || !GSAP_CONFIG_VARS.has(key))) sawFunctionValue = true;
              else if (!inEntry && (zone === 'vars-root' || zone === 'vars-css')) topFunctionProps.push(key);
              else if (!inEntry && zone === 'vars-nested') sawFunctionValue = true;
              continue;
            }
            pushValue(backedgeValue, inEntry, zone === 'vars-root' ? 'vars-nested' : zone);
            continue;
          }
          const ownValue = propertyDescriptor.value;
          if (typeof ownValue === 'function') {
            if (inEntry) {
              if (!isRoot || !GSAP_CONFIG_VARS.has(key)) sawFunctionValue = true;
            } else if (zone === 'vars-root') {
              if (!GSAP_CONFIG_VARS.has(key)) topFunctionProps.push(key); // sibling-aware (Sol r115)
            } else if (zone === 'vars-css') {
              topFunctionProps.push(key);
            } else if (zone === 'vars-nested') {
              sawFunctionValue = true; // plugin namespaces — no writer covers these
            }
            continue; // functions are never stacked
          }
          let childZone = null;
          if (zone === 'vars-root') {
            childZone = key === 'css' ? 'vars-css' : key === 'startAt' ? 'vars-startat' : 'vars-nested';
          } else if (zone === 'vars-css' || zone === 'vars-nested') {
            childZone = 'vars-nested';
          } else if (zone === 'vars-startat') {
            childZone = 'vars-startat';
          }
          pushValue(ownValue, inEntry, childZone);
        }
      };
      if (animation?.vars && typeof animation.vars === 'object') {
        pushOwn(animation.vars, true, false, false, true, 'vars-root');
      }
      try {
        (Array.isArray(entries) ? entries : []).forEach((entry) => {
          if (entry && typeof entry === 'object') stack.push({ value: entry, inEntry: true, isRoot: true });
        });
      } catch (_) {
        sawUnknown = true;
      }
      while (stack.length) {
        const frame = stack.pop();
        const candidate = frame.value;
        if (typeof candidate === 'string') {
          if (/random\(/i.test(candidate)) return 'observed';
          continue;
        }
        if (!candidate || typeof candidate !== 'object') continue;
        const contextKey = `${frame.inEntry ? 1 : 0}${frame.isRoot ? 1 : 0}:${frame.zone || ''}`;
        let seenContexts = visited.get(candidate);
        if (seenContexts && seenContexts.has(contextKey)) continue;
        if (!seenContexts) {
          seenContexts = new Set();
          visited.set(candidate, seenContexts);
        }
        seenContexts.add(contextKey);
        // A REVOKED Proxy makes Array.isArray itself throw — the node
        // degrades alone, never the scan (Sol r108).
        let candidateIsArray;
        try { candidateIsArray = Array.isArray(candidate); } catch (_) {
          sawUnknown = true;
          continue;
        }
        if (candidateIsArray) {
          // Descriptor-based like objects: candidate[i] would EXECUTE an
          // index getter, and a throwing one must degrade only THIS node to
          // unknown — never abort a positive observation already stacked
          // (Sol r106). length/descriptor reads go through Proxy traps that
          // can throw too — isolated the same way (Sol r107).
          let arrayLength;
          try { arrayLength = candidate.length; } catch (_) {
            sawUnknown = true;
            continue;
          }
          for (let itemIndex = 0; itemIndex < arrayLength; itemIndex += 1) {
            let itemDescriptor;
            try { itemDescriptor = Object.getOwnPropertyDescriptor(candidate, itemIndex); } catch (_) {
              sawUnknown = true;
              continue;
            }
            if (!itemDescriptor) continue;
            if (itemDescriptor.get || itemDescriptor.set) {
              sawUnknown = true;
              continue;
            }
            const itemValue = itemDescriptor.value;
            if (typeof itemValue === 'function') {
              if (frame.inEntry) sawFunctionValue = true;
              else if (frame.zone === 'vars-nested' || frame.zone === 'vars-css') sawFunctionValue = true;
              continue;
            }
            pushValue(itemValue, frame.inEntry, frame.zone);
          }
          continue;
        }
        pushOwn(candidate, false, frame.inEntry, frame.isRoot, frame.isRoot, frame.zone);
      }
      if (Array.isArray(functionPropCollector)) topFunctionProps.forEach((propName) => functionPropCollector.push(propName));
      if (sawFunctionValue) return 'observed';
      return sawUnknown ? 'unknown' : 'clean';
    } catch (_) {
      return 'unknown'; // fail CLOSED — an aborted scan must never grant a write
    }
  }

  // Animation-level random hazard: ANY invalidating writer re-rolls every
  // randomized value on the tween — including edits to a FLAT rides-along
  // property beside randomized keyframes (Sol r101). Consulted by the plan
  // (via values), by every writer that invalidates, and by the classifier.
  function gsapAnimationRandomHazard(animation, editedProperty) {
    if (!animation) return false;
    if (gsapRandomObservedAnimations.has(animation)) return true;
    const vars = animation.vars;
    if (!vars) return false;
    const origin = gsapKeyframesOrigin(animation, vars);
    let entries = null;
    if (origin && origin.shape === 'array') {
      entries = gsapAuthoredOwnershipEntries(animation, vars, origin.source);
    } else if (vars.keyframes && typeof vars.keyframes === 'object') {
      entries = [vars.keyframes];
    }
    return gsapHasRandomizedValue(animation, entries, editedProperty);
  }

  // Entry-level temporal modifiers (repeat/yoyo at minimum) make the entry's
  // RENDERED end diverge from its authored value ({x:200,repeat:1,yoyo:true}
  // renders back to the segment start) — editing "the end" would move an
  // intermediate peak while reporting success (Sol r93). Own-key presence
  // fails closed; GSAP does not inject these into processed entries.
  function gsapEntryHasTemporalModifier(entry, child) {
    if (Object.prototype.hasOwnProperty.call(entry, 'repeat')
      || Object.prototype.hasOwnProperty.call(entry, 'yoyo')) return true;
    // The EFFECTIVE state lives on the child: _repeat/_yoyo (r94) and the
    // forward-active trio _ts/_rts/_ps (r95 — reversed(true) flips the
    // timeScales negative, paused(true) sets _ps and _ts=0, timeScale(0)
    // zeroes both) — all settable without touching vars, all making the
    // rendered end diverge from the authored end. Reading them needs no
    // timeline — the child reference was captured at inspection. When the
    // child IS confrontable it alone decides paused/reversed: authored
    // `paused:false`/`reversed:false` are benign (GSAP only applies truthy
    // setters) and key presence must not lock (Sol r96). The authored keys
    // are a TRUTHY fallback only while no child can be confronted.
    const effective = child || gsapEntryChildTweens.get(entry);
    if (effective) {
      if (effective._repeat || effective._yoyo || effective._ps) return true;
      if (typeof effective._rts === 'number' && effective._rts < 0) return true;
      if (typeof effective._ts === 'number' && effective._ts <= 0) return true;
      return false;
    }
    return Boolean(entry.paused || entry.reversed);
  }

  // Namespace of a property on ONE entry — 'top' | 'css' | 'both' | 'none'.
  // Frozen per entry in the binding and revalidated without the timeline.
  function gsapEntryPropertyNamespace(entry, property) {
    const cssWrap = entry.css && typeof entry.css === 'object' && !Array.isArray(entry.css) ? entry.css : null;
    const inCss = Boolean(cssWrap && gsapHasEnumerableProp(cssWrap, property));
    const inTop = gsapHasEnumerableProp(entry, property); // for..in mirror (Sol r117)
    return inTop && inCss ? 'both' : inCss ? 'css' : inTop ? 'top' : 'none';
  }

  // A bucket reachable in the animation's OWN authored vars graph OUTSIDE the
  // canonical keyframes source (vars.startAt = terminalEntry, nested aliases in
  // wrappers): writing the bucket would simultaneously write that other slot,
  // and invalidatePreservingStart would materialize it (Sol r88). Cycle-safe,
  // descriptor-based, accessors fail closed. Directly observable — needs no
  // timeline, so it runs in ALL plan modes and in the binding validation.
  function gsapBucketsAliasedInOwnVars(animation, buckets, liveEntries, canonicalCssPairs) {
    try {
      const vars = animation?.vars;
      if (!vars || typeof vars !== 'object') return false;
      const bucketSet = new Set(buckets);
      const stack = [];
      let directBackedgeAlias = false;
      const pushOwnValues = (owner, skipKeyframes) => {
        // for..in mirror: inherited enumerable keys (an inherited startAt
        // aliasing an entry) are processed by GSAP too (Sol r118).
        let ownerKeys;
        try {
          ownerKeys = [];
          // eslint-disable-next-line guard-for-in
          for (const enumeratedKey in owner) ownerKeys.push(enumeratedKey);
        } catch (_) { return false; }
        for (let keyIndex = 0; keyIndex < ownerKeys.length; keyIndex += 1) {
          const key = ownerKeys[keyIndex];
          if (skipKeyframes && key === 'keyframes') continue;
          if (key === 'parent' || key.charCodeAt(0) === 95) {
            // _-keys are ANIMATABLE (r111/r113): the edge gets at least the
            // direct identity check before any suppression — vars._phase =
            // terminalEntry is a live alias (Sol r123). Only the structural
            // root `parent` is a proven backedge; descent stays off (the
            // injected entry.parent would walk GSAP's own tree).
            if (key === 'parent' && skipKeyframes) continue;
            const backedgeLookup = gsapChainDescriptor(owner, key);
            if (backedgeLookup.unknown) return false;
            const backedgeDescriptor = backedgeLookup.descriptor;
            if (!backedgeDescriptor) continue;
            if (backedgeDescriptor.get || backedgeDescriptor.set) return false;
            const backedgeValue = backedgeDescriptor.value;
            if (backedgeValue && typeof backedgeValue === 'object') {
              // Outside the structural ROOT parent (already skipped above),
              // BOTH nested `parent` and `_...` get the identity check —
              // vars.attr.parent = terminalEntry is authored/animated, not a
              // backedge (Sol r124). Descent stays off.
              if (bucketSet.has(backedgeValue)) directBackedgeAlias = true;
              continue;
            }
            continue; // scalars under backedge-named keys carry no identity
          }
          const chainLookup = gsapChainDescriptor(owner, key);
          if (chainLookup.unknown) return false; // inscrutable
          const propertyDescriptor = chainLookup.descriptor;
          if (!propertyDescriptor) continue;
          if (propertyDescriptor.get || propertyDescriptor.set) return false; // inscrutable
          stack.push(propertyDescriptor.value);
        }
        return true;
      };
      if (!pushOwnValues(vars, true)) return true;
      if (directBackedgeAlias) return true;
      // The keyframes subtree is walked EDGE-SENSITIVELY, not skipped: each
      // entry is a full to() vars (entry.startAt is ACTIVE), so a bucket is
      // allowed only at its canonical occurrence — the array slot itself and
      // the entry's direct `css` edge. Every OTHER field of every canonical
      // entry (source slots ∪ live entries) is walked, and any re-encounter
      // of a bucket is an active alias (Sol r89).
      const canonicalEntries = new Set();
      if (Array.isArray(vars.keyframes)) {
        vars.keyframes.forEach((entry) => {
          if (entry && typeof entry === 'object') canonicalEntries.add(entry);
        });
      } else if (vars.keyframes && typeof vars.keyframes === 'object') {
        stack.push(vars.keyframes); // object/percent forms carry no buckets
      }
      if (Array.isArray(liveEntries)) {
        liveEntries.forEach((entry) => {
          if (entry && typeof entry === 'object') canonicalEntries.add(entry);
        });
      }
      for (const entry of canonicalEntries) {
        let entryKeys;
        try {
          entryKeys = [];
          // eslint-disable-next-line guard-for-in
          for (const enumeratedKey in entry) entryKeys.push(enumeratedKey); // for..in mirror (Sol r118)
        } catch (_) { return true; }
        for (let keyIndex = 0; keyIndex < entryKeys.length; keyIndex += 1) {
          const key = entryKeys[keyIndex];
          if (key === 'parent' || key.charCodeAt(0) === 95) {
            // Entry-root `parent` is the injected backedge; `_...` keys are
            // animatable and get the direct identity check (Sol r123).
            if (key === 'parent') continue;
            const backedgeLookup = gsapChainDescriptor(entry, key);
            if (backedgeLookup.unknown) return true;
            const backedgeDescriptor = backedgeLookup.descriptor;
            if (!backedgeDescriptor) continue;
            if (backedgeDescriptor.get || backedgeDescriptor.set) return true;
            const backedgeValue = backedgeDescriptor.value;
            if (backedgeValue && typeof backedgeValue === 'object' && bucketSet.has(backedgeValue)) return true;
            continue;
          }
          const chainLookup = gsapChainDescriptor(entry, key);
          if (chainLookup.unknown) return true;
          const propertyDescriptor = chainLookup.descriptor;
          if (!propertyDescriptor) continue;
          if (propertyDescriptor.get || propertyDescriptor.set) return true;
          if (key === 'css') {
            const wrapper = propertyDescriptor.value;
            if (wrapper && typeof wrapper === 'object') {
              // The css edge is canonical ONLY for the exact frozen
              // (carrier, bucket) pair — a shared wrapper on any OTHER entry
              // is an active alias: the invalidate would materialize the
              // property into that entry's segment too (Sol r91).
              const canonicalPair = canonicalCssPairs
                ? canonicalCssPairs.get(entry) === wrapper
                : !bucketSet.has(wrapper);
              if (!canonicalPair && bucketSet.has(wrapper)) return true;
              if (!pushOwnValues(wrapper, false)) return true;
              if (directBackedgeAlias) return true; // consumed HERE (Sol r125)
            }
            continue;
          }
          stack.push(propertyDescriptor.value);
        }
      }
      const visited = new Set();
      while (stack.length) {
        const candidate = stack.pop();
        if (!candidate || typeof candidate !== 'object' || visited.has(candidate)) continue;
        visited.add(candidate);
        if (bucketSet.has(candidate)) return true;
        if (!pushOwnValues(candidate, false)) return true;
        if (directBackedgeAlias) return true;
      }
      return directBackedgeAlias; // belt — no consumption gap survives (Sol r125)
    } catch (_) {
      return true; // fail CLOSED — an aborted scan must never grant a write
    }
  }

  function gsapArrayKeyframePlan(animation, property, options) {
    const vars = animation?.vars;
    if (!vars) return null;
    if (gsapEntryBindingDisqualified(animation, property)) return null;
    if (!(options && options.structuralOnly) && gsapResurrectionHazard(animation)) return null;
    const orderedEntries = gsapLiveKeyframeEntries(animation) || [];
    if (orderedEntries.some((entry) => gsapEntryHasTemporalModifier(entry))) return null;
    if (gsapHasRandomizedValue(animation, orderedEntries)) return null;
    const buckets = [];
    const carriers = [];
    let nestedCarrier = false;
    let hiddenLiveCarrier = false;
    orderedEntries.forEach((entry, entryPosition) => {
      const child = gsapEntryChildTweens.get(entry);
      const carriesInCss = entry.css && typeof entry.css === 'object' && !Array.isArray(entry.css)
        && gsapHasEnumerableProp(entry.css, property);
      const carriesTop = gsapHasEnumerableProp(entry, property); // for..in mirror (Sol r117)
      // NAMESPACE SIGNATURE, frozen per (entry, property): with css:{} the
      // CSSPlugin drives the wrapper while top-level rides the generic writer
      // — entry.x AND entry.css.x are TWO writers of homonymous channels
      // (Sol r61), and deleting one namespace post-init leaves its PropTween
      // rendering invisibly (Sol r62). 'both' locks for the tween's life; any
      // signature CHANGE (namespace lost/moved without proof of rebuild)
      // locks too.
      const currentSignature = carriesInCss && carriesTop ? 'both'
        : carriesInCss ? 'css'
          : carriesTop ? 'top' : 'none';
      let signatures = gsapEntryNamespaceSignatures.get(entry);
      if (!signatures) {
        signatures = new Map();
        gsapEntryNamespaceSignatures.set(entry, signatures);
      }
      const frozenSignature = signatures.get(property);
      if (!frozenSignature && currentSignature !== 'none') signatures.set(property, currentSignature);
      if (currentSignature === 'both' || frozenSignature === 'both'
        || (frozenSignature && frozenSignature !== currentSignature)) {
        nestedCarrier = true;
        return;
      }
      if (!carriesInCss && !carriesTop) {
        // An entry that no longer DECLARES the property may still ANIMATE it:
        // deleting the key in place leaves the child's PropTween alive until
        // the next invalidate (probe _probe-r27.mjs — the end still renders).
        // The live writers sit under CANONICAL keys (autoAlpha ->
        // opacity+visibility, rotate -> rotation — Sol r32): ANY of them still
        // alive makes the visible end unknowable — lock.
        if (child && child._initted && Array.isArray(child._ptLookup)
          && child._ptLookup.some((lookup) => lookup
            && gsapPtRequiredKeys(property).some((requiredKey) => requiredKey in lookup))) {
          hiddenLiveCarrier = true;
        }
        return;
      }
      // A carrying entry that spawned its OWN inner timeline (stagger or
      // fn/string timing inside the entry) renders a level deeper — writing
      // the outer entry changes nothing (Sol r19). Any nested carrier poisons
      // the whole property's plan: the end may live inside it.
      if (gsapNestedFacadeEntries.has(entry)) {
        nestedCarrier = true;
        return;
      }
      buckets.push(carriesInCss ? entry.css : entry);
      // The occurrence index is carried FROM the traversal (Sol r7): indexOf
      // would collapse aliased occurrences to the first. Aliased CARRIERS are
      // locked below by repeated bucket identity either way — this keeps the
      // address correct by construction, not by that guard.
      carriers.push({ entry, namespace: carriesInCss ? 'css' : 'top', bucket: carriesInCss ? entry.css : entry, rawEntryIndex: entryPosition });
    });
    if (nestedCarrier) return null;
    if (hiddenLiveCarrier) return null;
    if (!buckets.length) return null;
    // A bucket aliased in the tween's OWN vars graph (outside keyframes) makes
    // every write a double-write — locks in ALL modes (Sol r88).
    {
      const canonicalCssPairs = new Map();
      carriers.forEach((carrier) => {
        if (carrier.namespace === 'css') canonicalCssPairs.set(carrier.entry, carrier.bucket);
      });
      if (gsapBucketsAliasedInOwnVars(animation, buckets, orderedEntries, canonicalCssPairs)) return null;
    }
    // ALIASED entries — the same object at two positions — make positional
    // writes impossible: editing the trailing bucket also mutates the earlier
    // occurrence through shared identity, breaking the non-trailing-duplicate
    // guarantee ([300,100,300] — Sol r43). Any repeated identity locks.
    if (new Set(buckets).size !== buckets.length) return null;
    // Sharing BETWEEN tweens locks too: GSAP preserves identity, so writing
    // A's bucket rewrites B's source and B re-renders the edit on its next
    // invalidate — a patch aimed at one motionId silently mutating another
    // animation (Sol r45). Writers re-plan before writing, so this check also
    // guards the write path. STRUCTURAL consumers (binding validity, pruning)
    // skip it: a transient 'unknown' must lock writes without reading as
    // structural staleness — pruning the frozen binding on uncertainty would
    // flatten a collision undo after the uncertainty clears (Sol r60).
    if (!(options && options.structuralOnly)
      && gsapBucketsSharedWithOtherTween(animation, buckets)) return null;
    const values = buckets.map((bucket) => bucket[property]);
    // random(...) re-resolves on every PropTween init and re-rolls on
    // invalidate: textually equal strings are NOT a hold and a verbatim
    // rollback re-rolls instead of restoring (Sol r97).
    const unsafe = values.some((value) =>
      (typeof value !== 'string' && typeof value !== 'number')
      // A non-finite number poisons the binding forever: allExpected carries
      // NaN and NaN===NaN is false, so valuesIntact fails after the FIRST
      // write — rollback refused with the edit applied (Sol r10). Fail closed.
      || (typeof value === 'number' && !Number.isFinite(value))
      || /^[+-]=/.test(String(value).trim())
      || /random\(/i.test(String(value)));
    if (unsafe) return null;
    // Trailing run membership by NUMERIC equivalence, not textual: GSAP renders
    // 200, "200.0" and "0200" identically, so a textual run would edit only the
    // last one and turn a hold into a ramp (Sol r20). The same NUMBER with a
    // DIFFERENT unit spelling ("200px" vs 200) may or may not render equal —
    // unprovable without per-property knowledge — so it locks the plan.
    let start = buckets.length - 1;
    while (start > 0) {
      const relation = gsapValueEquivalence(property, values[start - 1], values[values.length - 1]);
      if (relation === 'ambiguous') return null;
      if (relation === 'different') break;
      start -= 1;
    }
    // `buckets` (ALL carrying buckets, in order) is exposed so a frozen binding
    // can verify it is still the trailing suffix of the CURRENT structure;
    // `carriers` freezes each carrying ENTRY and its namespace so the binding
    // can revalidate entry-level state (runBackwards, top/css moves) without
    // the timeline (Sol r86).
    // `allEntries` persists EVERY live entry the plan walked — carriers or
    // not: a spliced non-carrier can still alias a bucket through its own
    // sub-fields and must stay visible to the binding validation (Sol r90).
    // `steps` — the phase-2 addressable view of the SAME carriers: the
    // canonical transactional address is rawEntryIndex (position in the LIVE
    // entry order — allEntries), never an offset. endOffset is POSITIONING
    // metadata only: the child's rendered endpoint normalized by the inner
    // timeline's own duration (the embedded timeline is stretched to the
    // parent's duration, so the parent duration would misplace every diamond);
    // duplicate endpoints (duration:0 entries) and a zero total duration make
    // offsets non-unique/undefined — Sol r2 blocker, probe _probe-phase2-zerodur.mjs.
    const timelineTotal = (() => {
      try {
        const timeline = animation.timeline;
        if (!timeline || typeof timeline.duration !== 'function') return null;
        const total = timeline.duration();
        return Number.isFinite(total) && total > 0 ? total : null;
      } catch (_) { return null; }
    })();
    const steps = carriers.map((carrier) => {
      let endOffset = null;
      const child = gsapEntryChildTweens.get(carrier.entry);
      if (child && timelineTotal != null
        && typeof child.startTime === 'function' && typeof child.duration === 'function') {
        try {
          const end = child.startTime() + child.duration();
          if (Number.isFinite(end)) endOffset = Math.max(0, Math.min(1, end / timelineTotal));
        } catch (_) {}
      }
      return {
        rawEntryIndex: carrier.rawEntryIndex,
        entry: carrier.entry,
        bucket: carrier.bucket,
        namespace: carrier.namespace,
        endOffset,
      };
    });
    return { run: buckets.slice(start), buckets, carriers, allEntries: orderedEntries, steps };
  }

  function gsapEditableTracks(animation, vars, target, animatedProps) {
    const gsap = window.gsap;
    const ease = typeof vars.ease === 'string' ? vars.ease : null;
    const endOnly = () => ({
      keyframes: false,
      tracks: animatedProps.map((property) => {
        // The wrapper slot is the live one (top-level values on wrapper tweens are
        // phantoms); keyframe-driven props have no vars value at all — never
        // report the literal string "undefined".
        const wrapper = vars.css && typeof vars.css === 'object' && !Array.isArray(vars.css) ? vars.css : null;
        const raw = wrapper && property in wrapper ? wrapper[property] : vars[property];
        return {
          property,
          keyframes: [{ offset: 1, value: typeof raw === 'function' || raw === undefined ? '' : String(raw), easing: ease }],
        };
      }),
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
        // Re-inspection refreshes the editing truth the UI shows — stale frozen
        // entry bindings are dropped HERE, so a later write is a genuinely NEW
        // edit against the current entries, never a reinterpreted replay (Sol r5).
        pruneStaleEntryBindings(animation);
        const scrollTrigger = animation.scrollTrigger || vars.scrollTrigger || null;
        const engine = scrollTrigger ? 'ScrollTrigger' : 'GSAP';
        const primaryTarget = targets.find((target) => target instanceof Element) || element;
        const id = motionIdFor(animation, engine === 'GSAP' ? 'gsap' : 'scroll', `${ensureElementId(primaryTarget)}:${vars.id || index}`);
        const ignored = GSAP_CONFIG_VARS;
        // css:{} wrapper (legacy GSAP-2 authoring): once it exists — even empty —
        // GSAP routes ONLY the wrapper through CSSPlugin; every SCALAR top-level
        // prop becomes a generic object-property tween (el.x = 100), which never
        // touches CSS (probe 2026-07-29, both directions). So the wrapper's
        // sub-keys ARE the tween's CSS tracks, and scalar top-level props on a
        // wrapper tween are phantoms — listing them would be furo-#1-class lies,
        // and dropping them leaves those channels genuinely unowned (a style edit
        // works; the tween cannot stomp what it never writes). PLUGIN vars stay
        // LIVE beside a wrapper in BOTH shapes — structured namespaces
        // (attr:{...}) and scalar vars of registered plugins (text/scrollTo;
        // probe: attr's data-n keeps animating, a registered plugin's init runs
        // for its scalar var) — they survive the drop so the inventory never
        // hides a live writer, and they are locked below.
        const cssWrapper = vars.css && typeof vars.css === 'object' && !Array.isArray(vars.css) ? vars.css : null;
        const topLevelProps = (cssWrapper
          ? gsapForInKeys(cssWrapper).concat(gsapForInKeys(vars).filter((property) => gsapPluginOwnedVar(vars, property)))
          : gsapForInKeys(vars))
          .filter((property, index, list) => !ignored.has(property) && list.indexOf(property) === index);
        // Surface keyframe-driven properties as tracks too — but remember which they
        // are: no safe writeback exists for them (probe 2026-07-29: editing vars or
        // the keyframes structure + invalidate corrupts the path start on the array
        // form and is silently ignored on the object/percent forms). A property
        // authored BOTH top-level and in keyframes stays keyframe-driven — the
        // keyframes win the rendered path, so retargeting the top-level value would
        // corrupt it the same way (dedup only the track list).
        // Detection is the UNION of the array and the live children entries
        // (fail-closed): a spliced-out entry's child keeps rendering — dropping
        // it from the inventory would resurrect the furo-#1 invisible-writer
        // lie, and a later vars.<prop> would reach the unsafe plain writer
        // (Sol r8). The write plan, in contrast, uses ONLY the live entries.
        const liveKeyframeEntries = gsapLiveKeyframeEntries(animation);
        const keyframeDriven = new Set(
          gsapAuthoredKeyframeProps(animation, ignored)
            .concat(liveKeyframeEntries ? gsapKeyframeProps(liveKeyframeEntries, ignored) : [])
            .concat(gsapDetectionKeyframeProps(animation, ignored)));
        // A killed writer haunting ANY entry locks EVERY channel of this
        // animation — even rides-along top-level props: their plain write also
        // fires invalidate, which resurrects the dead writer (Sol r29).
        const resurrectionHazardOnly = gsapResurrectionHazard(animation);
        const animatedProps = topLevelProps.concat(
          Array.from(keyframeDriven).filter((property) => !topLevelProps.includes(property)));
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
          // The wrapper slot is the LIVE one whenever the property sits there —
          // on a collision ({ x: '+=60', css: { x: 100 } }) the top-level value
          // is a phantom, so reading it would misreport the value/write model.
          const rawValue = cssWrapper && track.property in cssWrapper
            ? cssWrapper[track.property]
            : vars[track.property];
          const looping = iterations === Infinity;
          const writeModel = gsapWriteModel(rawValue, looping);
          const targetCount = Math.max(1, targets.filter((target) => target instanceof Element).length);
          const functionSupported = typeof rawValue !== 'function' || targetCount === 1;
          const scopeSafe = targetCount === 1;
          // css:{}-wrapped values: only the ABSOLUTE wrapper write is probe-proven.
          // The relative/function/loop write paths write top-level vars/startAt,
          // which css tweens silently ignore — keep those non-retargetable. And the
          // classifier must mirror the writer's bucket predicate EXACTLY: if the
          // slot this track was authored in differs from where the write would land
          // (name OR any descriptor-component key found in the wrapper — e.g.
          // vars.scale + css.scaleX), provenance would cross — lock it.
          // Plugin-owned vars (attr:{...}, text:"...", scrollTo:500): no
          // vars-write path is proven — writing over them corrupts the plugin's
          // config — so both edit channels lock (Sol v6 #2 + v7).
          const pluginOwned = gsapPluginOwnedVar(vars, track.property);
          const authoredInCss = vars[track.property] === undefined && Boolean(cssWrapper && track.property in cssWrapper);
          const writeLandsInCss = Boolean(cssWrapper && (track.property in cssWrapper
            || gsapDescriptorComponentKeys(track.property).some((key) => key in cssWrapper)));
          const cssProvenanceMismatch = Boolean(cssWrapper) && authoredInCss !== writeLandsInCss;
          const cssWriteUnproven = (authoredInCss && writeModel !== 'absolute') || cssProvenanceMismatch;
          // The keyframe (step) channel's per-track truth: mirror EVERY writer
          // guard (applyGsapKeyframe), so the UI never enables an input whose
          // write is always rejected (Sol rounds 5-6 — clip capability alone
          // promised step edits the guards refuse; stagger reopened the same
          // hole when left out). The reason is published so a locked field can
          // explain itself — stagger's points at unchain. The ARRAY keyframes
          // form with a safe entry plan unlocks: END edits go through the
          // ENTRIES, START edits through startAt (probe 2026-07-29) — the plan
          // itself excludes stagger/wrapper/plugin/both-places, so the later
          // reasons stay accurate for it.
          const entryPlan = keyframeDriven.has(track.property) ? gsapArrayKeyframePlan(animation, track.property) : null;
          // Per-track and PER-CHANNEL (Sol r115/r116): on retarget.final the
          // function prop itself keeps its function-model writer (sibling
          // functions still lock); on the keyframe channel ANY top-level
          // function — the property's own included — locks, because that
          // writer replaces vars[prop] and would destroy the authored
          // function without a restorable readback.
          const retargetDynamicHazard = resurrectionHazardOnly || gsapAnimationRandomHazard(animation, track.property);
          const keyframeDynamicHazard = resurrectionHazardOnly || gsapAnimationRandomHazard(animation);
          // Per PROPERTY on the step channel too: a plain top-level prop beside
          // keyframes of ANOTHER prop keeps its plain writer (probe
          // _probe-rides-along.mjs: vars.x/startAt.x writes preserve y's path
          // completely — Sol r13).
          const keyframeEditReason = !sampled.keyframes ? 'sampling'
            : vars.runBackwards ? 'from'
              : keyframeDynamicHazard ? 'keyframes'
              : keyframeDriven.has(track.property) && !entryPlan ? 'keyframes'
                : vars.stagger != null ? 'stagger'
                  // vars.startAt is ONE shared object: an offset-0 edit
                  // flattens distinct per-target starts and a single-value
                  // rollback cannot restore them ([10,20] -> [10,10] — probe
                  // _probe-r19.mjs, Sol r19).
                  : targetCount > 1 ? 'multi-target'
                  : (cssWrapper && track.property in cssWrapper) ? 'css-wrapper'
                    : pluginOwned ? 'plugin'
                      : null;
          return {
            ...track,
            keyframeEditable: keyframeEditReason == null,
            ...(keyframeEditReason ? { keyframeEditReason } : {}),
            // Phase-2 addressable steps: entryIndex is the canonical address
            // (raw position in the live entry order); offset positions the
            // diamond only and may be null/duplicated (zero-duration cases).
            ...(entryPlan && Array.isArray(entryPlan.steps) ? {
              steps: entryPlan.steps.map((step, stepIndex, list) => {
                // Frozen-run members belong to the END writer (journal
                // separation) — their diamond points at the end edit. The
                // OWNERSHIP truth is the FROZEN binding's run once one exists
                // (Sol r6): a collision edit widens the recomputed run, but
                // the writers keep their frozen split — locking the collided
                // step here would refuse a valid edit and point the user at
                // the end, which edits a DIFFERENT bucket. The fresh plan's
                // run only decides ownership before the first write.
                const frozenBinding = entryBindingState(animation, track.property).binding;
                const runMember = frozenBinding
                  ? frozenBinding.buckets.includes(step.bucket)
                  : entryPlan.run.includes(step.bucket);
                const editable = keyframeEditReason == null && !runMember;
                return {
                  entryIndex: step.rawEntryIndex,
                  offset: step.endOffset,
                  value: String(step.bucket[track.property]),
                  editable,
                  ...(runMember ? { reason: 'final' } : keyframeEditReason ? { reason: keyframeEditReason } : {}),
                  // The TERMINAL step by identity (last carrier = the end the
                  // offset-1 diamond already shows). The UI hides it by this
                  // flag — never by numeric offset, which is null/duplicated
                  // in zero-duration shapes (Sol r4).
                  ...(stepIndex === list.length - 1 ? { isEnd: true } : {}),
                };
              }),
            } : {}),
            ownership: writerOwnership({
              clipId: id,
              animation,
              target: primaryTarget,
              property: track.property,
              behavior,
              order: order + (trackIndex / 1000),
              sequenceId: group.timelineId,
              writeModel,
              // Keyframe-driven props unlock ONLY through the array-form entry
              // plan, and only for the ABSOLUTE model — the loop (additive-base)
              // and relative/function write paths have no entry equivalent.
              retargetable: sampled.keyframes && !vars.runBackwards && !retargetDynamicHazard && functionSupported && scopeSafe && (!keyframeDriven.has(track.property) || (entryPlan != null && writeModel === 'absolute')) && !cssWriteUnproven && !pluginOwned,
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
          // The clip-level keyframe capability is DERIVED from the tracks: it is
          // true only when at least one track's step edits the writer will accept
          // (per-track truth in `keyframeEditable`). Deriving it is what makes a
          // capability-vs-guard disagreement structurally impossible (Sol v5).
          capabilities: { timing: true, easing: true, keyframes: tracks.some((track) => track.keyframeEditable), trigger: false, scroll: Boolean(scrollTrigger) },
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
        // Randomized tweens never publish the chain — unchain would re-roll
        // them in both directions (Sol r102).
        const sharedLinkId = !trigger && elementTargets.length > 1
          && !gsapAnimationRandomHazard(tween) ? tweenKey : null;
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
    // sourceValue is authored-value METADATA — the readback must carry it through
    // untouched (like readBrowserRetarget). Recomputing it from vars made every
    // GSAP retarget fail validate-transaction with effect_mismatch: post-write it
    // differs from the requested descriptor, and on wrapper tweens the top-level
    // slot is empty so it silently vanished (Sol v6 #1, probe 2026-07-29).
    return {
      ...cloneValue(descriptor),
      value: String(value ?? ''),
    };
  }

  function assignGsapAbsolute(record, descriptor) {
    const animation = record.animation;
    const vars = animation.vars || (animation.vars = {});
    const property = descriptor.runtimeProperty;
    const desired = descriptor.value;
    // css:{}-wrapped property: EVERY write (component splits included) must land
    // INSIDE the wrapper — top-level vars writes are silently ignored by these
    // tweens, while wrapper edits (incl. scaleX/scaleY splits) retarget cleanly
    // (probe-verified 2026-07-29). The COMPONENT key matters too: after a scale
    // split deletes wrapper.scale, a rollback replays the stale descriptor
    // (runtimeProperty 'scale') and must still find the wrapper via 'scaleX'.
    const cssWrapper = vars.css && typeof vars.css === 'object' && !Array.isArray(vars.css) ? vars.css : null;
    const bucket = cssWrapper && (property in cssWrapper || (descriptor.component && descriptor.component in cssWrapper))
      ? cssWrapper
      : vars;
    if (descriptor.component === 'transformOriginX' || descriptor.component === 'transformOriginY') {
      bucket[property] = updateRuntimeOrigin(sampleGsapValue(record, property, 1), descriptor.component, desired);
      return;
    }
    if (descriptor.component && property === 'transform') {
      bucket[property] = updateRuntimeTransform(sampleGsapValue(record, property, 1), descriptor.component, desired);
      return;
    }
    if (descriptor.component && property === 'scale') {
      const other = descriptor.component === 'scaleX' ? 'scaleY' : 'scaleX';
      bucket[other] = sampleGsapValue(record, other, 1);
      bucket[descriptor.component] = Number.isFinite(Number(desired)) ? Number(desired) : desired;
      delete bucket.scale;
      return;
    }
    bucket[property] = typeof bucket[property] === 'number' && Number.isFinite(Number(desired))
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

  // Entry-edit writeback for the ARRAY keyframes form — the only probe-proven
  // safe write on keyframes tweens (2026-07-29): set the trailing-run entries and
  // re-invalidate preserving the start. The edited-entry set and its authored
  // values are FROZEN at the first write (like function-offset bindings): every
  // later write — rollbacks included — hits the SAME entries, and landing exactly
  // back on the original end restores the authored values VERBATIM. Recomputing
  // the run instead would swallow intermediate entries that happen to equal the
  // new value, making undo inexact (probe I: [100,200] -> end 100 -> undo must
  // give [100,200], never [200,200]).
  const gsapKeyframeEntryRetargets = new WeakMap();
  // Original start values (sampled at progress 0 before the FIRST offset-0
  // edit), per (animation, property) — the render-equivalent rollback target
  // for startAt edits (Sol r18).
  const gsapStartAtRetargets = new WeakMap();

  // True when a frozen binding exists for the property and the desired value
  // LANDS on the original end — a restore. Restores route to the writer BEFORE
  // the routers' hazard/plan gates: the payload is exactly the authored state,
  // safe by construction, so undo stays reachable during an outage (Sol r74).
  function gsapFrozenRestoreCandidate(animation, property, desired) {
    // VALIDATED state, never the raw map: a stale binding (externally mutated
    // bucket) must not open the restore lane (Sol r84).
    const binding = entryBindingState(animation, property).binding;
    if (!binding) return false;
    const desiredParsed = numericCss(String(desired));
    const authoredEnd = binding.originals[binding.originals.length - 1];
    return Boolean((binding.end && desiredParsed
      && desiredParsed.unit === binding.end.unit && desiredParsed.value === binding.end.value)
      || gsapValueEquivalence(property, String(desired), authoredEnd) === 'equal');
  }
  // Step-channel analog of the frozen-restore candidate: a desired landing on
  // the journal original (or the untouched bucket value) for a NON-RUN index
  // opens the binding-first restore lane. Validated state only (Sol r84).
  function gsapFrozenStepRestoreCandidate(animation, property, entryIndex, desired) {
    const binding = entryBindingState(animation, property).binding;
    if (!binding || !Number.isInteger(entryIndex) || entryIndex < 0) return false;
    const frozenEntry = binding.allEntries ? binding.allEntries[entryIndex] : null;
    const carrier = frozenEntry
      ? (binding.carriers || []).find((candidate) => candidate.entry === frozenEntry)
      : null;
    if (!carrier || binding.buckets.includes(carrier.bucket)) return false;
    const journal = binding.stepOriginals;
    const original = journal && journal.has(entryIndex) ? journal.get(entryIndex) : carrier.bucket[property];
    return gsapValueEquivalence(property, String(desired), String(original)) === 'equal';
  }

  // A frozen binding is only authoritative while it still DESCRIBES the tween.
  // It is validated against a FRESH plan: every plan guard must still hold
  // (vars[property] appearing post-binding reopens the probe-H both-places
  // resurrection; an external relative entry voids the write model), the frozen
  // run must still be the TRAILING SUFFIX of the current carrying buckets (an
  // appended entry moves the real end past the frozen run — writing through it
  // would edit an intermediate), and every bucket must hold exactly the value
  // our writer last left there (a diverged run written uniformly would flatten
  // on rollback: [300,250] -> [250,250]). Suffix — not equality — because a
  // collision edit widens the recomputed run ([100,100] plans BOTH entries)
  // while the frozen single-bucket run must keep undo exact (Sol r3/r4).
  //
  // A STALE binding is never silently replaced mid-flight: replanning an undo
  // replay would reinterpret it against the new structure (edit 500 -> page
  // appends {x:400} -> undo 200 would write the APPENDED entry: [100,500,200] —
  // neither a restore nor a no-op, Sol r5). Writes against a stale binding are
  // refused atomically; RE-INSPECTION (which refreshes the truth the UI shows)
  // prunes stale bindings, so the next edit is a genuinely new edit against the
  // current entries — edits stay available, never a generalized lock.
  function entryBindingState(animation, property) {
    const bindings = gsapKeyframeEntryRetargets.get(animation);
    const binding = bindings?.get(property);
    if (!binding) return { binding: null, stale: false };
    // Timeline-independent disqualifiers run FIRST — a top-level/css carrier
    // or plugin/stagger state appearing post-binding is observable without
    // the timeline and voids the binding even mid-outage (Sol r85).
    if (gsapEntryBindingDisqualified(animation, property)) return { binding: null, stale: true };
    if (gsapHasRandomizedValue(animation, binding.allEntries
      || (binding.carriers ? binding.carriers.map((carrier) => carrier.entry) : null), property)) {
      return { binding: null, stale: true };
    }
    {
      const frozenCssPairs = new Map();
      (binding.carriers || []).forEach((carrier) => {
        if (carrier.namespace === 'css') frozenCssPairs.set(carrier.entry, carrier.bucket);
      });
      if (gsapBucketsAliasedInOwnVars(animation, binding.allBuckets,
        binding.allEntries || (binding.carriers ? binding.carriers.map((carrier) => carrier.entry) : null),
        frozenCssPairs)) return { binding: null, stale: true };
    }
    // Carrier-ENTRY state is frozen too: a runBackwards flag or a namespace
    // move on a frozen carrier reverses/reroutes the restored path even when
    // the values still match — both observable without the timeline (Sol r86).
    const carriersIntact = !binding.carriers || binding.carriers.every(({ entry, namespace, bucket }) => {
      if (!entry || typeof entry !== 'object' || entry.runBackwards) return false;
      const cssWrap = entry.css && typeof entry.css === 'object' && !Array.isArray(entry.css) ? entry.css : null;
      if (gsapEntryPropertyNamespace(entry, property) !== namespace) return false;
      // BUCKET IDENTITY is frozen too: a replaced css wrapper detaches the
      // frozen bucket — writing it changes nothing that renders (Sol r87).
      return (namespace === 'css' ? cssWrap : entry) === bucket;
    });
    if (!carriersIntact) return { binding: null, stale: true };
    // The namespace of EVERY planned entry is frozen — including 'none': a
    // non-carrier gaining the property (css.x appearing mid-outage) is a
    // brand-new writer our invalidate would materialize (Sol r92, the r36
    // class). runBackwards is absolute — no entry had it at freeze time (the
    // hazard scan locks the plan otherwise).
    const entryStatesIntact = !binding.allEntryStates || binding.allEntryStates.every(({ entry, namespace, child }) => {
      if (!entry || typeof entry !== 'object' || entry.runBackwards) return false;
      if (gsapEntryHasTemporalModifier(entry, child)) return false; // absolute — none existed at freeze (Sol r93/r94)
      return gsapEntryPropertyNamespace(entry, property) === namespace;
    });
    if (!entryStatesIntact) return { binding: null, stale: true };
    // The VALUE check needs no timeline — the buckets are held by identity.
    // An externally mutated bucket is OBSERVABLE staleness even while the
    // topology is uninspectable: the frozen restore would wipe the page's
    // write (Sol r84). Only the topology stays 'unknown' during an outage.
    const valuesIntact = binding.allBuckets.every((bucket, index) => bucket[property] === binding.allExpected[index]);
    if (!valuesIntact) return { binding: null, stale: true };
    // A transient timeline outage is UNKNOWN, not structural staleness: the
    // binding survives (writes are refused elsewhere by the full plan) and
    // only a PROVEN structural mismatch after inspection recovers may prune
    // (Sol r69).
    const bindingChildren = gsapInnerTimelineChildren(animation);
    if (bindingChildren === 'uninspectable'
      || (bindingChildren === null && gsapLiveObservedAnimations.has(animation))) {
      return { binding, stale: false };
    }
    const plan = gsapArrayKeyframePlan(animation, property, { structuralOnly: true });
    // The WHOLE carrying set is frozen — identity AND expected values (updated
    // only for buckets the bridge itself writes). Watching just the run bucket
    // misses an external mutation of a NEIGHBOR that creates a live hold: the
    // next single-bucket write would turn that hold into a ramp (Sol r26).
    const intact = plan
      && plan.buckets.length === binding.allBuckets.length
      && plan.buckets.every((bucket, index) => binding.allBuckets[index] === bucket)
      && binding.allBuckets.every((bucket, index) => bucket[property] === binding.allExpected[index]);
    return intact ? { binding, stale: false } : { binding: null, stale: true };
  }

  function pruneStaleEntryBindings(animation) {
    const bindings = gsapKeyframeEntryRetargets.get(animation);
    if (!bindings) return;
    Array.from(bindings.keys()).forEach((property) => {
      if (entryBindingState(animation, property).stale) bindings.delete(property);
    });
  }
  // The ONE frozen binding per (animation, property) — shared by the trailing
  // entry-edit writer and the phase-2 step writer (design-lock Sol r1: two
  // snapshot families of the same index would corrupt composed rollbacks).
  // Created on the FIRST write of either writer; `stepOriginals` is the step
  // journal (verbatim value per rawEntryIndex, frozen at first touch). Returns
  // null when no plan exists (callers word their own refusal); throws on a
  // stale binding — never silently replaces it (Sol r5).
  function ensureFrozenEntryBinding(record, property) {
    const animation = record.animation;
    let bindings = gsapKeyframeEntryRetargets.get(animation);
    if (!bindings) {
      bindings = new Map();
      gsapKeyframeEntryRetargets.set(animation, bindings);
    }
    const state = entryBindingState(animation, property);
    if (state.stale) {
      throw bridgeError('unsupported_patch', "This animation's keyframes were changed by the page — reselect the layer to edit them again.");
    }
    let binding = state.binding;
    if (!binding) {
      const plan = gsapArrayKeyframePlan(animation, property);
      if (!plan) return null;
      binding = {
        buckets: plan.run,
        originals: plan.run.map((bucket) => bucket[property]),
        allBuckets: plan.buckets,
        allExpected: plan.buckets.map((bucket) => bucket[property]),
        carriers: plan.carriers,
        allEntries: plan.allEntries,
        allEntryStates: plan.allEntries.map((frozenEntry) => ({
          entry: frozenEntry,
          namespace: gsapEntryPropertyNamespace(frozenEntry, property),
          child: gsapEntryChildTweens.get(frozenEntry) || null,
        })),
        end: numericCss(sampleGsapValue(record, property, 1)),
        stepOriginals: new Map(),
      };
      bindings.set(property, binding);
    }
    if (!binding.stepOriginals) binding.stepOriginals = new Map();
    return binding;
  }

  function applyGsapKeyframeEntryEdit(record, property, desired) {
    const animation = record.animation;
    // A RELATIVE desired ('+=10') must be refused BEFORE any mutation: written
    // into an entry it would invalidate the plan itself on the next read/write,
    // leaving an edit no rollback can reach (Sol r2).
    if (/^[+-]=/.test(String(desired ?? '').trim())) {
      throw bridgeError('unsupported_value', 'Relative values cannot be written into GSAP keyframes entries.');
    }
    // random(...) re-rolls on every init/invalidate — written into an entry it
    // is neither stable nor restorable (Sol r97).
    if (/random\(/i.test(String(desired ?? ''))) {
      throw bridgeError('unsupported_value', 'Randomized values cannot be written into GSAP keyframes entries.');
    }
    // Binding FIRST: once an edit run is frozen, later writes — rollbacks above
    // all — must keep working even if a fresh plan would no longer validate
    // (e.g. the page mutated an unrelated entry). Only a first write needs a plan.
    const binding = ensureFrozenEntryBinding(record, property);
    if (!binding) {
      throw bridgeError('unsupported_patch', 'This value is driven by GSAP keyframes and cannot be retargeted safely yet.');
    }
    const coerceFor = (bucket) => (typeof bucket[property] === 'number' && Number.isFinite(Number(desired))
      ? Number(desired)
      : String(desired));
    const desiredParsed = numericCss(desired);
    // Landing back on the ORIGINAL end restores the authored entries verbatim.
    // The AUTHORED final matters as much as the sampled one: for clamped props
    // the sampled end (computed 1) diverges from the authored value (3), and a
    // rollback replaying the authored '3' must restore — never uniform-write
    // [3,3] over [2,3] (Sol r25).
    const authoredEnd = binding.originals[binding.originals.length - 1];
    const landsOnOriginal = (binding.end && desiredParsed
      && desiredParsed.unit === binding.end.unit && desiredParsed.value === binding.end.value)
      || gsapValueEquivalence(property, desired, authoredEnd) === 'equal';
    if (landsOnOriginal) {
      // Revalidated HERE, immediately before restore+invalidate: a restore may
      // traverse an outage ('unknown') but never a PROVEN hazard — the
      // invalidate would resurrect the killed writer on OTHER channels even
      // though this channel's payload is authored (Sol r75).
      if (gsapResurrectionHazardVerdict(animation) === 'proven') {
        throw bridgeError('unsupported_patch', "Part of this animation was killed by the page — restoring would bring the dead writer back.");
      }
      // Sharing that arose AFTER the binding froze: another tween riding on
      // these buckets would be silently rewritten by the restore (the r45
      // cross-motionId corruption). Proven sharing or an uncertain inspection
      // fails closed; the binding stays for a later attempt. The global
      // timeline is an independent API — a mere inner-timeline outage (r74)
      // still restores when no sharing is found (Sol r79).
      if (gsapBucketsSharedWithOtherTween(animation, binding.allBuckets)) {
        throw bridgeError('unsupported_patch', 'These keyframes are shared with another animation and cannot be restored safely.');
      }
      binding.buckets.forEach((bucket, index) => { bucket[property] = binding.originals[index]; });
    } else {
      // FULL plan demanded immediately before a NON-RESTORE mutation
      // (defense-in-depth TOCTOU guard — Sol r70): if any disqualifier
      // appeared since the router's gate, refuse; the frozen binding stays
      // for a later restore. Landing on the original (above) remains a
      // restore-only path through the frozen buckets.
      const plan = gsapArrayKeyframePlan(animation, property);
      if (!plan) {
        throw bridgeError('unsupported_patch', 'This value is driven by GSAP keyframes and cannot be retargeted safely yet.');
      }
      // PRE-SIMULATE the write: a desired that lands beside a same-number,
      // different-unit neighbor ('100' beside '100px') would turn the next
      // plan AMBIGUOUS -> null, stranding the applied edit beyond any rollback
      // (the r2 failure class — Sol r21). Reject BEFORE mutating.
      {
        const simulated = plan.buckets.map((bucket) =>
          (binding.buckets.includes(bucket) ? coerceFor(bucket) : bucket[property]));
        for (let index = simulated.length - 1; index > 0; index -= 1) {
          const relation = gsapValueEquivalence(property, simulated[index - 1], simulated[simulated.length - 1]);
          if (relation === 'ambiguous') {
            throw bridgeError('unsupported_value', 'Mixed units around this keyframe make the edit unsafe.');
          }
          if (relation === 'different') break;
        }
      }
      binding.buckets.forEach((bucket) => { bucket[property] = coerceFor(bucket); });
    }
    binding.allExpected = binding.allBuckets.map((bucket) => bucket[property]);
    invalidatePreservingStart(animation);
  }

  // Phase-2 step writer: edits ONE intermediate entry of the ARRAY keyframes
  // form, addressed by rawEntryIndex (the canonical transactional address —
  // design-lock Sol r2/r3: offsets duplicate on duration:0 and vanish on a
  // zero total duration; probe _probe-phase2-zerodur.mjs). Probe
  // _probe-phase2-midentry.mjs (GSAP 3.15 real): editing an intermediate
  // entry + invalidatePreservingStart preserves the global start and never
  // touches the segment BEFORE the edited one; zero callbacks leak
  // (suppressEvents — probe _probe-phase2-callbacks.mjs).
  function applyGsapKeyframeStep(record, property, descriptor) {
    const animation = record.animation;
    const vars = animation.vars || {};
    if (GSAP_CONFIG_VARS.has(property)) {
      throw bridgeError('unsupported_patch', 'This is a GSAP configuration key — not an animatable property.');
    }
    const desired = String(descriptor?.value ?? '');
    // Same value refusals as the entry-edit writer, BEFORE any mutation: a
    // relative/randomized value written into an entry voids the plan itself
    // and has no restorable rollback (Sol r2/r97).
    if (/^[+-]=/.test(desired.trim())) {
      throw bridgeError('unsupported_value', 'Relative values cannot be written into GSAP keyframes entries.');
    }
    if (/random\(/i.test(desired)) {
      throw bridgeError('unsupported_value', 'Randomized values cannot be written into GSAP keyframes entries.');
    }
    const entryIndex = Number(descriptor?.entryIndex);
    if (!Number.isInteger(entryIndex) || entryIndex < 0) {
      throw bridgeError('invalid_value', 'The step patch is missing its keyframe address.');
    }
    if (vars.runBackwards) {
      throw bridgeError('unsupported_patch', 'gsap.from() keyframes are read-only — vars hold the start, not the end.');
    }
    // Channel guards mirrored from applyGsapKeyframe: entries are shared
    // storage across targets/staggers, and plugin/css-wrapper carriers have
    // no proven step path.
    if (vars.stagger != null) {
      throw bridgeError('unsupported_patch', 'This value is shared by a staggered group — unchain the layer (chain icon) to edit it independently.');
    }
    if (Math.max(1, record.targets?.length || 1) > 1) {
      throw bridgeError('unsupported_patch', 'This value is shared by multiple targets — unchain the layer (chain icon) to edit it independently.');
    }
    if (vars.css && typeof vars.css === 'object' && !Array.isArray(vars.css) && property in vars.css) {
      throw bridgeError('unsupported_patch', 'This value lives in the legacy css wrapper — step editing is not supported yet.');
    }
    if (gsapPluginOwnedVar(vars, property)) {
      throw bridgeError('unsupported_patch', 'This value is driven by a GSAP plugin — its steps cannot be edited safely yet.');
    }
    const binding = ensureFrozenEntryBinding(record, property);
    if (!binding) {
      throw bridgeError('unsupported_patch', 'This value is driven by GSAP keyframes and cannot be edited safely yet.');
    }
    // Address against the FROZEN binding (identity — Sol F2): the raw index
    // names a position in the entry order frozen at first write.
    const frozenEntry = binding.allEntries ? binding.allEntries[entryIndex] : null;
    const carrier = frozenEntry
      ? (binding.carriers || []).find((candidate) => candidate.entry === frozenEntry)
      : null;
    if (!frozenEntry || !carrier) {
      throw bridgeError('unsupported_patch', 'This keyframe step does not carry the edited property.');
    }
    // Journal separation (Sol F1): the frozen trailing run belongs to the END
    // writer — its uniform writes and value-replay undo cannot represent a
    // divergent member. Steps own everything BEFORE the run.
    if (binding.buckets.includes(carrier.bucket)) {
      throw bridgeError('unsupported_patch', 'This step holds the final value — edit it from the end keyframe.');
    }
    const journal = binding.stepOriginals;
    const original = journal.has(entryIndex) ? journal.get(entryIndex) : carrier.bucket[property];
    if (gsapValueEquivalence(property, desired, String(original)) === 'equal') {
      // RESTORE lane — binding-first, never a fresh plan (a rollback must
      // traverse an outage). Same terminal guards as the entry-edit restore:
      // a PROVEN resurrection hazard or cross-tween sharing refuses (Sol
      // r75/r45); a mere inner-timeline outage restores (Sol r79).
      if (gsapResurrectionHazardVerdict(animation) === 'proven') {
        throw bridgeError('unsupported_patch', "Part of this animation was killed by the page — restoring would bring the dead writer back.");
      }
      if (gsapBucketsSharedWithOtherTween(animation, binding.allBuckets)) {
        throw bridgeError('unsupported_patch', 'These keyframes are shared with another animation and cannot be restored safely.');
      }
      carrier.bucket[property] = original;
    } else {
      // WRITE lane — the full plan is demanded immediately before a
      // non-restore mutation (TOCTOU — Sol r70), plus the channel-level
      // hazards the plan alone does not carry.
      if (gsapResurrectionHazard(animation)) {
        throw bridgeError('unsupported_patch', "Part of this animation was killed by the page — editing it would bring the dead writer back.");
      }
      // No property self-exemption on this channel (Sol r116): the write
      // replaces the entry value and would destroy an authored function.
      if (gsapAnimationRandomHazard(animation)) {
        throw bridgeError('unsupported_patch', 'This animation uses randomized values — any edit would re-roll them.');
      }
      const plan = gsapArrayKeyframePlan(animation, property);
      if (!plan) {
        throw bridgeError('unsupported_patch', 'This value is driven by GSAP keyframes and cannot be edited safely yet.');
      }
      // The frozen entry must still OCCUPY this raw index in the live order
      // (Sol F2) — a moved/spliced entry refuses instead of editing a
      // neighbor; re-inspection prunes and re-freezes.
      if (plan.allEntries[entryIndex] !== frozenEntry) {
        throw bridgeError('unsupported_patch', "This animation's keyframes were changed by the page — reselect the layer to edit them again.");
      }
      const coerced = (typeof carrier.bucket[property] === 'number' && Number.isFinite(Number(desired)))
        ? Number(desired)
        : desired;
      // PRE-SIMULATE the write with the end writer's exact trailing walk
      // (Sol r5): a desired that turns the NEXT plan ambiguous → null would
      // also fail entryBindingState's structural re-plan, marking the binding
      // stale and stranding the applied edit beyond its own rollback (the r2
      // class — the router is binding-first, but staleness validation is a
      // plan consumer too). Reject BEFORE journaling or mutating.
      {
        const simulated = plan.buckets.map((bucket) =>
          (bucket === carrier.bucket ? coerced : bucket[property]));
        for (let index = simulated.length - 1; index > 0; index -= 1) {
          const relation = gsapValueEquivalence(property, simulated[index - 1], simulated[simulated.length - 1]);
          if (relation === 'ambiguous') {
            throw bridgeError('unsupported_value', 'Mixed units around this keyframe make the edit unsafe.');
          }
          if (relation === 'different') break;
        }
      }
      if (!journal.has(entryIndex)) journal.set(entryIndex, carrier.bucket[property]);
      carrier.bucket[property] = coerced;
    }
    binding.allExpected = binding.allBuckets.map((bucket) => bucket[property]);
    invalidatePreservingStart(animation);
  }

  function applyGsapRetarget(record, descriptor) {
    const targetCount = Math.max(1, record.targets?.length || 1);
    if (targetCount > 1 && Number(descriptor.affectedTargetCount || 1) !== targetCount) {
      throw bridgeError('scope_mismatch', 'This animation controls more targets than the patch declares.');
    }
    // Reserved GSAP config keys are never animatable properties (Sol r17).
    if (GSAP_CONFIG_VARS.has(descriptor.runtimeProperty)) {
      throw bridgeError('unsupported_patch', 'This is a GSAP configuration key — not an animatable property.');
    }
    // Frozen-binding RESTORES bypass the gates below — the writer's own
    // restore path (frozen buckets, authored payload) is safe by construction
    // and must stay reachable during an outage (Sol r74).
    if (descriptor.writeModel === 'absolute' && !descriptor.component
      && gsapFrozenRestoreCandidate(record.animation, descriptor.runtimeProperty, descriptor.value)) {
      applyGsapKeyframeEntryEdit(record, descriptor.runtimeProperty, descriptor.value);
      return;
    }
    // ANY write here ends in invalidate — refuse while a killed writer haunts
    // the animation (Sol r28/r29).
    if (gsapResurrectionHazard(record.animation)) {
      throw bridgeError('unsupported_patch', "Part of this animation was killed by the page — editing it would bring the dead writer back.");
    }
    // The invalidate also re-rolls every randomized value on the tween —
    // animation-level, so flat rides-along edits refuse too (Sol r101);
    // sibling-aware for top-level functions (Sol r115).
    if (gsapAnimationRandomHazard(record.animation, descriptor.runtimeProperty)) {
      throw bridgeError('unsupported_patch', 'This animation uses randomized values — any edit would re-roll them.');
    }
    // Defense in depth: every write model funnels into vars/startAt writes, which are
    // unsafe on keyframes-driven properties (probe 2026-07-29: path-start corruption
    // on the array form, silently ignored on object/percent forms) — including a
    // property authored BOTH top-level and in keyframes. Ownership is the UNION of
    // the array and the live children entries: a spliced-out entry's child keeps
    // rendering, so its property must never fall through to the plain vars writer
    // (Sol r8). The ARRAY form with a safe entry plan is the one exception: its
    // retarget edits the ENTRIES instead, and only for the ABSOLUTE model
    // (loop/relative/function paths have no entry equivalent — the classifier
    // mirrors this exactly).
    const liveKeyframeEntries = gsapLiveKeyframeEntries(record.animation);
    if (gsapAuthoredKeyframeProps(record.animation, GSAP_CONFIG_VARS).includes(descriptor.runtimeProperty)
      || (liveKeyframeEntries
        && gsapKeyframeProps(liveKeyframeEntries, GSAP_CONFIG_VARS).includes(descriptor.runtimeProperty))
      || gsapDetectionKeyframeProps(record.animation, GSAP_CONFIG_VARS).includes(descriptor.runtimeProperty)) {
      if (descriptor.writeModel === 'absolute' && !descriptor.component
        && gsapArrayKeyframePlan(record.animation, descriptor.runtimeProperty)) {
        applyGsapKeyframeEntryEdit(record, descriptor.runtimeProperty, descriptor.value);
        return;
      }
      throw bridgeError('unsupported_patch', 'This value is driven by GSAP keyframes and cannot be retargeted safely yet.');
    }
    // Plugin-owned vars (attr:{...}, text:"...", scrollTo:500): writing over
    // them corrupts the plugin's config — no write path is proven (Sol v6/v7).
    if (gsapPluginOwnedVar(record.animation?.vars, descriptor.runtimeProperty)) {
      throw bridgeError('unsupported_patch', 'This value is driven by a GSAP plugin and cannot be retargeted safely yet.');
    }
    if (descriptor.writeModel === 'relative') applyGsapRelative(record, descriptor);
    else if (descriptor.writeModel === 'function-offset') applyGsapFunctionOffset(record, descriptor);
    else if (descriptor.writeModel === 'additive-base') applyGsapLoopBase(record, descriptor);
    else assignGsapAbsolute(record, descriptor);
    invalidatePreservingStart(record.animation);
  }

  function applyGsapKeyframe(record, property, descriptor) {
    const animation = record.animation;
    const vars = animation.vars || (animation.vars = {});
    // Reserved GSAP config keys are never animatable properties — writing one
    // into vars mutates tween CONFIG while reporting a visual edit (Sol r17).
    if (GSAP_CONFIG_VARS.has(property)) {
      throw new Error('This is a GSAP configuration key — not an animatable property.');
    }
    // A randomized desired is refused BEFORE the offset branching: the
    // offset-0 lane writes vars.startAt directly and would otherwise bypass
    // the entry-edit writer's guard (Sol r98).
    if (/random\(/i.test(String(descriptor?.value ?? ''))) {
      throw bridgeError('unsupported_value', 'Randomized values cannot be written into GSAP keyframes.');
    }
    // Frozen-binding RESTORES bypass the gates below (Sol r74).
    if (Number(descriptor?.offset) >= 0.999 && descriptor?.exists !== false
      && gsapFrozenRestoreCandidate(animation, property, String(descriptor?.value ?? ''))) {
      applyGsapKeyframeEntryEdit(record, property, String(descriptor?.value ?? ''));
      return;
    }
    // ANY write here ends in invalidate — refuse while a killed writer haunts
    // the animation (Sol r28/r29).
    if (gsapResurrectionHazard(animation)) {
      throw new Error("Part of this animation was killed by the page — editing it would bring the dead writer back.");
    }
    // The invalidate also re-rolls every randomized value on the tween (Sol r101).
    // NO self-exemption on this channel: keyframe.<prop> writes vars[prop]
    // directly, destroying an authored function (the reader only captured
    // String(fn) — a rollback would write source code as a string). Any
    // top-level function, the edited property's own included, blocks
    // (Sol r116).
    if (gsapAnimationRandomHazard(animation)) {
      throw bridgeError('unsupported_patch', 'This animation uses randomized values — any edit would re-roll them.');
    }
    if (vars.runBackwards) {
      throw new Error('gsap.from() keyframes are read-only — vars hold the start, not the end.');
    }
    // Writing vars/startAt on a keyframes-driven tween corrupts its path start on
    // invalidate (array form) or does nothing (object/percent forms) — probe-verified.
    // The ARRAY form with a safe entry plan is the exception: END edits go through
    // the ENTRIES and START edits through startAt (post-hoc startAt is clean on
    // keyframes tweens — probe G). The plan itself excludes the wrapper/stagger/
    // plugin/both-places cases, so the guards below stay accurate without it.
    // Ownership PER PROPERTY, independent of the array's presence: live
    // children entries keep rendering after `delete vars.keyframes` — their
    // property must never fall through to the plain vars writer below (Sol r9)
    // — while a plain top-level prop beside keyframes of ANOTHER prop keeps its
    // plain writer (probe _probe-rides-along.mjs — Sol r13).
    const liveKeyframeEntries = gsapLiveKeyframeEntries(animation);
    const keyframeOwned = gsapAuthoredKeyframeProps(animation, GSAP_CONFIG_VARS).includes(property)
      || Boolean(liveKeyframeEntries
        && gsapKeyframeProps(liveKeyframeEntries, GSAP_CONFIG_VARS).includes(property))
      || gsapDetectionKeyframeProps(animation, GSAP_CONFIG_VARS).includes(property);
    const entryPlan = keyframeOwned ? gsapArrayKeyframePlan(animation, property) : null;
    if (keyframeOwned && !entryPlan) {
      throw new Error('This animation is driven by GSAP keyframes — its steps cannot be edited safely yet.');
    }
    // css:{}-wrapped properties: top-level vars/startAt writes are silently ignored
    // by these tweens (probe-verified) — step editing needs a css-aware path first.
    if (vars.css && typeof vars.css === 'object' && !Array.isArray(vars.css) && property in vars.css) {
      throw new Error('This value lives in the legacy css wrapper — step editing is not supported yet.');
    }
    // A staggered tween is a facade over internal per-target tweens: writing
    // vars/startAt on it silently changes NOTHING (probe-verified — the edit
    // read back the old value). Fail loudly and point at the way out.
    if (vars.stagger != null) {
      throw new Error('This value is shared by a staggered group — unchain the layer (chain icon) to edit it independently.');
    }
    // Shared vars/startAt cannot restore distinct per-target starts on
    // rollback ([10,20] -> [10,10] — probe _probe-r19.mjs, Sol r19).
    if (Math.max(1, record.targets?.length || 1) > 1) {
      throw new Error('This value is shared by multiple targets — unchain the layer (chain icon) to edit it independently.');
    }
    // Plugin-owned vars (attr:{...}, text:"...", scrollTo:500): a write over
    // them corrupts the plugin's config — same predicate as the classifier.
    if (gsapPluginOwnedVar(vars, property)) {
      throw new Error('This value is driven by a GSAP plugin — its steps cannot be edited safely yet.');
    }
    const offset = Math.max(0, Math.min(1, Number(descriptor?.offset) || 0));
    if (descriptor?.exists === false) {
      if (offset <= 0.001 && vars.startAt) {
        // A naive delete is a FALSE rollback: GSAP materializes _startAt on
        // first render and deleting vars.startAt does not un-materialize it —
        // the edited start keeps rendering while the ack reports restored
        // (probe _probe-startat-rollback.mjs — Sol r18). The binding restores
        // the AUTHORED value verbatim when one existed (function identity
        // included — Sol r41), else the render-equivalent sampled original.
        const bindings = gsapStartAtRetargets.get(animation);
        let binding = bindings?.get(property);
        if (binding) {
          // Same staleness rule as the write path (Sol r42): a live value the
          // bridge did not leave there means the page rebased the start.
          const live = vars.startAt[property];
          const expected = 'lastWritten' in binding ? binding.lastWritten : binding.authored;
          if (live !== expected) {
            bindings.delete(property);
            binding = null;
          }
        }
        if (binding) {
          vars.startAt = { ...vars.startAt, [property]: binding.hadKey ? binding.authored : binding.original };
          binding.lastWritten = vars.startAt[property];
        } else {
          delete vars.startAt[property];
        }
      }
      invalidatePreservingStart(animation);
      return;
    }
    const value = String(descriptor?.value ?? '');
    if (offset >= 0.999) {
      if (entryPlan) {
        applyGsapKeyframeEntryEdit(record, property, value); // entries, never vars
        return;
      }
      vars[property] = value; // end target
    } else if (offset <= 0.001) {
      let bindings = gsapStartAtRetargets.get(animation);
      if (!bindings) {
        bindings = new Map();
        gsapStartAtRetargets.set(animation, bindings);
      }
      // STALENESS: the binding only describes reality while the live startAt
      // holds what the bridge last wrote (or the authored value, pre-write).
      // If the page replaced it (fnA -> fnB), a frozen binding would roll the
      // next transaction back to fnA — REBASE from the live state instead
      // (Sol r42).
      const existing = bindings.get(property);
      if (existing) {
        const live = vars.startAt ? vars.startAt[property] : undefined;
        const expected = 'lastWritten' in existing ? existing.lastWritten : existing.authored;
        if (live !== expected) bindings.delete(property);
      }
      if (!bindings.has(property)) {
        bindings.set(property, {
          original: String(sampleGsapValue(record, property, 0)),
          hadKey: Boolean(vars.startAt && Object.prototype.hasOwnProperty.call(vars.startAt, property)),
          authored: vars.startAt ? vars.startAt[property] : undefined,
        });
      }
      // Landing back on the original start restores the AUTHORED value
      // verbatim — a function keeps its identity; its stringification must
      // never be written over it (Sol r41).
      const binding = bindings.get(property);
      if (binding && binding.hadKey
        && (value === binding.original || value === String(binding.authored))) {
        vars.startAt = { ...(vars.startAt || {}), [property]: binding.authored };
      } else {
        vars.startAt = { ...(vars.startAt || {}), [property]: value }; // explicit start
      }
      if (binding) binding.lastWritten = vars.startAt[property];
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
    // The clone re-resolves authored vars (re-rolling random()) and the
    // sibling relink invalidates — a randomized tween cannot unchain safely
    // in either direction (Sol r102).
    if (gsapAnimationRandomHazard(tween)) {
      throw bridgeError('unsupported_patch', 'This animation uses randomized values — unchaining would re-roll them.');
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
    // Mirror of the detach gate: the relink's invalidate re-rolls every
    // randomized value on BOTH targets (Sol r102). Unreachable while detach
    // refuses, kept as defense in depth (random could appear post-detach).
    if (gsapAnimationRandomHazard(tween)) {
      throw bridgeError('unsupported_patch', 'This animation uses randomized values — re-chaining would re-roll them.');
    }
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
    if (patch.property.startsWith('keyframeStep.')) {
      applyGsapKeyframeStep(record, patch.property.slice('keyframeStep.'.length), value);
    } else if (patch.property.startsWith('keyframe.')) {
      applyGsapKeyframe(record, patch.property.slice('keyframe.'.length), value);
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
    if (property.startsWith('keyframeStep.')) {
      const trackProperty = property.slice('keyframeStep.'.length);
      const descriptor = patch.value && typeof patch.value === 'object' ? patch.value : patch.before;
      const entryIndex = Number(descriptor?.entryIndex);
      if (record.type === 'browser' || !Number.isInteger(entryIndex) || entryIndex < 0) {
        return { entryIndex, exists: false };
      }
      // Canonicalize by the FROZEN binding when one exists: buckets are held
      // by identity and stay readable through an outage — the transactional
      // history stays truthful (Sol r83 semantics, per index).
      const bindingRead = entryBindingState(animation, trackProperty);
      if (bindingRead.binding) {
        const frozenEntry = bindingRead.binding.allEntries ? bindingRead.binding.allEntries[entryIndex] : null;
        const carrier = frozenEntry
          ? (bindingRead.binding.carriers || []).find((candidate) => candidate.entry === frozenEntry)
          : null;
        if (!carrier) return { entryIndex, exists: false };
        return { entryIndex, value: String(carrier.bucket[trackProperty]), exists: true };
      }
      const plan = gsapArrayKeyframePlan(animation, trackProperty);
      if (plan) {
        const step = plan.steps.find((candidate) => candidate.rawEntryIndex === entryIndex);
        if (!step) return { entryIndex, exists: false };
        return { entryIndex, value: String(step.bucket[trackProperty]), exists: true };
      }
      return { entryIndex, exists: false };
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
        // A FUNCTION-valued startAt must never be stringified into the
        // descriptor — the rollback would write the garbage string back over
        // the function (Sol r41). Report the SAMPLED rendered start instead;
        // the writer's binding restores the authored function verbatim.
        if (typeof vars.startAt[trackProperty] === 'function') {
          return { offset, value: String(sampleGsapValue(record, trackProperty, 0)), exists: true };
        }
        return { offset, value: String(vars.startAt[trackProperty]), exists: true };
      }
      if (offset >= 0.999) {
        // Array-form keyframe-driven ends live in the ENTRIES (the writer edits
        // them, never vars) — read the trailing bucket, or before/value both
        // report {exists:false} and a transaction rollback no-ops while the
        // edit stays applied (Sol r1). The plan's last bucket is also a valid
        // frozen binding's last bucket (the binding is a suffix of it).
        const entryPlan = gsapArrayKeyframePlan(animation, trackProperty);
        if (entryPlan) {
          const bucket = entryPlan.run[entryPlan.run.length - 1];
          return { offset, value: String(bucket[trackProperty]), exists: true };
        }
        // During an outage the plan is unavailable but a FROZEN binding still
        // describes the trailing run it froze — report its current bucket so
        // transactional history stays truthful (300→200). {exists:false} on
        // both sides would persist an inverse that no-ops forever (Sol r83).
        const bindingRead = entryBindingState(animation, trackProperty);
        if (bindingRead.binding) {
          const bindingBuckets = bindingRead.binding.buckets;
          const bindingBucket = bindingBuckets[bindingBuckets.length - 1];
          return { offset, value: String(bindingBucket[trackProperty]), exists: true };
        }
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
    if (patch.kind === 'control') return readControlPatchValue(patch, element);
    throw bridgeError('unsupported_patch', 'The patch kind is not supported.');
  }

  function declaredControlTarget(control, elementId) {
    return control.targets.find((target) => target?.elementId === elementId) || null;
  }

  function controlForPatch(patch) {
    const control = controlRegistry.get(patch?.property);
    if (!control) throw bridgeError('control_missing', 'The validated control is no longer available.');
    if (control.bundleId !== bundleId || control.runtimeFingerprint !== runtimeFingerprint) {
      throw bridgeError('fingerprint_mismatch', 'The validated control belongs to another runtime.');
    }
    const target = declaredControlTarget(control, patch.elementId);
    if (!target) throw bridgeError('scope_escape', 'The control cannot write to this target.');
    return { control, target };
  }

  function controlValueAllowed(control, value) {
    const domain = control.domain || {};
    if (control.controlType === 'slider-number') {
      const min = Number(domain.min);
      const max = Number(domain.max);
      const step = Number(domain.step);
      if (typeof value !== 'number' || !Number.isFinite(value)
        || !Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step)
        || step <= 0 || value < min || value > max) return false;
      const stepOffset = (value - min) / step;
      return Math.abs(stepOffset - Math.round(stepOffset)) <= 1e-7;
    }
    if (control.controlType === 'toggle') return typeof value === 'boolean';
    const options = Array.isArray(domain.options) ? domain.options : [];
    return options.some((option) => valuesEqual(option?.value ?? option, value));
  }

  function controlMotionPatch(control, target, patch) {
    if (!target.motionId) throw bridgeError('motion_missing', 'The validated motion target is no longer available.');
    const property = control.binding?.property || target.property;
    if (typeof property !== 'string' || !property) throw bridgeError('unsupported_patch', 'The control property is unavailable.');
    return { ...patch, kind: 'motion', motionId: target.motionId, property };
  }

  function registeredControlCapability(name) {
    const registry = window.__uncraftMotionControlCapabilities;
    if (!registry || typeof registry !== 'object') return null;
    const capability = registry[name];
    if (!capability || typeof capability.read !== 'function' || typeof capability.apply !== 'function') return null;
    return capability;
  }

  function capabilityContext(control, target, patch, element) {
    return Object.freeze({
      controlId: control.id,
      element,
      elementId: target.elementId,
      motionId: target.motionId,
      property: control.binding?.property || target.property,
      value: cloneValue(patch.value),
    });
  }

  function readControlPatchValue(patch, element) {
    const { control, target } = controlForPatch(patch);
    const binding = control.binding || {};
    if (binding.kind === 'css-custom-property') return element.style.getPropertyValue(binding.property);
    if (binding.kind === 'dom-attribute') return element.getAttribute(binding.attribute) ?? '';
    if (binding.kind === 'known-runtime' || binding.kind === 'typed-command') {
      return readMotionPatchValue(controlMotionPatch(control, target, patch), element);
    }
    const capability = binding.kind === 'custom-capability' ? binding.capability : null;
    if (!['motion.scalar', 'motion.boolean', 'motion.option', 'motion.color', 'motion.easing'].includes(capability)) {
      throw bridgeError('capability_missing', 'The control capability is not registered.');
    }
    const registered = registeredControlCapability(capability);
    if (registered) return cloneValue(registered.read(capabilityContext(control, target, patch, element)));
    return readMotionPatchValue(controlMotionPatch(control, target, patch), element);
  }

  function applyControlPatch(patch, element) {
    const { control, target } = controlForPatch(patch);
    if (!controlValueAllowed(control, patch.value)) throw bridgeError('invalid_value', 'The control value is outside its validated domain.');
    const binding = control.binding || {};
    if (binding.kind === 'css-custom-property') {
      element.style.setProperty(binding.property, patch.value ?? '');
      return;
    }
    if (binding.kind === 'dom-attribute') {
      if (patch.value === '' || patch.value == null) element.removeAttribute(binding.attribute);
      else element.setAttribute(binding.attribute, patch.value);
      return;
    }
    if (binding.kind === 'known-runtime' || binding.kind === 'typed-command') {
      applyMotionPatch(controlMotionPatch(control, target, patch), element);
      return;
    }
    const capability = binding.kind === 'custom-capability' ? binding.capability : null;
    if (!['motion.scalar', 'motion.boolean', 'motion.option', 'motion.color', 'motion.easing'].includes(capability)) {
      throw bridgeError('capability_missing', 'The control capability is not registered.');
    }
    const registered = registeredControlCapability(capability);
    if (registered) {
      registered.apply(capabilityContext(control, target, patch, element));
      return;
    }
    applyMotionPatch(controlMotionPatch(control, target, patch), element);
  }

  function alternateControlValue(control) {
    const current = control.currentValue;
    const domain = control.domain || {};
    if (control.controlType === 'slider-number') {
      const step = Number(domain.step);
      const min = Number(domain.min);
      const max = Number(domain.max);
      if (![step, min, max].every(Number.isFinite) || step <= 0) return null;
      if (Number(current) + step <= max) return Number(current) + step;
      if (Number(current) - step >= min) return Number(current) - step;
      return null;
    }
    if (control.controlType === 'toggle') return !current;
    const options = Array.isArray(domain.options) ? domain.options : [];
    const next = options.map((option) => option?.value ?? option).find((value) => !valuesEqual(value, current));
    return next === undefined ? null : next;
  }

  function controlMotionMatches(control, target, clip) {
    const property = control.binding?.property || target.property;
    if (String(property).startsWith('timing.') || String(property).startsWith('scroll.')) return true;
    return (clip?.tracks || []).some((track) => track.property === property);
  }

  function recoverControl(message, payload) {
    const controlId = payload?.controlId;
    const stage = ['reinspect', 'rebind', 'regenerate-control'].includes(payload?.stage)
      ? payload.stage
      : 'reinspect';
    const original = controlRegistry.get(controlId);
    if (!original) {
      reply(message, 'control-recovery-result', {
        controlId: controlId || null,
        stage,
        recovered: false,
        code: 'control_missing',
        diagnostics: transactionDiagnostic('control_missing', controlId),
      });
      return;
    }
    let nextControl = original;
    try {
      document.querySelectorAll(SELECTABLE).forEach((element) => ensureElementId(element));
      refreshRuntime();
      const nextTargets = original.targets.map((target) => {
        const element = findElement(target.elementId);
        if (!element) throw bridgeError('target_missing', 'The target element is no longer present.');
        if (!target.motionId) return target;
        const clips = inspectMotion(element);
        if (clips.some((clip) => clip.id === target.motionId)) return target;
        if (stage !== 'regenerate-control') throw bridgeError('motion_missing', 'The motion target is no longer present.');
        const compatible = clips.filter((clip) => controlMotionMatches(original, target, clip));
        if (compatible.length !== 1) throw bridgeError('motion_missing', 'The motion target could not be rebuilt safely.');
        return { ...target, motionId: compatible[0].id };
      });
      nextControl = { ...original, targets: nextTargets };
      controlRegistry.set(controlId, nextControl);
      nextTargets.forEach((target) => {
        const element = findElement(target.elementId);
        readControlPatchValue({ elementId: target.elementId, kind: 'control', property: controlId, value: nextControl.currentValue }, element);
      });
      if (stage === 'regenerate-control') {
        const alternate = alternateControlValue(nextControl);
        if (alternate == null) throw bridgeError('no_effect', 'The control has no safe validation value.');
        const transaction = {
          id: randomIdentity('control-recovery'),
          patches: nextTargets.map((target) => ({
            id: randomIdentity('control-recovery-patch'),
            elementId: target.elementId,
            kind: 'control',
            property: controlId,
            before: nextControl.currentValue,
            value: alternate,
          })),
        };
        const first = applyAtomicTransaction(transaction, { restore: true });
        const second = applyAtomicTransaction({ ...transaction, id: `${transaction.id}:second` }, { restore: true });
        const changed = first.patches.some((patch) => !valuesEqual(patch.before, patch.value));
        const deterministic = first.patches.every((patch, index) => valuesEqual(patch.value, second.patches[index]?.value));
        if (!changed) throw bridgeError('no_effect', 'The rebuilt control had no effect.');
        if (!deterministic) throw bridgeError('non_deterministic', 'The rebuilt control is not deterministic.');
      }
      reply(message, 'control-recovery-result', {
        controlId,
        stage,
        recovered: true,
        control: nextControl,
        diagnostics: transactionDiagnostic('control_recovered', controlId),
      });
    } catch (error) {
      controlRegistry.set(controlId, original);
      const code = error?.code || 'validation_failed';
      reply(message, 'control-recovery-result', {
        controlId,
        stage,
        recovered: false,
        code,
        diagnostics: transactionDiagnostic(code, controlId),
      });
    }
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
      } else if (patch.kind === 'control') {
        applyControlPatch(patch, element);
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

  // A frozen-binding restore is the ONLY lane when the normal entry plan is
  // unavailable (outage): it can be APPLIED but never ROLLED BACK — writing
  // the pre-transaction (non-original) value back is a blocked non-restore.
  // Inside an atomic transaction that asymmetry breaks atomicity, so such a
  // patch is rejected BEFORE the first mutation (Sol r82). The last patch of
  // a commit (restore=false) never needs its own rollback and stays allowed —
  // the single-patch undo lane of r74 is untouched.
  function patchIrreversibleUnderOutage(patch) {
    try {
      if (!patch || patch.kind !== 'motion' || typeof patch.property !== 'string') return false;
      const record = motionRegistry.get(patch.motionId);
      if (!record || record.type === 'browser' || !record.animation) return false;
      let property = null;
      let desired = null;
      if (patch.property === 'retarget.final') {
        const value = patch.value;
        if (!value || value.schemaVersion !== 2 || !value.runtimeProperty) return false;
        if (value.writeModel !== 'absolute' || value.component) return false;
        property = value.runtimeProperty;
        desired = String(value.value ?? '');
      } else if (patch.property.startsWith('keyframeStep.')) {
        // The step channel has the same asymmetry per INDEX: its frozen-journal
        // restore is the only lane under an outage and cannot be rolled back
        // (writing the pre-transaction value back is a blocked non-restore).
        const descriptor = patch.value;
        if (descriptor?.exists === false) return false;
        const stepProperty = patch.property.slice('keyframeStep.'.length);
        if (!gsapFrozenStepRestoreCandidate(record.animation, stepProperty,
          Number(descriptor?.entryIndex), String(descriptor?.value ?? ''))) return false;
        return !gsapArrayKeyframePlan(record.animation, stepProperty);
      } else if (patch.property.startsWith('keyframe.')) {
        const descriptor = patch.value;
        if (!(Number(descriptor?.offset) >= 0.999) || descriptor?.exists === false) return false;
        property = patch.property.slice('keyframe.'.length);
        desired = String(descriptor?.value ?? '');
      } else {
        return false;
      }
      if (!gsapFrozenRestoreCandidate(record.animation, property, desired)) return false;
      // Reversible only when the NORMAL write lane is open too: a full plan
      // must exist to write the pre-transaction value back.
      return !gsapArrayKeyframePlan(record.animation, property);
    } catch (_) {
      return false; // resolution failures surface through the normal apply path
    }
  }

  function applyAtomicTransaction(transaction, { restore = false } = {}) {
    assertTransaction(transaction);
    transaction.patches.forEach((patch, patchIndex) => {
      const needsOwnRollback = restore || patchIndex < transaction.patches.length - 1;
      if (needsOwnRollback && patchIrreversibleUnderOutage(patch)) {
        throw bridgeError('unsupported_patch', 'This restore cannot be rolled back while the animation is uninspectable.');
      }
    });
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

  function describedTransactionElement(transaction) {
    const selectedElement = findElement(selectedId);
    if (!selectedElement) return null;
    const affectedIds = new Set((transaction?.patches || []).map((patch) => patch?.elementId).filter(Boolean));
    const activeElementId = ensureElementId(selectedElement);
    if (affectedIds.size && !affectedIds.has(activeElementId)) return null;
    return describe(selectedElement);
  }

  function commitTransaction(message, transaction, operation = 'apply') {
    try {
      const acknowledged = applyAtomicTransaction(transaction);
      committedTransactions.set(acknowledged.id, acknowledged);
      const element = describedTransactionElement(acknowledged);
      reply(message, 'transaction-committed', {
        transaction: acknowledged,
        operation,
        ...(element ? { element } : {}),
      });
    } catch (error) {
      rejectTransaction(message, transaction?.id, error);
    }
  }

  function validateTransaction(message, transaction) {
    try {
      const first = applyAtomicTransaction(transaction, { restore: true });
      const second = applyAtomicTransaction(transaction, { restore: true });
      const matchesRequested = first.patches.every((patch, index) => valuesEqual(patch.value, transaction.patches[index].value));
      const effectChanged = first.patches.some((patch) => !valuesEqual(patch.before, patch.value));
      const deterministic = first.patches.every((patch, index) => valuesEqual(patch.value, second.patches[index]?.value));
      const valid = matchesRequested && effectChanged && deterministic;
      const code = !matchesRequested ? 'effect_mismatch' : !effectChanged ? 'no_effect' : !deterministic ? 'non_deterministic' : null;
      reply(message, 'validation-result', {
        transactionId: first.id,
        valid,
        restored: true,
        stages: {
          read: 'passed', apply: matchesRequested ? 'passed' : 'failed',
          effect: effectChanged ? 'passed' : 'failed', restore: 'passed',
          deterministic: deterministic ? 'passed' : 'failed', teardown: 'passed',
          fingerprint: runtimeFingerprint ? 'passed' : 'not-required',
        },
        observations: first.patches.map((patch) => ({ patchId: patch.id, value: cloneValue(patch.value) })),
        ...(valid ? {} : { code, diagnostics: transactionDiagnostic(code, first.id) }),
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
    } else if (message.type === 'recover-control') {
      recoverControl(message, payload);
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
    on(window, 'error', () => {
      emit('runtime-failure', {
        code: 'runtime_exception',
        diagnostics: transactionDiagnostic('runtime_exception', runtimeGeneration),
      });
    });
    on(window, 'unhandledrejection', () => {
      emit('runtime-failure', {
        code: 'runtime_exception',
        diagnostics: transactionDiagnostic('runtime_exception', runtimeGeneration),
      });
    });
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
