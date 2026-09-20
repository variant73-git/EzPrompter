// Cliente REST do Steel (steel.dev), substituto do Browserbase atrás de
// UNCRAFT_CHALLENGE_VENDOR=steel. Interface: createSession/liveUrls/
// releaseSession/connectUrl. Spec 2026-09-08.
//
// Fatos MEDIDOS na API viva (2026-09-20): header `steel-api-key`, base
// `https://api.steel.dev`, `POST /v1/sessions` com `timeout` (ms) + `dimensions`;
// resposta traz `id`, `websocketUrl`, `debugUrl` (= .../player). CDP reconstruído
// como `wss://connect.steel.dev?apiKey=<key>&sessionId=<id>` (doc). Viewer
// interativo = `${debugUrl}?interactive=true` (NÃO-autenticado por design →
// segredo portador, mesmo gating no-store).
//
// ⚠️ CAMADA GRÁTIS: `solveCaptcha` e `useProxy` retornam 403 ("requires at least
// $10 in paid balance") — as 100h grátis navegam SEM solver/proxy. Por isso o
// solver é OPT-IN (UNCRAFT_CHALLENGE_SOLVER=on) e só deve ser ligado com saldo.
const API = 'https://api.steel.dev';
const SESSION_TIMEOUT_MS = 600_000; // humano (≤5 min) + partida + captura (~3 min)

export class SteelError extends Error {
  constructor(code, status, detail) { super(`steel_${code}`); this.name = 'SteelError'; this.code = code; this.status = status; this.detail = detail; }
}

export function createSteelClient({ apiKey, fetchImpl = fetch, solveCaptcha = false } = {}) {
  if (!apiKey) throw new SteelError('not_configured');
  const headers = { 'steel-api-key': apiKey, 'content-type': 'application/json' };

  function connectUrl(sessionId) {
    return `wss://connect.steel.dev?apiKey=${encodeURIComponent(apiKey)}&sessionId=${encodeURIComponent(sessionId)}`;
  }

  async function call(path, init) {
    let res;
    try { res = await fetchImpl(`${API}${path}`, { ...init, headers }); }
    catch { throw new SteelError('vendor_unavailable'); }
    if (res.status >= 500 || res.status === 429) throw new SteelError('vendor_unavailable', res.status);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // 403 de saldo ("requires at least $10 …") = recurso pago não liberado.
      const paid = res.status === 403 && /paid balance|CAPTCHA solving|proxies/i.test(body?.message || '');
      throw new SteelError(paid ? 'paid_feature_required' : 'vendor_rejected', res.status, body?.message);
    }
    return res.json().catch(() => ({}));
  }

  return {
    connectUrl,
    async createSession({ targetUrl, proxy = false, jobId = null }) { // eslint-disable-line no-unused-vars
      const body = {
        timeout: SESSION_TIMEOUT_MS,
        dimensions: { width: 1440, height: 900 },
        // Só pede recursos pagos quando explicitamente ligados (senão 403 na
        // conta grátis). proxy vem do job (UNCRAFT_CHALLENGE_PROXY/BROWSERBASE_PROXY).
        ...(solveCaptcha ? { solveCaptcha: true } : {}),
        ...(proxy ? { useProxy: true } : {}),
      };
      const j = await call('/v1/sessions', { method: 'POST', body: JSON.stringify(body) });
      const expiresAt = j.expiresAt || new Date(Date.now() + (j.timeout || SESSION_TIMEOUT_MS)).toISOString();
      return { id: j.id, connectUrl: connectUrl(j.id), expiresAt };
    },
    async liveUrls(sessionId) {
      // Steel dá UMA página por sessão; o viewer é o debugUrl (.../player).
      const j = await call(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
      const debug = j.debugUrl ? `${j.debugUrl}?interactive=true` : null;
      return { pages: debug ? [{ id: sessionId, url: j.url || null, debuggerFullscreenUrl: debug }] : [] };
    },
    async releaseSession(sessionId) {
      await call(`/v1/sessions/${encodeURIComponent(sessionId)}/release`, { method: 'POST', body: '{}' });
    },
  };
}

export function steelFromEnv(env = process.env) {
  if (!env.STEEL_API_KEY) return null;
  // solver e proxy são pagos no Steel — só ligam por opção explícita.
  return createSteelClient({ apiKey: env.STEEL_API_KEY, solveCaptcha: String(env.UNCRAFT_CHALLENGE_SOLVER || '') === 'on' });
}
