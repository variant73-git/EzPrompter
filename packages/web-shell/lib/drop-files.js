// Shared classification for files entering the canvas — the "+" picker
// queue, Cmd+V paste, and OS drag-and-drop all funnel through this so a
// node kind can never ingest the wrong format. Pure module (no DOM) so
// the mapping and the reject feedback stay unit-testable.

// Map a file to the node kind it becomes on the canvas, or null when the
// format has no node representation.
export function classifyDropFile(file) {
  const name = (file?.name || '').toLowerCase();
  const type = file?.type || '';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/.test(name)) return 'image';
  if (/\.(md|markdown)$/.test(name) || type === 'text/markdown') return 'md';
  if (/\.html?$/.test(name) || type === 'text/html') return 'html';
  return null;
}

// Human message for the unsupported-drop error modal: names every rejected
// file and says what IS accepted, so the user knows exactly what to fix.
export function formatDropRejectMessage(names) {
  const list = (names || []).map((n) => `"${n || 'untitled'}"`).join(', ');
  const verb = names?.length > 1 ? "aren't supported formats" : "isn't a supported format";
  return `${list} ${verb}. Drop images (PNG, JPG, GIF, WebP, AVIF, SVG, BMP), .md, or .html files.`;
}
