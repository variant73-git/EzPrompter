/**
 * Credits + monthly cost cap.
 *
 * Two layers:
 *   1. Credit balance — reads/writes `users.credits_cents` when the column
 *      exists, falls back to unlimited otherwise (keeps dev / migration
 *      windows frictionless). Updated AFTER each run with the actual cost.
 *   2. Monthly cost cap — a hard per-user ceiling regardless of plan,
 *      tracked in `users.monthly_cost_cents` + `cost_window_start`. Resets
 *      every 30 days. Defends against runaway bills even when a paying
 *      user has high credit balance (or when columns are missing).
 *
 * To enable enforcement in production, run the migration:
 *   ALTER TABLE users
 *     ADD COLUMN credits_cents BIGINT DEFAULT 0,
 *     ADD COLUMN monthly_cost_cents BIGINT DEFAULT 0,
 *     ADD COLUMN cost_window_start TIMESTAMP DEFAULT NOW();
 * Then grant initial credits per user and the code below picks it up.
 *
 * Set MONTHLY_COST_CAP_CENTS env var to tune the ceiling (default $50).
 * Set MONTHLY_COST_CAP_CENTS=0 to disable the monthly cap entirely.
 */
import { sql } from './db.js';

const MONTHLY_CAP_CENTS = parseInt(process.env.MONTHLY_COST_CAP_CENTS ?? '5000', 10); // $50/mo default
const WINDOW_MS = 30 * 24 * 3600 * 1000;

let creditsColumnExists = null;
let costColumnsExist = null;

async function detectColumns() {
  if (creditsColumnExists !== null && costColumnsExist !== null) {
    return { creditsColumnExists, costColumnsExist };
  }
  try {
    const rows = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = ANY(${['credits_cents', 'monthly_cost_cents', 'cost_window_start']})
    `;
    const names = new Set(rows.map((r) => r.column_name));
    creditsColumnExists = names.has('credits_cents');
    costColumnsExist = names.has('monthly_cost_cents') && names.has('cost_window_start');
  } catch {
    creditsColumnExists = false;
    costColumnsExist = false;
  }
  return { creditsColumnExists, costColumnsExist };
}

export async function getUserCredits({ userId }) {
  const { creditsColumnExists: has } = await detectColumns();
  if (!has) return Number.MAX_SAFE_INTEGER;
  const rows = await sql`SELECT credits_cents FROM users WHERE id = ${userId}`;
  return Number(rows[0]?.credits_cents ?? 0);
}

export async function deductCredits({ userId, cents }) {
  if (!Number.isFinite(cents) || cents <= 0) return await getUserCredits({ userId });
  const { creditsColumnExists, costColumnsExist } = await detectColumns();
  const safeCents = Math.ceil(cents);
  // Atomic: deduct from balance AND add to monthly counter (reset window
  // if it elapsed). One UPDATE covers both with COALESCE so a missing
  // column in either pair degrades gracefully.
  if (creditsColumnExists || costColumnsExist) {
    const rows = await sql`
      UPDATE users SET
        credits_cents = COALESCE(GREATEST(0, credits_cents - ${safeCents}), credits_cents),
        monthly_cost_cents = CASE
          WHEN cost_window_start IS NULL OR cost_window_start < NOW() - INTERVAL '30 days'
            THEN ${safeCents}
          ELSE COALESCE(monthly_cost_cents, 0) + ${safeCents}
        END,
        cost_window_start = CASE
          WHEN cost_window_start IS NULL OR cost_window_start < NOW() - INTERVAL '30 days'
            THEN NOW()
          ELSE cost_window_start
        END
      WHERE id = ${userId}
      RETURNING credits_cents
    `;
    return Number(rows[0]?.credits_cents ?? Number.MAX_SAFE_INTEGER);
  }
  return Number.MAX_SAFE_INTEGER;
}

export async function hasEnoughCredits({ userId, cents }) {
  const { creditsColumnExists, costColumnsExist } = await detectColumns();
  // 1. Hard monthly cost cap defends against bill-runaway regardless of
  //    credit balance. Survives column-missing fallback to TRUE because
  //    without the columns we can't track — the rate limit is the backstop.
  if (MONTHLY_CAP_CENTS > 0 && costColumnsExist) {
    const rows = await sql`
      SELECT
        COALESCE(monthly_cost_cents, 0) AS cost_cents,
        cost_window_start
      FROM users WHERE id = ${userId}
    `;
    const r = rows[0];
    if (r) {
      const windowActive = r.cost_window_start && (Date.now() - new Date(r.cost_window_start).getTime() < WINDOW_MS);
      const accumulated = windowActive ? Number(r.cost_cents) : 0;
      if (accumulated >= MONTHLY_CAP_CENTS) return false;
    }
  }
  // 2. Credit balance check (when column exists).
  if (!creditsColumnExists) return true;
  const have = await getUserCredits({ userId });
  return have >= Math.ceil(cents || 0);
}
