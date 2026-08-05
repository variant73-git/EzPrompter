import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../lib/auth.js';
import { createReferencePlan } from '../../../../lib/reference-planner.js';
import { getReviewedPlanningCandidates, saveShadowReferencePlan } from '../../../../lib/reference-bank-store.js';
import { canCuratePrivateReferences } from '../../../../lib/reference-privacy.js';

export async function POST(request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let input;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const brief = String(input?.brief || '').trim();
  const maxReferences = Math.min(3, Math.max(1, Number(input?.maxReferences) || 3));
  const candidates = await getReviewedPlanningCandidates(user.id, {
    includePrivate: canCuratePrivateReferences(user),
  });
  const result = createReferencePlan({ brief, candidates, maxReferences });
  if (!result.ok) {
    const status = result.error === 'review_required' ? 409 : 400;
    return NextResponse.json(result, { status });
  }

  const record = await saveShadowReferencePlan(user.id, brief, result.plan);
  return NextResponse.json({
    id: record.id,
    status: record.status,
    createdAt: record.created_at,
    plan: result.plan,
  }, { status: 201 });
}
