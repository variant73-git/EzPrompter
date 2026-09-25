// Seleção do fornecedor de navegador remoto (spec 2026-09-08). Ambos os
// clientes expõem a MESMA interface (createSession/liveUrls/releaseSession/
// connectUrl), então trocar é uma variável de ambiente, não uma reescrita —
// o job service e a sessão emprestada são agnósticos de fornecedor.
import { browserbaseFromEnv } from './browserbase-client.js';
import { steelFromEnv } from './steel-client.js';

export function challengeVendorFromEnv(env = process.env) {
  const v = String(env.UNCRAFT_CHALLENGE_VENDOR || 'browserbase').toLowerCase();
  if (v === 'steel') return steelFromEnv(env);
  return browserbaseFromEnv(env);
}

// URL de conexão CDP para reconectar a uma sessão existente (a connectUrl NUNCA
// é persistida — segredo portador; reconstrói-se pelo id). Delega ao cliente do
// fornecedor corrente.
export function connectUrlForSession(sessionId, env = process.env) {
  const vendor = challengeVendorFromEnv(env);
  if (!vendor) return '';
  return vendor.connectUrl(sessionId);
}
