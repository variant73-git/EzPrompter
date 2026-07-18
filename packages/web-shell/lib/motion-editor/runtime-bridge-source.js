/*
 * Source injected into an untrusted native-clone iframe. Keep this file free
 * of imports: getRuntimeBridgeSource serializes the function into the cloned
 * document, where it runs inside the iframe's opaque sandbox origin.
 */
function nativeMotionRuntimeBridge() {
  const PROTOCOL = 'uncraft-motion-editor/v1';
  const SELECTABLE = [
    '[data-w-id]', '[data-wf-target]',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote',
    'a', 'button', 'label', 'input', 'textarea', 'select',
    'img', 'picture', 'video', 'canvas', 'svg', 'li',
    'section', 'article', 'header', 'footer', 'nav', 'main', 'div'
  ].join(',');
  const TEXT_BLOCK = 'h1,h2,h3,h4,h5,h6,p,blockquote,a,button,label,li,figcaption,dt,dd';
  const SPLIT_TOKEN = '.char,.word,.line,[data-split-text],[data-split-type],[text-split],[text-split-delay]';
  let mode = 'edit';
  let tool = 'select';
  let selectedId = null;
  let speed = 1;
  let hoveredElement = null;
  let hoverFrame = null;
  let dragState = null;
  let suppressClickUntil = 0;
  let textEditState = null;
  let motionSequence = 0;
  let activeTimelineId = null;
  let timelineFrame = null;
  let lastTimelineEmit = 0;
  const animationIds = new WeakMap();
  const motionRegistry = new Map();

  function emit(type, payload) {
    window.parent.postMessage({ protocol: PROTOCOL, source: 'runtime', type, payload }, '*');
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
        if (group.querySelectorAll('.char').length > 1 || group.querySelectorAll('.word').length > 1) return group;
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
    const clip = {
      id,
      engine,
      name: keyframeName || animation.id || `Animation ${index + 1}`,
      editability: 'direct',
      driver: { type: driverType },
      trigger: { type: keyframeName ? 'css-rule' : 'runtime' },
      playState: animation.playState,
      currentTime: Number.isFinite(animation.currentTime) ? Math.round(animation.currentTime) : null,
      timing: {
        delay: finite(rawTiming.delay),
        duration: finite(computed.duration, finite(rawTiming.duration)),
        endDelay: finite(rawTiming.endDelay),
        iterations: rawTiming.iterations ?? 1,
        direction: rawTiming.direction || 'normal',
        fill: rawTiming.fill || 'none',
        easing: rawTiming.easing || 'linear',
        yoyo: rawTiming.direction === 'alternate' || rawTiming.direction === 'alternate-reverse',
        repeatDelay: 0,
      },
      tracks: keyframeTracks(effect),
      scroll: driverType === 'scroll' ? { start: 'timeline start', end: 'timeline end', scrub: true, pin: false, snap: false } : null,
      capabilities: { timing: true, easing: true, keyframes: true, trigger: false, scroll: driverType === 'scroll' },
      source: { engine, animationName: keyframeName || null, timeline: timelineName || null, writeback: 'native' },
    };
    motionRegistry.set(id, { type: 'browser', animation });
    return clip;
  }

  function gsapEditableTracks(animation, vars, target, animatedProps) {
    const gsap = window.gsap;
    const ease = typeof vars.ease === 'string' ? vars.ease : null;
    const endOnly = () => ({
      keyframes: false,
      tracks: animatedProps.map((property) => ({
        property,
        keyframes: [{ offset: 1, value: String(vars[property]), easing: ease }],
      })),
    });
    if (!gsap || typeof gsap.getProperty !== 'function' || typeof animation.progress !== 'function') {
      return endOnly();
    }
    let restore = null;
    try {
      const current = animation.progress();
      restore = Number.isFinite(current) ? current : 0;
      animation.progress(0, true);
      const startValues = animatedProps.map((property) => String(gsap.getProperty(target, property)));
      animation.progress(1, true);
      const endValues = animatedProps.map((property) => String(gsap.getProperty(target, property)));
      animation.progress(restore, true);
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
      return endOnly();
    }
  }

  function gsapAnimationsFor(element) {
    try {
      const timeline = window.gsap && window.gsap.globalTimeline;
      if (!timeline || typeof timeline.getChildren !== 'function') return [];
      return timeline.getChildren(true, true, true).flatMap((animation, index) => {
        const targets = typeof animation.targets === 'function' ? animation.targets() : [];
        const ownsTarget = targets.some((target) =>
          target === element ||
          (target instanceof Element && (element.contains(target) || target.contains(element)))
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
          'force3D', 'data', 'autoRound', 'inherit', 'defaults', 'smoothChildTiming', 'keyframes',
        ]);
        const animatedProps = Object.keys(vars)
          .filter((property) => !ignored.has(property) && typeof vars[property] !== 'function');
        const sampled = gsapEditableTracks(animation, vars, primaryTarget, animatedProps);
        const tracks = sampled.tracks;
        const clip = {
          id,
          engine,
          name: vars.id || scrollTrigger?.vars?.id || scrollTrigger?.id || `Animation ${index + 1}`,
          editability: 'adapter',
          driver: { type: scrollTrigger ? 'scroll' : 'time' },
          trigger: {
            type: scrollTrigger ? 'scroll' : 'runtime',
            target: scrollTrigger?.trigger?.className || scrollTrigger?.trigger?.id || vars.scrollTrigger?.trigger?.className || vars.scrollTrigger?.trigger?.id || null,
          },
          playState: animation.paused?.() ? 'paused' : 'running',
          timing: {
            delay: Math.round((animation.delay?.() || 0) * 1000),
            duration: Math.round((animation.duration?.() || 0) * 1000),
            endDelay: 0,
            iterations: animation.repeat?.() === -1 ? Infinity : (Number.isFinite(animation.repeat?.()) ? animation.repeat() + 1 : 1),
            direction: animation.reversed?.() ? 'reverse' : 'normal',
            fill: 'both',
            easing: typeof vars.ease === 'string' ? vars.ease : 'power1.out',
            yoyo: Boolean(animation.yoyo?.()),
            repeatDelay: Math.round((animation.repeatDelay?.() || 0) * 1000),
          },
          tracks,
          scroll: scrollTrigger ? {
            start: String(scrollTrigger.start ?? scrollTrigger.vars?.start ?? 'top bottom'),
            end: String(scrollTrigger.end ?? scrollTrigger.vars?.end ?? 'bottom top'),
            scrub: Boolean(scrollTrigger.vars?.scrub ?? vars.scrollTrigger?.scrub),
            pin: Boolean(scrollTrigger.pin || (scrollTrigger.vars?.pin ?? vars.scrollTrigger?.pin)),
            snap: Boolean(scrollTrigger.vars?.snap ?? vars.scrollTrigger?.snap),
          } : null,
          capabilities: { timing: true, easing: true, keyframes: sampled.keyframes, trigger: false, scroll: Boolean(scrollTrigger) },
          source: { engine, writeback: 'adapter' },
        };
        motionRegistry.set(id, { type: 'gsap', animation, scrollTrigger });
        return [clip];
      });
    } catch (_) {
      return [];
    }
  }

  function inspectMotion(element) {
    const native = typeof element.getAnimations === 'function'
      ? element.getAnimations({ subtree: true }).map((animation, index) => browserMotionClip(animation, index, element))
      : [];
    return [...native, ...gsapAnimationsFor(element)];
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

  function applyGsapKeyframe(animation, property, descriptor) {
    const vars = animation.vars || (animation.vars = {});
    const offset = Math.max(0, Math.min(1, Number(descriptor?.offset) || 0));
    if (descriptor?.exists === false) {
      if (offset <= 0.001 && vars.startAt) delete vars.startAt[property];
      animation.invalidate?.();
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
    animation.invalidate?.();
  }

  function applyMotionPatch(patch, element) {
    if (!motionRegistry.has(patch.motionId)) inspectMotion(element);
    const record = motionRegistry.get(patch.motionId);
    if (!record) throw new Error('The selected animation is no longer available.');
    const value = patch.value;

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
    } else if (patch.property === 'timing.duration') animation.duration?.(Math.max(0, Number(value)) / 1000);
    else if (patch.property === 'timing.delay') animation.delay?.(Number(value) / 1000);
    else if (patch.property === 'timing.iterations') animation.repeat?.(Math.max(0, Number(value) - 1));
    else if (patch.property === 'timing.repeatDelay') animation.repeatDelay?.(Math.max(0, Number(value)) / 1000);
    else if (patch.property === 'timing.yoyo') animation.yoyo?.(Boolean(value));
    else if (patch.property === 'timing.easing') {
      animation.vars.ease = value;
      animation.invalidate?.();
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
      },
      motion: inspectMotion(element),
      warnings: splitText ? ['Text is split by the animation runtime. A production save must rebuild its split instance.'] : [],
    };
  }

  function chooseElement(target) {
    if (!(target instanceof Element)) return null;
    const textContainer = textRoot(target);
    if (textContainer) return textContainer;
    const exact = target.closest(SELECTABLE);
    if (!exact || exact === document.documentElement || exact === document.body) return null;
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
      emit('inline-text-committed', {
        elementId: state.elementId,
        before: state.beforeText,
        value,
        element: describe(element),
      });
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
      selectedId = null;
      emit('selection-changed', { element: null });
      return;
    }
    selectedId = ensureElementId(element);
    element.setAttribute('data-uncraft-selected', 'true');
    emit('selection-changed', { element: describe(element) });
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

  function applyPatch(patch, quiet) {
    let element = findElement(patch.elementId);
    if (!element) {
      if (!quiet) emit('patch-rejected', { patch, error: 'Element is no longer present in the runtime.' });
      return;
    }
    try {
      if (patch.kind === 'style') {
        element.style.setProperty(patch.property, patch.value || '');
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
        if (!replacement) throw new Error('The selected SVG file is invalid.');
        element.replaceWith(replacement);
        element = replacement;
      } else if (patch.kind === 'motion') {
        applyMotionPatch(patch, element);
      }
    } catch (error) {
      if (!quiet) emit('patch-rejected', { patch, error: error?.message || 'The change could not be applied.' });
      return;
    }
    refreshRuntime();
    if (!quiet) emit('patch-applied', { patch, element: describe(element) });
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

  function controlPlayback(action, nextSpeed) {
    if (Number.isFinite(nextSpeed)) speed = Math.max(0.1, Math.min(4, nextSpeed));
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
    return {
      motionId,
      currentTime: Math.max(0, Math.min(delay + duration, delay + finite(animation.time?.()) * 1000)),
      duration: delay + duration,
      playState: animation.paused?.() ? 'paused' : 'running',
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

  function handleCommand(event) {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.protocol !== PROTOCOL || message.source !== 'host') return;
    const payload = message.payload || {};

    if (message.type === 'set-mode') {
      if (textEditState && payload.mode === 'preview') finishInlineTextEdit(true);
      mode = payload.mode === 'preview' ? 'preview' : 'edit';
      document.documentElement.dataset.uncraftEditorMode = mode;
      emit('mode-changed', { mode });
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
      controlPlayback(payload.action, payload.speed);
    } else if (message.type === 'set-timeline-active') {
      setTimelineActive(payload.motionId);
    } else if (message.type === 'seek-motion') {
      seekTimeline(payload.motionId, payload.currentTime);
    } else if (message.type === 'refresh') {
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
    document.addEventListener('pointermove', (event) => {
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
    document.addEventListener('pointerleave', () => hover(null), true);
    document.addEventListener('pointerdown', (event) => {
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
    document.addEventListener('pointerup', (event) => {
      if (!dragState) return;
      const finished = dragState;
      dragState = null;
      finished.element.releasePointerCapture?.(event.pointerId);
      if (Math.abs(finished.dx) + Math.abs(finished.dy) > 2) {
        suppressClickUntil = Date.now() + 120;
        emit('layout-intent-committed', {
          elementId: finished.elementId,
          before: finished.before,
          value: finished.value,
          delta: { x: finished.dx, y: finished.dy },
          originalRect: {
            x: Math.round(finished.rect.x), y: Math.round(finished.rect.y),
            width: Math.round(finished.rect.width), height: Math.round(finished.rect.height),
          },
          element: describe(finished.element),
        });
      }
    }, true);
    document.addEventListener('click', (event) => {
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
    document.addEventListener('dblclick', (event) => {
      if (mode !== 'edit' || tool !== 'select') return;
      const element = chooseElement(event.target);
      if (!element || !isEditableText(element)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      enterInlineTextEdit(element);
    }, true);
    document.addEventListener('keydown', (event) => {
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
    document.addEventListener('focusout', () => {
      if (!textEditState) return;
      queueMicrotask(() => {
        if (textEditState && !textEditState.editable.contains(document.activeElement)) finishInlineTextEdit(true);
      });
    }, true);
    document.addEventListener('submit', (event) => {
      if (mode === 'edit') event.preventDefault();
    }, true);
    window.addEventListener('message', handleCommand);
    emit('runtime-ready', {
      title: document.title || 'Animated website',
      elementCount: document.querySelectorAll('*').length,
      engines: detectedEngines(),
      profile: collectDocumentProfile(),
      assets: collectAssets(),
    });
  }

  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot, { once: true });
}

export function getRuntimeBridgeSource() {
  return `;(${nativeMotionRuntimeBridge.toString()})();`;
}
