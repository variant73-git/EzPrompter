import { describe, it, expect, vi } from 'vitest';
import { breakerFor } from './circuit.js';

/**
 * Honest-breaker contract (real opossum, no mocks):
 *   1. Failures cross with the ORIGINAL error + category stamp — never
 *      rewritten as circuit_open while the circuit is closed.
 *   2. Deterministic our-side failures (balance/auth/malformed) do NOT count
 *      toward tripping — the adapter keeps being invoked.
 *   3. Health failures (outage) DO trip it; only then does the caller see
 *      code='circuit_open', and the adapter is NOT invoked.
 */

let seq = 0;
const fresh = (fn) => breakerFor(`circuit-test-${++seq}`, fn);

const balanceErr = () => Object.assign(
  new Error('400 Your credit balance is too low to access the Anthropic API.'),
  { status: 400 },
);
const outageErr = () => Object.assign(new Error('Service Unavailable'), { status: 503 });

describe('breakerFor — honest error contract', () => {
  it('closed circuit: original error crosses, categorized, NOT circuit_open', async () => {
    const call = fresh(vi.fn(async () => { throw balanceErr(); }));
    await expect(call()).rejects.toMatchObject({
      status: 400,
      providerErrorCategory: 'provider_balance',
    });
    await expect(call()).rejects.not.toMatchObject({ code: 'circuit_open' });
  });

  it('balance errors never trip the breaker — adapter still invoked past the volume threshold', async () => {
    const adapter = vi.fn(async () => { throw balanceErr(); });
    const call = fresh(adapter);
    // volumeThreshold is 5; 8 deterministic billing failures in a row.
    for (let i = 0; i < 8; i++) await expect(call()).rejects.toMatchObject({ status: 400 });
    // Still CLOSED: the 9th call reaches the adapter instead of failing fast.
    await expect(call()).rejects.toMatchObject({ status: 400 });
    expect(adapter).toHaveBeenCalledTimes(9);
  });

  it('outages DO trip it — then callers get circuit_open WITHOUT the adapter being hit', async () => {
    const adapter = vi.fn(async () => { throw outageErr(); });
    const call = fresh(adapter);
    for (let i = 0; i < 8; i++) await expect(call()).rejects.toBeTruthy();
    const callsBeforeOpen = adapter.mock.calls.length;
    // Breaker is now OPEN: synthesized circuit_open, no adapter invocation.
    await expect(call()).rejects.toMatchObject({
      code: 'circuit_open',
      providerErrorCategory: 'circuit_open',
    });
    expect(adapter).toHaveBeenCalledTimes(callsBeforeOpen);
  });

  it('successful calls pass values through untouched', async () => {
    const call = fresh(async (x) => ({ echoed: x }));
    await expect(call('hi')).resolves.toEqual({ echoed: 'hi' });
  });
});
