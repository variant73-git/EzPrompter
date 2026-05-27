import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { requireUser } from '../../../../lib/auth.js';

async function ownedNode(sql, userId, nodeId) {
  const [row] = await sql`
    SELECT n.* FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${nodeId} AND b.user_id = ${userId}
  `;
  return row || null;
}

// Lightweight GET — used by the handoff polling loop in CanvasClient
// to check whether the extension has shipped the verified DOM back.
// Returns the node row plus the current snapshot's html when present,
// so polling can render the result without a second round-trip.
export async function GET(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const node = await ownedNode(sql, user.id, id);
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let snapshot = null;
  if (node.current_snapshot_id) {
    const [snap] = await sql`
      SELECT id, html, screenshot_url, source, created_at
        FROM snapshots WHERE id = ${node.current_snapshot_id}
    `;
    if (snap) snapshot = snap;
  }
  return NextResponse.json({ node, snapshot });
}

export async function PATCH(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const node = await ownedNode(sql, user.id, id);
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const posX = body.posX ?? node.pos_x;
  const posY = body.posY ?? node.pos_y;
  const width = body.width ?? node.width;
  const height = body.height ?? node.height;
  const isMain = body.isMain ?? node.is_main;
  const meta = body.meta ?? node.meta;
  await sql`
    UPDATE nodes
       SET pos_x = ${posX}, pos_y = ${posY}, width = ${width}, height = ${height},
           is_main = ${isMain}, meta = ${meta}::jsonb
     WHERE id = ${id}
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const node = await ownedNode(sql, user.id, id);
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await sql`DELETE FROM nodes WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
