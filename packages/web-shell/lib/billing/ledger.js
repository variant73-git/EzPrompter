// lib/billing/ledger.js
/**
 * Balance + ledger primitives. Every function takes { sql } so tests inject
 * fakes. Money model: users.credits_cents IS the credit balance (1 credit =
 * 1¢ of price). Holds are real balance deductions (first come wins — spec
 * §9); settle refunds the difference to the actual charge and writes the
 * audit trail (usage_events) + one ledger 'charge' row per operation.
 */

export async function getBalance({ sql, userId }) {
  const rows = await sql`SELECT COALESCE(credits_cents, 0) AS c FROM users WHERE id = ${userId}`;
  return Number(rows[0]?.c ?? 0);
}

export async function holdCredits({ sql, userId, credits }) {
  const n = Math.max(0, Math.ceil(credits || 0));
  if (n === 0) {
    return { held: true, balance: await getBalance({ sql, userId }) };
  }
  const rows = await sql`
    UPDATE users SET credits_cents = credits_cents - ${n}
    WHERE id = ${userId} AND COALESCE(credits_cents, 0) >= ${n}
    RETURNING credits_cents
  `;
  if (rows.length) return { held: true, balance: Number(rows[0].credits_cents) };
  return { held: false, balance: await getBalance({ sql, userId }) };
}

export async function refundHold({ sql, userId, credits }) {
  const n = Math.max(0, Math.ceil(credits || 0));
  if (n === 0) return { balance: await getBalance({ sql, userId }) };
  const rows = await sql`
    UPDATE users SET credits_cents = COALESCE(credits_cents, 0) + ${n}
    WHERE id = ${userId}
    RETURNING credits_cents
  `;
  return { balance: Number(rows[0]?.credits_cents ?? 0) };
}

// Settle: adjust balance from hold→charge, persist events + charge row.
// diff > 0 → refund; diff < 0 → charge the excess (floored at 0 by GREATEST).
//
// ONE atomic transaction (root-cause fix, 2026-07-23): the balance UPDATE and
// the audit INSERTs commit together or not at all. A mid-sequence failure
// (transient DB error, dropped connection) therefore can NEVER leave a
// half-settled state — that failure mode is eliminated, not "handled". On any
// failure the transaction rejects with nothing applied, and the caller
// (billing/context.js) surfaces it loudly. credit_ledger.balance_after reads the
// balance AS OF the UPDATE via a subquery within the same transaction, so there
// is no cross-query JS dependency the non-interactive HTTP transaction couldn't
// carry.
//
// This atomicity is NOT the whole money-safety story (Sol audit 2026-07-24):
// the hold is a SEPARATE earlier commit, and every operation gets a fresh opId,
// so a settlement that fails strands the hold, and a paid op that commits+settles
// then loses its response is re-run under a NEW opId → the same logical action
// charged twice. Closing THAT needs LOGICAL-operation idempotency (a stable
// request/tool key + a durable operation record that dedups/resumes on retry) —
// a feature, not a per-opId marker (the opId is already unique per retry).
// Tracked in docs/superpowers/handoffs/2026-07-23-audit-fixes-…handoff.md.
// Two modes (audit 2026-07-24, Codex + Claude):
//
// LEGACY (opStatus null — metered ops with no operations row): the original
// unconditional atomic transaction. Balance moves by (held − charge).
//
// FENCED (opStatus 'settled'|'failed' — a real operations row): the terminal
// transition is GUARDED on `status='in_flight'` inside a single CTE, and the
// balance move + charge-ledger insert are gated on that transition firing. So a
// row already terminalized by the reconciliation sweep (or a concurrent settle)
// can NOT be resurrected and the hold can NOT be refunded twice — the keystone
// money-safety fix. The refund is derived from the ROW's own recorded
// `hold_credits`, not a recomputed estimate, so it stays correct even if pricing
// changes mid-flight. `result` is the compact replayable response stored on a
// settled row for retry-dedup. usage_events are pure metering (non-financial),
// written unconditionally in the same transaction.
export async function settleOperation({ sql, userId, opId, op, boardId = null, nodeId = null, events = [], holdCredits: held = 0, chargeCredits = 0, opStatus = null, result = undefined }) {
  const charge = Math.ceil(chargeCredits || 0);

  const usageInserts = events.map((e) => sql`
    INSERT INTO usage_events (user_id, op_id, op, board_id, node_id, provider, model, tokens_in, tokens_out, cached_in, images, cost_microcents, charged, meta)
    VALUES (${userId}, ${opId}, ${op}, ${boardId}, ${nodeId}, ${e.provider || null}, ${e.model || null},
            ${e.tokensIn || 0}, ${e.tokensOut || 0}, ${e.cachedIn || 0}, ${e.images || 0},
            ${e.costMicrocents || 0}, ${charge > 0}, ${JSON.stringify(e.meta || {})})
  `);

  if ((opStatus === 'settled' || opStatus === 'failed') && opId != null) {
    const resultJson = opStatus === 'settled' && result !== undefined ? JSON.stringify(result) : null;
    const fenced = opStatus === 'settled'
      ? sql`
          WITH claimed AS (
            UPDATE operations SET status = 'settled', charge_credits = ${charge},
                   result = ${resultJson}, settled_at = NOW(), updated_at = NOW()
            WHERE id = ${opId} AND status = 'in_flight'
            RETURNING hold_credits
          ),
          bal AS (
            UPDATE users
               SET credits_cents = GREATEST(0, COALESCE(credits_cents, 0) + ((SELECT hold_credits FROM claimed) - ${charge}))
             WHERE id = ${userId} AND EXISTS (SELECT 1 FROM claimed)
             RETURNING credits_cents
          ),
          ledger AS (
            INSERT INTO credit_ledger (user_id, delta_credits, reason, op_id, balance_after, meta)
            SELECT ${userId}, ${-charge}, 'charge', ${opId}, (SELECT credits_cents FROM bal), ${JSON.stringify({ op })}
            WHERE ${charge} > 0 AND EXISTS (SELECT 1 FROM claimed)
            RETURNING 1
          )
          SELECT (SELECT credits_cents FROM bal) AS balance, (EXISTS (SELECT 1 FROM claimed)) AS fenced
        `
      : sql`
          WITH claimed AS (
            UPDATE operations SET status = 'failed', updated_at = NOW()
            WHERE id = ${opId} AND status = 'in_flight'
            RETURNING hold_credits
          ),
          bal AS (
            UPDATE users
               SET credits_cents = GREATEST(0, COALESCE(credits_cents, 0) + (SELECT hold_credits FROM claimed))
             WHERE id = ${userId} AND EXISTS (SELECT 1 FROM claimed)
             RETURNING credits_cents
          )
          SELECT (SELECT credits_cents FROM bal) AS balance, (EXISTS (SELECT 1 FROM claimed)) AS fenced
        `;
    const results = await sql.transaction([fenced, ...usageInserts]);
    const row = results?.[0]?.[0];
    return { balanceAfter: Number(row?.balance ?? 0), fenced: !!(row?.fenced) };
  }

  // LEGACY path: unconditional (no operations row to fence against).
  const diff = Math.ceil(held) - charge;
  const queries = [
    sql`
      UPDATE users SET credits_cents = GREATEST(0, COALESCE(credits_cents, 0) + ${diff})
      WHERE id = ${userId}
      RETURNING credits_cents
    `,
    ...usageInserts,
  ];
  if (charge > 0) {
    queries.push(sql`
      INSERT INTO credit_ledger (user_id, delta_credits, reason, op_id, balance_after, meta)
      VALUES (${userId}, ${-charge}, ${'charge'}, ${opId},
              (SELECT credits_cents FROM users WHERE id = ${userId}), ${JSON.stringify({ op })})
    `);
  }
  const results = await sql.transaction(queries);
  return { balanceAfter: Number(results?.[0]?.[0]?.credits_cents ?? 0) };
}

export async function grantCredits({ sql, userId, credits, reason, meta = {} }) {
  const n = Math.max(0, Math.ceil(credits || 0));
  // Atomic (same root-cause fix as settleOperation): balance + ledger row commit
  // together, so a grant can't leave credits added with no audit trail (or vice
  // versa). balance_after reads the post-UPDATE balance within the transaction.
  const results = await sql.transaction([
    sql`
      UPDATE users SET credits_cents = COALESCE(credits_cents, 0) + ${n}
      WHERE id = ${userId}
      RETURNING credits_cents
    `,
    sql`
      INSERT INTO credit_ledger (user_id, delta_credits, reason, balance_after, meta)
      VALUES (${userId}, ${n}, ${reason}, (SELECT credits_cents FROM users WHERE id = ${userId}), ${JSON.stringify(meta)})
    `,
  ]);
  return { balanceAfter: Number(results?.[0]?.[0]?.credits_cents ?? 0) };
}

export async function recentLedger({ sql, userId, limit = 10 }) {
  return sql`
    SELECT delta_credits, reason, op_id, balance_after, meta, created_at
    FROM credit_ledger WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
}
