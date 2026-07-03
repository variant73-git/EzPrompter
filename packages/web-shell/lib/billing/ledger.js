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
export async function settleOperation({ sql, userId, opId, op, boardId = null, nodeId = null, events = [], holdCredits: held = 0, chargeCredits = 0 }) {
  const diff = Math.ceil(held) - Math.ceil(chargeCredits);
  const rows = await sql`
    UPDATE users SET credits_cents = GREATEST(0, COALESCE(credits_cents, 0) + ${diff})
    WHERE id = ${userId}
    RETURNING credits_cents
  `;
  const balanceAfter = Number(rows[0]?.credits_cents ?? 0);
  for (const e of events) {
    await sql`
      INSERT INTO usage_events (user_id, op_id, op, board_id, node_id, provider, model, tokens_in, tokens_out, cached_in, images, cost_microcents, charged, meta)
      VALUES (${userId}, ${opId}, ${op}, ${boardId}, ${nodeId}, ${e.provider || null}, ${e.model || null},
              ${e.tokensIn || 0}, ${e.tokensOut || 0}, ${e.cachedIn || 0}, ${e.images || 0},
              ${e.costMicrocents || 0}, ${chargeCredits > 0}, ${JSON.stringify(e.meta || {})})
    `;
  }
  if (chargeCredits > 0) {
    await sql`
      INSERT INTO credit_ledger (user_id, delta_credits, reason, op_id, balance_after, meta)
      VALUES (${userId}, ${-Math.ceil(chargeCredits)}, ${'charge'}, ${opId}, ${balanceAfter}, ${JSON.stringify({ op })})
    `;
  }
  return { balanceAfter };
}

export async function grantCredits({ sql, userId, credits, reason, meta = {} }) {
  const n = Math.max(0, Math.ceil(credits || 0));
  const rows = await sql`
    UPDATE users SET credits_cents = COALESCE(credits_cents, 0) + ${n}
    WHERE id = ${userId}
    RETURNING credits_cents
  `;
  const balanceAfter = Number(rows[0]?.credits_cents ?? 0);
  await sql`
    INSERT INTO credit_ledger (user_id, delta_credits, reason, balance_after, meta)
    VALUES (${userId}, ${n}, ${reason}, ${balanceAfter}, ${JSON.stringify(meta)})
  `;
  return { balanceAfter };
}

export async function recentLedger({ sql, userId, limit = 10 }) {
  return sql`
    SELECT delta_credits, reason, op_id, balance_after, meta, created_at
    FROM credit_ledger WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
}
