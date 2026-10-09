import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const sqlMock = vi.fn();
sqlMock._reset = () => { sqlMock.mockClear(); sqlMock._results = []; };
sqlMock._results = [];
sqlMock.mockImplementation((template) => {
  // Stash each call's template (joined strings) so tests can assert
  // which query shape was executed — light vs full LEFT JOIN.
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

const board = { id: 'b1', user_id: 42, name: 'Untitled' };

const fullNode = {
  id: 'n1', board_id: 'b1', kind: 'site', meta: { name: 'Demo' },
  pos_x: 0, pos_y: 0, width: 1280, height: 720, is_main: false,
  current_snapshot_id: 'snap-1', created_at: '2026-06-19T00:00:00Z',
  current_html: '<html>heavy payload</html>',
  current_design_md: '# Tokens',
  current_screenshot: 'https://example.com/shot.png',
  current_snapshot_source: 'capture',
  original_snapshot_id: 'snap-orig',
};

const lightNode = {
  id: 'n1', board_id: 'b1', kind: 'site', meta: { name: 'Demo' },
  pos_x: 0, pos_y: 0, width: 1280, height: 720, is_main: false,
  current_snapshot_id: 'snap-1', created_at: '2026-06-19T00:00:00Z',
  hasSnapshot: true,
  original_snapshot_id: 'snap-orig',
};

describe('GET /api/boards/[id]', () => {
  it('returns 404 when board not owned', async () => {
    sqlMock._results = [[]]; // ownedBoard empty
    const req = new Request('http://test/api/boards/b1');
    const res = await GET(req, { params: Promise.resolve({ id: 'b1' }) });
    expect(res.status).toBe(404);
  });

  it('default GET returns nodes WITH current_html / current_design_md / current_screenshot', async () => {
    sqlMock._results = [
      [board],          // ownedBoard
      [fullNode],       // nodes (full, with JOIN)
      [],               // edges
    ];
    const req = new Request('http://test/api/boards/b1');
    const res = await GET(req, { params: Promise.resolve({ id: 'b1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toHaveLength(1);
    const n = body.nodes[0];
    expect(n.current_html).toBe('<html>heavy payload</html>');
    expect(n.current_design_md).toBe('# Tokens');
    expect(n.current_screenshot).toBe('https://example.com/shot.png');
    expect(n.current_snapshot_source).toBe('capture');
    // Sanity: full query path should include the LEFT JOIN.
    expect(sqlMock._templates[1]).toMatch(/LEFT JOIN snapshots/);
  });

  it('?light=1 returns nodes WITH hasSnapshot but WITHOUT current_html / current_design_md / current_screenshot', async () => {
    sqlMock._results = [
      [board],          // ownedBoard
      [lightNode],      // nodes (light, no JOIN)
      [],               // edges
    ];
    const req = new Request('http://test/api/boards/b1?light=1');
    const res = await GET(req, { params: Promise.resolve({ id: 'b1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toHaveLength(1);
    const n = body.nodes[0];
    expect(n.hasSnapshot).toBe(true);
    expect(n.current_snapshot_id).toBe('snap-1');
    expect(n).not.toHaveProperty('current_html');
    expect(n).not.toHaveProperty('current_design_md');
    expect(n).not.toHaveProperty('current_screenshot');
    expect(n).not.toHaveProperty('current_snapshot_source');
    // Sanity: light query path must NOT include the LEFT JOIN on snapshots.
    expect(sqlMock._templates[1]).not.toMatch(/LEFT JOIN snapshots/);
    expect(sqlMock._templates[1]).toMatch(/hasSnapshot/);
  });

  it('full and light return the same node count for the same board', async () => {
    const fullNodes = [
      { ...fullNode, id: 'n1' },
      { ...fullNode, id: 'n2', current_snapshot_id: null, current_html: null, current_design_md: null, current_screenshot: null },
      { ...fullNode, id: 'n3' },
    ];
    const lightNodes = [
      { ...lightNode, id: 'n1' },
      { ...lightNode, id: 'n2', current_snapshot_id: null, hasSnapshot: false },
      { ...lightNode, id: 'n3' },
    ];

    sqlMock._results = [[board], fullNodes, []];
    const resFull = await GET(
      new Request('http://test/api/boards/b1'),
      { params: Promise.resolve({ id: 'b1' }) }
    );
    const bodyFull = await resFull.json();

    sqlMock._reset();
    sqlMock._templates = [];
    sqlMock._results = [[board], lightNodes, []];
    const resLight = await GET(
      new Request('http://test/api/boards/b1?light=1'),
      { params: Promise.resolve({ id: 'b1' }) }
    );
    const bodyLight = await resLight.json();

    expect(bodyLight.nodes).toHaveLength(bodyFull.nodes.length);
    expect(bodyLight.nodes).toHaveLength(3);
  });
});
