import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { startJob, publicJobView } from '../../../../../lib/challenge/job-service.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const purpose = body?.purpose;
  if (!['reference', 'edit'].includes(purpose)) {
    return NextResponse.json({ error: 'invalid_purpose' }, { status: 400 });
  }
  const idemKey = request.headers.get('idempotency-key') || null;
  const sql = await db();
  const [node] = await sql`
    SELECT n.* FROM nodes n JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}`;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!node.origin_url) return NextResponse.json({ error: 'no_origin_url' }, { status: 400 });

  const r = await startJob({ sql, userId: user.id, node, purpose, idemKey });
  if (r.error) {
    const { code, status = 409, estimate, balance } = r.error;
    return NextResponse.json({ error: code, ...(estimate != null ? { estimate, balance } : {}) }, { status });
  }
  return NextResponse.json({ job: publicJobView(r.job) });
}
