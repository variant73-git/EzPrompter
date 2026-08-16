import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthUser = vi.fn();
const getReviewedPlanningCandidates = vi.fn();
const canCuratePrivateReferences = vi.fn();

vi.mock('../../../../../lib/auth.js', () => ({ getAuthUser }));
vi.mock('../../../../../lib/reference-bank-store.js', () => ({ getReviewedPlanningCandidates }));
vi.mock('../../../../../lib/reference-privacy.js', () => ({ canCuratePrivateReferences }));

const { POST } = await import('./route.js');

function request(body) {
  return new Request('http://localhost/api/references/plan/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

function candidate(id, title, curationWeight = 0) {
  return {
    id, title, url: `https://${id}.example`, curationWeight,
    preference: { decision: 'keep', businessTags: ['landing-page'] },
  };
}

describe('reference plan preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ id: 3, email: 'curator@example.com' });
    canCuratePrivateReferences.mockReturnValue(true);
    getReviewedPlanningCandidates.mockResolvedValue([
      candidate('zulu', 'Zulu', 999), candidate('alpha', 'Alpha'), candidate('delta', 'Delta'), candidate('bravo', 'Bravo'),
    ]);
  });

  it('returns an ephemeral page of equal-fit options without any persistence seam', async () => {
    const response = await POST(request({ brief: 'A landing page for an industrial company.' }));
    expect(response.status).toBe(200);
    const { preview } = await response.json();
    expect(preview).toMatchObject({ mode: 'preview', totalOptions: 4, optionOffset: 0, hasMore: true });
    expect(preview.options.map((option) => option.title)).toEqual(['Alpha', 'Bravo', 'Delta']);
    expect(preview.previewHash).toHaveLength(64);
  });

  it('returns the next neutral option group without changing the candidate set', async () => {
    const response = await POST(request({ brief: 'A landing page for an industrial company.', optionOffset: 3 }));
    const { preview } = await response.json();
    expect(preview).toMatchObject({ totalOptions: 4, optionOffset: 3, hasPrevious: true, hasMore: false });
    expect(preview.options.map((option) => option.title)).toEqual(['Zulu']);
  });

  it('supports a direct URL without reading curated keeps', async () => {
    const response = await POST(request({ brief: 'Uma landing page industrial.', referenceUrl: 'https://direct.example' }));
    expect(response.status).toBe(200);
    expect(getReviewedPlanningCandidates).not.toHaveBeenCalled();
    const { preview } = await response.json();
    expect(preview).toMatchObject({ totalOptions: 1, selectionMode: 'direct-url', scoringBasis: 'direct-reference' });
  });
});
