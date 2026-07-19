/*
 * Framer export (Phase 5): emit React + Framer Motion code from motion clips,
 * with a TRANSLATION REPORT for everything that could not map. Decisions §3.4-6:
 * the IR core maps cleanly; the rest degrades WITH a report, never silently.
 * Export is an internal tool — a human finishes the last mile in Framer.
 */

// Deterministic easing translation. Unknown eases fall back with a report entry.
const EASING_MAP = {
  linear: "'linear'",
  none: "'linear'",
  ease: '[0.25, 0.1, 0.25, 1]',
  'ease-in': "'easeIn'",
  'ease-out': "'easeOut'",
  'ease-in-out': "'easeInOut'",
  'power1.in': "'easeIn'",
  'power1.out': "'easeOut'",
  'power1.inOut': "'easeInOut'",
  'power2.in': "'easeIn'",
  'power2.out': "'easeOut'",
  'power2.inOut': "'easeInOut'",
};

// GSAP/CSS property → framer-motion animatable prop. Unlisted properties pass
// through as-is (framer animates arbitrary CSS); listed exceptions degrade.
const PROPERTY_MAP = {
  rotation: 'rotate',
};

// Percent-based GSAP props keep their unit: Framer x: 50 means 50px — the
// faithful translation of xPercent: 50 is x: '50%'.
const PERCENT_PROPS = { xPercent: 'x', yPercent: 'y' };

const UNMAPPABLE_PROPERTIES = new Set(['transform']);

function fmtValue(value) {
  if (typeof value !== 'string') return String(value);
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
  return `'${escaped}'`;
}

function fmtArray(values) {
  return `[${values.map(fmtValue).join(', ')}]`;
}

function safeIdentifier(name, fallback) {
  const cleaned = String(name).replace(/[^a-zA-Z0-9_$]/g, '');
  return /^[a-zA-Z_$]/.test(cleaned) ? cleaned : fallback;
}

function propertyKey(property) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(property) ? property : `'${property.replace(/'/g, "\\'")}'`;
}

function componentName(label) {
  const name = String(label || 'Exported')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('')
    .replace(/^[0-9]+/, '');
  return `${name || 'Exported'}Motion`;
}

function numeric(value) {
  const trimmed = String(value).trim();
  const parsed = parseFloat(trimmed);
  // Pure numbers only: '50%' or '2rem' must survive as strings — parseFloat
  // would silently strip the unit and change the meaning.
  return Number.isFinite(parsed) && String(parsed) === trimmed ? parsed : null;
}

function orderedKeyframes(track) {
  return [...(track.keyframes || [])].sort((first, second) => Number(first.offset) - Number(second.offset));
}

function resolveEasing(easing, report) {
  if (!easing) return null;
  const bezier = String(easing).match(/cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/i);
  if (bezier) return `[${bezier.slice(1, 5).map(Number).join(', ')}]`;
  if (EASING_MAP[easing]) return EASING_MAP[easing];
  report.push({ feature: 'easing', detail: `"${easing}" has no Framer equivalent`, action: 'degraded' });
  return "'easeOut'";
}

function mapTracks(clip, report) {
  const mapped = [];
  (clip.tracks || []).forEach((track) => {
    if (UNMAPPABLE_PROPERTIES.has(track.property)) {
      report.push({ feature: 'property', detail: `${track.property} (raw matrix) cannot be decomposed reliably`, action: 'degraded' });
      return;
    }
    const percentTarget = PERCENT_PROPS[track.property] || null;
    const property = percentTarget || PROPERTY_MAP[track.property] || track.property;
    const frames = orderedKeyframes(track);
    if (!frames.length) return;
    const values = frames.map((frame) => {
      if (percentTarget) return `${numeric(frame.value) ?? String(frame.value)}%`;
      return numeric(frame.value) ?? String(frame.value);
    });
    const times = frames.map((frame) => Number(frame.offset) || 0);
    mapped.push({ property, values, times, sourceProperty: track.property });
    report.push({ feature: 'track', detail: `${track.property} → ${property} (${frames.length} keyframes)`, action: 'mapped' });
  });
  return mapped;
}

function scrollRange(clip, report) {
  const start = numeric(clip.scroll?.start);
  const end = numeric(clip.scroll?.end);
  if (start == null || end == null) {
    report.push({
      feature: 'scroll range',
      detail: `start/end "${clip.scroll?.start}"/"${clip.scroll?.end}" are not resolved pixels — re-export with the runtime connected`,
      action: 'degraded',
    });
    return { start: 0, end: 1000 };
  }
  return { start, end };
}

function reportUnsupportedScrollFeatures(clip, report) {
  if (clip.scroll?.pin) {
    report.push({ feature: 'pin', detail: 'ScrollTrigger pin has no direct Framer equivalent — recreate with position: sticky in Framer', action: 'skipped' });
  }
  if (clip.scroll?.snap) {
    report.push({ feature: 'snap', detail: 'Scroll snap must be re-authored in Framer', action: 'skipped' });
  }
  if (Number(clip.timing?.iterations) > 1 || clip.timing?.iterations === Infinity) {
    report.push({ feature: 'repeat', detail: 'Repeat carried onto transition.repeat — verify feel in Framer', action: 'mapped' });
  }
}

function timeClipCode(clip, tracks, report) {
  const initial = tracks.map((track) => `${propertyKey(track.property)}: ${fmtValue(track.values[0])}`);
  const multi = tracks.some((track) => track.values.length > 2);
  const animate = tracks.map((track) => (track.values.length > 2
    ? `${propertyKey(track.property)}: ${fmtArray(track.values)}`
    : `${propertyKey(track.property)}: ${fmtValue(track.values[track.values.length - 1])}`));
  const transition = [
    `duration: ${(Number(clip.timing?.duration) || 0) / 1000}`,
    `delay: ${(Number(clip.timing?.delay) || 0) / 1000}`,
  ];
  const ease = resolveEasing(clip.timing?.easing, report);
  if (ease) transition.push(`ease: ${ease}`);
  if (clip.timing?.iterations === Infinity) transition.push('repeat: Infinity');
  else if (Number(clip.timing?.iterations) > 1) transition.push(`repeat: ${Number(clip.timing.iterations) - 1}`);
  if (clip.timing?.yoyo || clip.timing?.direction === 'alternate') transition.push("repeatType: 'reverse'");
  if (multi) {
    const multiTracks = tracks.filter((track) => track.values.length > 2);
    const times = multiTracks[0]?.times || [];
    if (multiTracks.some((track) => JSON.stringify(track.times) !== JSON.stringify(times))) {
      report.push({ feature: 'times', detail: 'Tracks have different keyframe offsets but Framer shares one times array — align offsets or split the element in Framer', action: 'degraded' });
    }
    transition.push(`times: ${fmtArray(times)}`);
  }
  return { initial, animate, transition };
}

export function buildFramerExport({ label, tag = 'div', clips = [] }) {
  const report = [];
  const name = componentName(label);
  const safeTag = /^[a-z][a-z0-9]*$/.test(String(tag)) ? tag : 'div';
  const scrollClips = [];
  const mediaClips = [];
  const timeClips = [];

  clips.forEach((clip) => {
    const tracks = mapTracks(clip, report);
    // Unsupported features are reported even when no track maps — the report
    // is the deliverable for everything the human must finish by hand.
    reportUnsupportedScrollFeatures(clip, report);
    if (!tracks.length) return;
    if (clip.driver?.type === 'media') mediaClips.push({ clip, tracks });
    else if (clip.driver?.type === 'scroll') {
      scrollClips.push({ clip, tracks });
      report.push({ feature: 'scroll scrub', detail: `${clip.name}: mapped to useScroll + useTransform`, action: 'mapped' });
    } else timeClips.push({ clip, tracks });
  });

  const needsScroll = scrollClips.length > 0 || mediaClips.length > 0;
  const imports = ['motion'];
  if (needsScroll) imports.push('useScroll', 'useTransform');
  if (mediaClips.length) imports.push('useMotionValueEvent');

  const lines = [];
  const styleBindings = [];

  if (needsScroll) lines.push('  const { scrollY } = useScroll();');
  const boundProperties = new Set();
  scrollClips.forEach(({ clip, tracks }, clipIndex) => {
    const range = scrollRange(clip, report);
    tracks.forEach((track) => {
      // sourceProperty is unique within a clip — mapped names may collide
      // (x + xPercent both target x) and a duplicate const is a SyntaxError.
      const variable = `${safeIdentifier(track.sourceProperty, `track${clipIndex}`)}Value${clipIndex || ''}`;
      if (track.values.length > 2) {
        report.push({ feature: 'keyframes', detail: `${track.sourceProperty}: intermediate keyframes dropped in scroll mapping — useTransform carries start/end only`, action: 'degraded' });
      }
      lines.push(`  const ${variable} = useTransform(scrollY, [${range.start}, ${range.end}], ${fmtArray([track.values[0], track.values[track.values.length - 1]])});`);
      if (boundProperties.has(track.property)) {
        report.push({ feature: 'property collision', detail: `${track.sourceProperty} also maps to ${track.property} — merge the two useTransform values by hand (kept the first binding)`, action: 'degraded' });
        return;
      }
      boundProperties.add(track.property);
      styleBindings.push(`${propertyKey(track.property)}: ${variable}`);
    });
  });
  mediaClips.forEach(({ clip, tracks }, clipIndex) => {
    const range = scrollRange(clip, report);
    const timeTrack = tracks.find((item) => item.sourceProperty === 'currentTime') || tracks[0];
    lines.push(`  const mediaTime${clipIndex || ''} = useTransform(scrollY, [${range.start}, ${range.end}], ${fmtArray([timeTrack.values[0], timeTrack.values[timeTrack.values.length - 1]])});`);
    lines.push(`  useMotionValueEvent(mediaTime${clipIndex || ''}, 'change', (value) => {`);
    lines.push('    if (mediaRef.current) mediaRef.current.currentTime = value;');
    lines.push('  });');
    // Sibling tracks on the same media clip (opacity fades etc.) ride the same
    // scroll range as regular style bindings — dropping them would lie.
    tracks.filter((item) => item !== timeTrack).forEach((track) => {
      const variable = `${safeIdentifier(track.sourceProperty, `media${clipIndex}`)}MediaValue${clipIndex || ''}`;
      lines.push(`  const ${variable} = useTransform(scrollY, [${range.start}, ${range.end}], ${fmtArray([track.values[0], track.values[track.values.length - 1]])});`);
      if (!boundProperties.has(track.property)) {
        boundProperties.add(track.property);
        styleBindings.push(`${propertyKey(track.property)}: ${variable}`);
      }
    });
    report.push({ feature: 'media', detail: `${clip.name}: scroll-scrubbed currentTime bound through useMotionValueEvent`, action: 'mapped' });
  });

  const timeProps = [];
  if (timeClips.length) {
    // Merge every time clip's tracks into ONE motion element (matching how they
    // coexist on the source element).
    const initial = [];
    const animate = [];
    let transition = [];
    const seenTimeProps = new Set();
    timeClips.forEach(({ clip, tracks }) => {
      const uniqueTracks = tracks.filter((track) => {
        if (seenTimeProps.has(track.property)) {
          report.push({ feature: 'property collision', detail: `${track.sourceProperty} is animated by more than one clip — kept the first, re-author the second in Framer`, action: 'degraded' });
          return false;
        }
        seenTimeProps.add(track.property);
        return true;
      });
      if (!uniqueTracks.length) return;
      if (Number(clip.timing?.repeatDelay) > 0) {
        report.push({ feature: 'repeatDelay', detail: 'Framer has no repeatDelay — add a keyframe hold by hand', action: 'skipped' });
      }
      if (clip.timing?.direction === 'reverse') {
        report.push({ feature: 'direction', detail: 'Reverse playback must be re-authored (swap from/to) in Framer', action: 'degraded' });
      }
      const built = timeClipCode(clip, uniqueTracks, report);
      initial.push(...built.initial);
      animate.push(...built.animate);
      transition = built.transition; // last clip wins for shared transition — reported below
    });
    if (timeClips.length > 1) {
      report.push({ feature: 'timing', detail: 'Multiple time-driven clips share one transition — split manually in Framer if they need distinct timing', action: 'degraded' });
    }
    timeProps.push(`initial={{ ${initial.join(', ')} }}`);
    timeProps.push(`animate={{ ${animate.join(', ')} }}`);
    timeProps.push(`transition={{ ${transition.join(', ')} }}`);
  }

  const styleProp = styleBindings.length ? [`style={{ ${styleBindings.join(', ')} }}`] : [];
  const refProp = mediaClips.length ? ['ref={mediaRef}'] : [];
  const elementProps = [...refProp, ...timeProps, ...styleProp].map((prop) => `      ${prop}`).join('\n');

  const reportBlock = [
    '/*',
    ' * TRANSLATION REPORT — what mapped, what degraded, what you must finish by hand.',
    ...report.map((item) => ` * [${item.action.toUpperCase()}] ${item.feature}: ${item.detail}`.replace(/\*\//g, '*\\/')),
    ' */',
  ].join('\n');

  const code = [
    reportBlock,
    `import { ${imports.join(', ')} } from 'framer-motion';`,
    ...(mediaClips.length ? ["import { useRef } from 'react';"] : []),
    '',
    `export default function ${name}() {`,
    ...(mediaClips.length ? ['  const mediaRef = useRef(null);'] : []),
    ...lines,
    '  return (',
    `    <motion.${safeTag}`,
    elementProps,
    '    >',
    `      {/* content of "${String(label || '').replace(/\*\//g, '')}" goes here */}`,
    `    </motion.${safeTag}>`,
    '  );',
    '}',
    '',
  ].join('\n');

  return { code, report };
}
