// context.refund.test.js — on a billed-operation FAILURE the hold must be
// restored ATOMICALLY and a refund failure must be surfaced, not swallowed
// (audit 2026-07-23, Sol #3): the old path did refundHold().catch(()=>{}) then
// settle(holdCredits:0) — a transient refund UPDATE failure left the user
// debited behind a clean error.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./pricing.js', () => ({ estimateOp: () => 7, creditsForOperation: () => 3 }));

import { runBilledOperation } from './context.js';

const baseOpts = { sql: async () => [], userId: 'u1', op: 'extract.designmd' };

beforeEach(() => { vi.restoreAllMocks(); });

describe('runBilledOperation — refund on failure', () => {
  const claimed = { claimOperation: vi.fn(async () => ({ outcome: 'claimed', operationId: 'op-1', balance: 100 })), reclaimOperation: vi.fn() };

  it('restores the hold in ONE failed-settle (holdCredits=estimate, chargeCredits=0), not a separate swallowed refund', async () => {
    const refundHold = vi.fn(async () => ({ balance: 107 }));
    const settleOperation = vi.fn(async () => ({ balanceAfter: 107 }));

    await expect(
      runBilledOperation(baseOpts, async () => { throw new Error('boom'); },
        { ...claimed, refundHold, settleOperation })
    ).rejects.toThrow('boom');

    expect(settleOperation).toHaveBeenCalledWith(
      expect.objectContaining({ holdCredits: 7, chargeCredits: 0, opStatus: 'failed' })
    );
    // The atomic settle IS the refund — no reliance on a separate refundHold.
    expect(refundHold).not.toHaveBeenCalled();
  });

  it('surfaces a settle failure on the error path (logs it) instead of swallowing it, and still throws the ORIGINAL error', async () => {
    const settleOperation = vi.fn(async () => { throw new Error('db down'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runBilledOperation(baseOpts, async () => { throw new Error('boom'); },
        { ...claimed, refundHold: vi.fn(), settleOperation })
    ).rejects.toThrow('boom'); // the original failure, NOT the settle error

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/refund|debited|billing/i),
      expect.anything()
    );
  });
});
