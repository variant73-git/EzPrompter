import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../lib/auth.js';
import { normalizeReferencePreference } from '../../../../../lib/reference-preferences.js';
import { saveReferencePreference } from '../../../../../lib/reference-bank-store.js';

export async function PUT(request, { params }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!id || id.length > 128) return NextResponse.json({ error: 'invalid_reference' }, { status: 400 });

  let input;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const normalized = normalizeReferencePreference(input);
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });

  try {
    const preference = await saveReferencePreference(user.id, id, normalized.value);
    return NextResponse.json({ referenceId: id, preference });
  } catch (error) {
    if (error?.code === '23503') return NextResponse.json({ error: 'reference_not_found' }, { status: 404 });
    throw error;
  }
}
