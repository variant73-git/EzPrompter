import { describe, expect, it } from 'vitest';
import {
  approveReferencePlanPreview,
  createManualReferenceCandidate,
  createReferencePlan,
  createReferencePlanPreview,
  inferReferenceBrief,
  scoreReferenceCandidate,
} from './reference-planner.js';

function candidate(id, preference = {}, extra = {}) {
  return {
    id,
    title: id.toUpperCase(),
    url: `https://${id}.example`,
    curationWeight: 1.2,
    sourceConfidence: 0.6,
    preference: { decision: 'keep', rating: null, businessTags: [], visualTags: [], motionTags: [], dimensionRatings: {}, ...preference },
    ...extra,
  };
}

describe('reference single-chassis planner v5', () => {
  it('infers only the site type needed to retrieve chassis candidates', () => {
    expect(inferReferenceBrief('A playful futuristic animated SaaS tool with a fashion tone')).toEqual({
      text: 'A playful futuristic animated SaaS tool with a fashion tone',
      productTypes: ['saas', 'tool'],
      businessTags: ['saas', 'tool'],
    });
  });

  it('previews the best type-fit chassis and carries guidance outside scoring', () => {
    const result = createReferencePlanPreview({
      brief: 'A SaaS tool landing page for security teams',
      candidates: [
        candidate('chassis', {
          businessTags: ['saas', 'tool'],
          worthBorrowing: 'Text composition and media placement.',
          avoid: 'The WebGL hero effect.',
        }),
        candidate('pretty', { businessTags: ['portfolio'], rating: 5, visualTags: ['futuristic'], motionTags: ['webgl'] }),
        candidate('uncertain', { decision: 'maybe', businessTags: ['saas', 'tool'] }),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.preview).toMatchObject({ schemaVersion: 3, plannerContractVersion: 5, mode: 'preview', strategy: 'single-chassis', scoringBasis: 'site-type-only' });
    expect(result.preview.options).toHaveLength(1);
    expect(result.preview.options[0]).toMatchObject({
      id: 'chassis', influence: 'chassis', scoreBreakdown: { typeFit: 67 },
      guidance: { worthBorrowing: 'Text composition and media placement.', avoid: 'The WebGL hero effect.' },
    });
    expect(result.preview.options[0].composition.preserve).toContain('Curator guidance: Text composition and media placement.');
    expect(result.preview.options[0].composition.replace).toContain('Exclude from transfer: The WebGL hero effect.');
  });

  it('does not use taste, style, or motion to rank matching chassis', () => {
    const profile = inferReferenceBrief('A SaaS platform for operations teams');
    const quiet = scoreReferenceCandidate(candidate('quiet', { businessTags: ['saas'], rating: 1 }), profile);
    const flashy = scoreReferenceCandidate(candidate('flashy', {
      businessTags: ['saas'], rating: 5, visualTags: ['futuristic'], motionTags: ['webgl'],
      worthBorrowing: 'Everything.', avoid: 'Nothing.',
    }), profile);
    expect(quiet.score).toBe(flashy.score);
    expect(quiet.breakdown).toEqual({ typeFit: 100 });
  });

  it('uses catalog metadata when the curator leaves site type blank', () => {
    const profile = inferReferenceBrief('Um site institucional para uma empresa industrial');
    const automatic = scoreReferenceCandidate(candidate('automatic', {}, { description: 'Corporate website for an industrial manufacturer' }), profile);
    expect(automatic).toMatchObject({ score: 100, breakdown: { typeFit: 100 } });
  });

  it('shows up to three exact ties without using editorial weight as a hidden preference', () => {
    const candidates = [
      candidate('zulu', { businessTags: ['saas'] }, { title: 'Zulu', curationWeight: 999 }),
      candidate('alpha', { businessTags: ['saas'] }, { title: 'Alpha', curationWeight: 0 }),
      candidate('delta', { businessTags: ['saas'] }, { title: 'Delta', curationWeight: 3 }),
      candidate('bravo', { businessTags: ['saas'] }, { title: 'Bravo', curationWeight: 7 }),
    ];
    const first = createReferencePlanPreview({ brief: 'A SaaS platform for operations teams', candidates });
    expect(first.preview).toMatchObject({ totalOptions: 4, optionOffset: 0, hasPrevious: false, hasMore: true, bestScore: 100 });
    expect(first.preview.options.map((option) => option.title)).toEqual(['Alpha', 'Bravo', 'Delta']);

    const second = createReferencePlanPreview({ brief: 'A SaaS platform for operations teams', candidates, optionOffset: 3 });
    expect(second.preview).toMatchObject({ totalOptions: 4, optionOffset: 3, hasPrevious: true, hasMore: false });
    expect(second.preview.options.map((option) => option.title)).toEqual(['Zulu']);
    expect(second.preview.previewHash).not.toBe(first.preview.previewHash);
  });

  it('persists only the explicitly selected chassis from the exact preview hash', () => {
    const candidates = [
      candidate('alpha', { businessTags: ['saas'], worthBorrowing: 'The section rhythm.' }),
      candidate('bravo', { businessTags: ['saas'] }),
    ];
    const { preview } = createReferencePlanPreview({ brief: 'A SaaS platform for operations teams', candidates });
    const result = approveReferencePlanPreview({
      brief: 'A SaaS platform for operations teams',
      candidates,
      previewHash: preview.previewHash,
      selectedReferenceId: 'bravo',
    });
    expect(result.plan).toMatchObject({ plannerContractVersion: 5, strategy: 'single-chassis', previewHash: preview.previewHash });
    expect(result.plan.selectedReferences).toHaveLength(1);
    expect(result.plan.selectedReferences[0]).toMatchObject({ id: 'bravo', influence: 'chassis', scaleOwner: true });
  });

  it('fails closed when the preview is stale or the selection was not displayed', () => {
    const candidates = [candidate('alpha', { businessTags: ['saas'] }), candidate('bravo', { businessTags: ['saas'] })];
    const { preview } = createReferencePlanPreview({ brief: 'A SaaS platform for operations teams', candidates });
    expect(approveReferencePlanPreview({
      brief: 'A SaaS platform for operations teams', candidates, previewHash: 'stale', selectedReferenceId: 'alpha',
    })).toMatchObject({ ok: false, error: 'preview_stale' });
    const changedGuidance = [candidate('alpha', { businessTags: ['saas'], avoid: 'The loader.' }), candidate('bravo', { businessTags: ['saas'] })];
    expect(approveReferencePlanPreview({
      brief: 'A SaaS platform for operations teams', candidates: changedGuidance, previewHash: preview.previewHash, selectedReferenceId: 'alpha',
    })).toMatchObject({ ok: false, error: 'preview_stale' });
    expect(approveReferencePlanPreview({
      brief: 'A SaaS platform for operations teams', candidates, previewHash: preview.previewHash, selectedReferenceId: 'outside',
    })).toMatchObject({ ok: false, error: 'invalid_preview_selection' });
  });

  it('requires at least one kept candidate', () => {
    expect(createReferencePlanPreview({ brief: 'A premium technology landing page', candidates: [] })).toMatchObject({ ok: false, error: 'review_required', required: 1 });
    expect(createReferencePlanPreview({ brief: 'A premium technology landing page', candidates: [candidate('uncertain', { decision: 'maybe' })] })).toMatchObject({ ok: false, error: 'review_required', required: 1 });
  });

  it('supports Portuguese briefs and a direct URL without curated candidates', () => {
    expect(inferReferenceBrief('Uma landing page para um aplicativo de comunidade')).toMatchObject({ productTypes: ['landing-page', 'app', 'community'] });
    const manual = createManualReferenceCandidate({ url: 'https://www.reference.example/page#hero', brief: 'Uma landing page editorial' });
    const previewResult = createReferencePlanPreview({ brief: 'Uma landing page editorial', candidates: [manual] });
    const result = createReferencePlan({ brief: 'Uma landing page editorial', candidates: [manual] });
    expect(manual).toMatchObject({ title: 'reference.example', url: 'https://www.reference.example/page', manual: true });
    expect(previewResult.preview).toMatchObject({ totalOptions: 1, selectionMode: 'direct-url', scoringBasis: 'direct-reference' });
    expect(result.plan).toMatchObject({ selectionMode: 'direct-url', scoringBasis: 'direct-reference' });
    expect(result.plan.selectedReferences[0]).toMatchObject({ source: 'direct-url', score: 100 });
  });
});
