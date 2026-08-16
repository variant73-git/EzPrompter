import { describe, expect, it } from 'vitest';
import { decodeReferenceGuidance } from './reference-guidance.js';
import { normalizeReferencePreference } from './reference-preferences.js';

describe('reference preference contract', () => {
  it('keeps only bounded ratings, product/style tags, and notes', () => {
    const result = normalizeReferencePreference({
      decision: 'keep',
      rating: 5,
      preferredRole: 'chassis',
      productTypes: ['saas', 'unknown'],
      styleTags: ['soft-tech', 'soft-tech', 'corporate', 'playful'],
      motionTags: ['scroll-driven'],
      dimensionRatings: { visualQuality: 5, transferability: 4 },
      notes: '  Preserve the pinned hero.  ',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        decision: 'keep',
        rating: 5,
        preferredRole: 'either',
        businessTags: ['saas'],
        visualTags: ['soft-tech', 'corporate'],
        motionTags: ['scroll-driven'],
        dimensionRatings: {
          visualQuality: 5,
          structureQuality: null,
          motionQuality: null,
          originality: null,
          transferability: 4,
          commercialClarity: null,
        },
        notes: 'Preserve the pinned hero.',
      },
    });
  });

  it('accepts a verdict without forcing a score and rejects invalid scores', () => {
    expect(normalizeReferencePreference({ decision: 'approve' })).toMatchObject({ ok: false, error: 'invalid_decision' });
    expect(normalizeReferencePreference({ decision: 'maybe' })).toMatchObject({ ok: true, value: { rating: null } });
    expect(normalizeReferencePreference({ decision: 'maybe', rating: 7 })).toMatchObject({ ok: false, error: 'invalid_rating' });
    expect(normalizeReferencePreference({ decision: 'keep', rating: 5, dimensionRatings: { motionQuality: 9 } })).toMatchObject({ ok: false, error: 'invalid_dimension_rating' });
  });

  it('stores structured transfer guidance without changing the database schema', () => {
    const result = normalizeReferencePreference({
      decision: 'keep',
      worthBorrowing: 'The wireframe and image roles.',
      avoid: 'The hero distortion.',
    });
    expect(result.ok).toBe(true);
    expect(decodeReferenceGuidance(result.value.notes)).toEqual({
      worthBorrowing: 'The wireframe and image roles.',
      avoid: 'The hero distortion.',
    });
  });

  it('drops deep weights below the high-quality threshold', () => {
    const result = normalizeReferencePreference({ decision: 'maybe', rating: 3, dimensionRatings: { visualQuality: 5 } });
    expect(result.ok).toBe(true);
    expect(Object.values(result.value.dimensionRatings).every((value) => value == null)).toBe(true);
  });
});
