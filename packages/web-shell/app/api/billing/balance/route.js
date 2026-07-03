import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { requireUser } from '../../../../lib/auth.js';
import { getBalance, recentLedger } from '../../../../lib/billing/ledger.js';

export const runtime = 'nodejs';

// GET /api/billing/balance → { credits, ledger }
export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const sql = await db();
  const [credits, ledger] = await Promise.all([
    getBalance({ sql, userId: user.id }),
    recentLedger({ sql, userId: user.id, limit: 10 }),
  ]);
  return NextResponse.json({ credits, ledger });
}
