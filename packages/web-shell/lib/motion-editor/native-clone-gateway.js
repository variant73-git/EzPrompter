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
    // O editor completo tambem sai: sem isto, reinjetar ACUMULA copias do
    // editor inteiro no documento (mesma classe do resíduo anotado em 2026-08-01).
    .replace(/<script\b[^>]*\bdata-uncraft-full-editor(?:-boot)?\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<link\b[^>]*\bdata-uncraft-full-editor\b[^>]*>/gi, '')
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

/**
 * O EDITOR COMPLETO DENTRO DO CLONE.
 *
 * O editor (layers, inspector, fontes, imagens, fills, gradientes, efeitos,
 * guias) roda hoje no documento do CANVAS e alcança o node por same-origin. O
 * clone é servido em iframe com sandbox e origem opaca, então o canvas não
 * alcança nada — e é por isso que ele abre um editor menor, só de animação.
 *
 * A saída é rodar o editor DENTRO do clone, que é como a extensão sempre
 * funcionou em sites de verdade: ele edita DOM arbitrário, não precisa que o
 * site seja nosso. Os arquivos entram por caminho ABSOLUTO na origem do
 * runtime — `'self'` da CSP já os autoriza, e nada de rede privada é cruzado.
 *
 * `__rbHost` e `__rbTarget` apontam para o PRÓPRIO documento (host = target),
 * ao contrário do canvas, onde são documentos diferentes.
 */
/**
 * ⚠️ SEM `freeze.js` E SEM `rebuild.js` — DE PROPOSITO (achado do Sol).
 *
 * Na extensao, `freeze.js` existe para CONGELAR o site antes de editar: ele
 * pausa a timeline global do GSAP, mata todos os tweens e destroi todos os
 * ScrollTriggers. Isso e' certo quando o alvo e' uma pagina qualquer da
 * internet — e e' exatamente o oposto do que este clone existe para ser.
 *
 * Medido: com `freeze.js` no pacote, a timeline global fica `paused`, os tweens
 * ativos vao a ZERO e o relogio nao anda em 1,5s. As "78 animacoes" que eu
 * contei eram OBJETOS, nao movimento — contagem nao e' vida.
 *
 * `editor.js` chama `__rbFreeze` e `__rbRebuild` sob guarda de existencia, entao
 * nao carregar os dois e' silencioso e seguro. `rebuild.js` sai junto porque
 * reescreve o documento, o que quebraria a ponte de animacao.
 */
const EDITOR_CORE_FILES = [
  'detect.js', 'extractor.js', 'persist.js', 'mode-e.js', 'mode-e-classic.js',
  'mode-e-diff.js', 'mode-e-refine.js', 'mode-b.js', 'mode-e2.js', 's2h.js',
  'fill-popup.js', 'editor.js',
];

export function fullEditorEnabled(env = process.env) {
  return String(env.UNCRAFT_CLONE_FULL_EDITOR || '').trim() === '1';
}

function fullEditorTags() {
  // Origem opaca: `localStorage` LANÇA. O editor usa isso para auto-save e
  // paleta, e três chamadas dele não têm proteção — um SecurityError ali mataria
  // a edição inteira. O substituto guarda em memória: perde entre recargas,
  // que é o comportamento certo num clone servido por token.
  const memoria = `<script data-uncraft-full-editor-boot>(function(){
    try { window.localStorage.getItem('x'); } catch (e) {
      var m = {};
      Object.defineProperty(window, 'localStorage', { configurable: true, value: {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
        setItem: function (k, v) { m[k] = String(v); },
        removeItem: function (k) { delete m[k]; },
        clear: function () { m = {}; },
        key: function (i) { return Object.keys(m)[i] || null; },
        get length() { return Object.keys(m).length; },
      } });
    }
    // O editor tem congeladores PROPRIOS (animacao CSS inline e matador de
    // :hover) que rodam na inicializacao, independentes do freeze.js. Num clone
    // que existe para se mexer, os dois estao errados (achado do Sol r2).
    // A chave viaja DENTRO do objeto de boot: um global solto seria escrito pela
    // propria pagina, que assim se declararia imune (Sol r3-r5).
    window.__rbHost = { doc: document, win: window, preserveMotion: true };
    window.__rbTarget = { doc: document, win: window };
    window.__uncraftTransport = { send: function () { return Promise.resolve({}); } };
    var noop = function () {};
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || { sendMessage: noop, onMessage: { addListener: noop } };
    window.chrome.storage = window.chrome.storage || { local: { get: function (k, cb) { cb && cb({}); }, set: noop } };
    window.chrome.tabs = window.chrome.tabs || { query: function () { return Promise.resolve([]); }, captureVisibleTab: function () { return Promise.resolve(null); } };
    window.chrome.scripting = window.chrome.scripting || { executeScript: function () { return Promise.resolve([]); }, insertCSS: function () { return Promise.resolve(); } };
  })();</script>`;
  const css = '<link data-uncraft-full-editor rel="stylesheet" href="/editor-core/editor.css">';
  const js = EDITOR_CORE_FILES
    .map((f) => `<script data-uncraft-full-editor src="/editor-core/${f}"></script>`)
    .join('');
  return `${css}${memoria}${js}`;
}

export function injectRuntimeBridge(html, runtimeConfig = null, options = {}) {
  const source = getRuntimeBridgeSource().replace(/<\/script/gi, '<\\/script');
  const fullEditor = options.fullEditor ?? fullEditorEnabled();
  const script = `<script data-uncraft-runtime-bridge>${source}</script>${fullEditor ? fullEditorTags() : ''}`;
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
