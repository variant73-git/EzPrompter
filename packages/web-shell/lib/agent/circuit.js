/**
 * Per-provider circuit breakers around the LLM adapters.
 *
 * Pattern: opossum tracks consecutive failures + timeouts per provider.
 * After `errorThresholdPercentage` failures inside `rollingCountTimeout`,
 * the breaker OPENS — subsequent calls fail FAST (no network) for
 * `resetTimeout` ms. After the cool-down, a single probe call is allowed
 * (HALF-OPEN); success closes the breaker, failure re-opens it.
 *
 * Why this matters: when Anthropic / OpenAI / Gemini have an outage
 * (real-world: ~once a quarter, ~10-30min each), retrying with backoff
 * still adds latency to each user turn and burns timeouts. The breaker
 * short-circuits during the outage and lets the agent loop fail-fast,
 * giving the user a clear error instead of a 60s spinner.
 *
 * Breakers are module-singletons keyed by provider name so they survive
 * across requests within a Node process (matches outage-window behaviour).
 *
 * NOTE: HMR creates new module evaluations in dev — we stash on globalThis
 * the same way run-map.js does so dev sessions don't reset breaker state.
 */
import CircuitBreaker from 'opossum';
import { classifyProviderError, countsForBreaker, annotateProviderError } from './provider-errors.js';

// Version suffix matters (adversarial-review find): the stash survives HMR
// by design, so an UNVERSIONED key would keep serving breakers built by OLD
// module code — including the pre-fix ones with the masking fallback()
// registered — until the process restarts. Bump the suffix whenever breaker
// construction semantics change.
const KEY = '__uncraft_llm_breakers_v2';
const breakers = globalThis[KEY] || (globalThis[KEY] = new Map());

const DEFAULT_OPTS = {
  // Trip when ≥50% of the last `rollingCountTimeout` ms fail.
  errorThresholdPercentage: 50,
  // 30 seconds of observation window.
  rollingCountTimeout: 30_000,
  rollingCountBuckets: 10,
  // After tripping, stay open for 45 seconds — long enough for most short
  // outages to resolve without bombarding the provider with retries.
  resetTimeout: 45_000,
  // Per-call timeout caught BY the breaker as a failure (the adapters have
  // their own timeouts at ~4min; this acts as outer fail-safe).
  timeout: 5 * 60 * 1000,
  // Volume threshold — don't trip on a single failure when traffic is low.
  volumeThreshold: 5,
};

/**
 * Wraps an async function with a per-provider circuit breaker.
 *
 *   const safeCall = breakerFor('anthropic', callAnthropic);
 *   await safeCall(args);
 *
 * Error contract (2026-07-22 — the old fallback() rewrote EVERY failure as
 * code='circuit_open', which the driver treats as failover-eligible; a 400
 * "credit balance too low" thereby caused silent failover):
 *   - Breaker CLOSED/HALF-OPEN: the ORIGINAL adapter error crosses,
 *     annotated with `providerErrorCategory` (see provider-errors.js).
 *   - Breaker OPEN: a synthesized error with code='circuit_open' — and ONLY
 *     then.
 *   - Health accounting: only outage / timeout / rate_limit count toward
 *     tripping. invalid_request / auth / provider_balance are OUR problems
 *     (bug, key, billing) — deterministic failures that say nothing about
 *     provider health. A truthy errorFilter makes opossum record the call
 *     as a SUCCESS (not merely a non-failure) while still rejecting with
 *     the original error. Two accepted side effects of that semantic:
 *     filtered errors dilute the failure rate in the rolling window, and a
 *     HALF-OPEN probe failing with a filtered error CLOSES the circuit —
 *     defensible, because a provider that answered (even with a 4xx) is
 *     up; a live outage re-trips within one rolling window.
 */
export function breakerFor(providerName, fn) {
  if (breakers.has(providerName)) return fireThroughBreaker(providerName, breakers.get(providerName));
  const breaker = new CircuitBreaker(fn, {
    ...DEFAULT_OPTS,
    errorFilter: (e) => !countsForBreaker(classifyProviderError(e)),
  });
  // Optional telemetry hooks — keep them lightweight; observability code
  // hooks into these once Langfuse is wired up.
  breaker.on('open', () => {
    // eslint-disable-next-line no-console
    console.warn(`[circuit] ${providerName} OPEN — calls failing fast until ${new Date(Date.now() + DEFAULT_OPTS.resetTimeout).toISOString()}`);
  });
  breaker.on('halfOpen', () => {
    // eslint-disable-next-line no-console
    console.warn(`[circuit] ${providerName} HALF-OPEN — probing`);
  });
  breaker.on('close', () => {
    // eslint-disable-next-line no-console
    console.warn(`[circuit] ${providerName} CLOSED — back to normal`);
  });
  breakers.set(providerName, breaker);
  return fireThroughBreaker(providerName, breaker);
}

/**
 * fire() wrapper enforcing the error contract above. NO opossum fallback()
 * is registered — opossum runs a registered fallback on ANY action failure
 * (not just when open), which is exactly the masking bug this replaces.
 */
function fireThroughBreaker(providerName, breaker) {
  return async (...args) => {
    try {
      return await breaker.fire(...args);
    } catch (e) {
      // Open breaker: opossum rejects with its own EOPENBREAKER error before
      // ever invoking the adapter. Translate to our stable shape.
      if (e && (e.code === 'EOPENBREAKER' || /breaker is open/i.test(String(e.message)))) {
        const err = new Error(`${providerName} circuit open — provider unavailable, try again shortly`);
        err.code = 'circuit_open';
        err.provider = providerName;
        err.providerErrorCategory = 'circuit_open';
        throw err;
      }
      // Everything else crosses UNCHANGED apart from the category stamp —
      // status, SDK body, and message stay intact for the driver's policy.
      throw annotateProviderError(e);
    }
  };
}

/** Inspect current state (useful in /api/health). */
export function snapshot() {
  const out = {};
  for (const [name, b] of breakers) {
    out[name] = {
      state: b.opened ? 'open' : b.halfOpen ? 'half-open' : 'closed',
      stats: b.stats,
    };
  }
  return out;
}
