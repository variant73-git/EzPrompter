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
  if (node.kind === 'site' && node.origin_url) return 'url';
  if (node.kind === 'site') return 'html';
  return 'unknown';
}

// Hex colors (also referenced from globals.css via .cnode.origin-* classes —
// keep in sync if you change one).
export const ORIGIN_COLORS = {
  url:        '#38bdf8',  // sky — matches Add URL pill
  html:       '#f97316',  // orange
  md:         '#34d399',  // emerald
  screenshot: '#a78bfa',  // violet
  prompt:     '#facc15',  // yellow
  skill:      '#f472b6',  // pink
  unknown:    '#94a3b8'   // slate fallback
};

export function originColor(node) {
  return ORIGIN_COLORS[nodeOrigin(node)] || ORIGIN_COLORS.unknown;
}
