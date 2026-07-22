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
