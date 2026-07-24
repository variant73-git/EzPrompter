// app/api/cron/reconcile-holds/route.js
// Reconciliation backstop (money-safety; spec 2026-07-24 §7). Refunds + expires
// operations rows stuck in_flight past a safety TTL — the case where a paid op
// deducted a hold but its settle never ran (process crash, settlement rollback).
// Without this job the "reconciliation will refund" guarantee is inert (Sol audit
// 2026-07-24, finding #4). Schedule it (e.g. Vercel cron every 5 min):
//   { "crons": [{ "path": "/api/cron/reconcile-holds", "schedule": "*/5 * * * *" }] }
// Guarded by CRON_SECRET (Vercel cron sends `Authorization: Bearer <CRON_SECRET>`).
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { reconcileStrandedHolds } from '../../../../lib/billing/operations.js';

// TTL must sit safely ABOVE the longest real op runtime (route deadlines ≤200s,
// reconstruct 2-3 min) so a live op is never swept. Default 15 min; override via env.
const RECONCILE_TTL_SECS = Math.max(300, Number(process.env.UNCRAFT_RECONCILE_TTL_SECS) || 900);
const RECONCILE_LIMIT = Math.max(1, Number(process.env.UNCRAFT_RECONCILE_LIMIT) || 200);

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unset (dev) → allow; production MUST set it
  const auth = request.headers.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const sql = await db();
    const summary = await reconcileStrandedHolds({ sql, olderThanSecs: RECONCILE_TTL_SECS, limit: RECONCILE_LIMIT });
    if (summary.reconciled > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[reconcile-holds] refunded ${summary.refundedCredits} credits across ${summary.reconciled}/${summary.scanned} stranded ops (ttl ${RECONCILE_TTL_SECS}s)`);
    }
    return NextResponse.json({ ok: true, ...summary, ttlSecs: RECONCILE_TTL_SECS });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[reconcile-holds] sweep failed:', e);
    return NextResponse.json({ error: 'reconcile_failed', message: String(e?.message || e) }, { status: 500 });
  }
}
