import { describe, expect, it } from 'vitest';
import { createReferencePlan, getBriefWeightProfile, inferReferenceBrief, scoreReferenceCandidate } from './reference-planner.js';

function candidate(id, preference) {
  return {
    id,
    title: id.toUpperCase(),
    url: `https://${id}.example`,
    curationWeight: 1.2,
    sourceConfidence: 0.6,
    preference: { decision: 'keep', rating: null, preferredRole: 'either', businessTags: [], visualTags: [], motionTags: [], dimensionRatings: {}, ...preference },
  };
}

describe('reference shadow planner v3', () => {
  it('turns a brief into product, style, brand, and motion hints with bounded tags', () => {
    expect(inferReferenceBrief('A playful, bold and approachable futuristic animated SaaS tool with a fashion tone')).toMatchObject({
      productTypes: expect.arrayContaining(['saas', 'tool']),
      styleTags: ['futuristic', 'fashion'],
      brandAttributes: ['playful', 'approachable', 'bold'],
      motionTags: expect.arrayContaining(['scroll-driven']),
    });
  });

  it('keeps brand personality independent from the business category', () => {
    const playfulFintech = inferReferenceBrief('Uma landing para fintech, lúdica, extrovertida e amigável');
    expect(playfulFintech.brandAttributes).toEqual(['playful', 'extroverted', 'approachable']);
    expect(playfulFintech.brandAttributes).not.toContain('sober');
    expect(playfulFintech.productTypes).not.toContain('app');
  });

  it('selects a contextual scale owner without fixed per-site roles', () => {
    const result = createReferencePlan({
      brief: 'A futuristic animated SaaS tool for security teams',
      candidates: [
        candidate('structure', { businessTags: ['saas', 'tool'], visualTags: ['futuristic'], dimensionRatings: { structureQuality: 5, transferability: 5 } }),
        candidate('motion', { visualTags: ['futuristic'], motionTags: ['scroll-driven', 'pinned'], dimensionRatings: { motionQuality: 5 } }),
        candidate('passed', { decision: 'pass', rating: 5 }),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.plan.schemaVersion).toBe(3);
    expect(result.plan.selectedReferences).toHaveLength(2);
    expect(result.plan.selectedReferences.map((item) => item.id)).not.toContain('passed');
    expect(result.plan.selectedReferences.filter((item) => item.scaleOwner)).toHaveLength(1);
    expect(result.plan.selectedReferences[0]).toMatchObject({ id: 'structure', influence: 'scale-owner' });
    expect(result.plan.rule).toContain('No fixed roles per site');
  });

  it('weights product/style match as a weak hint and structure more heavily', () => {
    const profile = inferReferenceBrief('A corporate SaaS platform');
    const weighted = { ...profile, weighting: getBriefWeightProfile(profile) };
    const strongStructure = scoreReferenceCandidate(candidate('strong', {
      dimensionRatings: { structureQuality: 5, transferability: 5, visualQuality: 4 },
    }), weighted);
    const exactTags = scoreReferenceCandidate(candidate('tags', {
      businessTags: ['saas', 'corporate-site'], visualTags: ['corporate'],
      dimensionRatings: { structureQuality: 2, transferability: 2, visualQuality: 3 },
    }), weighted);
    expect(strongStructure.score).toBeGreaterThan(exactTags.score);
    expect(strongStructure.breakdown.sourceConfidence).toBe(60);
  });

  it('can plan from one kept reference and does not require a donor', () => {
    const result = createReferencePlan({ brief: 'A premium corporate landing page', candidates: [candidate('only', {})] });
    expect(result.ok).toBe(true);
    expect(result.plan.selectedReferences).toHaveLength(1);
    expect(result.plan.selectedReferences[0].scaleOwner).toBe(true);
  });

  it('requires at least one human-reviewed candidate', () => {
    expect(createReferencePlan({ brief: 'A premium technology landing page', candidates: [] })).toMatchObject({ ok: false, error: 'review_required', required: 1 });
  });
});
