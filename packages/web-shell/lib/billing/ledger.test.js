// lib/billing/ledger.test.js
import { describe, it, expect } from 'vitest';
import { holdCredits, refundHold, settleOperation, grantCredits } from './ledger.js';

// Scripted fake: returns queued row-sets in order; records every call's
// template strings so assertions can check the SQL shape.
function fakeSql(results) {
  let i = 0;
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('¶'), values });
    return Promise.resolve(results[i++] ?? []);
  };
  sql.calls = calls;
  return sql;
}

describe('holdCredits', () => {
  it('holds atomically — conditional UPDATE returns the new balance', async () => {
    const sql = fakeSql([[{ credits_cents: 320 }]]);
    const out = await holdCredits({ sql, userId: 'u1', credits: 75 });
    expect(out).toEqual({ held: true, balance: 320 });
    expect(sql.calls[0].text).toContain('COALESCE(credits_cents, 0) >=');
  });
  it('reports a failed hold when the conditional matches no row', async () => {
    const sql = fakeSql([[], [{ c: 10 }]]); // no row updated → balance read (SELECT ... AS c)
    const out = await holdCredits({ sql, userId: 'u1', credits: 75 });
    expect(out.held).toBe(false);
    expect(out.balance).toBe(10);
  });
  it('zero-credit hold is a no-op success', async () => {
    const sql = fakeSql([[{ credits_cents: 50 }]]);
    const out = await holdCredits({ sql, userId: 'u1', credits: 0 });
    expect(out.held).toBe(true);
  });
});

describe('settleOperation', () => {
  it('refunds the difference, inserts events and one charge row', async () => {
    const sql = fakeSql([
      [{ credits_cents: 160 }], // balance adjustment RETURNING
      [],                       // usage_events insert
      [],                       // ledger insert
    ]);
    const out = await settleOperation({
      sql, userId: 'u1', opId: 'op1', op: 'compose',
      events: [{ provider: 'openai', model: 'gpt-5.5', tokensIn: 10, tokensOut: 5, cachedIn: 0, images: 0, costMicrocents: 200000, meta: {} }],
      holdCredits: 75, chargeCredits: 60,
    });
    expect(out.balanceAfter).toBe(160);
    const ledgerCall = sql.calls[2].text;
    expect(ledgerCall).toContain('credit_ledger');
    expect(sql.calls[2].values).toContain(-60); // delta_credits of the charge
  });
});

describe('refundHold / grantCredits', () => {
  it('refund adds the held credits back', async () => {
    const sql = fakeSql([[{ credits_cents: 500 }]]);
    const out = await refundHold({ sql, userId: 'u1', credits: 75 });
    expect(out.balance).toBe(500);
  });
  it('grant writes a ledger row with balance_after', async () => {
    const sql = fakeSql([[{ credits_cents: 500 }], []]);
    const out = await grantCredits({ sql, userId: 'u1', credits: 500, reason: 'welcome', meta: {} });
    expect(out.balanceAfter).toBe(500);
    expect(sql.calls[1].values).toContain('welcome');
  });
});
