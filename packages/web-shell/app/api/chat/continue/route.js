import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { hasRun, resolveContinue } from '../../../../lib/agent/run-map.js';

export const runtime = 'nodejs';

export async function POST(request) {
  const { error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { runId, action } = body || {};

  if (!runId || !action) {
    return NextResponse.json({ error: 'runId, action required' }, { status: 400 });
  }
  if (!['continue', 'stop'].includes(action)) {
    return NextResponse.json({ error: 'action must be continue|stop' }, { status: 400 });
  }
  if (!hasRun(runId)) {
    return NextResponse.json({ error: 'unknown run' }, { status: 404 });
  }

  const ok = resolveContinue(runId, { action });
  if (!ok) return NextResponse.json({ error: 'no soft-pause pending' }, { status: 404 });
  return new Response(null, { status: 204 });
}
