import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../lib/auth.js';
import { createManualReferenceCandidate, createReferencePlanPreview } from '../../../../../lib/reference-planner.js';
import { getReviewedPlanningCandidates } from '../../../../../lib/reference-bank-store.js';
import { canCuratePrivateReferences } from '../../../../../lib/reference-privacy.js';

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
  const result = createReferencePlanPreview({ brief, candidates, optionOffset: input?.optionOffset });
  if (!result.ok) {
    const status = result.error === 'review_required' ? 409 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ preview: result.preview });
}
