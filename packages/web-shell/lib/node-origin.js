// Classify a canvas node by where its content came from. Drives the
// color-coded border on the node frame and the color of edges that
// originate from it. URL and HTML uploads both produce kind='site' on
// the server, so we disambiguate via origin_url (URL flow sets it,
// HTML upload doesn't).

export function nodeOrigin(node) {
  if (!node) return 'unknown';
  if (node.kind === 'designmd') return 'md';
  if (node.kind === 'image' || node.kind === 'asset') return 'screenshot';
  if (node.kind === 'prompt') return 'prompt';
  if (node.kind === 'skill') return 'skill';
  // Blank site = composition target (designer assembles content from
  // incoming connections via brainstorm + asset library). Distinct
  // identity from a captured URL or an HTML upload — distinct border
  // colour signals "this is where you compose, not where you imported."
  if (node.kind === 'site' && node.meta?.source === 'blank') return 'blank';
  // A site CLONED from an image is a generated "site", not an imported .html
  // file — it reads BLUE like a URL/blank site, never orange. (extract 'clone'.)
  if (node.kind === 'site' && node.meta?.extractTo === 'clone') return 'url';
  if (node.kind === 'site' && node.origin_url) return 'url';
  if (node.kind === 'site') return 'html';
  return 'unknown';
}

// Hex colors (also referenced from globals.css via .cnode.origin-* classes —
// keep in sync if you change one).
export const ORIGIN_COLORS = {
  url:        '#2966EA',  // blue — "site"
  html:       '#f97316',  // orange — .html (unchanged)
  md:         '#EEA665',  // warm ochre — design.md
  screenshot: '#7951C2',  // violet — image
  prompt:     '#ECEBF1',  // near-white grey — prompt
  skill:      '#f472b6',  // pink
  blank:      '#2966EA',  // blue — merged with URL (same colour code)
  unknown:    '#94a3b8'   // slate fallback
};

export function originColor(node) {
  return ORIGIN_COLORS[nodeOrigin(node)] || ORIGIN_COLORS.unknown;
}

/**
 * Ink for a category-coloured FILL (inverted pills, 2026-08-17): dark by
 * default, light only when real WCAG contrast of dark-on-fill falls short.
 * Proper sRGB linearisation — the cheap luminance heuristic passed dark text
 * on #2966EA (3.25:1) and #7951C2 (2.93:1), both AA failures (Sol).
 */
function channelLin(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function relLuminance(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channelLin(r) + 0.7152 * channelLin(g) + 0.0722 * channelLin(b);
}
const DARK_INK = '#20201E';
const LIGHT_INK = '#F1F0EB';
export function pillInk(fillHex) {
  const fill = relLuminance(fillHex);
  const dark = relLuminance(DARK_INK);
  const contrastDark = (Math.max(fill, dark) + 0.05) / (Math.min(fill, dark) + 0.05);
  return contrastDark >= 4.5 ? DARK_INK : LIGHT_INK;
}
