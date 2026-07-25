function readHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || '') : '';
}

function originOf(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

function sourceAllowsOrigin(source, { appOrigin, pageOrigin }) {
  const token = source.replace(/,$/, '').trim();
  if (!token) return false;
  if (token === '*') return true;
  if (token === "'self'") return Boolean(appOrigin && pageOrigin && appOrigin === pageOrigin);
  if (token === 'http:' || token === 'https:') return appOrigin.startsWith(token);

  try {
    const app = new URL(appOrigin);
    const normalized = token.replace(/^\*:/, app.protocol);
    if (/^https?:\/\/\*\./i.test(normalized)) {
      const allowed = new URL(normalized.replace('://*.', '://placeholder.'));
      const suffix = allowed.hostname.replace(/^placeholder\./, '');
      return app.protocol === allowed.protocol
        && app.port === allowed.port
        && app.hostname.endsWith(`.${suffix}`);
    }
    return new URL(normalized).origin === app.origin;
  } catch {
    return false;
  }
}

export function iframeBlockReason(headers, { pageUrl, appOrigin } = {}) {
  const pageOrigin = originOf(pageUrl);
  const normalizedAppOrigin = originOf(appOrigin);
  const xFrameOptions = readHeader(headers, 'x-frame-options').toLowerCase();

  if (/(^|[,\s])deny($|[,\s])/.test(xFrameOptions)) return 'x-frame-options-deny';
  if (/(^|[,\s])sameorigin($|[,\s])/.test(xFrameOptions)
      && pageOrigin !== normalizedAppOrigin) return 'x-frame-options-sameorigin';
  if (xFrameOptions.includes('allow-from')) return 'x-frame-options-allow-from';

  const csp = readHeader(headers, 'content-security-policy');
  const directives = [...csp.matchAll(/(?:^|;)\s*frame-ancestors\s+([^;]+)/gi)];
  for (const directive of directives) {
    const sources = directive[1].trim().split(/\s+/);
    if (sources.includes("'none'")) return 'csp-frame-ancestors-none';
    const allowed = sources.some((source) => sourceAllowsOrigin(source, {
      appOrigin: normalizedAppOrigin,
      pageOrigin,
    }));
    if (!allowed) return 'csp-frame-ancestors';
  }

  return null;
}
