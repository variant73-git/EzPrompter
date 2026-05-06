// Lightweight token extraction from a hand-written or AI-generated design.md.
// We don't try to parse the file as a strict schema — designers write these
// in many shapes. Instead we sweep the raw text for the design primitives
// (colors, fonts, sizes) and return whatever we found, with sensible
// defaults for whatever we didn't.

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/gi;
const FONT_FAMILY_RE = /font[\s-]?family\s*[:=]\s*['"]?([^'"\n,;)]+)/gi;
// Inline-style or token-table mentions like "Inter", "Aeonik", etc.
const QUOTED_FONT_RE = /['"`]([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)['"`]\s*(?:,|—|–|\)|\n)/g;
const SIZE_RE = /(\d{1,3}(?:\.\d+)?)\s*(?:px|rem|pt)\b/gi;

function rgbToHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function dedupe(arr) {
  return Array.from(new Set(arr));
}

function looksLikeFontName(s) {
  const t = s.trim();
  if (t.length < 3 || t.length > 32) return false;
  // Reject obvious non-fonts (URLs, code-ish strings)
  if (/[<>{}\\\/]/.test(t)) return false;
  if (/^(black|white|red|blue|green|gray|grey|none|auto|inherit|sans|serif|mono|monospace)$/i.test(t)) return false;
  return /^[A-Z]/.test(t);
}

export function parseDesignMdTokens(md) {
  if (typeof md !== 'string' || !md) {
    return defaultTokens();
  }

  // Colors — hex first, then rgb()
  const hexes = (md.match(HEX_RE) || []).map((h) => h.length === 4
    // expand #abc → #aabbcc for consistent display
    ? '#' + h.slice(1).split('').map((c) => c + c).join('')
    : h.slice(0, 7).toLowerCase()
  );
  const rgbs = [];
  let m;
  RGB_RE.lastIndex = 0;
  while ((m = RGB_RE.exec(md))) {
    rgbs.push(rgbToHex(+m[1], +m[2], +m[3]));
  }
  let palette = dedupe([...hexes, ...rgbs]);
  // Drop ultra-similar duplicates that come from alpha variants.
  palette = palette.slice(0, 8);

  // Fonts — explicit font-family declarations first, then quoted names.
  const fonts = [];
  FONT_FAMILY_RE.lastIndex = 0;
  while ((m = FONT_FAMILY_RE.exec(md))) {
    const name = (m[1] || '').trim().replace(/[,;]+$/, '');
    if (looksLikeFontName(name)) fonts.push(name);
  }
  if (fonts.length === 0) {
    QUOTED_FONT_RE.lastIndex = 0;
    while ((m = QUOTED_FONT_RE.exec(md))) {
      const name = (m[1] || '').trim();
      if (looksLikeFontName(name)) fonts.push(name);
    }
  }
  const fontsUniq = dedupe(fonts).slice(0, 3);
  const headingFont = fontsUniq[0] || 'Aeonik';
  const bodyFont = fontsUniq[1] || fontsUniq[0] || 'Aeonik';

  // Sizes — collect, sort desc, pick a few representative steps.
  const sizes = [];
  SIZE_RE.lastIndex = 0;
  while ((m = SIZE_RE.exec(md))) {
    const px = parseFloat(m[1]);
    if (px >= 8 && px <= 200) sizes.push(px);
  }
  const sizesUniq = dedupe(sizes).sort((a, b) => b - a);
  // Pick a top heading + body — fallback to a 1.25 modular scale on 16px.
  const h1 = sizesUniq[0] || 64;
  const h2 = sizesUniq.find((s) => s < h1 && s > 22) || Math.round(h1 * 0.55);
  const body = sizesUniq.find((s) => s >= 13 && s <= 18) || 16;

  // Surface vs ink — pick the lightest as bg, darkest as ink (rough heuristic).
  const surface = pickLightest(palette) || '#fafafa';
  const ink = pickDarkest(palette) || '#1f1f1f';
  const accents = palette.filter((c) => c !== surface && c !== ink).slice(0, 4);

  return {
    palette,
    surface,
    ink,
    accents,
    headingFont,
    bodyFont,
    sizes: { h1, h2, body }
  };
}

function pickLightest(arr) {
  if (!arr || arr.length === 0) return null;
  let best = arr[0], bestL = -Infinity;
  for (const c of arr) {
    const L = relLuminance(c);
    if (L > bestL) { best = c; bestL = L; }
  }
  return best;
}

function pickDarkest(arr) {
  if (!arr || arr.length === 0) return null;
  let best = arr[0], bestL = Infinity;
  for (const c of arr) {
    const L = relLuminance(c);
    if (L < bestL) { best = c; bestL = L; }
  }
  return best;
}

function relLuminance(hex) {
  if (typeof hex !== 'string' || hex.length < 7) return 0.5;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function defaultTokens() {
  return {
    palette: ['#ECEAE5', '#1f1f1f', '#7c3aed'],
    surface: '#ECEAE5',
    ink: '#1f1f1f',
    accents: ['#7c3aed'],
    headingFont: 'Aeonik',
    bodyFont: 'Aeonik',
    sizes: { h1: 64, h2: 28, body: 16 }
  };
}
