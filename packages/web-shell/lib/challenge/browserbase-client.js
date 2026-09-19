// REST do Browserbase (sem SDK no repo). Spec 2026-09-08 §4.2/§4.6: uma sessão
// por job, solver ligado, gravação/log desligados, domínio de navegação
// restrito — e a connectUrl / URLs de visualizador NUNCA entram em log: são
// segredos portadores (quem tem a URL controla o navegador remoto).
const API = 'https://api.browserbase.com/v1';
// Orçamento da sessão: humano (≤5 min) + partida/fila + captura (~3 min).
const SESSION_TIMEOUT_S = 600;

export class BrowserbaseError extends Error {
  constructor(code, status) {
    super(`browserbase_${code}`);
    this.name = 'BrowserbaseError';
    this.code = code;
    this.status = status;
  }
}

// eTLD+1 simplificado: sufixos públicos de 2 níveis conhecidos mantêm 3
// rótulos; o resto, 2. Serve para restringir a navegação PRINCIPAL da sessão
// (o vendor já libera subdomínios sozinho); não é firewall de egress.
const TWO_LEVEL = new Set([
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'ne.jp', 'or.jp',
  'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.cl',
  'co.nz', 'co.za', 'co.in', 'co.kr', 'com.sg', 'com.hk', 'com.tr',
]);
export function allowedDomainsFor(url) {
  const host = new URL(url).hostname.toLowerCase();
  const parts = host.split('.');
  const last2 = parts.slice(-2).join('.');
  const keep = TWO_LEVEL.has(last2) ? 3 : 2;
  return [parts.slice(-Math.min(keep, parts.length)).join('.')];
}

export function createBrowserbaseClient({ apiKey, projectId, fetchImpl = fetch } = {}) {
  if (!apiKey || !projectId) throw new BrowserbaseError('not_configured');
  const headers = { 'x-bb-api-key': apiKey, 'content-type': 'application/json' };

  async function call(path, init) {
    let res;
    try {
      res = await fetchImpl(`${API}${path}`, { ...init, headers });
    } catch {
      throw new BrowserbaseError('vendor_unavailable');
    }
    if (res.status >= 500 || res.status === 429) throw new BrowserbaseError('vendor_unavailable', res.status);
    if (!res.ok) throw new BrowserbaseError('vendor_rejected', res.status);
    return res.json();
  }

  return {
    async createSession({ targetUrl, proxy = false, jobId = null }) {
      const body = {
        projectId,
        keepAlive: true,
        timeout: SESSION_TIMEOUT_S,
        browserSettings: {
          solveCaptchas: true,
          recordSession: false,
          logSession: false,
          viewport: { width: 1440, height: 900 },
          allowedDomains: allowedDomainsFor(targetUrl),
        },
        userMetadata: { uncraft: 'challenge-job', jobId },
        ...(proxy ? { proxies: true } : {}),
      };
      const j = await call('/sessions', { method: 'POST', body: JSON.stringify(body) });
      return { id: j.id, connectUrl: j.connectUrl, expiresAt: j.expiresAt };
    },
    async liveUrls(sessionId) {
      const j = await call(`/sessions/${encodeURIComponent(sessionId)}/debug`, { method: 'GET' });
      // Só o necessário POR PÁGINA — nunca wsUrl/debuggerUrl da sessão inteira.
      return {
        pages: (j.pages || []).map((p) => ({ id: p.id, url: p.url, debuggerFullscreenUrl: p.debuggerFullscreenUrl })),
      };
    },
    async releaseSession(sessionId) {
      await call(`/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        body: JSON.stringify({ projectId, status: 'REQUEST_RELEASE' }),
      });
    },
  };
}

export function browserbaseFromEnv(env = process.env) {
  if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) return null;
  return createBrowserbaseClient({ apiKey: env.BROWSERBASE_API_KEY, projectId: env.BROWSERBASE_PROJECT_ID });
}
