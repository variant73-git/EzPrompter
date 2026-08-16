import { getRuntimeBridgeSource } from './runtime-bridge-source.js';

export function rewriteRuntimePaths(source, prefixes = ['assets'], runtimeBase = '/api/native-clone') {
  // Clone bundles reference their own top-level directories root-absolutely
  // (/assets/, /vendor/, /media/, …). Every one of them must be translated —
  // a path that escapes the gateway resolves against the Next app, 404s, and
  // kills the site's boot script. The caller passes the bundle's REAL top-level
  // directory names, so this never guesses.
  const names = [...new Set(prefixes)].filter((name) => /^[a-zA-Z0-9_-]+$/.test(name));
  if (!names.length) return source;
  const base = String(runtimeBase || '').replace(/\/+$/, '');
  if (!base) throw new TypeError('A runtime base path is required');
  // The boundary guard avoids rewriting a suffix inside a path we already
  // translated. It also catches unquoted srcset entries and URLs embedded in
  // runtime JSON, not only src/href attributes.
  const pattern = new RegExp(`(^|[^a-zA-Z0-9_./-])/(${names.join('|')})/`, 'g');
  return source.replace(pattern, `$1${base}/$2/`);
}

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function removePriorInjection(html) {
  return html
    .replace(/<script\b[^>]*\bdata-uncraft-runtime-(?:bridge|config)\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<meta\b[^>]*\bdata-uncraft-runtime-policy\b[^>]*>/gi, '');
}

// Where our own markup may be spliced in without changing how the browser reads
// the document: right after the LEADING doctype, or at the very start when there
// is none.
//
// The old anchor was a literal `<head>` search, which failed two ways — both
// measured in a real Chromium (spike r46):
//   - it misses `<head lang="…">` and headless documents, and the fallback used
//     to prepend before the doctype; a doctype that is not the first thing in
//     the document is ignored and the clone renders in QUIRKS MODE, with a
//     different box model than the original;
//   - it also matches inside a comment (`<!-- <head> -->`), burying the whole
//     injection where the parser never reads it.
//
// The scan mirrors the tokens the parser's "initial" insertion mode tolerates
// without leaving standards mode: a BOM, whitespace, comments, and bogus
// comments. Bogus comments matter in practice — legacy XHTML served as text/html
// opens with an `<?xml …?>` prolog, and a scanner that only knew `<!-- -->`
// would give up, land at 0 and put the meta before the doctype: quirks again.
//
// Returning 0 when the preamble holds no doctype is safe: a document without one
// is already in quirks mode, so injecting at the very start changes nothing.
// The whitespace the "initial" insertion mode ignores is a closed set, so this
// can be exact rather than a guess. JS `\s` is wider (it matches U+00A0 and
// friends, which the parser treats as ordinary text) — using it would misjudge
// the preamble.
const HTML_SPACE = /[\t\n\f\r ]/;
// Character references are resolved by the tokenizer BEFORE tree construction,
// so `&#10;` ahead of the doctype is a whitespace token the initial mode
// ignores. Only these forms can resolve to HTML whitespace.
const WHITESPACE_REFERENCE = /^&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|(Tab|NewLine);)/;

function leadingDoctypeEnd(html) {
  let at = html.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (at < html.length && HTML_SPACE.test(html[at])) at += 1;
    if (html[at] === '&') {
      const reference = WHITESPACE_REFERENCE.exec(html.slice(at));
      const code = reference
        ? (reference[1] ? Number.parseInt(reference[1], 10)
          : reference[2] ? Number.parseInt(reference[2], 16)
            : reference[3] === 'Tab' ? 0x09 : 0x0a)
        : -1;
      if (code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d && code !== 0x20) return 0;
      at += reference[0].length;
      continue;
    }
    if (/^<!doctype/i.test(html.slice(at, at + 9))) {
      const close = html.indexOf('>', at);
      return close === -1 ? 0 : close + 1;
    }
    if (html.startsWith('<!--', at)) {
      // Abbreviated forms close the comment immediately; a lazy `-->` search
      // would swallow the real markup that follows.
      if (html.startsWith('<!-->', at)) { at += 5; continue; }
      if (html.startsWith('<!--->', at)) { at += 6; continue; }
      const close = /--!?>/.exec(html.slice(at + 4));
      if (!close) return 0;
      at += 4 + close.index + close[0].length;
      continue;
    }
    if (html.startsWith('<?', at) || html.startsWith('<!', at) || /^<\/[^a-zA-Z]/.test(html.slice(at, at + 3))) {
      const close = html.indexOf('>', at);
      if (close === -1) return 0;
      at = close + 1;
      continue;
    }
    return 0;
  }
}

export function injectRuntimeBridge(html, runtimeConfig = null) {
  const source = getRuntimeBridgeSource().replace(/<\/script/gi, '<\\/script');
  const script = `<script data-uncraft-runtime-bridge>${source}</script>`;
  const policy = [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "form-action 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  const securityMeta = `<meta data-uncraft-runtime-policy http-equiv="Content-Security-Policy" content="${policy}">`;
  const config = runtimeConfig && typeof runtimeConfig === 'object'
    ? `<script type="application/json" data-uncraft-runtime-config>${safeJson(runtimeConfig)}</script>`
    : '';
  const cleaned = removePriorInjection(String(html));
  const at = leadingDoctypeEnd(cleaned);
  const secured = `${cleaned.slice(0, at)}${securityMeta}${config}${cleaned.slice(at)}`;
  if (/<\/body>/i.test(secured)) return secured.replace(/<\/body>/i, `${script}</body>`);
  return `${secured}${script}`;
}
