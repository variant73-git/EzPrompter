import { describe, expect, it } from 'vitest';
import { normalizeReferencePreference } from './reference-preferences.js';

describe('reference preference contract', () => {
  it('keeps only bounded ratings, roles, tags, and notes', () => {
    const result = normalizeReferencePreference({
      decision: 'keep',
      rating: 5,
      preferredRole: 'chassis',
      businessTags: ['technology', 'unknown'],
      visualTags: ['immersive', 'immersive'],
      motionTags: ['scroll-driven'],
      dimensionRatings: { visualQuality: 5, transferability: 4 },
      notes: '  Preserve the pinned hero.  ',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        decision: 'keep',
        rating: 5,
        preferredRole: 'chassis',
        businessTags: ['technology'],
        visualTags: ['immersive'],
        motionTags: ['scroll-driven'],
        dimensionRatings: {
          visualQuality: 5,
          structureQuality: null,
          motionQuality: null,
          originality: null,
          transferability: 4,
          commercialClarity: null,
          chassisPotential: null,
          donorPotential: null,
        },
        notes: 'Preserve the pinned hero.',
      },
    });
  });

  it('rejects invalid decisions and ratings', () => {
    expect(normalizeReferencePreference({ decision: 'approve' })).toMatchObject({ ok: false, error: 'invalid_decision' });
    expect(normalizeReferencePreference({ decision: 'maybe' })).toMatchObject({ ok: false, error: 'rating_required' });
    expect(normalizeReferencePreference({ decision: 'maybe', rating: 7 })).toMatchObject({ ok: false, error: 'invalid_rating' });
    expect(normalizeReferencePreference({ decision: 'keep', rating: 5, dimensionRatings: { motionQuality: 9 } })).toMatchObject({ ok: false, error: 'invalid_dimension_rating' });
  });

  it('drops deep weights below the high-quality threshold', () => {
    const result = normalizeReferencePreference({ decision: 'maybe', rating: 3, dimensionRatings: { visualQuality: 5 } });
    expect(result.ok).toBe(true);
    expect(Object.values(result.value.dimensionRatings).every((value) => value == null)).toBe(true);
  });
});
