// lib/billing/operations.test.js
import { describe, it, expect } from 'vitest';
import {
  claimOperation, reclaimOperation, getOperation,
  reconcileStrandedHold, reconcileStrandedHolds,
} from './operations.js';

// Same scripted fake as ledger.test.js: each awaited sql`` consumes one queued
// result-set in order. Records the built SQL text so we can assert the shape.
function fakeSql(results) {
  let i = 0;
  const calls = [];
  const sql = (strings, ...values) => {
    const q = { text: strings.join('¶'), values };
    calls.push(q);
    q.then = (onF, onR) => Promise.resolve(results[i++] ?? []).then(onF, onR);
    return q;
  };
  sql.calls = calls;
  return sql;
}

describe('claimOperation', () => {
  it('claims + holds in ONE atomic statement and returns the operation id', async () => {
    const sql = fakeSql([[{ op_id: 'op-1', balance: 925 }]]);
    const out = await claimOperation({ sql, userId: 'u1', idemKey: 'k1', op: 'extract.clone', estimate: 250 });
    expect(out).toEqual({ outcome: 'claimed', operationId: 'op-1', balance: 925 });
    // Single statement: insert-if-affordable-and-no-conflict + deduct the hold,
    // under a FOR UPDATE lock on the balance row so concurrent claims serialize
    // (no stale-snapshot overspend).
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).toContain('INSERT INTO operations');
    expect(sql.calls[0].text).toContain('ON CONFLICT');
    expect(sql.calls[0].text).toContain('UPDATE users SET credits_cents');
    expect(sql.calls[0].text).toContain('FOR UPDATE');
  });

  it('reports a DUPLICATE when a row already exists for the key (dedup path)', async () => {
    const sql = fakeSql([
      [{ op_id: null, balance: null }],                                   // CTE: no insert (conflict)
      [{ id: 'op-1', status: 'settled', charge_credits: 250, result: { response: { ok: true } } }], // existing row
    ]);
    const out = await claimOperation({ sql, userId: 'u1', idemKey: 'k1', op: 'extract.clone', estimate: 250 });
    expect(out.outcome).toBe('duplicate');
    expect(out.row.status).toBe('settled');
    expect(out.row.result.response).toEqual({ ok: true });
  });

  it('reports INSUFFICIENT when no row exists and the balance filter blocked the insert', async () => {
    const sql = fakeSql([
      [{ op_id: null, balance: null }], // CTE: balance too low → no insert
      [],                               // no existing row
      [{ c: 5 }],                       // balance read
    ]);
    const out = await claimOperation({ sql, userId: 'u1', idemKey: 'k1', op: 'extract.clone', estimate: 250 });
    expect(out).toEqual({ outcome: 'insufficient', balance: 5 });
  });

  it('a zero estimate still claims a row (unbilled/free ops get a durable record)', async () => {
    const sql = fakeSql([[{ op_id: 'op-9', balance: 1000 }]]);
    const out = await claimOperation({ sql, userId: 'u1', idemKey: 'k9', op: 'chat', estimate: 0 });
    expect(out.outcome).toBe('claimed');
  });
});

describe('reclaimOperation', () => {
  it('flips a failed/expired row back to in_flight and re-holds', async () => {
    const sql = fakeSql([[{ op_id: 'op-1', balance: 700 }]]);
    const out = await reclaimOperation({ sql, userId: 'u1', idemKey: 'k1', estimate: 250 });
    expect(out).toEqual({ outcome: 'reclaimed', operationId: 'op-1', balance: 700 });
    expect(sql.calls[0].text).toContain("status IN ('failed', 'expired')");
    expect(sql.calls[0].text).toContain('FOR UPDATE');
    // created_at is RESET so the new attempt gets a fresh reconciliation lease
    // (a day-old reclaimed row must not be swept as stranded).
    expect(sql.calls[0].text).toContain('created_at = NOW()');
  });

  it('reports RACED when the row is no longer failed/expired (someone else moved it)', async () => {
    const sql = fakeSql([
      [{ op_id: null, balance: null }],                 // CTE didn't fire
      [{ id: 'op-1', status: 'in_flight' }],            // re-read: now in_flight
    ]);
    const out = await reclaimOperation({ sql, userId: 'u1', idemKey: 'k1', estimate: 250 });
    expect(out.outcome).toBe('raced');
    expect(out.row.status).toBe('in_flight');
  });

  it('reports INSUFFICIENT when the row is still failed but the balance blocked the re-hold', async () => {
    const sql = fakeSql([
      [{ op_id: null, balance: null }],                 // CTE didn't fire (balance guard)
      [{ id: 'op-1', status: 'failed' }],               // re-read: still failed
      [{ c: 10 }],                                      // balance read
    ]);
    const out = await reclaimOperation({ sql, userId: 'u1', idemKey: 'k1', estimate: 250 });
    expect(out).toEqual({ outcome: 'insufficient', balance: 10 });
  });
});

describe('getOperation', () => {
  it('returns the row or null', async () => {
    const sql = fakeSql([[{ id: 'op-1', status: 'settled', result: { response: 1 } }]]);
    expect(await getOperation({ sql, userId: 'u1', idemKey: 'k1' })).toMatchObject({ status: 'settled' });
    const empty = fakeSql([[]]);
    expect(await getOperation({ sql: empty, userId: 'u1', idemKey: 'x' })).toBeNull();
  });
});

describe('reconcileStrandedHold', () => {
  it('refunds + expires an in_flight row race-safely in ONE statement, returns the refunded credits', async () => {
    const sql = fakeSql([[{ refunded: 250 }]]);
    const out = await reconcileStrandedHold({ sql, operationId: 'op-1' });
    expect(out).toEqual({ refunded: 250 });
    // Race-safe: the status flip is guarded WHERE status='in_flight' inside the CTE.
    expect(sql.calls[0].text).toContain("status = 'in_flight'");
    // NO credit_ledger row — the matching hold debit was never journaled (holds
    // are transient), so journaling the refund would drift SUM(credit_ledger).
    expect(sql.calls[0].text).not.toContain('credit_ledger');
  });

  it('refunds nothing when another sweep already moved the row', async () => {
    const sql = fakeSql([[{ refunded: 0 }]]);
    const out = await reconcileStrandedHold({ sql, operationId: 'op-1' });
    expect(out.refunded).toBe(0);
  });
});

describe('reconcileStrandedHolds (sweep)', () => {
  it('scans stale in_flight rows and reconciles each', async () => {
    const sql = fakeSql([
      [{ id: 'op-1', user_id: 'u1', hold_credits: 250 }, { id: 'op-2', user_id: 'u2', hold_credits: 100 }], // findStranded
      [{ refunded: 250 }], // reconcile op-1
      [{ refunded: 100 }], // reconcile op-2
    ]);
    const out = await reconcileStrandedHolds({ sql, olderThanSecs: 600 });
    expect(out).toEqual({ scanned: 2, reconciled: 2, refundedCredits: 350 });
  });

  it('is a no-op when nothing is stranded', async () => {
    const sql = fakeSql([[]]);
    const out = await reconcileStrandedHolds({ sql });
    expect(out).toEqual({ scanned: 0, reconciled: 0, refundedCredits: 0 });
  });
});
