// lib/harness.js — harnesses nomeados de modelo por slot, chaveáveis no widget
// Dev (pedido do Adilson, 2026-08-20). Um harness diz QUAL modelo atende cada
// slot de clone; o widget grava a escolha num cookie e as rotas leem por
// requisição. A/B: cada clone carrega o harness no meta.cloneTelemetry, então
// custo e tempo comparam-se POR HARNESS no próprio widget.
//
// Fail-closed para qualidade: id desconhecido resolve para o baseline — um
// cookie adulterado nunca rebaixa o clone para um modelo fora do registro.
// `UNCRAFT_HARNESS` (env) vence o cookie — força de servidor para dev/test.

export const HARNESS_COOKIE = 'uncraft-harness';

export const HARNESSES = Object.freeze({
  baseline: Object.freeze({ id: 'baseline', label: 'GPT-5.5 (baseline)', cloneVision: 'gpt-5.5' }),
  terra:    Object.freeze({ id: 'terra',    label: 'GPT-5.6 Terra',      cloneVision: 'gpt-5.6-terra' }),
});

export const DEFAULT_HARNESS_ID = 'baseline';

export function resolveHarness(id) {
  return HARNESSES[String(id || '').toLowerCase()] || HARNESSES[DEFAULT_HARNESS_ID];
}

export function harnessFromCookieHeader(cookieHeader, env = process.env) {
  if (env.UNCRAFT_HARNESS) return resolveHarness(env.UNCRAFT_HARNESS);
  const m = /(?:^|;\s*)uncraft-harness=([^;]+)/.exec(String(cookieHeader || ''));
  let raw = m ? m[1] : null;
  try { raw = raw && decodeURIComponent(raw); } catch { /* valor cru já serve */ }
  return resolveHarness(raw);
}
