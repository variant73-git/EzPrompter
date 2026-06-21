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

// Used by the handoff polling loop in CanvasClient.
//
// Default: returns the node row plus current snapshot's html — heavy but
// one round-trip when the caller actually wants the content.
//
// `?ready_check=1`: cheap probe (≈30 bytes) — returns `{ ready, snapshotId }`
// without joining or transferring snapshot.html. The poller hits this every
// 3s and only does ONE full GET when `ready: true`. Cuts ~17MB → ~91KB per
// 10-minute handoff.
export async function GET(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const node = await ownedNode(sql, user.id, id);
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const url = new URL(request.url);
  if (url.searchParams.get('ready_check') === '1') {
    let ready = false;
    const snapshotId = node.current_snapshot_id || null;
    if (snapshotId) {
      // `html IS NOT NULL AND length > 0` so md-only seeds (html = '') don't
      // false-positive as "handoff ready". length() is a cheap header read —
      // doesn't transfer the html column itself.
      const [r] = await sql`
        SELECT (COALESCE(LENGTH(html), 0) > 0) AS ready
          FROM snapshots WHERE id = ${snapshotId}
      `;
      ready = !!r?.ready;
    }
    return NextResponse.json({ ready, snapshotId });
  }

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
