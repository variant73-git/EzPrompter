import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import {
  openOrResumeEditSession,
  updateEditSessionDraft,
} from '../../../../../lib/motion-editor/edit-session-store.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sessionJson(session) {
  return {
    id: session.id,
    nodeId: session.nodeId,
    baseSnapshotId: session.baseSnapshotId,
    baseBundleId: session.baseBundleId,
    draftManifest: session.draftManifest,
    revision: session.revision,
    status: session.status,
    updatedAt: session.updatedAt ?? null,
  };
}

function noStore(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return NextResponse.json(body, { ...init, headers });
}

function storeError(error) {
  if (error?.code === 'not_found') return noStore({ error: 'not_found' }, { status: 404 });
  if (['revision_conflict', 'base_snapshot_changed', 'session_closed', 'base_bundle_mismatch'].includes(error?.code)) {
    return noStore({
      error: error.code,
      ...(error.currentRevision == null ? {} : { currentRevision: Number(error.currentRevision) }),
    }, { status: 409 });
  }
  if (error instanceof TypeError) return noStore({ error: 'invalid_request' }, { status: 400 });
  return noStore({ error: 'temporarily_unavailable' }, { status: 503 });
}

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  try {
    const sql = await db();
    const [row] = await sql`
      SELECT n.current_snapshot_id AS snapshot_id
        FROM nodes n
        JOIN boards b ON b.id = n.board_id
        JOIN snapshots s ON s.id = n.current_snapshot_id AND s.node_id = n.id
       WHERE n.id = ${id}
         AND b.user_id = ${user.id}
         AND s.native_bundle_id IS NOT NULL
    `;
    if (!row?.snapshot_id) return noStore({ error: 'not_found' }, { status: 404 });
    const session = await openOrResumeEditSession({
      sql,
      userId: user.id,
      nodeId: id,
      baseSnapshotId: row.snapshot_id,
    });
    return noStore({ session: sessionJson(session) });
  } catch (sessionError) {
    return storeError(sessionError);
  }
}

export async function PATCH(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.sessionId !== 'string'
    || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
    || !body.draftManifest || typeof body.draftManifest !== 'object') {
    return noStore({ error: 'invalid_request' }, { status: 400 });
  }
  try {
    const sql = await db();
    const session = await updateEditSessionDraft({
      sql,
      userId: user.id,
      nodeId: id,
      sessionId: body.sessionId,
      expectedRevision: body.expectedRevision,
      draftManifest: body.draftManifest,
    });
    return noStore({ session: sessionJson(session) });
  } catch (sessionError) {
    return storeError(sessionError);
  }
}
