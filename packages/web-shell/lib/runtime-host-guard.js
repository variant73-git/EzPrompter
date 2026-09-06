// Decisão PURA de roteamento por host — consumida pelo middleware (edge
// runtime: nada de node:crypto/db aqui) e testável de frente.
//
// Regra (spec §3 / Sol r1 §7): o hostname por sessão (`<nonce>.<sufixo>`) só
// serve rotas de runtime — NENHUMA API do app mora no runtime host; e em
// produção o host do APP recusa as rotas exclusivas de runtime. Sem sufixo
// configurado, tudo passa (dev de host único, comportamento atual).

const RUNTIME_ONLY_PREFIXES = ['/api/rt/', '/api/runtime-bootstrap/'];
const RUNTIME_ALLOWED_PREFIXES = [...RUNTIME_ONLY_PREFIXES, '/api/runtime/'];

function hostWithoutPort(host) {
  return String(host || '').toLowerCase().replace(/:\d+$/, '');
}

// ⚠️ A VERDADE DO HOST É O HEADER. Em `next dev`, `request.url` reporta origin
// SEMPRE `localhost` (lição 167; provado em laboratório 2026-09-06: o handler
// vê Host/X-Forwarded-Host reais e `request.url` = localhost). Todo lugar que
// tirava host de `request.url` comparava `localhost` com o host da sessão e
// recusava (bootstrap 404, verifyLease host_mismatch, frame-ancestors 'self').
// Uma fonte só: x-forwarded-host (proxy) → host → request.url (fallback, que é
// o comportamento de produção, onde request.url é o host real).
function firstHeaderValue(request, name) {
  const raw = request?.headers?.get?.(name);
  return raw ? String(raw).split(',')[0].trim() : '';
}

export function requestHostname(request) {
  const header = firstHeaderValue(request, 'x-forwarded-host') || firstHeaderValue(request, 'host');
  if (header) return hostWithoutPort(header);
  try { return new URL(request.url).hostname.toLowerCase(); } catch { return ''; }
}

export function requestOrigin(request) {
  const header = firstHeaderValue(request, 'x-forwarded-host') || firstHeaderValue(request, 'host');
  if (!header) {
    try { return new URL(request.url).origin; } catch { return ''; }
  }
  let proto = firstHeaderValue(request, 'x-forwarded-proto');
  if (!proto) {
    try { proto = new URL(request.url).protocol.replace(':', ''); } catch { proto = 'http'; }
  }
  return `${proto}://${header.toLowerCase()}`;
}

export function isRuntimeHost(host, suffix) {
  if (typeof suffix !== 'string' || !suffix) return false;
  const bare = hostWithoutPort(host);
  const expected = suffix.toLowerCase();
  if (!bare.endsWith(`.${expected}`)) return false;
  // Exatamente UM label de nonce: `x.y.<sufixo>` não é host de sessão.
  const label = bare.slice(0, -(expected.length + 1));
  return /^[a-z0-9-]+$/.test(label);
}

export function decideHostRouting({ host, pathname, suffix, production }) {
  if (typeof suffix !== 'string' || !suffix) return 'allow';
  const path = String(pathname || '');
  if (isRuntimeHost(host, suffix)) {
    return RUNTIME_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix)) ? 'allow' : 'block';
  }
  if (production && RUNTIME_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix))) return 'block';
  return 'allow';
}

/**
 * Checagem de SEPARAÇÃO DE SITE para o startup (Sol r4 #2): em produção o
 * sufixo do runtime deve viver em domínio registrável separado do app —
 * subdomínio do mesmo eTLD+1 não é fronteira de site (cookies para o domínio
 * pai, SameSite same-site). Heurística de "registrável" = dois últimos labels;
 * NÃO cobre sufixos públicos compostos (co.uk) — limitação declarada, e o
 * domínio real do produto não os usa. Falha FECHADA: URL de app ilegível
 * conta como "compartilha".
 */
export function runtimeSuffixSharesRegistrableDomain(suffix, appUrl) {
  const registrable = (hostname) => hostname.split('.').slice(-2).join('.');
  try {
    const appHost = new URL(appUrl).hostname.toLowerCase();
    return registrable(String(suffix).toLowerCase()) === registrable(appHost);
  } catch {
    return true;
  }
}
