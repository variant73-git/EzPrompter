import { describe, expect, it, vi } from 'vitest';
vi.mock('./job-store.js', () => ({
  countOpenForUser: vi.fn(), countOpenSessions: vi.fn(), countTodayForUser: vi.fn(), countTodaySessions: vi.fn(),
}));
vi.mock('../billing/ledger.js', () => ({ getBalance: vi.fn() }));
const store = await import('./job-store.js');
const { getBalance } = await import('../billing/ledger.js');
const { checkChallengeQuota } = await import('./quotas.js');

const env = { UNCRAFT_CHALLENGE_DAILY_FREE: '10', UNCRAFT_CHALLENGE_MAX_OPEN: '2', UNCRAFT_CHALLENGE_MAX_SESSIONS: '10', UNCRAFT_CHALLENGE_DAILY_SESSIONS: '200', UNCRAFT_CHALLENGE_EDIT_RESERVED: '3' };
function counts({ open = 0, sessions = 0, today = 0, todaySessions = 0 } = {}) {
  store.countOpenForUser.mockResolvedValue(open); store.countOpenSessions.mockResolvedValue(sessions);
  store.countTodayForUser.mockResolvedValue(today); store.countTodaySessions.mockResolvedValue(todaySessions);
}

describe('checkChallengeQuota', () => {
  it('reference: daily free quota', async () => { counts({ today: 10 }); expect(await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'reference', env })).toMatchObject({ ok: false, code: 'daily_free_quota', status: 429 }); });
  it('too many open jobs', async () => { counts({ open: 2 }); expect((await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'reference', env })).code).toBe('too_many_open'); });
  it('reference cannot take the sessions reserved for edit; edit can', async () => {
    counts({ sessions: 7 });
    expect((await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'reference', env })).code).toBe('verification_busy');
    getBalance.mockResolvedValue(1000);
    expect((await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'edit', env })).ok).toBe(true);
  });
  it('spend breaker closes the whole path', async () => { counts({ todaySessions: 200 }); expect((await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'edit', env })).code).toBe('spend_breaker'); });
  it('edit pre-checks the balance against the clone.edit estimate (402)', async () => {
    counts(); getBalance.mockResolvedValue(5);
    const r = await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'edit', env });
    expect(r).toMatchObject({ ok: false, code: 'insufficient_credits', status: 402, balance: 5 });
    expect(r.estimate).toBeGreaterThan(5);
  });
});
