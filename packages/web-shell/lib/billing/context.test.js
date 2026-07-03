// lib/billing/context.test.js
import { describe, it, expect, vi } from 'vitest';
import { runBilledOperation, runMeteredOperation, recordUsage, recordImage, InsufficientCreditsError } from './context.js';

function fakeDeps({ heldOk = true, balance = 1000 } = {}) {
  return {
    holdCredits: vi.fn(async () => ({ held: heldOk, balance })),
    refundHold: vi.fn(async () => ({ balance })),
    settleOperation: vi.fn(async ({ chargeCredits }) => ({ balanceAfter: balance - chargeCredits })),
  };
}
const sql = () => Promise.resolve([]);

describe('runBilledOperation', () => {
  it('meters usage recorded deep in the call stack and charges once', async () => {
    const deps = fakeDeps();
    const out = await runBilledOperation({ sql, userId: 'u1', op: 'compose' }, async () => {
      // deep code records without receiving userId
      recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 20000, tokensOut: 6000 });
      return 'built';
    }, deps);
    // 20k in ($0.10) + 6k out ($0.09) = 190,000 µ¢ × 3 = 57¢ → 60 credits
    expect(out.result).toBe('built');
    expect(out.credits).toBe(60);
    expect(deps.settleOperation).toHaveBeenCalledOnce();
  });
  it('throws 402 BEFORE running fn when the hold fails', async () => {
    const deps = fakeDeps({ heldOk: false, balance: 10 });
    const fn = vi.fn();
    await expect(runBilledOperation({ sql, userId: 'u1', op: 'compose' }, fn, deps))
      .rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(fn).not.toHaveBeenCalled();
  });
  it('refunds the whole hold and rethrows when fn throws (failure never charges)', async () => {
    const deps = fakeDeps();
    await expect(runBilledOperation({ sql, userId: 'u1', op: 'compose' }, async () => {
      recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 1000, tokensOut: 100 });
      throw new Error('llm exploded');
    }, deps)).rejects.toThrow('llm exploded');
    expect(deps.refundHold).toHaveBeenCalled();
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ chargeCredits: 0 }));
  });
  it('records images with quality pricing', async () => {
    const deps = fakeDeps();
    const out = await runBilledOperation({ sql, userId: 'u1', op: 'image.generate' }, async () => {
      recordImage({ provider: 'openai', model: 'gpt-image-1', quality: 'high' });
    }, deps);
    expect(out.credits).toBe(100); // 250,000 µ¢ × 4 = 100¢ → 100 credits
  });
});

describe('nesting (innermost wins)', () => {
  it('chat outer stays free while the inner tool op charges its own price', async () => {
    const deps = fakeDeps();
    const outer = await runMeteredOperation({ sql, userId: 'u1', op: 'chat' }, async () => {
      recordUsage({ provider: 'gemini', model: 'gemini-2.5-flash', tokensIn: 12000, tokensOut: 800 }); // conversation
      const inner = await runBilledOperation({ sql, userId: 'u1', op: 'compose' }, async () => {
        recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 20000, tokensOut: 6000 });
      }, deps);
      return inner;
    }, deps);
    expect(outer.credits).toBe(0);                 // conversation free
    expect(outer.result.credits).toBe(60);         // inner op charged
    // outer settle got ONLY the conversation event (1), not the tool's
    const outerSettle = deps.settleOperation.mock.calls.find((c) => c[0].op === 'chat');
    expect(outerSettle[0].events).toHaveLength(1);
  });
});

describe('recordUsage outside any context', () => {
  it('is a silent no-op', () => {
    expect(() => recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 1 })).not.toThrow();
  });
});
