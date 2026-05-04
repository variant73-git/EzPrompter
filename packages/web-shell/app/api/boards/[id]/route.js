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

  const nodes = await sql`
    SELECT n.*, s.html AS current_html, s.design_md AS current_design_md, s.screenshot_url AS current_screenshot
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
