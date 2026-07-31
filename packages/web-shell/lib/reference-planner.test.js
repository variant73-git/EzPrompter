import { describe, expect, it } from 'vitest';
import { createReferencePlan, inferReferenceBrief } from './reference-planner.js';

function candidate(id, preference) {
  return {
    id,
    title: id.toUpperCase(),
    url: `https://${id}.example`,
    curationWeight: 1.2,
    preference: { decision: 'keep', rating: 4, preferredRole: 'either', businessTags: [], visualTags: [], motionTags: [], ...preference },
  };
}

describe('reference shadow planner', () => {
  it('turns a brief into structured business, visual, and motion signals', () => {
    expect(inferReferenceBrief('A cinematic animated site for an industrial robotics platform')).toMatchObject({
      businessTags: expect.arrayContaining(['technology', 'industrial']),
      visualTags: expect.arrayContaining(['immersive']),
      motionTags: expect.arrayContaining(['scroll-driven', 'video-led']),
    });
  });

  it('selects exactly one chassis and bounded donors without triggering generation', () => {
    const result = createReferencePlan({
      brief: 'A cinematic animated website for an industrial robotics platform',
      candidates: [
        candidate('motion', { preferredRole: 'chassis', businessTags: ['industrial'], visualTags: ['immersive'], motionTags: ['scroll-driven', 'pinned'] }),
        candidate('type', { preferredRole: 'donor', visualTags: ['typographic', 'minimal'] }),
        candidate('media', { preferredRole: 'donor', visualTags: ['photographic'], motionTags: ['video-led'] }),
        candidate('passed', { decision: 'pass', rating: 5 }),
      ],
      maxReferences: 4,
    });
    expect(result.ok).toBe(true);
    expect(result.plan.generationTriggered).toBe(false);
    expect(result.plan.selectedReferences.filter((item) => item.role === 'chassis')).toHaveLength(1);
    expect(result.plan.selectedReferences).toHaveLength(3);
    expect(result.plan.selectedReferences.map((item) => item.id)).not.toContain('passed');
    expect(result.plan.selectedReferences[0]).toMatchObject({ id: 'motion', role: 'chassis' });
  });

  it('requires at least two manually reviewed candidates', () => {
    expect(createReferencePlan({ brief: 'A premium technology landing page', candidates: [] })).toMatchObject({ ok: false, error: 'review_required' });
  });
});
