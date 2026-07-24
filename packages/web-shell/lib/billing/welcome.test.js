// lib/billing/welcome.test.js
import { describe, it, expect, vi } from 'vitest';
import { normalizeEmail, isDisposableEmail, grantWelcomeIfEligible, WELCOME_CREDITS } from './welcome.js';

describe('normalizeEmail', () => {
  it('lowercases and strips plus-suffixes', () => {
    expect(normalizeEmail('Fulano+spam1@Gmail.com')).toBe('fulano@gmail.com');
    expect(normalizeEmail('a.b+x@empresa.com')).toBe('a.b@empresa.com');
  });
});

describe('isDisposableEmail', () => {
  it('flags known disposable domains', () => {
    expect(isDisposableEmail('x@mailinator.com')).toBe(true);
    expect(isDisposableEmail('x@gmail.com')).toBe(false);
  });
});

describe('grantWelcomeIfEligible', () => {
  // Dual-mode like the neon client: individual queries are awaitable (lazy —
  // only consume a result when awaited, not when collected into a transaction),
  // and grantCredits now settles via sql.transaction([...]).
  function scriptedSql(results) {
    let i = 0;
    const sql = () => {
      const q = {};
      q.then = (onF, onR) => Promise.resolve(results[i++] ?? []).then(onF, onR);
      return q;
    };
    sql.transaction = vi.fn(async (queries) => queries.map(() => results[i++] ?? []));
    return sql;
  }
  it('grants 500 to a clean signup', async () => {
    // WELCOME_BUDGET unset → the budget query is SKIPPED. Sequence: prior grant
    // by email → none; ip/device window → none; then grantCredits' atomic
    // transaction (balance UPDATE returning the new balance + ledger INSERT).
    delete process.env.WELCOME_BUDGET_MONTHLY_CREDITS;
    const sql = scriptedSql([[], [], [{ credits_cents: 500 }], []]);
    const out = await grantWelcomeIfEligible({ sql, userId: 'u1', email: 'novo@gmail.com', ip: '1.2.3.4', deviceHash: 'd1' });
    expect(out).toEqual({ granted: true, credits: WELCOME_CREDITS, reason: 'ok' });
    // The grant actually settled (transaction ran + read the post-UPDATE balance).
    expect(sql.transaction).toHaveBeenCalledTimes(1);
  });
  it('denies disposable emails without touching the db', async () => {
    const sql = vi.fn();
    const out = await grantWelcomeIfEligible({ sql, userId: 'u1', email: 'x@mailinator.com', ip: '1.2.3.4', deviceHash: 'd1' });
    expect(out.granted).toBe(false);
    expect(out.reason).toBe('disposable_email');
    expect(sql).not.toHaveBeenCalled();
  });
  it('denies a second pack from the same device/ip window', async () => {
    const sql = scriptedSql([[], [{ n: 1 }]]); // no email match, but ip/device hit
    const out = await grantWelcomeIfEligible({ sql, userId: 'u2', email: 'outro@gmail.com', ip: '1.2.3.4', deviceHash: 'd1' });
    expect(out.granted).toBe(false);
    expect(out.reason).toBe('identity_window');
  });
  it('denies when the global monthly budget is exhausted', async () => {
    process.env.WELCOME_BUDGET_MONTHLY_CREDITS = '1000';
    const sql = scriptedSql([[], [], [{ total: 900 }]]); // 900 + 500 > 1000
    const out = await grantWelcomeIfEligible({ sql, userId: 'u3', email: 'novo3@gmail.com', ip: '9.9.9.9', deviceHash: 'd9' });
    expect(out.granted).toBe(false);
    expect(out.reason).toBe('budget_exhausted');
    delete process.env.WELCOME_BUDGET_MONTHLY_CREDITS;
  });
});
