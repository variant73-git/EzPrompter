import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock.mockImplementation(() => Promise.resolve(sqlMock._results.shift() || []));

vi.mock('../../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const { GET } = await import('./route.js');

beforeEach(() => { sqlMock.mockClear(); sqlMock._results = []; });

const req = () => new Request('http://test/api/nodes/n1/snapshots/snap-1');
const params = { params: Promise.resolve({ id: 'n1', snapId: 'snap-1' }) };

describe('GET /api/nodes/[id]/snapshots/[snapId]', () => {
  it('404 when snapshot not found / not owned / wrong node', async () => {
    sqlMock._results = [[]];
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
  });

  it('returns the version content for preview / thumbnail', async () => {
    sqlMock._results = [[{
      id: 'snap-1', html: '<html>v1</html>', design_md: null,
      screenshot_url: null, source: 'edit', created_at: '2026-06-23T01:00:00Z',
    }]];
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.snapshot.id).toBe('snap-1');
    expect(json.snapshot.html).toBe('<html>v1</html>');
  });
});
