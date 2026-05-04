import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const { html } = await request.json().catch(() => ({}));
  if (!html || typeof html !== 'string') {
    return NextResponse.json({ error: 'html required' }, { status: 400 });
  }
  const sql = await db();
  const [node] = await sql`
    SELECT n.id FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [snap] = await sql`
    INSERT INTO snapshots (node_id, html, source, parent_snapshot_id)
    VALUES (${id}, ${html}, 'edit',
            (SELECT current_snapshot_id FROM nodes WHERE id = ${id}))
    RETURNING id, created_at
  `;
  await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${id}`;
  return NextResponse.json({ ok: true, snapshotId: snap.id });
}
