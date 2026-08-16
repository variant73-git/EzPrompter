import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthUser = vi.fn();
const getShadowReferencePlan = vi.fn();
const saveShadowReferenceManifest = vi.fn();
const analyzeChassisReference = vi.fn();

vi.mock('../../../../../../lib/auth.js', () => ({ getAuthUser }));
vi.mock('../../../../../../lib/reference-bank-store.js', () => ({ getShadowReferencePlan, saveShadowReferenceManifest }));
vi.mock('../../../../../../lib/chassis-analyzer.js', () => ({ analyzeChassisReference }));

const { POST } = await import('./route.js');
const request = new Request('http://localhost/api/references/plan/plan_1/analyze', { method: 'POST' });
const context = { params: Promise.resolve({ id: 'plan_1' }) };
const reference = { id: 'ref_1', title: 'Reference', url: 'https://reference.example', guidance: { worthBorrowing: 'Hero anchor.', avoid: '' } };
const manifest = { schemaVersion: 1, hash: 'abc', structure: { sections: [{}] } };

describe('reference plan chassis analysis route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ id: 7 });
    getShadowReferencePlan.mockResolvedValue({ id: 'plan_1', status: 'approved', plan: { selectedReferences: [reference] } });
    analyzeChassisReference.mockResolvedValue(manifest);
    saveShadowReferenceManifest.mockResolvedValue({ id: 'plan_1', status: 'approved' });
  });

  it('requires explicit plan approval before capturing a reference', async () => {
    getShadowReferencePlan.mockResolvedValue({ id: 'plan_1', status: 'shadow', plan: { selectedReferences: [reference] } });
    const response = await POST(request, context);
    expect(response.status).toBe(409);
    expect(analyzeChassisReference).not.toHaveBeenCalled();
  });

  it('captures two viewports and persists the compact manifest after approval', async () => {
    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(analyzeChassisReference).toHaveBeenCalledWith({ reference, guidance: reference.guidance });
    expect(saveShadowReferenceManifest).toHaveBeenCalledWith(7, 'plan_1', manifest);
    await expect(response.json()).resolves.toEqual({ manifest, cached: false });
  });

  it('returns an existing manifest without recapturing the site', async () => {
    getShadowReferencePlan.mockResolvedValue({ id: 'plan_1', status: 'approved', plan: { selectedReferences: [reference], chassisManifest: manifest } });
    const response = await POST(request, context);
    expect(analyzeChassisReference).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ manifest, cached: true });
  });
});
