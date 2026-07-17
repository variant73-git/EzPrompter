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
  let mode = 'edit';
  let tool = 'select';
  let selectedId = null;
  let speed = 1;
  let hoveredElement = null;
  let hoverFrame = null;
  let dragState = null;
  let suppressClickUntil = 0;

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

  function directText(element) {
    if (!element) return '';
    if (element.matches('input,textarea')) return element.value || '';
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() || (element.children.length <= 12 ? (element.textContent || '').replace(/\s+/g, ' ').trim() : '');
  }

  function pageOrigin() {
    const generator = document.querySelector('meta[name="generator"]')?.content || '';
    if (document.documentElement.hasAttribute('data-wf-page') || window.Webflow) return 'webflow';
    if (/framer/i.test(generator) || document.querySelector('[data-framer-name],[data-framer-component-type]')) return 'framer';
    return 'native';
  }

  function animationLabel(animation, index) {
    const effect = animation.effect;
    const timing = effect && typeof effect.getComputedTiming === 'function'
      ? effect.getComputedTiming()
      : {};
    const keyframeName = animation.animationName || '';
    return {
      id: animation.id || `waapi-${index + 1}`,
      engine: keyframeName ? 'CSS' : 'WAAPI',
      name: keyframeName || animation.id || `Animation ${index + 1}`,
      playState: animation.playState,
      currentTime: Number.isFinite(animation.currentTime) ? Math.round(animation.currentTime) : null,
      duration: Number.isFinite(timing.duration) ? Math.round(timing.duration) : null,
      iterations: timing.iterations ?? null,
    };
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
        return [{
          id: `gsap-${index + 1}`,
          engine: vars.scrollTrigger ? 'ScrollTrigger' : 'GSAP',
          name: vars.id || vars.scrollTrigger?.id || `Timeline ${index + 1}`,
          playState: animation.paused?.() ? 'paused' : 'running',
          duration: Math.round((animation.duration?.() || 0) * 1000),
          trigger: vars.scrollTrigger?.trigger?.className || vars.scrollTrigger?.trigger?.id || null,
        }];
      });
    } catch (_) {
      return [];
    }
  }

  function inspectMotion(element) {
    const native = typeof element.getAnimations === 'function'
      ? element.getAnimations({ subtree: true }).map(animationLabel)
      : [];
    return [...native, ...gsapAnimationsFor(element)];
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
    const splitText = Boolean(element.querySelector('.char,.word,.line,[data-split-text]'));
    const canEditText = element.matches('input,textarea') || element.children.length === 0 ||
      Array.from(element.children).every((child) => child.matches('.char,.word,.line,[data-split-text]'));
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
    if (target.closest('.char,.word,.line,span,em,strong')) {
      const textContainer = target.closest('h1,h2,h3,h4,h5,h6,p,a,button,label,li,blockquote');
      if (textContainer) return textContainer;
    }
    const exact = target.closest(SELECTABLE);
    if (!exact || exact === document.documentElement || exact === document.body) return null;
    if (/^(SPAN|EM|STRONG)$/i.test(exact.tagName)) {
      return exact.closest('h1,h2,h3,h4,h5,h6,p,a,button,label,li,div') || exact;
    }
    return exact;
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
    if (patch.kind === 'style') {
      element.style.setProperty(patch.property, patch.value || '');
    } else if (patch.kind === 'attribute') {
      if (patch.value === '' || patch.value == null) element.removeAttribute(patch.property);
      else element.setAttribute(patch.property, patch.value);
    } else if (patch.kind === 'text') {
      if (element.matches('input,textarea')) element.value = patch.value;
      else {
        const hadSplitText = Boolean(element.querySelector('.char,.word,.line,[data-split-text]'));
        element.textContent = patch.value;
        if (hadSplitText) element.dataset.uncraftNeedsMotionRebind = 'split-text';
      }
    } else if (patch.kind === 'svg') {
      const replacement = safeSvg(patch.value, patch.elementId);
      if (!replacement) {
        if (!quiet) emit('patch-rejected', { patch, error: 'The selected SVG file is invalid.' });
        return;
      }
      element.replaceWith(replacement);
      element = replacement;
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
  }

  function handleCommand(event) {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.protocol !== PROTOCOL || message.source !== 'host') return;
    const payload = message.payload || {};

    if (message.type === 'set-mode') {
      mode = payload.mode === 'preview' ? 'preview' : 'edit';
      document.documentElement.dataset.uncraftEditorMode = mode;
      emit('mode-changed', { mode });
    } else if (message.type === 'set-tool') {
      tool = payload.tool === 'move' ? 'move' : 'select';
      document.documentElement.dataset.uncraftEditorTool = tool;
      emit('tool-changed', { tool });
    } else if (message.type === 'select-element') {
      select(findElement(payload.elementId));
    } else if (message.type === 'apply-patch') {
      applyPatch(payload.patch, false);
    } else if (message.type === 'apply-patches') {
      (payload.patches || []).forEach((patch) => applyPatch(patch, true));
      const selected = findElement(selectedId);
      emit('patches-applied', { count: (payload.patches || []).length, element: selected ? describe(selected) : null });
    } else if (message.type === 'playback') {
      controlPlayback(payload.action, payload.speed);
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
