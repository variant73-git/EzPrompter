import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthUser = vi.fn();
const getShadowReferencePlan = vi.fn();
const getOwnedBoardTarget = vi.fn();
const saveShadowReferenceTargetContract = vi.fn();
const createChassisTargetContractPreview = vi.fn();
const approveChassisTargetContract = vi.fn();
const analyzeTargetAuthority = vi.fn();

vi.mock('../../../../../../lib/auth.js', () => ({ getAuthUser }));
vi.mock('../../../../../../lib/reference-bank-store.js', () => ({
  getShadowReferencePlan, getOwnedBoardTarget, saveShadowReferenceTargetContract,
}));
vi.mock('../../../../../../lib/chassis-target-contract.js', () => ({
  createChassisTargetContractPreview, approveChassisTargetContract,
}));
vi.mock('../../../../../../lib/chassis-target-evidence.js', () => ({ analyzeTargetAuthority }));

const { POST } = await import('./route.js');
const context = { params: Promise.resolve({ id: 'plan_1' }) };
const manifest = { hash: 'manifest_one' };
const target = { authorityType: 'url', url: 'https://target.example', brand: 'Target' };
const preview = { hash: 'contract_one', approvable: true };
const evidence = { hash: 'evidence_one', brand: 'Target' };
const approved = { ...preview, manifestHash: 'manifest_one', status: 'approved', locks: { generationAuthorized: false, creditSpendAuthorized: false } };

function request(body) {
  return new Request('http://localhost/api/references/plan/plan_1/contract', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('target contract approval route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ id: 7 });
    getShadowReferencePlan.mockResolvedValue({ id: 'plan_1', status: 'approved', plan: { chassisManifest: manifest } });
    createChassisTargetContractPreview.mockReturnValue(preview);
    analyzeTargetAuthority.mockResolvedValue(evidence);
    approveChassisTargetContract.mockReturnValue(approved);
    saveShadowReferenceTargetContract.mockResolvedValue({ id: 'plan_1', status: 'approved' });
  });

  it('rebuilds and persists only the exact approved target hash without authorizing execution', async () => {
    const response = await POST(request({ target, contractHash: 'contract_one' }), context);
    expect(response.status).toBe(201);
    expect(analyzeTargetAuthority).toHaveBeenCalledWith({ input: target, project: null });
    expect(createChassisTargetContractPreview).toHaveBeenCalledWith({ manifest, input: target, project: null, evidence });
    expect(approveChassisTargetContract).toHaveBeenCalledWith(preview, 'contract_one');
    expect(saveShadowReferenceTargetContract).toHaveBeenCalledWith(7, 'plan_1', approved);
    await expect(response.json()).resolves.toEqual({ contract: approved });
  });

  it('returns a stale-contract conflict before any persistence', async () => {
    approveChassisTargetContract.mockImplementation(() => { throw new Error('target_contract_stale'); });
    const response = await POST(request({ target, contractHash: 'old_hash' }), context);
    expect(response.status).toBe(409);
    expect(saveShadowReferenceTargetContract).not.toHaveBeenCalled();
  });
});
