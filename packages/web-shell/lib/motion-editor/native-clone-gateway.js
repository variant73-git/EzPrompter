import { getRuntimeBridgeSource } from './runtime-bridge-source.js';

export function rewriteRuntimePaths(source) {
  // The boundary guard avoids rewriting the `/assets/` suffix inside a path
  // we already translated. It also catches unquoted srcset entries and URLs
  // embedded in runtime JSON, not only src/href attributes.
  return source.replace(/(^|[^a-zA-Z0-9_-])\/assets\//g, '$1/api/native-clone/assets/');
}

export function injectRuntimeBridge(html) {
  const source = getRuntimeBridgeSource().replace(/<\/script/gi, '<\\/script');
  const script = `<script data-uncraft-runtime-bridge>${source}</script>`;
  const policy = [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  const securityMeta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const secured = /<head>/i.test(html) ? html.replace(/<head>/i, `<head>${securityMeta}`) : `${securityMeta}${html}`;
  if (/<\/body>/i.test(secured)) return secured.replace(/<\/body>/i, `${script}</body>`);
  return `${secured}${script}`;
}
