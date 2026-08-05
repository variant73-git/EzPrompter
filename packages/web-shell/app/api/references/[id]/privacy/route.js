import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../lib/auth.js';
import { saveReferencePrivacy } from '../../../../../lib/reference-bank-store.js';
import { canCuratePrivateReferences } from '../../../../../lib/reference-privacy.js';

export async function PUT(request, { params }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!canCuratePrivateReferences(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (!id || id.length > 128) return NextResponse.json({ error: 'invalid_reference' }, { status: 400 });

  let input;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof input?.isPrivate !== 'boolean') {
    return NextResponse.json({ error: 'invalid_privacy' }, { status: 400 });
  }

  const privacy = await saveReferencePrivacy(id, input.isPrivate);
  if (!privacy) return NextResponse.json({ error: 'reference_not_found' }, { status: 404 });
  return NextResponse.json({ privacy });
}
