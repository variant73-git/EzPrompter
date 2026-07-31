import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../lib/auth.js';
import { queryReferenceCatalog } from '../../../lib/reference-bank.js';

export async function GET(request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const result = queryReferenceCatalog({
    query: params.get('q') || '',
    source: params.get('source') || 'all',
    category: params.get('category') || 'all',
    sort: params.get('sort') || 'curated',
    offset: params.get('offset') || 0,
    limit: params.get('limit') || 48,
  });
  return NextResponse.json(result);
}
