// lib/billing/context.test.js
import { describe, it, expect, vi } from 'vitest';
import { runBilledOperation, runIdempotentOperation, runMeteredOperation, recordUsage, recordImage, InsufficientCreditsError, OperationInProgressError } from './context.js';

// One injected deps object provides BOTH the ledger (settleOperation) and the
// operations lifecycle (claimOperation / reclaimOperation) — context.js reads
// `deps` for both.
function fakeDeps({ claim, reclaim, balance = 1000 } = {}) {
  return {
    claimOperation: vi.fn(async () => claim ?? { outcome: 'claimed', operationId: 'op-1', balance }),
    reclaimOperation: vi.fn(async () => reclaim ?? { outcome: 'reclaimed', operationId: 'op-1', balance }),
    settleOperation: vi.fn(async ({ chargeCredits }) => ({ balanceAfter: balance - chargeCredits })),
    // Legacy primitives — must NOT be called by the new flow.
    holdCredits: vi.fn(async () => ({ held: true, balance })),
    refundHold: vi.fn(async () => ({ balance })),
  };
}
const sql = () => Promise.resolve([]);

describe('runBilledOperation', () => {
  it('claims, meters usage recorded deep in the call stack, and charges once', async () => {
    const deps = fakeDeps();
    const out = await runBilledOperation({ sql, userId: 'u1', op: 'compose' }, async () => {
      recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 20000, tokensOut: 6000 });
      return 'built';
    }, deps);
    // 20k in ($0.10) + 6k out ($0.09) = 190,000 µ¢ × 3 = 57¢ → 60 credits
    expect(out.result).toBe('built');
    expect(out.credits).toBe(60);
    expect(out.deduped).toBe(false);
    expect(deps.claimOperation).toHaveBeenCalledOnce();
    expect(deps.settleOperation).toHaveBeenCalledOnce();
    expect(deps.settleOperation.mock.calls[0][0]).toMatchObject({ opStatus: 'settled', opId: 'op-1' });
    expect(deps.holdCredits).not.toHaveBeenCalled();
  });

  it('throws 402 BEFORE running fn when the claim reports insufficient balance', async () => {
    const deps = fakeDeps({ claim: { outcome: 'insufficient', balance: 10 } });
    const fn = vi.fn();
    await expect(runBilledOperation({ sql, userId: 'u1', op: 'compose' }, fn, deps))
      .rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(fn).not.toHaveBeenCalled();
    expect(deps.settleOperation).not.toHaveBeenCalled();
  });

  it('refunds the hold via an atomic failed-settle (charge 0) and rethrows when fn throws', async () => {
    const deps = fakeDeps();
    await expect(runBilledOperation({ sql, userId: 'u1', op: 'compose' }, async () => {
      recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 1000, tokensOut: 100 });
      throw new Error('llm exploded');
    }, deps)).rejects.toThrow('llm exploded');
    // The hold is restored by the settle itself (holdCredits=estimate → the settle
    // UPDATE adds it back) at zero charge, and the row is flipped to failed — not a
    // separate, swallowable refundHold.
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ holdCredits: 75, chargeCredits: 0, opStatus: 'failed' }));
    expect(deps.refundHold).not.toHaveBeenCalled();
  });

  it('records images with quality pricing', async () => {
    const deps = fakeDeps();
    const out = await runBilledOperation({ sql, userId: 'u1', op: 'image.generate' }, async () => {
      recordImage({ provider: 'openai', model: 'gpt-image-1', quality: 'high' });
    }, deps);
    expect(out.credits).toBe(100); // 250,000 µ¢ × 4 = 100¢ → 100 credits
  });
});

describe('idempotency (retry dedup)', () => {
  it('replays the stored response and charges NOTHING when the same key already settled', async () => {
    const deps = fakeDeps({ claim: { outcome: 'duplicate', row: { id: 'op-1', status: 'settled', charge_credits: 240, result: { response: { node: 'n-9' } } } } });
    const fn = vi.fn();
    const out = await runIdempotentOperation({ sql, userId: 'u1', op: 'extract.clone', idemKey: 'ticket-abc' }, fn, deps);
    expect(out).toMatchObject({ result: { node: 'n-9' }, credits: 240, deduped: true, opId: 'op-1' });
    expect(fn).not.toHaveBeenCalled();          // the work never re-runs
    expect(deps.settleOperation).not.toHaveBeenCalled(); // nothing charged
  });

  it('throws 409 in-progress when the same key is still running', async () => {
    const deps = fakeDeps({ claim: { outcome: 'duplicate', row: { id: 'op-1', status: 'in_flight' } } });
    const fn = vi.fn();
    await expect(runIdempotentOperation({ sql, userId: 'u1', op: 'extract.clone', idemKey: 't1' }, fn, deps))
      .rejects.toBeInstanceOf(OperationInProgressError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('reclaims a failed row and re-runs the work', async () => {
    const deps = fakeDeps({
      claim: { outcome: 'duplicate', row: { id: 'op-1', status: 'failed' } },
      reclaim: { outcome: 'reclaimed', operationId: 'op-1', balance: 700 },
    });
    const fn = vi.fn(async () => 'rebuilt');
    const out = await runIdempotentOperation({ sql, userId: 'u1', op: 'extract.clone', idemKey: 't1' }, fn, deps);
    expect(deps.reclaimOperation).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledOnce();
    expect(out.result).toBe('rebuilt');
    expect(out.deduped).toBe(false);
  });

  it('stores a replayable response (wrapped) on settle when a ticket is present', async () => {
    const deps = fakeDeps();
    await runIdempotentOperation({ sql, userId: 'u1', op: 'extract.clone', idemKey: 't1' }, async () => ({ node: 'n-1' }), deps);
    expect(deps.settleOperation.mock.calls[0][0]).toMatchObject({ result: { response: { node: 'n-1' } }, opStatus: 'settled' });
  });
});

describe('nesting (innermost wins)', () => {
  it('chat outer stays free (no operations row) while the inner tool op claims + charges', async () => {
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
    // Metered outer never claims an operations row (lightweight path); only the inner paid op does.
    expect(deps.claimOperation).toHaveBeenCalledOnce();
    // outer settle got ONLY the conversation event (1), not the tool's, and no operations transition
    const outerSettle = deps.settleOperation.mock.calls.find((c) => c[0].op === 'chat');
    expect(outerSettle[0].events).toHaveLength(1);
    expect(outerSettle[0].opStatus).toBeNull();
  });
});

describe('recordUsage outside any context', () => {
  it('is a silent no-op', () => {
    expect(() => recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 1 })).not.toThrow();
  });
});
