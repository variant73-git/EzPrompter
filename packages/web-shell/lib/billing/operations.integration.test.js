// lib/billing/operations.integration.test.js
//
// REAL Postgres/Neon integration test (Sol audit 2026-07-24: the scripted `sql`
// fake models neither transaction rollback nor row-lock concurrency, so the
// atomicity/fencing/overspend guarantees can only be VERIFIED against a live DB).
//
// Gated: runs ONLY when UNCRAFT_INTEGRATION_DB=1 AND DATABASE_URL point at a
// throwaway Postgres. Skipped everywhere else (CI without a DB, local unit runs).
//   UNCRAFT_INTEGRATION_DB=1 DATABASE_URL=postgres://… bun run test operations.integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const RUN = process.env.UNCRAFT_INTEGRATION_DB === '1' && !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

let sql, claimOperation, reclaimOperation, reconcileStrandedHold, settleOperation;
let userId;

async function balance() {
  const r = await sql`SELECT COALESCE(credits_cents,0) AS c FROM users WHERE id = ${userId}`;
  return Number(r[0]?.c ?? 0);
}

d('operations idempotency — real DB', () => {
  beforeAll(async () => {
    const db = await import('../db.js');
    ({ claimOperation, reclaimOperation, reconcileStrandedHold } = await import('./operations.js'));
    ({ settleOperation } = await import('./ledger.js'));
    sql = await db.db(); // runs initDB() → creates the operations table
    const [u] = await sql`
      INSERT INTO users (email, credits_cents) VALUES (${`idem-int-${Date.now()}@test.local`}, 1000)
      RETURNING id
    `;
    userId = u.id;
  });
  afterAll(async () => {
    if (userId != null) {
      await sql`DELETE FROM operations WHERE user_id = ${userId}`;
      await sql`DELETE FROM credit_ledger WHERE user_id = ${userId}`;
      await sql`DELETE FROM usage_events WHERE user_id = ${userId}`;
      await sql`DELETE FROM users WHERE id = ${userId}`;
    }
  });

  it('claim → settle charges exactly once and the balance matches the ledger', async () => {
    const before = await balance();
    const c = await claimOperation({ sql, userId, idemKey: 'int-k1', op: 'extract.clone', estimate: 250 });
    expect(c.outcome).toBe('claimed');
    expect(await balance()).toBe(before - 250);            // hold debited
    await settleOperation({ sql, userId, opId: c.operationId, op: 'extract.clone', events: [], holdCredits: 250, chargeCredits: 200, opStatus: 'settled', result: { node: 'n1' } });
    expect(await balance()).toBe(before - 200);            // charged 200, 50 hold refunded
    const led = await sql`SELECT COALESCE(SUM(delta_credits),0) AS s FROM credit_ledger WHERE user_id = ${userId}`;
    expect(Number(led[0].s)).toBe(-200);                   // ledger sum == net balance change
  });

  it('a same-key retry after settle DEDUPS (duplicate/settled, no second charge)', async () => {
    const c = await claimOperation({ sql, userId, idemKey: 'int-k1', op: 'extract.clone', estimate: 250 });
    expect(c.outcome).toBe('duplicate');
    expect(c.row.status).toBe('settled');
    expect(c.row.result.response).toEqual({ node: 'n1' });
  });

  it('two concurrent DIFFERENT-key claims can NOT both pass when only one is affordable (no overspend)', async () => {
    await sql`UPDATE users SET credits_cents = 300 WHERE id = ${userId}`;
    const [a, b] = await Promise.all([
      claimOperation({ sql, userId, idemKey: 'int-race-a', op: 'extract.clone', estimate: 250 }),
      claimOperation({ sql, userId, idemKey: 'int-race-b', op: 'extract.clone', estimate: 250 }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['claimed', 'insufficient']); // exactly one wins
    expect(await balance()).toBeGreaterThanOrEqual(0);      // NEVER negative
    expect(await balance()).toBe(50);                       // 300 − one 250 hold
  });

  it('FENCING: a reconciled (expired) row can NOT be resurrected by a late settle — no double refund', async () => {
    await sql`UPDATE users SET credits_cents = 1000 WHERE id = ${userId}`;
    const c = await claimOperation({ sql, userId, idemKey: 'int-fence', op: 'extract.clone', estimate: 250 });
    expect(await balance()).toBe(750);
    // Reconcile refunds + expires the in_flight row.
    const rec = await reconcileStrandedHold({ sql, operationId: c.operationId });
    expect(rec.refunded).toBe(250);
    expect(await balance()).toBe(1000);
    // The late worker settle must be FENCED (row no longer in_flight) → no money moves.
    const s = await settleOperation({ sql, userId, opId: c.operationId, op: 'extract.clone', events: [], holdCredits: 250, chargeCredits: 200, opStatus: 'settled', result: { node: 'x' } });
    expect(s.fenced).toBe(false);
    expect(await balance()).toBe(1000);                    // NOT 1000 + (250−200): no resurrection
  });
});
