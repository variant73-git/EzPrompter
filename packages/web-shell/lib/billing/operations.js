// lib/billing/operations.js
/**
 * Logical-operation idempotency (money-safety; spec 2026-07-24). One durable
 * `operations` row per logical action, keyed by (user_id, idem_key). The row
 * ABSORBS the hold, so:
 *   - a retry with the SAME key that already settled returns the stored response
 *     (no second charge, no second artifact) — that is the dedup;
 *   - a stranded hold (settle failed) is just an in_flight row the reconciliation
 *     sweep finds deterministically and refunds.
 *
 * Every claim/hold mutation is ONE atomic SQL statement (a CTE) so the row and
 * the balance deduction can never diverge — neon's HTTP transaction is a
 * non-interactive batch that can't branch mid-way, so the branch lives in SQL.
 * The immutable money audit stays in credit_ledger / usage_events (ledger.js);
 * this table is coordination/dedup only.
 */

// Claim a logical operation and place its hold, atomically. Inserts an in_flight
// row IFF affordable AND no existing row for (user_id, idem_key), and deducts the
// hold in the SAME statement. Returns one of:
//   { outcome: 'claimed', operationId, balance }   — we own it; run the work
//   { outcome: 'duplicate', row }                  — a row already exists; caller
//        inspects row.status (settled → replay, in_flight → busy, failed/expired → reclaim)
//   { outcome: 'insufficient', balance }           — balance below the estimate
export async function claimOperation({ sql, userId, idemKey, op, boardId = null, nodeId = null, estimate = 0 }) {
  const hold = Math.max(0, Math.ceil(estimate || 0));
  const rows = await sql`
    WITH bal AS (
      SELECT COALESCE(credits_cents, 0) AS c FROM users WHERE id = ${userId}
    ),
    ins AS (
      INSERT INTO operations (idem_key, user_id, op, board_id, node_id, status, hold_credits)
      SELECT ${idemKey}, ${userId}, ${op}, ${boardId}, ${nodeId}, 'in_flight', ${hold}
      FROM bal WHERE bal.c >= ${hold}
      ON CONFLICT (user_id, idem_key) DO NOTHING
      RETURNING id
    ),
    upd AS (
      UPDATE users SET credits_cents = COALESCE(credits_cents, 0) - ${hold}
      WHERE id = ${userId} AND EXISTS (SELECT 1 FROM ins)
      RETURNING credits_cents
    )
    SELECT (SELECT id FROM ins) AS op_id, (SELECT credits_cents FROM upd) AS balance
  `;
  const opId = rows[0]?.op_id ?? null;
  if (opId) return { outcome: 'claimed', operationId: opId, balance: Number(rows[0].balance) };
  // op_id null → EITHER a row already exists (conflict) OR the balance filter
  // blocked the insert. Distinguish by reading the row.
  const existing = await sql`
    SELECT id, status, hold_credits, charge_credits, result
    FROM operations WHERE user_id = ${userId} AND idem_key = ${idemKey}
  `;
  if (existing.length) return { outcome: 'duplicate', row: existing[0] };
  const balRows = await sql`SELECT COALESCE(credits_cents, 0) AS c FROM users WHERE id = ${userId}`;
  return { outcome: 'insufficient', balance: Number(balRows[0]?.c ?? 0) };
}

// Reclaim a failed/expired row for a fresh attempt under the same key: flip it
// back to in_flight and re-place the hold, atomically and affordability-guarded.
// Returns:
//   { outcome: 'reclaimed', operationId, balance } — proceed
//   { outcome: 'raced', row }                      — someone else moved it; caller re-inspects
//   { outcome: 'insufficient', balance }           — balance below the estimate
export async function reclaimOperation({ sql, userId, idemKey, estimate = 0 }) {
  const hold = Math.max(0, Math.ceil(estimate || 0));
  const rows = await sql`
    WITH bal AS (
      SELECT COALESCE(credits_cents, 0) AS c FROM users WHERE id = ${userId}
    ),
    claimed AS (
      UPDATE operations SET status = 'in_flight', hold_credits = ${hold},
             charge_credits = 0, result = NULL, settled_at = NULL, updated_at = NOW()
      WHERE user_id = ${userId} AND idem_key = ${idemKey}
        AND status IN ('failed', 'expired')
        AND (SELECT c FROM bal) >= ${hold}
      RETURNING id
    ),
    upd AS (
      UPDATE users SET credits_cents = COALESCE(credits_cents, 0) - ${hold}
      WHERE id = ${userId} AND EXISTS (SELECT 1 FROM claimed)
      RETURNING credits_cents
    )
    SELECT (SELECT id FROM claimed) AS op_id, (SELECT credits_cents FROM upd) AS balance
  `;
  const opId = rows[0]?.op_id ?? null;
  if (opId) return { outcome: 'reclaimed', operationId: opId, balance: Number(rows[0].balance) };
  // Not reclaimed: either the row is no longer failed/expired (raced to in_flight
  // or settled by a concurrent attempt) or the balance blocked it. Re-read.
  const existing = await sql`
    SELECT id, status, hold_credits, charge_credits, result
    FROM operations WHERE user_id = ${userId} AND idem_key = ${idemKey}
  `;
  const row = existing[0];
  if (row && (row.status === 'failed' || row.status === 'expired')) {
    // Still reclaimable but the CTE didn't fire → the affordability guard blocked it.
    const balRows = await sql`SELECT COALESCE(credits_cents, 0) AS c FROM users WHERE id = ${userId}`;
    return { outcome: 'insufficient', balance: Number(balRows[0]?.c ?? 0) };
  }
  return { outcome: 'raced', row: row ?? null };
}

// Read a single operation row by its logical key.
export async function getOperation({ sql, userId, idemKey }) {
  const rows = await sql`
    SELECT id, status, hold_credits, charge_credits, result, created_at
    FROM operations WHERE user_id = ${userId} AND idem_key = ${idemKey}
  `;
  return rows[0] ?? null;
}

// Reconciliation backstop: refund + expire ONE stranded in_flight operation,
// race-safely and atomically. The status flip is conditional INSIDE the CTE
// (WHERE status='in_flight'), so a second sweep that lost the race sees an empty
// `claimed` CTE → refunds nothing → no double refund. The credit_ledger 'refund'
// row is written from within the same statement. Returns the refunded credits
// (0 if the row was already moved by another sweep).
export async function reconcileStrandedHold({ sql, operationId }) {
  const rows = await sql`
    WITH claimed AS (
      UPDATE operations SET status = 'expired', updated_at = NOW()
      WHERE id = ${operationId} AND status = 'in_flight'
      RETURNING id, user_id, hold_credits
    ),
    refunded AS (
      UPDATE users u SET credits_cents = COALESCE(u.credits_cents, 0) + c.hold_credits
      FROM claimed c WHERE u.id = c.user_id
      RETURNING u.id AS user_id, u.credits_cents
    ),
    audit AS (
      INSERT INTO credit_ledger (user_id, delta_credits, reason, op_id, balance_after, meta)
      SELECT c.user_id, c.hold_credits, 'refund', c.id, r.credits_cents, ${JSON.stringify({ reconciled: true })}
      FROM claimed c JOIN refunded r ON r.user_id = c.user_id
      WHERE c.hold_credits > 0
      RETURNING 1
    )
    SELECT COALESCE((SELECT hold_credits FROM claimed), 0) AS refunded
  `;
  return { refunded: Number(rows[0]?.refunded ?? 0) };
}

// Find stranded in_flight operations older than `olderThanSecs` for the sweep to
// reconcile. Kept as a plain SELECT so the caller (a cron/job) drives the loop.
export async function findStrandedOperations({ sql, olderThanSecs = 600, limit = 100 }) {
  return sql`
    SELECT id, user_id, op, hold_credits, created_at
    FROM operations
    WHERE status = 'in_flight' AND created_at < NOW() - make_interval(secs => ${olderThanSecs})
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
}

// Run one reconciliation pass: refund+expire every stranded op. Returns a summary.
export async function reconcileStrandedHolds({ sql, olderThanSecs = 600, limit = 100 }) {
  const stale = await findStrandedOperations({ sql, olderThanSecs, limit });
  let refundedCredits = 0;
  let count = 0;
  for (const row of stale) {
    const { refunded } = await reconcileStrandedHold({ sql, operationId: row.id });
    if (refunded > 0 || row.hold_credits === 0) count += 1;
    refundedCredits += refunded;
  }
  return { scanned: stale.length, reconciled: count, refundedCredits };
}
