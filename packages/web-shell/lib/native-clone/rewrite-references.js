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
 * Known limits, deliberate (Sol audit 2026-08-21) — each one costs a real
 * tokenizer or a bigger design, and none showed up in the sites measured:
 *  - Script-originated references are NOT processed by this scanner. Two
 *    different things live there, and only one is truly out of reach: a URL
 *    written as a literal (`new Image().src = 'rel.png'`, ESM
 *    `import "/chunk.js"`, `<script type="importmap">`) is findable — a
 *    JavaScript-aware rewriter would see it; skipping those is a deliberate
 *    limit of THIS scanner, not an impossibility. A URL actually COMPUTED at
 *    runtime (`'/' + name`, a template with a variable) is the one that no
 *    static pass can close; that is what would need a per-bundle virtual
 *    origin.
 *  - Attribute values are matched with quotes; unquoted attributes are left
 *    alone (writing one back could break the tag).
 *  - CSS escapes (`url(foo\)bar.png)`) and entity-encoded whitespace inside
 *    srcset (`&#32;`) need real tokenizers to read; both are rare in built
 *    output, and a miss leaves the original reference untouched — it points
 *    outward and the gateway CSP blocks it, but it never MOVES.
 */

const HTML_URL_ATTRS = 'src|href|poster|data-src|data-original|data-bg|data-image';

/**
 * HTML attribute values carry ENTITIES: a Next.js image reference is written
 * `_next/image?url=…&amp;w=3840`, while the captured response URL has a plain
 * `&`. Comparing the raw text against the map therefore never matched, and
 * every optimised image on such a site stayed unreachable (measured on a real
 * Next site, 2026-08-21). Decode before resolving; re-encode when writing back
 * into markup, so the document stays valid.
 */
function decodeEntities(value) {
  return value
    .replace(/&(?:amp|AMP);/g, '&')
    .replace(/&(?:#38|#x26);/g, '&')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&(?:lt|#60);/g, '<')
    .replace(/&(?:gt|#62);/g, '>');
}

function encodeForMarkup(value) {
  return value.replace(/&/g, '&amp;');
}

function splitFragment(value) {
  const hash = value.indexOf('#');
  return hash === -1 ? [value, ''] : [value.slice(0, hash), value.slice(hash)];
}

/** Candidate URLs inside one srcset/imagesrcset value, with their offsets. */
function srcsetTokens(value, base) {
  // Offsets matter here, so the scan walks the string once. A token runs to
  // whitespace; a trailing comma means "no descriptor, next candidate now"
  // (the same spec rule the capture side follows). Commas inside data: URLs
  // are never at the end of a token, so they stay intact.
  const tokens = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[,\s]/.test(value[i])) i += 1;
    if (i >= value.length) break;
    const start = i;
    while (i < value.length && !/\s/.test(value[i])) i += 1;
    const token = value.slice(start, i);
    const raw = token.replace(/,+$/, '');
    if (raw) tokens.push({ start: base + start, end: base + start + raw.length, raw });
    if (token.endsWith(',')) continue;
    while (i < value.length && value[i] !== ',') i += 1;
  }
  return tokens;
}

/** Comment spans. Markup inside them is inert — and a comment that merely
 * MENTIONS `<script>` used to make the script scan swallow the rest of the
 * document, leaving every real reference after it unrewritten (Sol). */
function commentRanges(html) {
  const ranges = [];
  const re = /<!--/g;
  let m;
  while ((m = re.exec(html))) {
    const close = html.indexOf('-->', m.index + 4);
    const end = close === -1 ? html.length : close + 3;
    ranges.push([m.index, end]);
    re.lastIndex = end;
  }
  return ranges;
}

/** Regions a rewriter must not touch: script bodies are code, not markup. */
function scriptRanges(html, comments) {
  const ranges = [];
  const re = /<script\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (inRanges(m.index, comments)) continue;   // a mentioned tag is not a tag
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
  const comments = commentRanges(html);
  // Both directions matter: never read a reference out of a comment, and never
  // let a commented-out tag hide the real ones after it.
  const skip = [...scriptRanges(html, comments), ...comments];
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
  // A document's references resolve against its <base href>, not against the
  // file's own URL — resolving with the wrong base means the lookup misses and
  // the reference is left pointing at the live site. The tag itself is dropped
  // from the bundle: it names the ORIGINAL origin, so keeping it would send
  // every relative path we just wrote back out to the internet (Sol).
  //
  // SCOPE OF THE GUARANTEE (Sol, final round): dropping the tag preserves the
  // meaning of every reference THIS SCANNER SEES — leftovers are pinned to the
  // absolute URL they had. References inside script bodies are not processed
  // here, so a URL a script resolves against the document (`new Image().src =
  // 'rel.png'`) shifts from the original base to the bundle's own directory.
  // Keeping the tag is not the fix — it would repoint every path just
  // rewritten back to the original site — and emitting bundle-absolute paths
  // is impossible in the producer (the serving path carries a token minted
  // much later). Closing it properly means teaching the scanner to read
  // JavaScript.
  let effectiveBase = resourceUrl;
  let baseWasRemoved = false;
  let body = text;
  if (kind === 'html') {
    const baseTag = /<base\b[^>]*\bhref\s*=\s*(["'])([^"']*)\1[^>]*>/i.exec(
      text.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length)),
    );
    if (baseTag && baseTag[2]) {
      try { effectiveBase = new URL(decodeEntities(baseTag[2]), resourceUrl).href; } catch { /* keep own URL */ }
      body = `${text.slice(0, baseTag.index)}${' '.repeat(baseTag[0].length)}${text.slice(baseTag.index + baseTag[0].length)}`;
      baseWasRemoved = true;
    }
  }
  const tokens = tokensFor(body, kind);
  if (!tokens.length) return body;
  const fromDir = posix.dirname(assetPath);
  const edits = [];
  const markup = kind === 'html' || kind === 'svg';
  const resolveBase = effectiveBase;
  for (const token of tokens) {
    const decoded = markup ? decodeEntities(token.raw) : token.raw;
    const [withoutHash, hash] = splitFragment(decoded);
    if (!withoutHash || withoutHash.startsWith('data:') || withoutHash.startsWith('#')) continue;
    let absolute;
    try { absolute = new URL(withoutHash, resolveBase).href; } catch { continue; }
    const target = map.get(absolute);
    if (!target) {
      // Dropping <base> changes what an UNREWRITTEN relative reference means:
      // it would start resolving against the bundle directory instead of the
      // original base. Pin those to the absolute URL they had, so removing the
      // tag cannot silently repoint anything (Sol). They stay external — the
      // gateway CSP blocks them either way — but they no longer LIE.
      // Anything WITHOUT an explicit scheme takes it from the base — including
      // protocol-relative `//host/x`, which would flip http→https once the
      // bundle is served over TLS (Sol). Only a reference that already carries
      // its own scheme is immune.
      if (baseWasRemoved && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(withoutHash)) {
        const pinned = `${absolute}${hash}`;
        edits.push({ start: token.start, end: token.end, value: markup ? encodeForMarkup(pinned) : pinned });
      }
      continue;
    }
    let relative = posix.relative(fromDir === '.' ? '' : fromDir, target);
    if (!relative.startsWith('.')) relative = `./${relative}`;
    const replacement = `${relative}${hash}`;
    edits.push({ start: token.start, end: token.end, value: markup ? encodeForMarkup(replacement) : replacement });
  }
  if (!edits.length) return body;
  // Back to front: an earlier replacement can never be re-scanned or shift
  // the offsets of the ones still to apply.
  edits.sort((a, b) => b.start - a.start);
  let out = body;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.value + out.slice(edit.end);
  return out;
}

export function referenceKindFor(path, contentType = '') {
  if (/\.html?$/i.test(path) || /^text\/html/i.test(contentType)) return 'html';
  if (/\.css$/i.test(path) || /^text\/css/i.test(contentType)) return 'css';
  if (/\.svg$/i.test(path) || /^image\/svg/i.test(contentType)) return 'svg';
  return null;
}
