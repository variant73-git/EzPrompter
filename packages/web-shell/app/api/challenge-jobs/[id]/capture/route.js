import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { captureJob, publicJobView } from '../../../../../lib/challenge/job-service.js';
import { InsufficientCreditsError, OperationInProgressError } from '../../../../../lib/billing/context.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

async function loadNode({ sql, userId, nodeId }) {
  const [node] = await sql`
    SELECT n.* FROM nodes n JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${nodeId} AND b.user_id = ${userId}`;
  return node || null;
}

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const sql = await db();
  try {
    const { job, result } = await captureJob({ sql, userId: user.id, jobId: id, loadNode });
    return NextResponse.json({ job: publicJobView(job), result });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', estimate: e.estimate, balance: e.balance }, { status: 402 });
    if (e instanceof OperationInProgressError) return NextResponse.json({ error: 'in_progress' }, { status: 409 });
    if (['control_conversion_timeout', 'provider_timeout'].includes(e?.code)) return NextResponse.json({ error: 'conversion_timeout' }, { status: 504 });
    if (e?.code && e?.status) return NextResponse.json({ error: e.code }, { status: e.status });
    console.error('challenge capture error', e?.code || e?.message);
    return NextResponse.json({ error: 'capture_failed' }, { status: 502 });
  }
}
