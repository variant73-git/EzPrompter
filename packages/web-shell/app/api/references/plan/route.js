import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../lib/auth.js';
import { approveReferencePlanPreview, createManualReferenceCandidate } from '../../../../lib/reference-planner.js';
import { getReviewedPlanningCandidates, saveApprovedReferencePlan } from '../../../../lib/reference-bank-store.js';
import { canCuratePrivateReferences } from '../../../../lib/reference-privacy.js';

export async function POST(request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let input;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const brief = String(input?.brief || '').trim();
  let candidates;
  try {
    candidates = input?.referenceUrl
      ? [createManualReferenceCandidate({ url: input.referenceUrl, brief })]
      : await getReviewedPlanningCandidates(user.id, {
        includePrivate: canCuratePrivateReferences(user),
      });
  } catch (error) {
    if (error.message === 'invalid_reference_url') return NextResponse.json({ error: 'invalid_reference_url' }, { status: 400 });
    throw error;
  }
  const result = approveReferencePlanPreview({
    brief,
    candidates,
    optionOffset: input?.optionOffset,
    previewHash: input?.previewHash,
    selectedReferenceId: input?.selectedReferenceId,
  });
  if (!result.ok) {
    const status = ['review_required', 'preview_stale'].includes(result.error) ? 409 : 400;
    return NextResponse.json(result, { status });
  }

  const record = await saveApprovedReferencePlan(user.id, brief, result.plan);
  return NextResponse.json({
    id: record.id,
    status: record.status,
    createdAt: record.created_at,
    plan: result.plan,
  }, { status: 201 });
}
