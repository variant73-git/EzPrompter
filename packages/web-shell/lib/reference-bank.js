import seed from './reference-bank.seed.json';

export function getReferenceCatalog({ limit } = {}) {
  const references = seed.references || [];
  return Number.isFinite(limit) ? references.slice(0, Math.max(0, limit)) : references;
}

function containsQuery(reference, query) {
  if (!query) return true;
  const haystack = [
    reference.title,
    reference.host,
    reference.description,
    ...(reference.categories || []),
    ...(reference.tags || []),
    ...(reference.sourceNames || []),
  ].join(' ').toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

function facetCounts(references, field) {
  const counts = new Map();
  for (const reference of references) {
    for (const value of reference[field] || []) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function queryReferenceCatalog({
  query = '',
  source = 'all',
  category = 'all',
  sort = 'curated',
  offset = 0,
  limit = 48,
} = {}) {
  const references = seed.references || [];
  const filtered = references.filter((reference) => (
    (source === 'all' || reference.sourceIds?.includes(source))
    && (category === 'all' || reference.categories?.includes(category))
    && containsQuery(reference, query.trim())
  ));

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'newest') {
      return String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')) || a.title.localeCompare(b.title);
    }
    if (sort === 'name') return a.title.localeCompare(b.title);
    return b.curationWeight - a.curationWeight
      || b.editorialConsensus - a.editorialConsensus
      || String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))
      || a.title.localeCompare(b.title);
  });

  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.min(96, Math.max(1, Number(limit) || 48));
  const items = sorted.slice(safeOffset, safeOffset + safeLimit);
  return {
    items,
    total: sorted.length,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + items.length < sorted.length,
    facets: {
      sources: facetCounts(references, 'sourceIds'),
      categories: facetCounts(references, 'categories'),
    },
  };
}

export function getReferenceCatalogStats() {
  return {
    generatedAt: seed.generatedAt || null,
    ...(seed.stats || {}),
  };
}
