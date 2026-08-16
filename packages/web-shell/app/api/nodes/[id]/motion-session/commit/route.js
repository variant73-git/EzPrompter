import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../../lib/auth.js';
import { db } from '../../../../../../lib/db.js';
import { commitEditSession } from '../../../../../../lib/motion-editor/edit-session-store.js';
import { MOTION_MANIFEST_SCHEMA_VERSION } from '../../../../../../lib/motion-editor/manifest.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COMMIT_REASONS = new Set(['exit', 'save-version', 'before-structural-operation']);

function json(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return NextResponse.json(body, { ...init, headers });
}

function failure(error) {
  if (error?.code === 'not_found') return json({ error: 'not_found' }, { status: 404 });
  if (['revision_conflict', 'base_snapshot_changed', 'session_closed'].includes(error?.code)) {
    return json({
      error: error.code,
      ...(error.currentRevision == null ? {} : { currentRevision: Number(error.currentRevision) }),
    }, { status: 409 });
  }
  if (error instanceof TypeError) return json({ error: 'invalid_request' }, { status: 400 });
  return json({ error: 'temporarily_unavailable' }, { status: 503 });
}

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.sessionId !== 'string'
    || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
    || !COMMIT_REASONS.has(body.reason)) {
    return json({ error: 'invalid_request' }, { status: 400 });
  }
  try {
    const sql = await db();
    const committed = await commitEditSession({
      sql,
      userId: user.id,
      nodeId: id,
      sessionId: body.sessionId,
      expectedRevision: body.expectedRevision,
      continueEditing: body.reason !== 'exit',
    });
    return json({
      reason: body.reason,
      snapshot: {
        id: committed.snapshotId,
        nativeBundleId: committed.baseBundleId,
        motionManifestVersion: MOTION_MANIFEST_SCHEMA_VERSION,
      },
      session: {
        id: committed.sessionId,
        nodeId: committed.nodeId,
        baseSnapshotId: committed.baseSnapshotId || committed.snapshotId,
        baseBundleId: committed.baseBundleId,
        revision: committed.revision,
        status: committed.status,
      },
    });
  } catch (commitError) {
    return failure(commitError);
  }
}
