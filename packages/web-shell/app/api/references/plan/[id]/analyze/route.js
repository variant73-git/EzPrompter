import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../lib/auth.js';
import { analyzeChassisReference } from '../../../../../../lib/chassis-analyzer.js';
import { getShadowReferencePlan, saveShadowReferenceManifest } from '../../../../../../lib/reference-bank-store.js';

export async function POST(request, { params }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const record = await getShadowReferencePlan(user.id, id);
  if (!record) return NextResponse.json({ error: 'plan_not_found' }, { status: 404 });
  if (record.status !== 'approved') return NextResponse.json({ error: 'plan_approval_required' }, { status: 409 });
  if (record.plan?.chassisManifest) return NextResponse.json({ manifest: record.plan.chassisManifest, cached: true });
  const reference = record.plan?.selectedReferences?.[0];
  if (!reference?.url) return NextResponse.json({ error: 'reference_missing' }, { status: 409 });
  try {
    const manifest = await analyzeChassisReference({ reference, guidance: reference.guidance || {} });
    const saved = await saveShadowReferenceManifest(user.id, id, manifest);
    if (!saved) return NextResponse.json({ error: 'plan_not_found_or_not_approved' }, { status: 409 });
    return NextResponse.json({ manifest, cached: false });
  } catch (error) {
    return NextResponse.json({ error: 'analysis_failed', detail: error.message }, { status: 502 });
  }
}
