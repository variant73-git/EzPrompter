import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { canonicalEditEnabled, publicCanonicalJobView, startCanonicalJob } from '../../../../../lib/canonical/job-service.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request, { params }) {
  if (!canonicalEditEnabled()) return NextResponse.json({ error: 'canonical_disabled' }, { status: 404, headers: NO_STORE });
  const { user, error } = await requireUser(request);
  if (error) return error;
  const idemKey = request.headers.get('idempotency-key');
  if (!idemKey || !idemKey.trim()) return NextResponse.json({ error: 'idempotency_key_required' }, { status: 400, headers: NO_STORE });
  const { id } = await params;
  const sql = await db();
  const rows = await sql`
    SELECT n.id, n.kind, n.board_id, n.current_snapshot_id,
           s.source AS current_snapshot_source, s.native_bundle_id AS current_native_bundle_id
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}`;
  const node = rows[0];
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  const out = await startCanonicalJob({ sql, userId: user.id, node, idemKey: idemKey.trim() });
  if (out.error) {
    const { code, status, ...rest } = out.error;
    return NextResponse.json({ error: code, ...rest }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ job: publicCanonicalJobView(out.job) }, { headers: NO_STORE });
}
