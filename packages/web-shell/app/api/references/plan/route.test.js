import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthUser = vi.fn();
const getReviewedPlanningCandidates = vi.fn();
const saveApprovedReferencePlan = vi.fn();
const canCuratePrivateReferences = vi.fn();

vi.mock('../../../../lib/auth.js', () => ({ getAuthUser }));
vi.mock('../../../../lib/reference-bank-store.js', () => ({ getReviewedPlanningCandidates, saveApprovedReferencePlan }));
vi.mock('../../../../lib/reference-privacy.js', () => ({ canCuratePrivateReferences }));

const { POST } = await import('./route.js');

function request(body) {
  return new Request('http://localhost/api/references/plan', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('reference plan route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ id: 3, email: 'curator@example.com' });
    canCuratePrivateReferences.mockReturnValue(true);
    saveApprovedReferencePlan.mockResolvedValue({ id: 'plan_1', status: 'approved', created_at: '2026-08-07T10:00:00.000Z' });
    getReviewedPlanningCandidates.mockResolvedValue([{
      id: 'ref_1', title: 'Reference', url: 'https://reference.example', curationWeight: 1,
      preference: { decision: 'keep', businessTags: ['landing-page'] },
    }]);
  });

  it('persists only the approved curated chassis from a current preview', async () => {
    const candidates = await getReviewedPlanningCandidates();
    getReviewedPlanningCandidates.mockResolvedValue(candidates);
    const { createReferencePlanPreview } = await import('../../../../lib/reference-planner.js');
    const { preview } = createReferencePlanPreview({ brief: 'A landing page for an industrial company.', candidates });
    const response = await POST(request({
      brief: 'A landing page for an industrial company.', previewHash: preview.previewHash, selectedReferenceId: 'ref_1',
    }));
    expect(response.status).toBe(201);
    const plan = saveApprovedReferencePlan.mock.calls[0][2];
    expect(plan.selectedReferences).toHaveLength(1);
    expect(plan.selectionMode).toBe('curated-keeps');
    expect(plan.previewHash).toBe(preview.previewHash);
  });

  it('uses an approved direct URL preview without loading curated preferences', async () => {
    const { createManualReferenceCandidate, createReferencePlanPreview } = await import('../../../../lib/reference-planner.js');
    const brief = 'Uma landing page industrial.';
    const referenceUrl = 'https://direct.example';
    const candidate = createManualReferenceCandidate({ url: referenceUrl, brief });
    const { preview } = createReferencePlanPreview({ brief, candidates: [candidate] });
    const response = await POST(request({
      brief, referenceUrl, previewHash: preview.previewHash, selectedReferenceId: candidate.id,
    }));
    expect(response.status).toBe(201);
    expect(getReviewedPlanningCandidates).not.toHaveBeenCalled();
    const plan = saveApprovedReferencePlan.mock.calls[0][2];
    expect(plan).toMatchObject({ selectionMode: 'direct-url', scoringBasis: 'direct-reference' });
    expect(plan.selectedReferences[0]).toMatchObject({ url: 'https://direct.example/', source: 'direct-url' });
  });

  it('rejects unsafe reference schemes before any persistence', async () => {
    const response = await POST(request({ brief: 'Uma landing page industrial.', referenceUrl: 'file:///tmp/reference.html' }));
    expect(response.status).toBe(400);
    expect(saveApprovedReferencePlan).not.toHaveBeenCalled();
  });

  it('rejects a stale preview without persisting', async () => {
    const response = await POST(request({
      brief: 'A landing page for an industrial company.', previewHash: 'stale', selectedReferenceId: 'ref_1',
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'preview_stale' });
    expect(saveApprovedReferencePlan).not.toHaveBeenCalled();
  });
});
