import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { hasRun, cancelRun } from '../../../../lib/agent/run-map.js';

export const runtime = 'nodejs';

export async function POST(request) {
  const { error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { runId } = body || {};
  if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });
  if (!hasRun(runId)) return NextResponse.json({ error: 'unknown run' }, { status: 404 });

  cancelRun(runId);
  return new Response(null, { status: 204 });
}
