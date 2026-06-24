import { NextResponse } from 'next/server';
import { db } from '../../../lib/db.js';
import { requireUser } from '../../../lib/auth.js';

const VALID_KINDS = new Set(['transplant', 'token-swap', 'reskin', 'generic']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // The *_node_id columns are UUID — a non-UUID id (e.g. an optimistic
  // `temp-…` node still being created) makes the INSERT's implicit ::uuid cast
  // throw, surfacing as an opaque 500. Reject it cleanly so the client can tell
  // the user the node isn't ready yet instead of "Internal Server Error".
  if (!UUID_RE.test(sourceNodeId) || !UUID_RE.test(targetNodeId)) {
    return NextResponse.json({ error: 'node not ready — finish creating it before connecting' }, { status: 409 });
  }

  const sql = await db();
  const [board] = await sql`SELECT id FROM boards WHERE id = ${boardId} AND user_id = ${user.id}`;
  if (!board) return NextResponse.json({ error: 'board not found' }, { status: 404 });

  // Both endpoints must still exist on this board — a stale client referencing
  // a since-deleted node would otherwise hit a foreign-key 500.
  const present = await sql`
    SELECT id FROM nodes
    WHERE board_id = ${boardId} AND id = ANY(${[sourceNodeId, targetNodeId]}::uuid[])
  `;
  if (present.length < 2) {
    return NextResponse.json({ error: 'one of the nodes no longer exists' }, { status: 404 });
  }

  try {
    const [edge] = await sql`
      INSERT INTO edges (board_id, source_node_id, target_node_id, kind, payload)
      VALUES (${boardId}, ${sourceNodeId}, ${targetNodeId}, ${kind}, ${payload}::jsonb)
      RETURNING *
    `;
    return NextResponse.json({ edge });
  } catch (e) {
    return NextResponse.json({ error: `could not create edge: ${e.message}` }, { status: 500 });
  }
}
