import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createLeaseFromBadge = vi.fn();
const verifyLease = vi.fn();
vi.mock('../../../../lib/motion-editor/runtime-lease.js', async (original) => ({
  ...(await original()),
  createLeaseFromBadge,
  verifyLease,
}));

const sqlMock = vi.fn(() => Promise.resolve([]));
vi.mock('../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const { GET } = await import('./route.js');
const { mintBootstrapBadge, leaseCookieName } = await import('../../../../lib/motion-editor/runtime-lease.js');

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const BUNDLE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'runtime-only-secret-with-at-least-32-characters';
const HOST = 'a1b2c3d4e5f60718293a4b5c6d7e8f90.rt.uncraft.test';

function makeBadge(overrides = {}) {
  return mintBootstrapBadge({
    nodeId: NODE_ID, bundleId: BUNDLE_ID, sessionId: SESSION_ID,
    entryPath: 'site/index.html', hostname: HOST, ...overrides,
  }, { secret: SECRET }).badge;
}

function req(badge, { host = HOST, cookie = null, proto = 'https' } = {}) {
  const headers = { host };
  if (cookie) headers.cookie = cookie;
  return new Request(`${proto}://${host}/api/runtime-bootstrap/${badge}`, { headers });
}
const ctx = (badge) => ({ params: Promise.resolve({ badge }) });

beforeEach(() => {
  process.env.UNCRAFT_RUNTIME_LEASE = '1';
  process.env.UNCRAFT_RUNTIME_SESSION_SECRET = SECRET;
  createLeaseFromBadge.mockReset();
  verifyLease.mockReset();
  createLeaseFromBadge.mockResolvedValue({ cookieValue: 'C'.repeat(43), lease: { id: 'lease-1' } });
  verifyLease.mockResolvedValue({ error: 'invalid' });
});
afterEach(() => {
  delete process.env.UNCRAFT_RUNTIME_LEASE;
  delete process.env.UNCRAFT_RUNTIME_SESSION_SECRET;
});

describe('GET /api/runtime-bootstrap/[badge]', () => {
  it('valid badge -> consumes it, sets a CHIPS session cookie, 303 to a clean URL with no credential', async () => {
    const badge = makeBadge();
    const res = await GET(req(badge), ctx(badge));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/api/rt/${SESSION_ID}/site/index.html`);
    expect(res.headers.get('location')).not.toContain(badge);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toMatch(/^__Host-rt=C+; Secure; HttpOnly; SameSite=None; Partitioned; Path=\/$/);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(createLeaseFromBadge).toHaveBeenCalledOnce();
  });

  it('a request already carrying a valid lease cookie -> 303 WITHOUT consuming the badge', async () => {
    verifyLease.mockResolvedValue({ lease: { id: 'lease-1', hostname: HOST } });
    const badge = makeBadge();
    const res = await GET(req(badge, { cookie: `${leaseCookieName()}=EXISTING` }), ctx(badge));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/api/rt/${SESSION_ID}/site/index.html`);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(createLeaseFromBadge).not.toHaveBeenCalled();
  });

  it('a consumed badge replayed WITHOUT the cookie -> inert failure, no cookie', async () => {
    createLeaseFromBadge.mockResolvedValue({ error: 'badge_used' });
    const badge = makeBadge();
    const res = await GET(req(badge), ctx(badge));
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
  });

  it('a badge whose hostname does not match the request host -> inert failure, badge untouched', async () => {
    const badge = makeBadge();
    const res = await GET(req(badge, { host: 'evil.rt.uncraft.test' }), ctx(badge));
    expect(res.status).toBe(404);
    expect(createLeaseFromBadge).not.toHaveBeenCalled();
  });

  it('a garbage badge -> inert failure', async () => {
    const res = await GET(req('not-a-badge'), ctx('not-a-badge'));
    expect(res.status).toBe(404);
    expect(createLeaseFromBadge).not.toHaveBeenCalled();
  });

  it('flag off -> 404 inert, nothing consumed', async () => {
    delete process.env.UNCRAFT_RUNTIME_LEASE;
    const badge = makeBadge();
    const res = await GET(req(badge), ctx(badge));
    expect(res.status).toBe(404);
    expect(createLeaseFromBadge).not.toHaveBeenCalled();
  });
});
