/**
 * llm-deadline.js — shared hardening for the extract seams (design-md, demarcelize,
 * extract-llm). Two defects, one fix each, validated by Claude + Codex/Sol review
 * (2026-07-23): the provider calls await with NO deadline (a stuck/slow model hangs
 * the synchronous extract route forever → the client loader spins with no error),
 * and a misrouted model id (e.g. a global UNCRAFT_LLM_MODEL=gpt-* bleeding into a
 * seam that only routes Anthropic/Gemini) silently reaches the wrong SDK.
 *
 *   withDeadline(run, {ms, label})  — bounds any provider call; on timeout it aborts
 *                                     (where the SDK honors the signal) and rejects
 *                                     with LlmTimeoutError so the route returns a
 *                                     clean error instead of hanging. The race is the
 *                                     guarantee; the abort is best-effort cleanup.
 *   assertProvider(model, supported) — fast-fail a model the seam cannot route,
 *                                      with a clear message, BEFORE any request.
 *
 * The deadline is generous by design (default 150s, env UNCRAFT_LLM_DEADLINE_MS):
 * it exists to surface an indefinite hang, not to kill a legitimately slow large
 * generation. On timeout the billed-operation hold refunds (the seam throws before
 * completion), so a timeout never charges.
 */

export class LlmTimeoutError extends Error {
  constructor(label, ms) {
    super(`LLM call timed out after ${ms}ms (${label})`);
    this.name = 'LlmTimeoutError';
    this.code = 'llm_timeout';
  }
}

export class LlmProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmProviderError';
    this.code = 'llm_provider';
  }
}

const DEFAULT_DEADLINE_MS = Number(process.env.UNCRAFT_LLM_DEADLINE_MS) || 150_000;

// Which provider will actually serve a model id. Mirrors the isAnthropic/isOpenAI
// checks scattered across the seams so the guard and the routing agree.
// @google/genai accepts both `gemini-*` and the fully-qualified `models/gemini-*`
// / `tunedModels/*` forms — normalize so the guard doesn't reject a valid route
// the old else-fallthrough handled.
export function providerFor(model) {
  const raw = String(model || '');
  if (/^tunedModels\//i.test(raw)) return 'gemini';
  const m = raw.replace(/^models\//i, '');
  if (/^(claude|opus|sonnet|haiku|fable|mythos)/i.test(m)) return 'anthropic';
  if (/^gemini/i.test(m)) return 'gemini';
  if (/^(gpt|openai|o[1-9]|chatgpt)/i.test(m)) return 'openai';
  return 'unknown';
}

// Throw a clear config error if `model` resolves to a provider this seam can't
// route to. `supported` is the list of providers the caller's LLM fn handles.
export function assertProvider(model, supported) {
  const provider = providerFor(model);
  if (provider === 'unknown' || !supported.includes(provider)) {
    throw new LlmProviderError(
      `Model "${model}" resolves to provider "${provider}", which this extract seam cannot route to ` +
      `(supports: ${supported.join(', ')}). Check UNCRAFT_EXTRACT_MODEL / UNCRAFT_LLM_MODEL.`
    );
  }
  return provider;
}

// Race `run(signal)` against a deadline. `run` receives an AbortSignal to pass to
// the provider SDK; the race guarantees the returned promise settles even if the
// SDK ignores the signal. Rejects with LlmTimeoutError on deadline.
export async function withDeadline(run, { ms = DEFAULT_DEADLINE_MS, label = 'llm' } = {}) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch { /* best-effort */ }
      // eslint-disable-next-line no-console
      console.warn(`[llm-deadline] deadline exceeded (${label}, ${ms}ms) — aborting`);
      reject(new LlmTimeoutError(label, ms));
    }, ms);
  });
  const runPromise = Promise.resolve().then(() => run(controller.signal));
  // When the deadline wins the race, the aborted provider call rejects LATER;
  // attach a no-op handler so that late rejection is not an unhandled rejection.
  runPromise.catch(() => {});
  try {
    return await Promise.race([runPromise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
