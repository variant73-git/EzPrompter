import { describe, expect, it } from 'vitest';
import { getReferenceCatalogStats, queryReferenceCatalog } from './reference-bank.js';

describe('reference catalog seed', () => {
  it('contains the initial multi-source catalog and reports merged duplicates', () => {
    const stats = getReferenceCatalogStats();
    expect(stats.references).toBeGreaterThan(800);
    expect(stats.appearances).toBeGreaterThan(stats.references);
    expect(stats.duplicatesMerged).toBeGreaterThan(0);
    expect(stats.sources).toMatchObject({ codrops: expect.any(Number), pafolios: expect.any(Number), siteinspire: expect.any(Number) });
  });

  it('supports source, category, search, sorting, and bounded pagination', () => {
    const result = queryReferenceCatalog({ source: 'codrops', query: 'studio', sort: 'name', limit: 500 });
    expect(result.limit).toBe(96);
    expect(result.items.every((item) => item.sourceIds.includes('codrops'))).toBe(true);
    expect(result.items.every((item) => [item.title, item.host, item.description, ...item.categories, ...item.tags].join(' ').toLowerCase().includes('studio'))).toBe(true);
    expect(result.facets.sources.length).toBeGreaterThanOrEqual(3);
  });
});
