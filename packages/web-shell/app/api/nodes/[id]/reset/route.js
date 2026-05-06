import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';

// Reset a node to its original capture: point current_snapshot_id back at
// the FIRST snapshot for this node (the one created when the node was
// added). Returns the restored HTML so the caller can swap srcDoc client
// side without a full board refetch.

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;

  const [node] = await sql`
    SELECT n.* FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [first] = await sql`
    SELECT id, html, design_md, screenshot_url
      FROM snapshots
     WHERE node_id = ${id}
     ORDER BY created_at ASC
     LIMIT 1
  `;
  if (!first) return NextResponse.json({ error: 'no_original_snapshot' }, { status: 404 });

  await sql`
    UPDATE nodes
       SET current_snapshot_id = ${first.id}
     WHERE id = ${id}
  `;

  return NextResponse.json({
    ok: true,
    snapshot_id: first.id,
    html: first.html,
    design_md: first.design_md,
    screenshot_url: first.screenshot_url
  });
}
