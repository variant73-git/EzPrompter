// lib/billing/ledger.test.js
import { describe, it, expect, vi } from 'vitest';
import { holdCredits, refundHold, settleOperation, grantCredits } from './ledger.js';

// Scripted fake: records every call's template strings so assertions can check
// the SQL shape, and returns queued row-sets in order. Dual-mode, mirroring the
// neon client: an individual `sql`…`` is awaitable (lazily consumes one queued
// result), and `sql.transaction([...])` runs a batch atomically (one queued
// result per query). Multi-statement writes (settle, grant) MUST go through
// transaction — that is the atomicity the ledger relies on.
function fakeSql(results, { txFails = false } = {}) {
  let i = 0;
  const calls = [];
  const sql = (strings, ...values) => {
    const q = { text: strings.join('¶'), values };
    calls.push(q);
    // Lazy thenable: only consumes a result if actually awaited (individual
    // queries) — NOT when merely collected into a transaction() array.
    q.then = (onF, onR) => Promise.resolve(results[i++] ?? []).then(onF, onR);
    return q;
  };
  sql.calls = calls;
  sql.transaction = vi.fn(async (queries) => {
    if (txFails) throw new Error('transaction failed (db down)');
    return queries.map(() => results[i++] ?? []);
  });
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
  it('runs balance + events + charge as ONE atomic transaction (no partial-state possible)', async () => {
    const sql = fakeSql([
      [{ credits_cents: 160 }], // UPDATE ... RETURNING (first tx result)
      [],                       // usage_events insert
      [],                       // credit_ledger insert
    ]);
    const out = await settleOperation({
      sql, userId: 'u1', opId: 'op1', op: 'compose',
      events: [{ provider: 'openai', model: 'gpt-5.5', tokensIn: 10, tokensOut: 5, cachedIn: 0, images: 0, costMicrocents: 200000, meta: {} }],
      holdCredits: 75, chargeCredits: 60,
    });
    expect(out.balanceAfter).toBe(160);
    // Atomicity: the whole settlement is a SINGLE transaction of 3 queries
    // (balance UPDATE + 1 usage_event + 1 charge row) — not separate awaited writes.
    expect(sql.transaction).toHaveBeenCalledTimes(1);
    expect(sql.transaction.mock.calls[0][0]).toHaveLength(3);
    const built = sql.calls.map((c) => c.text).join(' | ');
    expect(built).toContain('UPDATE users');
    expect(built).toContain('usage_events');
    expect(built).toContain('credit_ledger');
    // The charge row's delta is the negative charge, and balance_after reads the
    // post-UPDATE balance from WITHIN the transaction (a subquery, not JS state).
    const ledgerCall = sql.calls.find((c) => c.text.includes('credit_ledger'));
    expect(ledgerCall.values).toContain(-60);
    expect(ledgerCall.text).toMatch(/SELECT credits_cents FROM users/i);
  });

  it('omits the charge row when nothing is charged (refund path)', async () => {
    const sql = fakeSql([[{ credits_cents: 200 }]]);
    const out = await settleOperation({ sql, userId: 'u1', opId: 'op1', op: 'compose', events: [], holdCredits: 40, chargeCredits: 0 });
    expect(out.balanceAfter).toBe(200);
    expect(sql.transaction.mock.calls[0][0]).toHaveLength(1); // just the balance UPDATE
    expect(sql.calls.some((c) => c.text.includes('credit_ledger'))).toBe(false);
  });

  it('a failed transaction REJECTS (all-or-nothing) so the caller can surface it — never a half-applied settle', async () => {
    const sql = fakeSql([], { txFails: true });
    await expect(settleOperation({
      sql, userId: 'u1', opId: 'op1', op: 'compose', events: [], holdCredits: 75, chargeCredits: 0,
    })).rejects.toThrow(/transaction failed/);
  });

  it('FENCED settle: transitions the row to SETTLED guarded on in_flight, derives the balance from the ROW hold_credits, stores the replay result', async () => {
    const sql = fakeSql([[{ balance: 10, fenced: true }]]);
    const out = await settleOperation({
      sql, userId: 'u1', opId: 'op-1', op: 'extract.clone', events: [], holdCredits: 250, chargeCredits: 240,
      opStatus: 'settled', result: { node: 'n-9' },
    });
    expect(out).toMatchObject({ fenced: true });
    // ONE fenced CTE (no events) — guarded flip + gated balance + gated charge row.
    expect(sql.transaction.mock.calls[0][0]).toHaveLength(1);
    const cte = sql.calls[0].text;
    expect(cte).toContain("status = 'settled'");
    expect(cte).toContain("WHERE id = ¶ AND status = 'in_flight'"); // the fence
    expect(cte).toContain('(SELECT hold_credits FROM claimed)');    // balance from the row, not the passed estimate
    expect(cte).toContain('EXISTS (SELECT 1 FROM claimed)');        // balance + charge gated on the flip
    expect(sql.calls[0].values).toContain(JSON.stringify({ node: 'n-9' }));
  });

  it('FENCED settle: a row already terminalized (reconciled) does NOT move money — fenced=false', async () => {
    const sql = fakeSql([[{ balance: null, fenced: false }]]);
    const out = await settleOperation({
      sql, userId: 'u1', opId: 'op-1', op: 'extract.clone', events: [], holdCredits: 250, chargeCredits: 240,
      opStatus: 'settled', result: { node: 'n-9' },
    });
    expect(out.fenced).toBe(false); // reconcile got there first → no resurrection, no double refund
  });

  it('FENCED settle: FAILED refunds the full hold from the row, guarded on in_flight', async () => {
    const sql = fakeSql([[{ balance: 500, fenced: true }]]);
    await settleOperation({
      sql, userId: 'u1', opId: 'op-1', op: 'extract.clone', events: [], holdCredits: 250, chargeCredits: 0,
      opStatus: 'failed',
    });
    const cte = sql.calls[0].text;
    expect(cte).toContain("status = 'failed'");
    expect(cte).toContain("AND status = 'in_flight'");
    expect(cte).toContain('(SELECT hold_credits FROM claimed)'); // full-hold refund from the row
  });

  it('LEGACY settle (opStatus absent): unconditional, no operations row touched', async () => {
    const sql = fakeSql([[{ credits_cents: 160 }], []]);
    await settleOperation({ sql, userId: 'u1', opId: 'op1', op: 'compose', events: [], holdCredits: 40, chargeCredits: 30 });
    expect(sql.calls.some((c) => c.text.includes('UPDATE operations'))).toBe(false);
  });
});

describe('refundHold / grantCredits', () => {
  it('refund adds the held credits back', async () => {
    const sql = fakeSql([[{ credits_cents: 500 }]]);
    const out = await refundHold({ sql, userId: 'u1', credits: 75 });
    expect(out.balance).toBe(500);
  });
  it('grant writes balance + ledger row as ONE atomic transaction', async () => {
    const sql = fakeSql([[{ credits_cents: 500 }], []]);
    const out = await grantCredits({ sql, userId: 'u1', credits: 500, reason: 'welcome', meta: {} });
    expect(out.balanceAfter).toBe(500);
    expect(sql.transaction).toHaveBeenCalledTimes(1);
    expect(sql.transaction.mock.calls[0][0]).toHaveLength(2);
    const ledgerCall = sql.calls.find((c) => c.text.includes('credit_ledger'));
    expect(ledgerCall.values).toContain('welcome');
  });
});
