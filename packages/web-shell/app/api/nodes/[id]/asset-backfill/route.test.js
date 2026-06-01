import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const sqlMock = vi.fn();
sqlMock._reset = () => { sqlMock.mockClear(); sqlMock._results = []; };
sqlMock._results = [];
sqlMock.mockImplementation(() => {
  const r = sqlMock._results.shift();
  return Promise.resolve(r || []);
});

vi.mock('../../../../../lib/db.js', () => ({
  db: async () => sqlMock,
}));

const { POST } = await import('./route.js');

beforeEach(() => { sqlMock._reset(); });

describe('POST /api/nodes/[id]/asset-backfill', () => {
  it('returns 404 when node not owned', async () => {
    sqlMock._results = [[]]; // ownership empty
    const req = new Request('http://test/api/nodes/n1/asset-backfill', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'n1' }) });
    expect(res.status).toBe(404);
  });

  it('returns existing assetId without inserting when node already has meta.assetId', async () => {
    sqlMock._results = [
      [{ id: 'n1', meta: { assetId: 'a-existing', name: 'demo' } }],
    ];
    const req = new Request('http://test/api/nodes/n1/asset-backfill', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'n1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assetId).toBe('a-existing');
    expect(body.created).toBe(false);
  });

  it('creates assets row + updates node meta when assetId missing', async () => {
    sqlMock._results = [
      [{ id: 'n1', board_id: 'b1', meta: { dataUrl: 'data:image/png;base64,X', name: 'orphan' } }],
      [{ id: 'a-new' }],
      [],
    ];
    const req = new Request('http://test/api/nodes/n1/asset-backfill', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'n1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assetId).toBe('a-new');
    expect(body.created).toBe(true);
  });

  it('returns 400 when node has no image data to backfill from', async () => {
    sqlMock._results = [
      [{ id: 'n1', board_id: 'b1', meta: {} }],
    ];
    const req = new Request('http://test/api/nodes/n1/asset-backfill', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'n1' }) });
    expect(res.status).toBe(400);
  });
});
