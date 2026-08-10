import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthUser = vi.fn();
const saveReferencePrivacy = vi.fn();
const canCuratePrivateReferences = vi.fn();

vi.mock('../../../../../lib/auth.js', () => ({ getAuthUser }));
vi.mock('../../../../../lib/reference-bank-store.js', () => ({ saveReferencePrivacy }));
vi.mock('../../../../../lib/reference-privacy.js', () => ({ canCuratePrivateReferences }));

const { PUT } = await import('./route.js');

function request(body) {
  return new Request('http://localhost/api/references/ref_one/privacy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('reference privacy route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ id: 1, email: 'owner@example.com' });
    canCuratePrivateReferences.mockReturnValue(true);
    saveReferencePrivacy.mockResolvedValue({ referenceId: 'ref_one', isPrivate: true });
  });

  it('updates global privacy for an internal curator', async () => {
    const response = await PUT(request({ isPrivate: true }), { params: Promise.resolve({ id: 'ref_one' }) });
    expect(response.status).toBe(200);
    expect(saveReferencePrivacy).toHaveBeenCalledWith('ref_one', true);
    await expect(response.json()).resolves.toEqual({ privacy: { referenceId: 'ref_one', isPrivate: true } });
  });

  it('does not expose the global switch to ordinary users', async () => {
    canCuratePrivateReferences.mockReturnValue(false);
    const response = await PUT(request({ isPrivate: true }), { params: Promise.resolve({ id: 'ref_one' }) });
    expect(response.status).toBe(403);
    expect(saveReferencePrivacy).not.toHaveBeenCalled();
  });
});
