import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../lib/auth.js';
import { queryPersistentReferenceCatalog } from '../../../lib/reference-bank-store.js';
import { canCuratePrivateReferences } from '../../../lib/reference-privacy.js';

export async function GET(request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const view = params.get('view') || 'browse';
  const canManagePrivateReferences = canCuratePrivateReferences(user);
  const result = await queryPersistentReferenceCatalog({
    userId: user.id,
    query: params.get('q') || '',
    source: params.get('source') || 'all',
    category: params.get('category') || 'all',
    sort: params.get('sort') || 'curated',
    view,
    includePrivate: canManagePrivateReferences && ['review', 'curate'].includes(view),
    offset: params.get('offset') || 0,
    limit: params.get('limit') || 48,
  });
  return NextResponse.json({ ...result, canManagePrivateReferences });
}
