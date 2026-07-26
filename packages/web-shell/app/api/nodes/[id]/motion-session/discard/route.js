import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../../lib/auth.js';
import { db } from '../../../../../../lib/db.js';
import { discardEditSession } from '../../../../../../lib/motion-editor/edit-session-store.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function json(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return NextResponse.json(body, { ...init, headers });
}

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.sessionId !== 'string') {
    return json({ error: 'invalid_request' }, { status: 400 });
  }
  try {
    const sql = await db();
    const session = await discardEditSession({
      sql,
      userId: user.id,
      nodeId: id,
      sessionId: body.sessionId,
    });
    return json({
      session: {
        id: session.id,
        nodeId: session.nodeId,
        baseSnapshotId: session.baseSnapshotId,
        revision: session.revision,
        status: session.status,
      },
    });
  } catch (discardError) {
    if (discardError?.code === 'not_found') return json({ error: 'not_found' }, { status: 404 });
    return json({ error: 'temporarily_unavailable' }, { status: 503 });
  }
}
