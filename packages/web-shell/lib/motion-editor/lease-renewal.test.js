import { describe, expect, it } from 'vitest';
import { LEASE_RENEW_MARGIN_MS, decideRenewOutcome } from './lease-renewal.js';

const base = { now: 1_000_000, expiresAtMs: 1_000_000 + 4 * 3.6e6, consecutiveFailures: 0 };

describe('decideRenewOutcome', () => {
  it('a successful renew is ok', () => {
    expect(decideRenewOutcome({ ...base, ok: true, status: 200 })).toEqual({ action: 'ok' });
  });

  it('a terminal authenticated refusal (401/403/409) masks immediately, even far from expiry', () => {
    for (const status of [401, 403, 409]) {
      expect(decideRenewOutcome({ ...base, ok: false, status })).toMatchObject({ action: 'mask', reason: 'terminal' });
    }
  });

  it('a transient failure (network/5xx) far from expiry backs off instead of masking', () => {
    expect(decideRenewOutcome({ ...base, ok: false, status: 0 })).toMatchObject({ action: 'backoff', delayMs: 30_000 });
    expect(decideRenewOutcome({ ...base, ok: false, status: 503 })).toMatchObject({ action: 'backoff' });
  });

  it('backoff grows with consecutive failures and caps at 120s', () => {
    expect(decideRenewOutcome({ ...base, ok: false, status: 500, consecutiveFailures: 0 }).delayMs).toBe(30_000);
    expect(decideRenewOutcome({ ...base, ok: false, status: 500, consecutiveFailures: 1 }).delayMs).toBe(60_000);
    expect(decideRenewOutcome({ ...base, ok: false, status: 500, consecutiveFailures: 2 }).delayMs).toBe(120_000);
    expect(decideRenewOutcome({ ...base, ok: false, status: 500, consecutiveFailures: 9 }).delayMs).toBe(120_000);
  });

  it('a transient failure WITHIN the margin of expiry masks (the lease is really about to die)', () => {
    const now = base.expiresAtMs - LEASE_RENEW_MARGIN_MS + 1;
    expect(decideRenewOutcome({ ...base, now, ok: false, status: 0 })).toMatchObject({ action: 'mask', reason: 'expiring' });
  });
});
