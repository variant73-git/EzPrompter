import { describe, it, expect, vi } from 'vitest';
import { APIError } from '@anthropic-ai/sdk';
import { runAgentLoop } from './driver.js';
import { Registry } from './registry.js';
import { breakerFor } from './circuit.js';

/**
 * Integration tests for the REAL breaker→driver composition.
 *
 * Every prior "400 does not fall over" test mocked the LLM adapter directly,
 * BYPASSING the circuit breaker. Production wraps every adapter in
 * breakerFor() (app/api/chat/route.js:76-78), and opossum runs a registered
 * fallback() on ANY action failure — not only when the circuit is open.
 * circuit.js's old fallback() rethrew every error as code='circuit_open',
 * which the driver treats as failover-eligible.
 *
 * WITNESS HISTORY (commit 356dceae, 2026-07-22): the first version of this
 * file PROVED the bug — an Anthropic 400 "credit balance too low" masked
 * into circuit_open, silently failing a clone-on-Opus over to Flash. The
 * error-taxonomy fix inverted those assertions into the contract below:
 *   - the breaker lets the ORIGINAL error through, stamped with a category;
 *   - provider_balance IS failover-eligible — but with an HONEST reason;
 *   - a genuinely malformed request (invalid_request) NEVER fails over,
 *     breaker or no breaker.
 */

const reg = new Registry();
reg.register({
  name: 'noop',
  description: 'no-op',
  classification: 'safe',
  inputSchema: { type: 'object' },
  async execute() { return { ok: true }; },
});

/** Error exactly as the installed @anthropic-ai/sdk surfaces a depleted-
 *  balance 400 (verified against APIError.generate on this SDK version). */
function anthropicBalanceError() {
  return APIError.generate(400, {
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    },
  }, undefined, new Headers());
}

/** A genuinely malformed request — same SDK class, no balance wording. */
function anthropicInvalidRequestError() {
  return APIError.generate(400, {
    type: 'error',
    error: { type: 'invalid_request_error', message: 'max_tokens: must be greater than 0' },
  }, undefined, new Headers());
}

/** A well-behaved fallback provider (the Flash slot in the generic chain). */
function okLLM(text = 'ok') {
  return vi.fn(async ({ onEvent }) => {
    onEvent({ type: 'message_complete', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
  });
}

/** Fresh breaker per test — breakers are process singletons keyed by name
 *  (stashed on globalThis), so reusing a name would leak state across tests. */
let breakerSeq = 0;
function freshBreaker(fn) {
  breakerSeq += 1;
  return breakerFor(`itest-provider-${breakerSeq}`, fn);
}

function runWith({ llm, fallbacks, message = 'clone this site' }) {
  const events = [];
  const resultPromise = runAgentLoop({
    llm,
    providerLabel: 'anthropic',
    fallbacks,
    registry: reg,
    systemPrompt: 's',
    messages: [{ role: 'user', content: message }],
    modelId: 'claude-opus-4-7',
    apiKey: 'k',
    ctx: {},
    onEvent: (e) => events.push(e),
    maxIterations: 5,
  });
  return resultPromise.then((result) => ({ result, events }));
}

describe('breaker→driver composition (real opossum, real circuit.js)', () => {
  it('balance-400 through the breaker fails over with the HONEST reason, not circuit_open', async () => {
    const anthropic = vi.fn(async () => { throw anthropicBalanceError(); });
    const nextProvider = okLLM('fallback took over');

    const { result, events } = await runWith({
      llm: freshBreaker(anthropic),
      fallbacks: [{ llm: nextProvider, modelId: 'gpt-5.5', apiKey: 'k2', tools: [], label: 'openai' }],
    });

    const failover = events.find((e) => e.type === 'provider_failover');
    expect(failover).toBeTruthy();
    expect(failover.reason).toBe('provider_balance');   // was: 'circuit_open' (the mask)
    expect(nextProvider).toHaveBeenCalledTimes(1);
    expect(result.stop_reason).toBe('end_turn');
  });

  it('invalid_request-400 through the breaker fails FAST — no failover, original error intact', async () => {
    let seen = null;
    const anthropic = vi.fn(async () => { throw anthropicInvalidRequestError(); });
    const wrapped = freshBreaker(anthropic);
    // Peek at what actually crosses the breaker before handing it to the driver.
    const peeking = async (args) => {
      try { return await wrapped(args); } catch (e) { seen = e; throw e; }
    };
    const nextProvider = okLLM();

    const { result, events } = await runWith({
      llm: peeking,
      fallbacks: [{ llm: nextProvider, modelId: 'gemini-2.5-flash', apiKey: 'k2', tools: [], label: 'gemini' }],
    });

    expect(events.some((e) => e.type === 'provider_failover')).toBe(false);
    expect(nextProvider).not.toHaveBeenCalled();
    expect(result.stop_reason).toBe('failed');
    // The breaker preserved the SDK error instead of synthesizing its own.
    expect(seen.status).toBe(400);
    expect(seen.code).not.toBe('circuit_open');
    expect(seen.providerErrorCategory).toBe('invalid_request');
  });

  it('control: the same balance-400 WITHOUT the breaker behaves identically (no divergence)', async () => {
    const anthropic = vi.fn(async () => { throw anthropicBalanceError(); });
    const nextProvider = okLLM();

    const { events } = await runWith({
      llm: anthropic, // unwrapped
      fallbacks: [{ llm: nextProvider, modelId: 'gpt-5.5', apiKey: 'k2', tools: [], label: 'openai' }],
    });

    const failover = events.find((e) => e.type === 'provider_failover');
    expect(failover).toBeTruthy();
    expect(failover.reason).toBe('provider_balance');
    expect(nextProvider).toHaveBeenCalledTimes(1);
  });
});
