// Cliente REST do Steel (steel.dev), substituto do Browserbase atrás de
// UNCRAFT_CHALLENGE_VENDOR=steel. Mesma interface do browserbase-client:
// createSession / liveUrls / releaseSession / connectUrl. Spec 2026-09-08.
//
// Fatos da doc (docs.steel.dev/llms.txt, 2026-09): header `steel-api-key`,
// base `https://api.steel.dev`, CDP construído como
// `wss://connect.steel.dev?apiKey=<key>&sessionId=<id>` (NÃO usar
// session.websocketUrl direto), viewer interativo = `${debugUrl}?interactive=true`
// (não-autenticado por design → segredo portador, mesmo tratamento no-store/gated).
const API = 'https://api.steel.dev';
const SESSION_TIMEOUT_MS = 600_000; // humano (≤5 min) + partida + captura (~3 min)

export class SteelError extends Error {
  constructor(code, status) { super(`steel_${code}`); this.name = 'SteelError'; this.code = code; this.status = status; }
}

export function createSteelClient({ apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new SteelError('not_configured');
  const headers = { 'steel-api-key': apiKey, 'content-type': 'application/json' };

  async function call(path, init) {
    let res;
    try { res = await fetchImpl(`${API}${path}`, { ...init, headers }); }
    catch { throw new SteelError('vendor_unavailable'); }
    if (res.status >= 500 || res.status === 429) throw new SteelError('vendor_unavailable', res.status);
    if (!res.ok) throw new SteelError('vendor_rejected', res.status);
    return res.json().catch(() => ({}));
  }

  function connectUrl(sessionId) {
    return `wss://connect.steel.dev?apiKey=${encodeURIComponent(apiKey)}&sessionId=${encodeURIComponent(sessionId)}`;
  }

  return {
    connectUrl,
    async createSession({ targetUrl, proxy = false, jobId = null }) { // eslint-disable-line no-unused-vars
      const body = {
        sessionTimeout: SESSION_TIMEOUT_MS,
        solveCaptcha: true,
        blockAds: false,
        dimensions: { width: 1440, height: 900 },
        useProxy: Boolean(proxy),
      };
      const j = await call('/v1/sessions', { method: 'POST', body: JSON.stringify(body) });
      const expiresAt = j.expiresAt || j.expireAt
        || new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString();
      // A URL de conexão é construída (a doc é explícita: não usar websocketUrl direto).
      return { id: j.id, connectUrl: connectUrl(j.id), expiresAt };
    },
    async liveUrls(sessionId) {
      // Steel dá UMA página por sessão (headful WebRTC); o viewer é o debugUrl.
      const j = await call(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
      const debug = j.debugUrl ? `${j.debugUrl}?interactive=true` : null;
      return { pages: debug ? [{ id: sessionId, url: j.url || null, debuggerFullscreenUrl: debug }] : [] };
    },
    async releaseSession(sessionId) {
      // Espelha o SDK `sessions.release(id)`.
      await call(`/v1/sessions/${encodeURIComponent(sessionId)}/release`, { method: 'POST', body: '{}' });
    },
  };
}

export function steelFromEnv(env = process.env) {
  if (!env.STEEL_API_KEY) return null;
  return createSteelClient({ apiKey: env.STEEL_API_KEY });
}
