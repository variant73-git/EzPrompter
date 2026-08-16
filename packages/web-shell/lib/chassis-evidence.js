/**
 * Runs inside a live browser page through page.evaluate(). It intentionally
 * has no module-level dependencies so the function can be serialized safely.
 */
export function collectChassisEvidence(input = {}) {
  const round = (value, precision = 1) => {
    const factor = 10 ** precision;
    return Math.round(Number(value || 0) * factor) / factor;
  };
  const clean = (value, limit = 240) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
  };
  const selectorFor = (element, index) => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const scene = element.getAttribute('data-scene-id');
    if (scene) return `[data-scene-id="${scene.replace(/"/g, '\\"')}"]`;
    const namedClass = [...element.classList].find((name) => !/^(w-|framer-|css-|jsx-)/.test(name));
    return namedClass ? `${element.tagName.toLowerCase()}.${CSS.escape(namedClass)}` : `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
  };
  const roleFor = (element, index, total) => {
    const signal = `${element.tagName} ${element.id} ${element.className} ${element.getAttribute('aria-label') || ''}`.toLowerCase();
    if (element.tagName === 'HEADER' || /\b(nav|header|masthead)\b/.test(signal)) return 'navigation';
    if (element.tagName === 'FOOTER' || /\bfooter\b/.test(signal)) return 'footer';
    if (index === 0 || /\b(hero|intro|masthead)\b/.test(signal)) return 'hero';
    if (/\b(case|work|project|portfolio|gallery)\b/.test(signal)) return 'showcase';
    if (/\b(feature|service|benefit|capabilit)\b/.test(signal)) return 'features';
    if (/\b(testimonial|quote|review|proof|client)\b/.test(signal)) return 'proof';
    if (/\b(price|pricing|plan)\b/.test(signal)) return 'pricing';
    if (/\b(faq|question)\b/.test(signal)) return 'faq';
    if (/\b(cta|contact|signup|conversion)\b/.test(signal) || (index === total - 1 && element.querySelector('a,button'))) return 'cta';
    return 'content';
  };
  const rectFor = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: round(rect.left + scrollX), y: round(rect.top + scrollY),
      width: round(rect.width), height: round(rect.height),
    };
  };
  const typographyFor = (element) => {
    const style = getComputedStyle(element);
    return {
      family: clean(style.fontFamily, 160), size: round(parseFloat(style.fontSize)),
      lineHeight: style.lineHeight === 'normal' ? 'normal' : round(parseFloat(style.lineHeight)),
      weight: clean(style.fontWeight, 20), letterSpacing: style.letterSpacing === 'normal' ? 0 : round(parseFloat(style.letterSpacing), 2),
      align: style.textAlign, transform: style.textTransform,
    };
  };
  const mediaRoleFor = (element, sectionRole, style) => {
    if (sectionRole === 'hero') return style.position === 'absolute' || style.objectFit === 'cover' ? 'hero-background' : 'hero-media';
    if (element.tagName === 'VIDEO') return 'video';
    if (element.tagName === 'CANVAS') return 'interactive-canvas';
    if (element.tagName === 'SVG') return 'graphic';
    return 'section-media';
  };

  let candidates = [...document.querySelectorAll('header, main > section, main > article, main > div, body > section, body > footer')];
  candidates = [...new Set(candidates)].filter((element) => visible(element) && element.getBoundingClientRect().height >= 72);
  if (!candidates.length) candidates = [...document.body.children].filter((element) => visible(element) && element.getBoundingClientRect().height >= 72);
  candidates = candidates.slice(0, 40);

  const motionTracks = [];
  const mediaSlots = [];
  const anchors = [];
  const sections = candidates.map((element, index) => {
    const style = getComputedStyle(element);
    const role = roleFor(element, index, candidates.length);
    const heading = [...element.querySelectorAll('h1,h2,h3')].find(visible);
    const body = [...element.querySelectorAll('p,li')].find(visible);
    const media = [...element.querySelectorAll('img,picture,video,canvas,svg')].filter(visible).slice(0, 12);
    const sectionId = element.getAttribute('data-scene-id') || element.id || `section-${index + 1}`;
    const sectionMedia = media.map((item, mediaIndex) => {
      const itemStyle = getComputedStyle(item);
      const rect = rectFor(item);
      const slot = {
        id: `${sectionId}-media-${mediaIndex + 1}`,
        sectionId, kind: item.tagName.toLowerCase(), role: mediaRoleFor(item, role, itemStyle), rect,
        objectFit: itemStyle.objectFit || 'fill', position: itemStyle.position,
        aspectRatio: rect.height ? round(rect.width / rect.height, 3) : null,
        alt: clean(item.getAttribute('alt'), 160),
      };
      mediaSlots.push(slot);
      return slot.id;
    });
    const backgroundImage = style.backgroundImage && style.backgroundImage !== 'none';
    if (backgroundImage) {
      const slot = {
        id: `${sectionId}-background`, sectionId, kind: 'background-image',
        role: role === 'hero' ? 'hero-background' : 'section-background', rect: rectFor(element),
        objectFit: style.backgroundSize || 'auto', position: style.backgroundPosition || '50% 50%', aspectRatio: null, alt: '',
      };
      mediaSlots.push(slot);
      sectionMedia.unshift(slot.id);
    }

    const motionElements = [element, ...element.querySelectorAll('[data-scroll],[data-animate],[data-motion],[data-w-id],video,canvas')].slice(0, 30);
    const sectionMotion = [];
    motionElements.forEach((item, motionIndex) => {
      const itemStyle = getComputedStyle(item);
      const classSignal = clean(item.className, 180).toLowerCase();
      const hasTransition = itemStyle.transitionDuration.split(',').some((duration) => parseFloat(duration) > 0);
      const hasAnimation = itemStyle.animationName !== 'none' && itemStyle.animationDuration.split(',').some((duration) => parseFloat(duration) > 0);
      const isPinned = ['sticky', 'fixed'].includes(itemStyle.position);
      const hasMotionHint = /scroll|parallax|reveal|marquee|ticker|scrub|sticky|pin/.test(classSignal) || [...item.attributes].some((attr) => /^data-(scroll|animate|motion|w-id)/.test(attr.name));
      if (!hasTransition && !hasAnimation && !isPinned && !hasMotionHint && !['VIDEO', 'CANVAS'].includes(item.tagName)) return;
      const driver = isPinned || /scroll|parallax|scrub|sticky|pin/.test(classSignal) ? 'scroll' : hasAnimation ? 'load' : item.tagName === 'VIDEO' ? 'media' : 'pointer-or-state';
      const track = {
        id: `${sectionId}-motion-${motionIndex + 1}`, sectionId, driver,
        target: selectorFor(item, motionIndex), pinned: isPinned,
        animationName: itemStyle.animationName === 'none' ? null : itemStyle.animationName,
        duration: hasAnimation ? itemStyle.animationDuration : hasTransition ? itemStyle.transitionDuration : null,
        properties: hasTransition ? clean(itemStyle.transitionProperty, 160).split(',').map((value) => value.trim()).filter(Boolean) : [],
      };
      motionTracks.push(track);
      sectionMotion.push(track.id);
    });

    [heading, body, ...media.slice(0, 2)].filter(Boolean).forEach((item, anchorIndex) => {
      const rect = rectFor(item);
      anchors.push({
        id: `${sectionId}-anchor-${anchorIndex + 1}`, sectionId,
        kind: /^H[1-6]$/.test(item.tagName) ? 'heading' : ['IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'SVG'].includes(item.tagName) ? 'media' : 'body',
        x: rect.x, y: rect.y, width: rect.width, align: getComputedStyle(item).textAlign || null,
      });
    });

    return {
      id: sectionId, order: index + 1, role, selector: selectorFor(element, index), rect: rectFor(element),
      layout: {
        display: style.display, position: style.position, columns: style.gridTemplateColumns,
        gap: style.gap, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        alignItems: style.alignItems, justifyContent: style.justifyContent,
      },
      text: {
        heading: heading ? { value: clean(heading.textContent), rect: rectFor(heading), typography: typographyFor(heading) } : null,
        body: body ? { value: clean(body.textContent), rect: rectFor(body), typography: typographyFor(body) } : null,
        visibleCharacters: clean(element.innerText || element.textContent, 10000).length,
      },
      mediaSlotIds: sectionMedia, motionTrackIds: sectionMotion,
    };
  });

  const breakpoints = new Set();
  const walkRules = (rules) => {
    [...(rules || [])].forEach((rule) => {
      if (rule.media?.mediaText) breakpoints.add(rule.media.mediaText);
      if (rule.cssRules) walkRules(rule.cssRules);
    });
  };
  [...document.styleSheets].forEach((sheet) => { try { walkRules(sheet.cssRules); } catch {} });

  const pageWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0, innerWidth);
  const pageHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, innerHeight);
  const sectionArea = sections.reduce((sum, section) => sum + section.rect.width * section.rect.height, 0);
  return {
    schemaVersion: 1,
    referenceUrl: input.referenceUrl || location.href,
    capturedAt: input.capturedAt || new Date().toISOString(),
    viewport: { width: innerWidth, height: innerHeight },
    document: { width: pageWidth, height: pageHeight },
    sections, anchors: anchors.slice(0, 80), mediaSlots, motionTracks,
    breakpoints: [...breakpoints].slice(0, 30).sort(),
    metrics: {
      sectionCount: sections.length, mediaCount: mediaSlots.length, motionCount: motionTracks.length,
      coverage: pageWidth * pageHeight ? round(sectionArea / (pageWidth * pageHeight), 3) : 0,
      charactersPerViewport: pageHeight ? round(sections.reduce((sum, section) => sum + section.text.visibleCharacters, 0) / (pageHeight / innerHeight), 1) : 0,
    },
  };
}
