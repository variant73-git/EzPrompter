import { NextResponse } from 'next/server';
import { db } from '../../../../../../lib/db.js';
import { requireUser } from '../../../../../../lib/auth.js';

// GET /api/nodes/[id]/snapshots/[snapId]
//
// One version's renderable content (html + screenshot_url) for the preview and
// the mini-iframe thumbnail. On-demand only — never bulk-loaded. The snapshot
// must belong to THIS node and the node to the user.
export async function GET(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id, snapId } = await params;

  const [row] = await sql`
    SELECT s.id, s.html, s.design_md, s.screenshot_url, s.source, s.created_at
      FROM snapshots s
      JOIN nodes n ON n.id = s.node_id
      JOIN boards b ON b.id = n.board_id
     WHERE s.id = ${snapId} AND s.node_id = ${id} AND b.user_id = ${user.id}
  `;
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ snapshot: row });
}
