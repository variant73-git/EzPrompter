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
