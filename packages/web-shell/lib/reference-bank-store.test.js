import { describe, expect, it } from 'vitest';
import { encodeReferenceGuidance } from './reference-guidance.js';
import { calculateSourceConfidence, mapReferenceRow, queryPersistentReferenceCatalog } from './reference-bank-store.js';

describe('persistent reference row mapping', () => {
  it('keeps provenance and private review metadata separate', () => {
    const reference = mapReferenceRow({
      id: 'ref_one',
      title: 'Antinomy',
      canonical_url: 'https://antinomy.studio',
      host: 'antinomy.studio',
      categories: ['Studio'],
      tags: ['Motion'],
      sources: [{ id: 'codrops', name: 'Codrops', overallRating: 4 }, { id: 'siteinspire', name: 'SiteInspire', overallRating: 3 }],
      editorial_consensus: 2,
      curation_weight: '1.6',
      curation_rank: 3,
      cohort_rank: 3,
      preference_decision: 'keep',
      preference_rating: 5,
      preference_role: 'chassis',
      preference_business_tags: ['agency'],
      preference_visual_tags: ['immersive'],
      preference_motion_tags: ['scroll-driven'],
      preference_visual_quality: 5,
      preference_transferability: 4,
      preference_notes: encodeReferenceGuidance({ worthBorrowing: 'The section rhythm.', avoid: 'The loader.' }),
      is_private: true,
      privacy_reason: 'webbuilder-template',
      template_platform: 'framer',
    });
    expect(reference.sourceIds).toEqual(['codrops', 'siteinspire']);
    expect(reference.reviewCandidate).toBe(true);
    expect(reference.preference).toMatchObject({ decision: 'keep', rating: 5, preferredRole: 'chassis' });
    expect(reference.preference).toMatchObject({ worthBorrowing: 'The section rhythm.', avoid: 'The loader.' });
    expect(reference.preference.dimensionRatings).toMatchObject({ visualQuality: 5, transferability: 4 });
    expect(reference.sourceConfidence).toBeGreaterThan(0.7);
    expect(reference).toMatchObject({
      isPrivate: true,
      privacyReason: 'webbuilder-template',
      templatePlatform: 'framer',
    });
  });

  it('caps aggregator consensus so source provenance remains a weak signal', () => {
    expect(calculateSourceConfidence([{ overallRating: 5 }, { overallRating: 5 }, { overallRating: 5 }])).toBe(1);
    expect(calculateSourceConfidence([])).toBe(0.6);
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
      expect(page.facets.all).toMatchObject({ count: expect.any(Number), decided: 0 });
      expect(page.facets.sources.every((item) => item.decided === 0)).toBe(true);
      expect(page.reviewCohort).toMatchObject({ id: 'cohort_v1', status: 'frozen', rubricVersion: 2 });
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});
