import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { requireUser } from '../../../../lib/auth.js';

async function ownedEdge(sql, userId, edgeId) {
  const [row] = await sql`
    SELECT e.* FROM edges e
      JOIN boards b ON b.id = e.board_id
     WHERE e.id = ${edgeId} AND b.user_id = ${userId}
  `;
  return row || null;
}

export async function PATCH(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const edge = await ownedEdge(sql, user.id, id);
  if (!edge) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const payload = body.payload ?? edge.payload;
  const status = body.status ?? edge.status;
  await sql`UPDATE edges SET payload = ${payload}::jsonb, status = ${status} WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const edge = await ownedEdge(sql, user.id, id);
  if (!edge) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await sql`DELETE FROM edges WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
