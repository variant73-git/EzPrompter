import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { requireUser } from '../../../../lib/auth.js';
import { PLANS } from '../../../../lib/stripe.js';
import { CREDIT_PRESETS, devToolsAllowed } from '../../../../lib/dev-toggles.js';

// Developer widget backend (pre-launch tooling). Fail-closed in production:
// without UNCRAFT_DEV_TOOLS=1 (server env) the route pretends not to exist.
function gate() {
  if (!devToolsAllowed()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}

async function currentState(sql, userId) {
  const [u] = await sql`SELECT plan, credits_cents FROM users WHERE id = ${userId}`;
  return {
    plans: Object.keys(PLANS),
    plan: u?.plan || 'free',
    credits: Number(u?.credits_cents ?? 0),
    creditPresets: Object.keys(CREDIT_PRESETS),
  };
}

export async function GET(request) {
  const blocked = gate();
  if (blocked) return blocked;
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  return NextResponse.json(await currentState(sql, user.id));
}

export async function POST(request) {
  const blocked = gate();
  if (blocked) return blocked;
  const { user, error } = await requireUser(request);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const sql = await db();

  if (body.plan !== undefined) {
    if (!Object.keys(PLANS).includes(body.plan)) {
      return NextResponse.json({ error: 'unknown_plan', plans: Object.keys(PLANS) }, { status: 400 });
    }
    await sql`UPDATE users SET plan = ${body.plan} WHERE id = ${user.id}`;
  }

  if (body.credits !== undefined) {
    if (!(body.credits in CREDIT_PRESETS)) {
      return NextResponse.json({ error: 'unknown_credit_preset', presets: Object.keys(CREDIT_PRESETS) }, { status: 400 });
    }
    const target = CREDIT_PRESETS[body.credits];
    // Single atomic statement: lock the row, set the preset, and derive the
    // ledger delta from the LOCKED previous balance — a prev read outside the
    // transaction races concurrent debits/grants and logs a wrong delta
    // (Sol review 2026-08-17 #2).
    await sql`
      WITH prev AS (
        SELECT credits_cents FROM users WHERE id = ${user.id} FOR UPDATE
      ), upd AS (
        UPDATE users SET credits_cents = ${target} WHERE id = ${user.id}
        RETURNING credits_cents
      )
      INSERT INTO credit_ledger (user_id, delta_credits, reason, balance_after, meta)
      SELECT ${user.id}, ${target} - prev.credits_cents, ${'dev_preset'}, ${target},
             ${JSON.stringify({ preset: body.credits })}
        FROM prev
    `;
  }

  return NextResponse.json(await currentState(sql, user.id));
}
