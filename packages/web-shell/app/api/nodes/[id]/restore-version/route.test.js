import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock._templates = [];
sqlMock.mockImplementation((tpl) => {
  sqlMock._templates.push(Array.isArray(tpl) ? tpl.join(' ') : String(tpl));
  return Promise.resolve(sqlMock._results.shift() || []);
});

vi.mock('../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const { POST } = await import('./route.js');

beforeEach(() => { sqlMock.mockClear(); sqlMock._results = []; sqlMock._templates = []; });

const post = (body) => new Request('http://test/api/nodes/n1/restore-version', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const params = { params: Promise.resolve({ id: 'n1' }) };

describe('POST /api/nodes/[id]/restore-version', () => {
  it('400 when snapshotId missing', async () => {
    const res = await POST(post({}), params);
    expect(res.status).toBe(400);
  });

  it('404 when snapshot not found / not owned / wrong node', async () => {
    sqlMock._results = [[]]; // SELECT empty
    const res = await POST(post({ snapshotId: 'snap-x' }), params);
    expect(res.status).toBe(404);
  });

  it('moves current_snapshot_id and returns the restored content', async () => {
    sqlMock._results = [
      [{ id: 'snap-1', html: '<html>v1</html>', design_md: null, screenshot_url: null }], // SELECT
      [], // UPDATE
    ];
    const res = await POST(post({ snapshotId: 'snap-1' }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.snapshot_id).toBe('snap-1');
    expect(json.html).toBe('<html>v1</html>');
    // the UPDATE that moves the pointer ran
    expect(sqlMock._templates.some((t) => /UPDATE nodes/.test(t) && /current_snapshot_id/.test(t))).toBe(true);
  });
});
