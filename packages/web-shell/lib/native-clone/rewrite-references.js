import { posix } from 'node:path';

/**
 * Reference rewriting for the native clone — by URL POSITION, not by blind
 * text substitution.
 *
 * The old rewriter replaced every occurrence of a captured absolute URL with
 * `split/join`. That closed exactly one of the shapes a site uses. A page that
 * writes `<img src="/hero.png">` or `<link href="/site.css">` — the ordinary
 * way to reference a file on your own domain — was never rewritten at all, and
 * the runtime gateway only translates paths whose first segment is a bundle
 * DIRECTORY, so anything served from the domain root escaped the token path
 * and 404'd. Measured end to end: a fixture site lost its stylesheet and three
 * images (2026-08-21).
 *
 * Blind substitution also cannot be extended safely: successive passes can
 * match inside their own output, `/foo` matches inside `/foobar`, and a
 * string like `const route = "/index.html"` is not a reference at all.
 *
 * So: find the places a URL can legitimately appear for the content type,
 * resolve each against the RIGHT base (the document for HTML, the stylesheet's
 * own URL for CSS), and rewrite only when the resolved URL is exactly one of
 * the responses we captured. One pass, applied back to front by offset, so no
 * replacement can be re-matched.
 *
 * Known limits, deliberate: URLs a script builds at runtime (`'/' + name`,
 * `fetch('/api')`) are invisible to any static rewriter — closing those needs
 * a per-bundle virtual origin, which is a bigger design. Script bodies are
 * skipped entirely rather than guessed at.
 */

const HTML_URL_ATTRS = 'src|href|poster|data-src|data-original|data-bg|data-image';

function splitFragment(value) {
  const hash = value.indexOf('#');
  return hash === -1 ? [value, ''] : [value.slice(0, hash), value.slice(hash)];
}

/** Candidate URLs inside one srcset/imagesrcset value, with their offsets. */
function srcsetTokens(value, base) {
  const tokens = [];
  const re = /(^|,)\s*([^\s,]+)/g;
  let m;
  while ((m = re.exec(value))) {
    const raw = m[2].replace(/,+$/, '');
    if (!raw) continue;
    tokens.push({ start: base + m.index + m[0].length - m[2].length, end: base + m.index + m[0].length - m[2].length + raw.length, raw });
  }
  return tokens;
}

/** Regions a rewriter must not touch: script bodies are code, not markup. */
function scriptRanges(html) {
  const ranges = [];
  const re = /<script\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const bodyStart = m.index + m[0].length;
    const close = html.slice(bodyStart).search(/<\/script\s*>/i);
    const bodyEnd = close === -1 ? html.length : bodyStart + close;
    ranges.push([bodyStart, bodyEnd]);
    re.lastIndex = bodyEnd;
  }
  return ranges;
}

function inRanges(offset, ranges) {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

/** Every url(...) / @import "..." occurrence in a CSS text, with offsets. */
function cssTokens(css, offset = 0) {
  const tokens = [];
  const urlRe = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g;
  let m;
  while ((m = urlRe.exec(css))) {
    const rawStart = m.index + m[0].indexOf(m[2], 4);
    if (m[2]) tokens.push({ start: offset + rawStart, end: offset + rawStart + m[2].length, raw: m[2] });
  }
  const importRe = /@import\s+(['"])([^'"]+)\1/g;
  while ((m = importRe.exec(css))) {
    const rawStart = m.index + m[0].indexOf(m[2]);
    tokens.push({ start: offset + rawStart, end: offset + rawStart + m[2].length, raw: m[2] });
  }
  return tokens;
}

function htmlTokens(html) {
  const skip = scriptRanges(html);
  const tokens = [];
  const attrRe = new RegExp(`\\s(?:${HTML_URL_ATTRS})\\s*=\\s*(["'])([^"']*)\\1`, 'gi');
  let m;
  while ((m = attrRe.exec(html))) {
    if (inRanges(m.index, skip) || !m[2]) continue;
    const rawStart = m.index + m[0].length - 1 - m[2].length;
    tokens.push({ start: rawStart, end: rawStart + m[2].length, raw: m[2] });
  }
  const setRe = /\s(?:srcset|imagesrcset|data-srcset)\s*=\s*(["'])([^"']*)\1/gi;
  while ((m = setRe.exec(html))) {
    if (inRanges(m.index, skip) || !m[2]) continue;
    tokens.push(...srcsetTokens(m[2], m.index + m[0].length - 1 - m[2].length));
  }
  // Inline style attributes and <style> blocks carry url() too.
  const styleAttrRe = /\sstyle\s*=\s*(["'])([^"']*)\1/gi;
  while ((m = styleAttrRe.exec(html))) {
    if (inRanges(m.index, skip) || !m[2].includes('url(')) continue;
    tokens.push(...cssTokens(m[2], m.index + m[0].length - 1 - m[2].length));
  }
  const styleTagRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  while ((m = styleTagRe.exec(html))) {
    tokens.push(...cssTokens(m[1], m.index + m[0].indexOf(m[1])));
  }
  return tokens;
}

function tokensFor(text, kind) {
  if (kind === 'html') return htmlTokens(text);
  if (kind === 'css') return cssTokens(text);
  if (kind === 'svg') {
    const tokens = [];
    const re = /\s(?:href|xlink:href)\s*=\s*(["'])([^"']*)\1/gi;
    let m;
    while ((m = re.exec(text))) {
      if (!m[2] || m[2].startsWith('#')) continue;
      const rawStart = m.index + m[0].length - 1 - m[2].length;
      tokens.push({ start: rawStart, end: rawStart + m[2].length, raw: m[2] });
    }
    return [...tokens, ...cssTokens(text)];
  }
  return [];
}

/**
 * @param {object} input
 * @param {string} input.text        the captured body, already decoded
 * @param {'html'|'css'|'svg'} input.kind
 * @param {string} input.resourceUrl absolute URL this body was served from —
 *   the base for its own relative references (a stylesheet resolves against
 *   ITSELF, not against the page)
 * @param {string} input.assetPath   this body's path inside the bundle
 * @param {Map<string,string>} input.map captured absolute URL → bundle path
 * @returns {string}
 */
export function rewriteDocumentReferences({ text, kind, resourceUrl, assetPath, map }) {
  const tokens = tokensFor(text, kind);
  if (!tokens.length) return text;
  const fromDir = posix.dirname(assetPath);
  const edits = [];
  for (const token of tokens) {
    const [withoutHash, hash] = splitFragment(token.raw);
    if (!withoutHash || withoutHash.startsWith('data:') || withoutHash.startsWith('#')) continue;
    let absolute;
    try { absolute = new URL(withoutHash, resourceUrl).href; } catch { continue; }
    const target = map.get(absolute);
    if (!target) continue;
    let relative = posix.relative(fromDir === '.' ? '' : fromDir, target);
    if (!relative.startsWith('.')) relative = `./${relative}`;
    edits.push({ start: token.start, end: token.end, value: `${relative}${hash}` });
  }
  if (!edits.length) return text;
  // Back to front: an earlier replacement can never be re-scanned or shift
  // the offsets of the ones still to apply.
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.value + out.slice(edit.end);
  return out;
}

export function referenceKindFor(path, contentType = '') {
  if (/\.html?$/i.test(path) || /^text\/html/i.test(contentType)) return 'html';
  if (/\.css$/i.test(path) || /^text\/css/i.test(contentType)) return 'css';
  if (/\.svg$/i.test(path) || /^image\/svg/i.test(contentType)) return 'svg';
  return null;
}
