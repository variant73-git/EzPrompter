// lib/clone-telemetry.js
/**
 * Per-clone telemetry (pedido do Adilson, 2026-08-20): TODO clone que o usuário
 * dispara no canvas grava tempo por etapa + custo real de API no meta do node,
 * para o widget Dev exibir. Metering puro — NUNCA participa de cobrança, e a
 * escrita é fail-open: telemetria não pode derrubar um clone que deu certo
 * (mesmo contrato do SSIM em meta.similarity, item 183).
 *
 * Unidade de custo: µ¢ como no billing (usage_events.cost_microcents);
 * 1 USD = 1_000_000 µ¢ (ver lib/billing/pricing.js: µ¢/10_000 = credits = ¢).
 */

export function usdFromMicrocents(microcents) {
  const n = Number(microcents);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / 1_000_000;
}

// Timer de etapas: mark('a') fecha a etapa corrente sob o nome dado.
// finish() devolve { stages, totalMs } com ms inteiros.
export function startCloneTimer(now = Date.now) {
  const t0 = now();
  let last = t0;
  const stages = {};
  return {
    mark(name) {
      const t = now();
      stages[name] = (stages[name] || 0) + Math.max(0, Math.round(t - last));
      last = t;
    },
    finish() {
      return { stages: { ...stages }, totalMs: Math.max(0, Math.round(now() - t0)) };
    },
  };
}

// Registro canônico gravado em node.meta.cloneTelemetry.
export function buildCloneTelemetry({ engine, reason = null, url = null, stages = {}, totalMs = 0, credits = 0, usageMicrocents = null, at = new Date().toISOString() }) {
  const µc = usageMicrocents == null ? null : Number(usageMicrocents);
  return {
    engine: String(engine || 'unknown'),
    reason,
    url,
    stages,
    totalMs: Math.max(0, Math.round(totalMs)),
    credits: Math.max(0, Number(credits) || 0),
    usageMicrocents: Number.isFinite(µc) ? µc : null,
    costUsd: Number.isFinite(µc) ? Number(usdFromMicrocents(µc).toFixed(4)) : null,
    at,
  };
}
