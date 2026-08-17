import { defaultTokens, parseDesignMdTokens } from './md-tokens.js';

function firstMeaningfulHeading(md) {
  const headings = String(md || '')
    .split('\n')
    .map((line) => /^#\s+(.+?)\s*$/.exec(line)?.[1]?.trim())
    .filter(Boolean);
  return headings.find((heading) => !/^design\s+system$/i.test(heading)) || headings[0] || 'Untitled system';
}

function uniquePalette(tokens) {
  const values = [tokens.surface, tokens.ink, ...(tokens.accents || []), ...(tokens.palette || [])].filter(Boolean);
  return [...new Set(values.map((value) => String(value).toLowerCase()))].slice(0, 6);
}

function hexLuminance(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return 0.5;
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function swatchInk(color) {
  return hexLuminance(color) > 0.58 ? '#20201e' : '#f1f0eb';
}

/**
 * Aura-style DESIGN.MD panel model (product spec 2026-08-17) — the ONE shape
 * both surfaces render: the site-node inspector panel and the .md node card.
 *
 * - colorRows: [{hex, share|null, role|null}] — share drives the proportional
 *   bar (site nodes carry measured shares from the capture screenshot; md
 *   tokens fall back to equal segments).
 * - typeRoles: [{role, label, family, size, weight, specimenPx}] — specimenPx
 *   is the PROPORTIONAL display size: the largest role renders at the cap
 *   (40px) and the others scale down with it, so a site whose h1 is 96px
 *   never explodes the panel. Metadata ("64px / w500") renders in the
 *   neutral UI font, never in the specimen font.
 */
const SPECIMEN_CAP = 40;
const SPECIMEN_FLOOR = 12;
// Measured palettes: merge perceptually-similar buckets (the coarse sampler
// splits one surface into near-identical greys) and keep the 5 most
// predominant — a legend of lookalike hexes reads as noise, not a system.
const SIMILAR_DIST = 36; // RGB euclidean, of ~441 max
const MAX_MEASURED_COLORS = 5;

function hexRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function mergeSimilarSwatches(rows) {
  const merged = [];
  for (const row of rows) {
    const rgb = hexRgb(row.hex);
    const near = rgb && merged.find((m) => {
      const mrgb = hexRgb(m.hex);
      if (!mrgb) return false;
      return Math.hypot(rgb[0] - mrgb[0], rgb[1] - mrgb[1], rgb[2] - mrgb[2]) < SIMILAR_DIST;
    });
    if (near) near.share = (near.share || 0) + (row.share || 0);
    else merged.push({ ...row });
  }
  return merged
    .sort((a, b) => (b.share || 0) - (a.share || 0))
    .slice(0, MAX_MEASURED_COLORS);
}

export function designPanelModel({ md = '', name = '', swatches = null, typeSample = null } = {}) {
  const base = designMdPreviewModel(md, name);
  const measured = Array.isArray(swatches) && swatches.length
    ? mergeSimilarSwatches(swatches.map((s) => ({ hex: String(s.hex || '').toUpperCase(), share: Number(s.share) || 0, role: null })))
    : null;
  const tokenRoles = [
    base.surface ? { hex: String(base.surface).toUpperCase(), share: null, role: 'Surface' } : null,
    base.ink ? { hex: String(base.ink).toUpperCase(), share: null, role: 'Ink' } : null,
    ...((base.accents || []).map((hex, i) => ({ hex: String(hex).toUpperCase(), share: null, role: i === 0 ? 'Accent' : null }))),
  ].filter(Boolean);
  const fromTokens = base.palette.map((hex) => {
    const upper = String(hex).toUpperCase();
    return { hex: upper, share: null, role: tokenRoles.find((r) => r.hex === upper)?.role || null };
  });
  const colorRows = measured || fromTokens;

  // Typography source: design.md tokens when the node has an md; otherwise a
  // typeSample MEASURED from the live page at capture (computed styles —
  // deterministic, no LLM), so cloned SITE nodes show their real type too.
  let roleSpecs;
  if (md) {
    roleSpecs = base.scale.map((item) => ({
      role: item.role,
      label: item.role === 'H1' ? 'Display Lg' : item.role === 'H2' ? 'Display Md' : 'Body Md',
      family: item.role === 'Body' ? base.bodyFont : base.headingFont,
      size: item.size,
      weight: item.weight,
    }));
  } else if (typeSample && (typeSample.display || typeSample.body)) {
    roleSpecs = [
      typeSample.display ? { role: 'Display', label: 'Display Lg', ...typeSample.display } : null,
      typeSample.body ? { role: 'Body', label: 'Body Md', ...typeSample.body } : null,
    ].filter((spec) => spec && spec.family && spec.size > 0);
  } else {
    roleSpecs = [];
  }
  const maxSize = Math.max(...roleSpecs.map((item) => item.size), 1);
  const typeRoles = roleSpecs.map((item) => ({
    ...item,
    specimenPx: Math.max(SPECIMEN_FLOOR, Math.round(SPECIMEN_CAP * (item.size / maxSize))),
  }));

  return { ...base, colorRows, typeRoles, hasTypography: typeRoles.length > 0 };
}

export function designMdPreviewModel(md, fallbackName = '') {
  const tokens = md ? parseDesignMdTokens(md) : defaultTokens();
  const title = firstMeaningfulHeading(md);
  const fileLabel = String(fallbackName || '').trim();
  const h1 = Math.round(tokens.sizes.h1);
  const h2 = Math.round(tokens.sizes.h2);
  const body = Math.round(tokens.sizes.body);
  return {
    ...tokens,
    title: title === 'Design System' && fileLabel ? fileLabel : title,
    fileLabel,
    palette: uniquePalette(tokens),
    sampleSize: Math.min(132, Math.max(72, h1)),
    scale: [
      { role: 'H1', size: h1, weight: 600, lineHeight: 1.05 },
      { role: 'H2', size: h2, weight: 550, lineHeight: 1.15 },
      { role: 'Body', size: body, weight: 400, lineHeight: 1.5 },
    ],
  };
}
