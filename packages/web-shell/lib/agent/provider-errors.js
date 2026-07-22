/**
 * Provider error taxonomy — the ONE place that reads the wire shapes of the
 * three LLM SDKs (Anthropic / OpenAI / Gemini) plus our own synthesized
 * errors, and assigns a semantic category. Everything downstream (circuit
 * breaker health accounting, driver failover eligibility, per-operation
 * fallback policy) derives from the category, never from raw status codes
 * scattered across call sites.
 *
 * Categories:
 *   invalid_request  — malformed call (true 400/404/422): OUR bug. Retrying
 *                      on another provider would just fail differently.
 *   auth             — 401/403 / bad key: OUR config. Same reasoning.
 *   provider_balance — OUR account is out of money on that provider.
 *                      Anthropic ships this as a 400 invalid_request_error
 *                      ("credit balance is too low"), OpenAI as a 429
 *                      insufficient_quota — which is why classification must
 *                      run BEFORE any status-code switch. Not provider
 *                      health, but IS failover-eligible: another funded
 *                      provider can serve the request.
 *   rate_limit       — 429 / per-minute quota: provider says slow down.
 *   outage           — 5xx / overloaded / network refused / dropped.
 *   timeout          — hung call (driver race, opossum ETIMEDOUT, SDK).
 *   circuit_open     — synthesized by circuit.js ONLY when the breaker is
 *                      actually open (fail-fast window during an outage).
 *   unknown          — unclassifiable; treated as fail-fast, never failover.
 */

export const FAILOVER_ELIGIBLE = new Set([
  'provider_balance', 'rate_limit', 'outage', 'timeout', 'circuit_open',
]);

// Breaker health = "is the PROVIDER degraded?". Balance/auth/malformed
// requests fail deterministically regardless of provider health — counting
// them would trip the breaker on our own billing/config problems and turn
// every later error into a bogus circuit_open.
export const COUNTS_FOR_BREAKER = new Set(['outage', 'timeout', 'rate_limit']);

/** Classify an error thrown by an LLM adapter (or our wrappers) into one
 *  semantic category. Never throws; unrecognized shapes return 'unknown'. */
export function classifyProviderError(e) {
  if (!e) return 'unknown';
  if (e.providerErrorCategory) return e.providerErrorCategory;

  const code = String(e.code || '');
  if (code === 'circuit_open' || code === 'EOPENBREAKER') return 'circuit_open';
  if (code === 'llm_timeout' || code === 'ETIMEDOUT') return 'timeout';

  const status = e.status ?? e.statusCode ?? e.response?.status ?? null;
  const msg = String(e.message || '');
  // Anthropic nests the wire type at error.error.type; OpenAI exposes
  // error.type / type / code on the APIError itself.
  const wireType = e?.error?.error?.type || e?.error?.type || e?.type || '';

  // ── Balance first — providers disguise it under generic statuses ──
  if (/credit balance is too low/i.test(msg)) return 'provider_balance';          // Anthropic 400
  if (wireType === 'insufficient_quota' || code === 'insufficient_quota'
    || /insufficient_quota/i.test(msg)) return 'provider_balance';                // OpenAI 429
  if (/prepayment credits|purchase more credits|billing hard limit/i.test(msg)) {
    return 'provider_balance';                                                    // Gemini prepaid 429
  }

  if (status === 401 || status === 403) return 'auth';
  if (wireType === 'authentication_error' || wireType === 'permission_error'
    || /invalid.?api.?key|API key not valid/i.test(msg)) return 'auth';

  if (status === 429 || wireType === 'rate_limit_error'
    || /RESOURCE_EXHAUSTED|rate.?limit|quota exceeded/i.test(msg)) return 'rate_limit';

  if (status === 529 || wireType === 'overloaded_error' || wireType === 'api_error'
    || (status != null && status >= 500)) return 'outage';
  if (/overloaded|temporarily unavailable|service unavailable|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|Connection error/i.test(msg)) {
    return 'outage';
  }

  if (/llm call exceeded \d+s|timed out after/i.test(msg)) return 'timeout';

  if (status === 400 || status === 404 || status === 422) return 'invalid_request';
  if (wireType === 'invalid_request_error' || wireType === 'not_found_error') return 'invalid_request';

  return 'unknown';
}

/** Stamp the category onto the error (idempotent) and return it — lets the
 *  breaker classify once and every later consumer read the verdict. */
export function annotateProviderError(e) {
  if (e && !e.providerErrorCategory) {
    try { e.providerErrorCategory = classifyProviderError(e); } catch { /* read-only errors: skip */ }
  }
  return e;
}

/** Should the driver try the next provider in the fallback chain? */
export function isFailoverEligible(category) {
  return FAILOVER_ELIGIBLE.has(category);
}

/** Should this error count toward tripping the provider's circuit breaker? */
export function countsForBreaker(category) {
  return COUNTS_FOR_BREAKER.has(category);
}
