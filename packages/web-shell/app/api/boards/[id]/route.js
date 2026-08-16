import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { requireUser } from '../../../../lib/auth.js';

async function ownedBoard(sql, userId, boardId) {
  const [b] = await sql`SELECT * FROM boards WHERE id = ${boardId} AND user_id = ${userId}`;
  return b || null;
}

export async function GET(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const board = await ownedBoard(sql, user.id, id);
  if (!board) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Bandwidth: caller can opt out of snapshot payload (`?light=1`) when only
  // node metadata is needed — e.g. the post-agent-mutation refetch that only
  // wants to know about creates/deletes/position changes. Saves ~50-200KB per
  // captured site node by skipping the snapshots JOIN.
  const url = new URL(request.url);
  const light = url.searchParams.get('light') === '1';

  const nodes = light
    ? await sql`
        SELECT n.*,
               (n.current_snapshot_id IS NOT NULL) AS "hasSnapshot",
               (SELECT id FROM snapshots WHERE node_id = n.id ORDER BY created_at ASC LIMIT 1) AS original_snapshot_id
          FROM nodes n
         WHERE n.board_id = ${id}
         ORDER BY n.created_at ASC
      `
    : await sql`
        SELECT n.*, s.html AS current_html, s.design_md AS current_design_md, s.screenshot_url AS current_screenshot,
               s.source AS current_snapshot_source,
               s.native_bundle_id AS current_native_bundle_id,
               s.motion_manifest_version AS current_motion_manifest_version,
               (SELECT id FROM snapshots WHERE node_id = n.id ORDER BY created_at ASC LIMIT 1) AS original_snapshot_id
          FROM nodes n
          LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
         WHERE n.board_id = ${id}
         ORDER BY n.created_at ASC
      `;
  const edges = await sql`SELECT * FROM edges WHERE board_id = ${id} ORDER BY created_at ASC`;
  return NextResponse.json({ board, nodes, edges });
}

export async function PATCH(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const board = await ownedBoard(sql, user.id, id);
  if (!board) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const name = (body?.name || board.name).slice(0, 120);
  await sql`UPDATE boards SET name = ${name}, updated_at = NOW() WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const board = await ownedBoard(sql, user.id, id);
  if (!board) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await sql`DELETE FROM boards WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
