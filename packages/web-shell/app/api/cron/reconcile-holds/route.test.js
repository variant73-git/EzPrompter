// app/api/cron/reconcile-holds/route.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const reconcileMock = vi.fn(async () => ({ scanned: 2, reconciled: 2, refundedCredits: 350 }));
vi.mock('../../../../lib/db.js', () => ({ db: async () => ({}) }));
vi.mock('../../../../lib/billing/operations.js', () => ({ reconcileStrandedHolds: (...a) => reconcileMock(...a) }));

const { GET } = await import('./route.js');

const makeReq = (auth) => ({ headers: { get: (h) => (h === 'authorization' ? auth : null) } });

beforeEach(() => { reconcileMock.mockClear(); delete process.env.CRON_SECRET; });

describe('GET /api/cron/reconcile-holds', () => {
  it('runs the sweep and returns the summary when no secret is configured (dev)', async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, scanned: 2, reconciled: 2, refundedCredits: 350 });
    expect(reconcileMock).toHaveBeenCalledOnce();
  });

  it('rejects an unauthorized request (401) when CRON_SECRET is set and the Bearer does not match', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await GET(makeReq('Bearer wrong'));
    expect(res.status).toBe(401);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('accepts the matching Bearer secret', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await GET(makeReq('Bearer s3cret'));
    expect(res.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledOnce();
  });
});
