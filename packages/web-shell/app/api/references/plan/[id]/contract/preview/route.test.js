import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthUser = vi.fn();
const getShadowReferencePlan = vi.fn();
const getOwnedBoardTarget = vi.fn();
const createChassisTargetContractPreview = vi.fn();
const analyzeTargetAuthority = vi.fn();

vi.mock('../../../../../../../lib/auth.js', () => ({ getAuthUser }));
vi.mock('../../../../../../../lib/reference-bank-store.js', () => ({ getShadowReferencePlan, getOwnedBoardTarget }));
vi.mock('../../../../../../../lib/chassis-target-contract.js', () => ({ createChassisTargetContractPreview }));
vi.mock('../../../../../../../lib/chassis-target-evidence.js', () => ({ analyzeTargetAuthority }));

const { POST } = await import('./route.js');
const context = { params: Promise.resolve({ id: 'plan_1' }) };
const manifest = { hash: 'manifest_one' };
const evidence = { hash: 'evidence_one', brand: 'Target Project' };

function request(body) {
  return new Request('http://localhost/api/references/plan/plan_1/contract/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('target contract preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ id: 7 });
    getShadowReferencePlan.mockResolvedValue({ id: 'plan_1', status: 'approved', plan: { chassisManifest: manifest } });
    getOwnedBoardTarget.mockResolvedValue({ id: 'project_1', name: 'Target Project' });
    analyzeTargetAuthority.mockResolvedValue(evidence);
    createChassisTargetContractPreview.mockReturnValue({ hash: 'contract_one', status: 'preview', approvable: true });
  });

  it('builds a zero-write preview from the approved Manifest and owned target project', async () => {
    const input = { authorityType: 'project', projectId: 'project_1', brand: 'Target Project' };
    const response = await POST(request(input), context);
    expect(response.status).toBe(200);
    expect(getOwnedBoardTarget).toHaveBeenCalledWith(7, 'project_1');
    expect(analyzeTargetAuthority).toHaveBeenCalledWith({ input, project: { id: 'project_1', name: 'Target Project' } });
    expect(createChassisTargetContractPreview).toHaveBeenCalledWith({ manifest, input, project: { id: 'project_1', name: 'Target Project' }, evidence });
    await expect(response.json()).resolves.toEqual({ contract: { hash: 'contract_one', status: 'preview', approvable: true } });
  });

  it('requires an approved plan with a frozen Manifest before previewing', async () => {
    getShadowReferencePlan.mockResolvedValue({ id: 'plan_1', status: 'approved', plan: {} });
    const response = await POST(request({ authorityType: 'url', url: 'https://target.example', brand: 'Target' }), context);
    expect(response.status).toBe(409);
    expect(createChassisTargetContractPreview).not.toHaveBeenCalled();
    expect(analyzeTargetAuthority).not.toHaveBeenCalled();
  });
});
