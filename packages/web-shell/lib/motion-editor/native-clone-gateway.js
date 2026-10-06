import { getRuntimeBridgeSource } from './runtime-bridge-source.js';
import { runtimeCspMeta } from './runtime-csp.js';
import { leadingDoctypeEnd } from '../native-clone/doctype-anchor.js';
import { bootstrapDoPlano } from '../native-plane/plane-mode.js';
import { prefixoTraduzivel } from '../native-clone/prefixo-de-runtime.js';

export { leadingDoctypeEnd };

export function rewriteRuntimePaths(source, prefixes = ['assets'], runtimeBase = '/api/native-clone') {
  // Clone bundles reference their own top-level directories root-absolutely
  // (/assets/, /vendor/, /media/, …). Every one of them must be translated —
  // a path that escapes the gateway resolves against the Next app, 404s, and
  // kills the site's boot script. The caller passes the bundle's REAL top-level
  // directory names, so this never guesses.
  const names = [...new Set(prefixes)].filter(prefixoTraduzivel);   // mesma regra do produtor (prefixo-de-runtime.js)
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
    .replace(/<meta\b[^>]*\bdata-uncraft-runtime-policy\b[^>]*>/gi, '')
    // modo plano (plano visual nativo): reinjetar nao acumula
    .replace(/<style\b[^>]*\bdata-u-plano\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<script\b[^>]*\bdata-u-plano\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
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

/**
 * ⭐ LIGADO POR PADRÃO (decisão de produto do Adilson, 2026-08-25): o editor
 * completo DENTRO do clone foi RETIRADO do padrão (Adilson, 2026-09-22):
 * o clone é o site; toda edição vive nos painéis de fora. Opt-in só p/ depurar.
 */
export function fullEditorEnabled(env = process.env) {
  // DESLIGADO por padrão (Adilson, 2026-09-22): o clone é O SITE, não a
  // ferramenta de edição — toda edição vive nos painéis DE FORA, que editam o
  // clone pela ponte (injetada à parte). Injetar o editor-core dentro do iframe
  // punha um "editor dentro de editor". Opt-in explícito só para depurar.
  const valor = String(env.UNCRAFT_CLONE_FULL_EDITOR || '').trim().toLowerCase();
  return valor === '1' || valor === 'on' || valor === 'true';
}

export function fullEditorTags() {
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
  // modo plano: camada so de canvas — sem editor completo (ninguem edita a camada)
  const plano = options.plano && typeof options.plano === 'object' ? options.plano : null;
  const fullEditor = plano ? false : (options.fullEditor ?? fullEditorEnabled());
  const script = `<script data-uncraft-runtime-bridge>${source}</script>${fullEditor ? fullEditorTags() : ''}`;
  // A política vem da fonte ÚNICA (runtime-csp.js), a mesma que gera o header
  // — era aqui que a lista à mão tinha DIVERGIDO (faltava worker-src, spec §5).
  const securityMeta = `<meta data-uncraft-runtime-policy http-equiv="Content-Security-Policy" content="${runtimeCspMeta()}">`;
  const config = runtimeConfig && typeof runtimeConfig === 'object'
    ? `<script type="application/json" data-uncraft-runtime-config>${safeJson(runtimeConfig)}</script>`
    : '';
  const cleaned = removePriorInjection(String(html));
  const at = leadingDoctypeEnd(cleaned);
  const secured = `${cleaned.slice(0, at)}${securityMeta}${config}${plano ? bootstrapDoPlano(plano) : ''}${cleaned.slice(at)}`;
  if (/<\/body>/i.test(secured)) return secured.replace(/<\/body>/i, `${script}</body>`);
  return `${secured}${script}`;
}
