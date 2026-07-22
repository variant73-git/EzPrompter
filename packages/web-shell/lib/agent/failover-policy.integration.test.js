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
 * breakerFor() (app/api/chat/route.js:76-78), and opossum runs the registered
 * fallback() on ANY action failure — not only when the circuit is open
 * (node_modules/opossum/lib/circuit.js handleError → fallback). circuit.js's
 * fallback() rethrew every error as code='circuit_open', which
 * driver.js isRetriableProviderError treats as failover-eligible.
 *
 * WITNESS (2026-07-22, pre-fix): an Anthropic 400 "credit balance too low" —
 * a non-retriable client error by the driver's own written policy — was
 * masked into circuit_open and triggered silent failover. A clone forced to
 * Opus degraded to Flash without telling anyone. The assertions in the
 * "WITNESS" test below document that bug verbatim; the structural fix
 * (error taxonomy + honest breaker + per-operation failover policy) must
 * invert them.
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

describe('breaker→driver composition (real opossum, real circuit.js)', () => {
  it('WITNESS: Anthropic balance-400 through the breaker triggers silent failover (THE BUG)', async () => {
    const anthropic = vi.fn(async () => { throw anthropicBalanceError(); });
    const wrappedAnthropic = freshBreaker(anthropic);
    const flash = okLLM('flash took over');

    const events = [];
    const result = await runAgentLoop({
      llm: wrappedAnthropic,
      providerLabel: 'anthropic',
      fallbacks: [{ llm: flash, modelId: 'gemini-2.5-flash', apiKey: 'k2', tools: [], label: 'gemini' }],
      registry: reg,
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'clone this site' }],
      modelId: 'claude-opus-4-7',
      apiKey: 'k',
      ctx: {},
      onEvent: (e) => events.push(e),
      maxIterations: 5,
    });

    // ── CURRENT (buggy) behaviour — this test PASSING proves the bug. ──
    // The 400 is not retriable by the driver's own policy, yet the breaker's
    // fallback() rewrote it as circuit_open, so the driver failed over and
    // Flash silently completed a run the user believes ran on Opus.
    const failover = events.find((e) => e.type === 'provider_failover');
    expect(failover).toBeTruthy();
    expect(failover.reason).toBe('circuit_open');
    expect(flash).toHaveBeenCalledTimes(1);
    expect(result.stop_reason).toBe('end_turn');
  });

  it('control: the same 400 WITHOUT the breaker fails fast (existing covered path)', async () => {
    const anthropic = vi.fn(async () => { throw anthropicBalanceError(); });
    const flash = okLLM();

    const events = [];
    const result = await runAgentLoop({
      llm: anthropic, // unwrapped — how the old tests exercised it
      providerLabel: 'anthropic',
      fallbacks: [{ llm: flash, modelId: 'gemini-2.5-flash', apiKey: 'k2', tools: [], label: 'gemini' }],
      registry: reg,
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'clone this site' }],
      modelId: 'claude-opus-4-7',
      apiKey: 'k',
      ctx: {},
      onEvent: (e) => events.push(e),
      maxIterations: 5,
    });

    expect(flash).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'provider_failover')).toBe(false);
    expect(result.stop_reason).toBe('failed');
  });
});
