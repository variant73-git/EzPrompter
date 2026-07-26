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
  const secured = /<head>/i.test(cleaned)
    ? cleaned.replace(/<head>/i, `<head>${securityMeta}${config}`)
    : `${securityMeta}${config}${cleaned}`;
  if (/<\/body>/i.test(secured)) return secured.replace(/<\/body>/i, `${script}</body>`);
  return `${secured}${script}`;
}
