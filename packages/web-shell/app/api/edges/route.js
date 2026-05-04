import { NextResponse } from 'next/server';
import { db } from '../../../lib/db.js';
import { requireUser } from '../../../lib/auth.js';

const VALID_KINDS = new Set(['transplant', 'token-swap', 'reskin']);

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const { boardId, sourceNodeId, targetNodeId, kind, payload = {} } = body || {};
  if (!boardId || !sourceNodeId || !targetNodeId) {
    return NextResponse.json({ error: 'boardId/source/target required' }, { status: 400 });
  }
  if (sourceNodeId === targetNodeId) {
    return NextResponse.json({ error: 'self-edge not allowed' }, { status: 400 });
  }
  if (!VALID_KINDS.has(kind)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 });

  const sql = await db();
  const [board] = await sql`SELECT id FROM boards WHERE id = ${boardId} AND user_id = ${user.id}`;
  if (!board) return NextResponse.json({ error: 'board not found' }, { status: 404 });

  const [edge] = await sql`
    INSERT INTO edges (board_id, source_node_id, target_node_id, kind, payload)
    VALUES (${boardId}, ${sourceNodeId}, ${targetNodeId}, ${kind}, ${payload}::jsonb)
    RETURNING *
  `;
  return NextResponse.json({ edge });
}
