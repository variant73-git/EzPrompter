import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../lib/auth.js';
import { updateShadowReferencePlan } from '../../../../../lib/reference-bank-store.js';

export async function PATCH(request, { params }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  let input;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!['approved', 'rejected'].includes(input?.status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }
  const plan = await updateShadowReferencePlan(user.id, id, input.status);
  if (!plan) return NextResponse.json({ error: 'plan_not_found_or_already_reviewed' }, { status: 404 });
  return NextResponse.json({ plan });
}
