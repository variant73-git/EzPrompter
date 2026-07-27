import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUserMock = vi.fn();

vi.mock('./auth.js', () => ({
  requireUser: (...args) => requireUserMock(...args),
}));

const { isAdmin, requireAdmin } = await import('./admin-auth.js');

beforeEach(() => requireUserMock.mockReset());

describe('admin authorization', () => {
  it('recognizes only the explicit admin role', () => {
    expect(isAdmin({ role: 'admin', plan: 'free' })).toBe(true);
    expect(isAdmin({ role: 'member', plan: 'enterprise' })).toBe(false);
    expect(isAdmin({ email: 'admin@example.com' })).toBe(false);
  });

  it('preserves authentication failures and denies normal users', async () => {
    const unauthorized = new Response(null, { status: 401 });
    requireUserMock.mockResolvedValueOnce({ user: null, error: unauthorized });
    expect((await requireAdmin({})).error).toBe(unauthorized);

    requireUserMock.mockResolvedValueOnce({ user: { id: 1, role: 'member' }, error: null });
    const denied = await requireAdmin({});
    expect(denied.user).toBeNull();
    expect(denied.error.status).toBe(403);
  });

  it('returns the current database-backed admin user', async () => {
    const user = { id: 7, role: 'admin' };
    requireUserMock.mockResolvedValue({ user, error: null });
    await expect(requireAdmin({})).resolves.toEqual({ user, error: null });
  });
});
