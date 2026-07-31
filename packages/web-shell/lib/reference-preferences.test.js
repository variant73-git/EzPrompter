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
        notes: 'Preserve the pinned hero.',
      },
    });
  });

  it('rejects invalid decisions and ratings', () => {
    expect(normalizeReferencePreference({ decision: 'approve' })).toMatchObject({ ok: false, error: 'invalid_decision' });
    expect(normalizeReferencePreference({ decision: 'maybe', rating: 7 })).toMatchObject({ ok: false, error: 'invalid_rating' });
  });
});
