import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../lib/auth.js';
import { createReferencePlan } from '../../../../lib/reference-planner.js';
import { getReviewedPlanningCandidates, saveShadowReferencePlan } from '../../../../lib/reference-bank-store.js';

export async function POST(request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let input;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const brief = String(input?.brief || '').trim();
  const maxReferences = Math.min(4, Math.max(2, Number(input?.maxReferences) || 4));
  const candidates = await getReviewedPlanningCandidates(user.id);
  const result = createReferencePlan({ brief, candidates, maxReferences });
  if (!result.ok) {
    const status = ['review_required', 'donor_required'].includes(result.error) ? 409 : 400;
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
