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

const KEY = '__uncraft_llm_breakers';
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
 * Throws the original error from the wrapped fn when the breaker is
 * CLOSED. Throws a synthesized "circuit_open" error when OPEN — caller
 * can catch and surface a graceful message to the user.
 */
export function breakerFor(providerName, fn) {
  if (breakers.has(providerName)) return breakers.get(providerName).fire.bind(breakers.get(providerName));
  const breaker = new CircuitBreaker(fn, DEFAULT_OPTS);
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
  // Fallback returns a structured error the adapter call sites can detect.
  breaker.fallback(() => {
    const err = new Error(`${providerName} circuit open — provider unavailable, try again shortly`);
    err.code = 'circuit_open';
    err.provider = providerName;
    throw err;
  });
  breakers.set(providerName, breaker);
  return breaker.fire.bind(breaker);
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
