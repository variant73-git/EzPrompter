import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const sqlMock = vi.fn();
sqlMock._reset = () => { sqlMock.mockClear(); sqlMock._results = []; };
sqlMock._results = [];
sqlMock.mockImplementation((template) => {
  sqlMock._templates ||= [];
  sqlMock._templates.push(Array.isArray(template) ? template.join(' ') : String(template));
  const r = sqlMock._results.shift();
  return Promise.resolve(r || []);
});

vi.mock('../../../../lib/db.js', () => ({
  db: async () => sqlMock,
}));

const { GET } = await import('./route.js');

beforeEach(() => { sqlMock._reset(); sqlMock._templates = []; });

const nodeWithSnap = {
  id: 'n1', board_id: 'b1', kind: 'site', meta: { name: 'Demo' },
  pos_x: 0, pos_y: 0, width: 1280, height: 720,
  current_snapshot_id: 'snap-1', created_at: '2026-06-19T00:00:00Z',
};

const nodeWithoutSnap = {
  ...nodeWithSnap, id: 'n2', current_snapshot_id: null,
};

describe('GET /api/nodes/[id]', () => {
  it('returns 404 when node not owned', async () => {
    sqlMock._results = [[]]; // ownedNode empty
    const req = new Request('http://test/api/nodes/n1');
    const res = await GET(req, { params: Promise.resolve({ id: 'n1' }) });
    expect(res.status).toBe(404);
  });

  it('default GET returns node + full snapshot (with html)', async () => {
    const snap = {
      id: 'snap-1', html: '<html>full payload</html>',
      screenshot_url: 'https://example.com/shot.png',
      source: 'capture', created_at: '2026-06-19T00:00:00Z',
      native_bundle_id: '33333333-3333-4333-8333-333333333333',
      motion_manifest_version: 2,
    };
    sqlMock._results = [
      [nodeWithSnap], // ownedNode
      [snap],         // snapshot fetch
    ];
    const req = new Request('http://test/api/nodes/n1');
    const res = await GET(req, { params: Promise.resolve({ id: 'n1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.node.id).toBe('n1');
    expect(body.snapshot).toBeTruthy();
    expect(body.snapshot.html).toBe('<html>full payload</html>');
    expect(body.snapshot.screenshot_url).toBe('https://example.com/shot.png');
    expect(body.snapshot.native_bundle_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(body.snapshot.motion_manifest_version).toBe(2);
    expect(sqlMock._templates[1]).toMatch(/native_bundle_id/);
    expect(sqlMock._templates[1]).toMatch(/motion_manifest_version/);
  });

  it('?ready_check=1 returns { ready: true, snapshotId } when snapshot has html', async () => {
    sqlMock._results = [
      [nodeWithSnap],   // ownedNode
      [{ ready: true }], // LENGTH(html) > 0 probe
    ];
    const req = new Request('http://test/api/nodes/n1?ready_check=1');
    const res = await GET(req, { params: Promise.resolve({ id: 'n1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ready: true, snapshotId: 'snap-1' });
    // Critical: ready_check must NOT transfer html — only a LENGTH() probe.
    expect(sqlMock._templates[1]).toMatch(/LENGTH\(html\)/);
    expect(sqlMock._templates[1]).not.toMatch(/SELECT[^;]*\bhtml\b\s*[,\s]/i);
    // Body must contain no html / design_md / screenshot_url fields.
    expect(body).not.toHaveProperty('node');
    expect(body).not.toHaveProperty('snapshot');
  });

  it('?ready_check=1 returns { ready: false, snapshotId: null } when node has no snapshot', async () => {
    sqlMock._results = [
      [nodeWithoutSnap], // ownedNode (current_snapshot_id null)
    ];
    const req = new Request('http://test/api/nodes/n2?ready_check=1');
    const res = await GET(req, { params: Promise.resolve({ id: 'n2' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ready: false, snapshotId: null });
    // No second sql call needed when there's no snapshot id to probe.
    expect(sqlMock._templates).toHaveLength(1);
  });

  it('?ready_check=1 returns { ready: false, snapshotId } when snapshot exists but html is empty (md-only seed)', async () => {
    sqlMock._results = [
      [nodeWithSnap],     // ownedNode
      [{ ready: false }], // LENGTH(html) > 0 → false (empty string)
    ];
    const req = new Request('http://test/api/nodes/n1?ready_check=1');
    const res = await GET(req, { params: Promise.resolve({ id: 'n1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ready: false, snapshotId: 'snap-1' });
  });
});
