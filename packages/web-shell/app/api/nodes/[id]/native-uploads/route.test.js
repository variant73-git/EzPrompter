import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn(async () => ({ user: { id: 42 } }));
vi.mock('../../../../../lib/auth.js', () => ({ requireUser }));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock.mockImplementation(() => Promise.resolve(sqlMock._results.shift() || []));
vi.mock('../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const store = { head: vi.fn(async () => null), putImmutable: vi.fn(async () => ({})), read: vi.fn() };
vi.mock('../../../../../lib/native-clone/bundle-store.js', () => ({
  createConfiguredBundleStore: () => store,
  indexedAssetKey: (r, p) => `${r}/assets/${p}`,
}));

const { POST } = await import('./route.js');

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function req(body = PNG) {
  return new Request(`http://app.test/api/nodes/${NODE_ID}/native-uploads`, {
    method: 'POST', body, headers: { 'content-length': String(body.length) },
  });
}
const ctx = { params: Promise.resolve({ id: NODE_ID }) };

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { id: 42 } });
  sqlMock.mockClear();
  sqlMock._results = [[{ id: 'session-1' }], [], [{ bytes_used: PNG.length }]]; // owned, insert, reserve
  store.head.mockReset();
  store.head.mockResolvedValue(null);
  store.putImmutable.mockReset();
  store.putImmutable.mockResolvedValue({});
});

describe('POST /api/nodes/[id]/native-uploads', () => {
  it('stores a raster upload for the owner of an active session and returns the hashed path', async () => {
    const res = await POST(req(), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.path).toMatch(/^\.\/_uploads\/[0-9a-f]{32}\.png$/);
    expect(store.putImmutable).toHaveBeenCalledOnce();
  });

  it('refuses when the node has no active owned session', async () => {
    sqlMock._results = [[]]; // ownership query returns nothing
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
    expect(store.putImmutable).not.toHaveBeenCalled();
  });

  it('passes through login failures before the database', async () => {
    requireUser.mockResolvedValue({ user: null, error: Response.json({ error: 'unauthorized' }, { status: 401 }) });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects a non-raster payload with 415', async () => {
    const res = await POST(req(new Uint8Array([1, 2, 3, 4])), ctx);
    expect(res.status).toBe(415);
  });

  it('maps an exhausted quota to 409', async () => {
    sqlMock._results = [[{ id: 'session-1' }], [], []]; // owned, insert, reserve -> no row
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
  });

  it('rejects an oversized declared content-length with 413 before reading the body', async () => {
    const r = new Request(`http://app.test/api/nodes/${NODE_ID}/native-uploads`, {
      method: 'POST', body: PNG, headers: { 'content-length': String(9 * 1024 * 1024) },
    });
    const res = await POST(r, ctx);
    expect(res.status).toBe(413);
  });
});
