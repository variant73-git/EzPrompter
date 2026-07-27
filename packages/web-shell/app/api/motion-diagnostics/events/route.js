import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { db } from '../../../../lib/db.js';
import {
  DiagnosticValidationError,
  MOTION_DIAGNOSTIC_MAX_BYTES,
  persistMotionDiagnosticEvents,
  pruneExpiredMotionDiagnostics,
  resolveOwnedDiagnosticContext,
  sanitizeMotionDiagnosticBatch,
} from '../../../../lib/motion-editor/diagnostics.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function noStore(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return NextResponse.json(body, { ...init, headers });
}

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const contentLength = Number(request.headers?.get?.('content-length') || 0);
  if (contentLength > MOTION_DIAGNOSTIC_MAX_BYTES) {
    return noStore({ error: 'payload_too_large' }, { status: 413 });
  }
  const input = await request.json().catch(() => null);
  let batch;
  try {
    batch = sanitizeMotionDiagnosticBatch(input || {});
  } catch (batchError) {
    const status = batchError?.code === 'oversized_batch' ? 413 : 400;
    return noStore({ error: batchError instanceof DiagnosticValidationError ? batchError.code : 'invalid_request' }, { status });
  }

  try {
    const sql = await db();
    const context = await resolveOwnedDiagnosticContext(sql, {
      userId: user.id,
      sessionId: batch.sessionId,
    });
    if (!context) return noStore({ error: 'not_found' }, { status: 404 });
    const productionEvents = batch.events.map((event) => ({
      ...event,
      source: event.source === 'smoke' ? 'runtime' : event.source,
      origin: 'production',
      siteClass: 'production',
    }));
    await persistMotionDiagnosticEvents(sql, context, productionEvents);
    await pruneExpiredMotionDiagnostics(sql).catch(() => null);
    return noStore({ accepted: batch.events.length }, { status: 202 });
  } catch {
    return noStore({ error: 'temporarily_unavailable' }, { status: 503 });
  }
}
