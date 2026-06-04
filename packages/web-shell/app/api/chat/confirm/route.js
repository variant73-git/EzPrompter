import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { hasRun, resolveConfirm, resolveChoice } from '../../../../lib/agent/run-map.js';

export const runtime = 'nodejs';

export async function POST(request) {
  const { error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { runId, toolCallId, action, choice } = body || {};

  if (!runId || !toolCallId || !action) {
    return NextResponse.json({ error: 'runId, toolCallId, action required' }, { status: 400 });
  }
  if (!['confirm', 'skip'].includes(action)) {
    return NextResponse.json({ error: 'action must be confirm|skip' }, { status: 400 });
  }
  if (!hasRun(runId)) {
    return NextResponse.json({ error: 'unknown run' }, { status: 404 });
  }

  // Try choice first (if this is a needs_choice resolution) then confirm.
  const decision = { action, ...(choice ? { choice } : {}) };
  const choiceResolved = resolveChoice(runId, toolCallId, decision);
  if (!choiceResolved) {
    const confirmResolved = resolveConfirm(runId, toolCallId, decision);
    if (!confirmResolved) {
      return NextResponse.json({ error: 'no pending decision for that toolCallId' }, { status: 404 });
    }
  }
  return new Response(null, { status: 204 });
}
