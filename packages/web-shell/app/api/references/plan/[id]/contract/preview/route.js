import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../lib/auth.js';
import { createChassisTargetContractPreview } from '../../../../../../../lib/chassis-target-contract.js';
import { analyzeTargetAuthority } from '../../../../../../../lib/chassis-target-evidence.js';
import { getOwnedBoardTarget, getShadowReferencePlan } from '../../../../../../../lib/reference-bank-store.js';

function errorResponse(error) {
  const code = error.message || 'target_contract_invalid';
  const status = code === 'target_project_not_found' ? 404 : 400;
  return NextResponse.json({ error: code }, { status });
}

export async function POST(request, { params }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  let input;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const record = await getShadowReferencePlan(user.id, id);
  if (!record) return NextResponse.json({ error: 'plan_not_found' }, { status: 404 });
  if (record.status !== 'approved') return NextResponse.json({ error: 'plan_approval_required' }, { status: 409 });
  if (!record.plan?.chassisManifest) return NextResponse.json({ error: 'chassis_manifest_required' }, { status: 409 });

  try {
    const project = input?.authorityType === 'project'
      ? await getOwnedBoardTarget(user.id, input.projectId)
      : null;
    const evidence = await analyzeTargetAuthority({ input, project });
    const contract = createChassisTargetContractPreview({ manifest: record.plan.chassisManifest, input, project, evidence });
    return NextResponse.json({ contract });
  } catch (error) {
    return errorResponse(error);
  }
}
