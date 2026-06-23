import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';

// POST /api/nodes/[id]/restore-version  { snapshotId }
//
// Restore a past version: point current_snapshot_id at a chosen snapshot.
// Non-destructive — no snapshot is deleted, so the user can switch back and
// forth freely; later edits branch from the restored version. The snapshot
// must belong to this node and the node to the user. Returns the restored
// content so the client renders immediately without a board refetch.
// (The existing /reset route — which always points at the FIRST snapshot —
// is left untouched.)
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const snapshotId = body?.snapshotId;
  if (!snapshotId) return NextResponse.json({ error: 'snapshotId required' }, { status: 400 });

  const [snap] = await sql`
    SELECT s.id, s.html, s.design_md, s.screenshot_url
      FROM snapshots s
      JOIN nodes n ON n.id = s.node_id
      JOIN boards b ON b.id = n.board_id
     WHERE s.id = ${snapshotId} AND s.node_id = ${id} AND b.user_id = ${user.id}
  `;
  if (!snap) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${id}`;

  return NextResponse.json({
    ok: true,
    snapshot_id: snap.id,
    html: snap.html,
    design_md: snap.design_md,
    screenshot_url: snap.screenshot_url,
  });
}
