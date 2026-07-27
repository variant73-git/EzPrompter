import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthUserMock = vi.fn();
const redirectMock = vi.fn(() => { throw new Error('redirected'); });
const notFoundMock = vi.fn(() => { throw new Error('not-found'); });

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: 'uncraft_sess=test' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (...args) => redirectMock(...args),
  notFound: (...args) => notFoundMock(...args),
}));
vi.mock('../../../lib/auth.js', () => ({
  getAuthUser: (...args) => getAuthUserMock(...args),
}));

const { default: MotionDiagnosticsPage } = await import('./page.jsx');

beforeEach(() => {
  getAuthUserMock.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

describe('Motion diagnostics private page', () => {
  it('redirects signed-out requests and hides the route from members', async () => {
    getAuthUserMock.mockResolvedValueOnce(null);
    await expect(MotionDiagnosticsPage()).rejects.toThrow('redirected');
    expect(redirectMock).toHaveBeenCalledWith('/');

    getAuthUserMock.mockResolvedValueOnce({ id: 7, role: 'member' });
    await expect(MotionDiagnosticsPage()).rejects.toThrow('not-found');
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it('renders only for the current database-backed admin', async () => {
    getAuthUserMock.mockResolvedValue({ id: 7, role: 'admin' });
    const element = await MotionDiagnosticsPage();
    expect(element.props.className).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
