// Política de renovação da lease — PURA e client-safe (sem node:crypto, roda no
// browser). O laço vive no viewport; a DECISÃO mora aqui para ser testada de
// frente. Dois regimes (Sol r4 #7): uma indisponibilidade transitória do
// endpoint de renew NÃO pode mascarar uma lease ainda válida por horas.

export const LEASE_RENEW_INTERVAL_MS = 10 * 60 * 1000; // renova bem antes das 4h
export const LEASE_RENEW_MARGIN_MS = 15 * 60 * 1000;   // mascara se cruzar isto sem renovar
const BACKOFF_MS = [30_000, 60_000, 120_000];          // rede/5xx: tenta de novo, teto 120s

/**
 * @param {{ ok:boolean, status:number, now:number, expiresAtMs:number,
 *           consecutiveFailures:number, marginMs?:number }} input
 * @returns {{ action:'ok'|'mask'|'backoff', delayMs?:number, reason?:string }}
 */
export function decideRenewOutcome(input) {
  const { ok, status, now, expiresAtMs, consecutiveFailures } = input;
  const marginMs = Number.isFinite(input.marginMs) ? input.marginMs : LEASE_RENEW_MARGIN_MS;
  if (ok) return { action: 'ok' };

  // Recusa TERMINAL autenticada: revogada, sessão inativa, ownership perdido.
  // Não adianta esperar — mascara na hora.
  if (status === 401 || status === 403 || status === 409) {
    return { action: 'mask', reason: 'terminal' };
  }

  // Transitório (rede status 0, 5xx, timeout): continua editando com backoff,
  // e só mascara quando a lease de fato está perto de vencer.
  if (Number.isFinite(expiresAtMs) && now >= expiresAtMs - marginMs) {
    return { action: 'mask', reason: 'expiring' };
  }
  const idx = Math.min(Math.max(0, consecutiveFailures), BACKOFF_MS.length - 1);
  return { action: 'backoff', delayMs: BACKOFF_MS[idx], reason: 'transient' };
}
