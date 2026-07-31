import { describe, expect, it } from 'vitest';
import { mapReferenceRow, queryPersistentReferenceCatalog } from './reference-bank-store.js';

describe('persistent reference row mapping', () => {
  it('keeps provenance and private review metadata separate', () => {
    const reference = mapReferenceRow({
      id: 'ref_one',
      title: 'Antinomy',
      canonical_url: 'https://antinomy.studio',
      host: 'antinomy.studio',
      categories: ['Studio'],
      tags: ['Motion'],
      sources: [{ id: 'codrops', name: 'Codrops' }, { id: 'siteinspire', name: 'SiteInspire' }],
      editorial_consensus: 2,
      curation_weight: '1.6',
      curation_rank: 3,
      preference_decision: 'keep',
      preference_rating: 5,
      preference_role: 'chassis',
      preference_business_tags: ['agency'],
      preference_visual_tags: ['immersive'],
      preference_motion_tags: ['scroll-driven'],
    });
    expect(reference.sourceIds).toEqual(['codrops', 'siteinspire']);
    expect(reference.reviewCandidate).toBe(true);
    expect(reference.preference).toMatchObject({ decision: 'keep', rating: 5, preferredRole: 'chassis' });
  });

  it('limits the seed fallback review queue to the same 24 candidates as persistence', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const page = await queryPersistentReferenceCatalog({ userId: 1, view: 'review', limit: 48 });
      expect(page.persistence).toBe('seed');
      expect(page.total).toBe(24);
      expect(page.items).toHaveLength(24);
      expect(page.items.every((item) => item.reviewCandidate)).toBe(true);
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});
