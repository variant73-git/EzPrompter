import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  return { sql };
});

const { sql } = await import('../../db.js');
const { createWorkflowTool } = await import('./create-workflow.js');

// The tool's SQL order:
//   1. board ownership SELECT
//   2. placeChainOnBoard → nodes SELECT (+ edges SELECT when non-empty)
//   3. per node: INSERT node (+ snapshot INSERT + UPDATE for seeded types)
//   4. per edge: INSERT edge
//   5. deoverlapSectionForEdge → nodes SELECT + edges SELECT + (UPDATE)
// Empty-board mocks keep this simple: placeChain returns (0,0) after one call.

function mockHappyPath({ nodeRows }) {
  let insertCount = 0;
  sql.mockImplementation((strings) => {
    const q = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (/FROM boards/.test(q)) return Promise.resolve([{ id: 'board-1' }]);
    if (/INSERT INTO nodes/.test(q)) return Promise.resolve([nodeRows[insertCount++]]);
    if (/INSERT INTO snapshots/.test(q)) return Promise.resolve([{ id: `snap-${insertCount}` }]);
    if (/INSERT INTO edges/.test(q)) return Promise.resolve([{ id: 'edge-1' }]);
    // placeChainOnBoard / deoverlap SELECTs — empty board.
    return Promise.resolve([]);
  });
}

describe('createWorkflow tool', () => {
  beforeEach(() => sql.mockReset());

  it('rejects an empty node list', async () => {
    const r = await createWorkflowTool.execute({ nodes: [] }, { boardId: 'b', userId: 1 });
    expect(r.error).toBe('invalid_args');
  });

  it('rejects duplicate keys and unknown types', async () => {
    const dup = await createWorkflowTool.execute(
      { nodes: [{ key: 'a', type: 'prompt' }, { key: 'a', type: 'prompt' }] },
      { boardId: 'b', userId: 1 },
    );
    expect(dup.error).toBe('invalid_args');
    const bad = await createWorkflowTool.execute(
      { nodes: [{ key: 'a', type: 'nonsense' }] },
      { boardId: 'b', userId: 1 },
    );
    expect(bad.error).toBe('invalid_args');
  });

  it('rejects edges referencing unknown keys or self-loops', async () => {
    const r = await createWorkflowTool.execute(
      { nodes: [{ key: 'a', type: 'prompt' }], edges: [{ from: 'a', to: 'ghost' }] },
      { boardId: 'b', userId: 1 },
    );
    expect(r.error).toBe('invalid_args');
    const self = await createWorkflowTool.execute(
      { nodes: [{ key: 'a', type: 'prompt' }], edges: [{ from: 'a', to: 'a' }] },
      { boardId: 'b', userId: 1 },
    );
    expect(self.error).toBe('invalid_args');
  });

  it('creates the whole chain, wires edges, and emits graph_mutated per node (real time)', async () => {
    mockHappyPath({
      nodeRows: [
        { id: 'n-brief', pos_x: 0, pos_y: 0 },
        { id: 'n-site', pos_x: 960, pos_y: 0 },
      ],
    });
    const emit = vi.fn();
    const r = await createWorkflowTool.execute(
      {
        nodes: [
          { key: 'brief', type: 'prompt', content: 'A landing page for a coffee roaster' },
          { key: 'site', type: 'blank-website' },
        ],
        edges: [{ from: 'brief', to: 'site' }],
      },
      { boardId: 'board-1', userId: 42, emit },
    );
    expect(r.error).toBeUndefined();
    expect(r.created).toHaveLength(2);
    expect(r.created[0]).toMatchObject({ key: 'brief', id: 'n-brief' });
    expect(r.created[1]).toMatchObject({ key: 'site', id: 'n-site' });
    expect(r.edges).toBe(1);
    // One graph_mutated per node insert + one after edges.
    const reasons = emit.mock.calls.filter(([ev]) => ev === 'graph_mutated').map(([, p]) => p.reason);
    expect(reasons.filter((x) => x === 'createWorkflow:node')).toHaveLength(2);
    expect(reasons.filter((x) => x === 'createWorkflow:edges')).toHaveLength(1);
  });

  it('rejects the reserved "anchor" node key', async () => {
    const r = await createWorkflowTool.execute(
      { nodes: [{ key: 'anchor', type: 'prompt' }] },
      { boardId: 'b', userId: 1 },
    );
    expect(r.error).toBe('invalid_args');
  });

  it('rejects edges using "anchor" without anchorNodeId', async () => {
    const r = await createWorkflowTool.execute(
      { nodes: [{ key: 'a', type: 'prompt' }], edges: [{ from: 'anchor', to: 'a' }] },
      { boardId: 'b', userId: 1 },
    );
    expect(r.error).toBe('invalid_args');
    expect(r.message).toContain('anchorNodeId');
  });

  it('returns anchor_not_found when anchorNodeId is not on the board', async () => {
    sql.mockImplementation((strings) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (/FROM boards/.test(q)) return Promise.resolve([{ id: 'board-1' }]);
      return Promise.resolve([]); // anchor validation SELECT → empty
    });
    const r = await createWorkflowTool.execute(
      { nodes: [{ key: 'a', type: 'prompt' }], anchorNodeId: 'ghost-node' },
      { boardId: 'board-1', userId: 1 },
    );
    expect(r.error).toBe('anchor_not_found');
  });

  it('anchored chain: places nodes right of the anchor and wires "anchor" edges from the existing node', async () => {
    const anchor = { id: 'anchor-1', pos_x: 100, pos_y: 50, width: 400, height: 300 };
    const nodeInserts = [];
    const edgeInserts = [];
    sql.mockImplementation((strings, ...vals) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (/FROM boards/.test(q)) return Promise.resolve([{ id: 'board-1' }]);
      if (/SELECT id FROM nodes WHERE id =/.test(q)) return Promise.resolve([{ id: 'anchor-1' }]); // anchor validation
      if (/INSERT INTO nodes/.test(q)) {
        nodeInserts.push(vals); // (boardId, kind, x, y, w, h, meta)
        return Promise.resolve([{ id: `n-${nodeInserts.length}`, pos_x: vals[2], pos_y: vals[3] }]);
      }
      if (/INSERT INTO snapshots/.test(q)) return Promise.resolve([{ id: 'snap-x' }]);
      if (/INSERT INTO edges/.test(q)) { edgeInserts.push(vals); return Promise.resolve([{ id: `e-${edgeInserts.length}` }]); }
      if (/FROM nodes WHERE board_id/.test(q)) return Promise.resolve([anchor]); // obstacles + deoverlap
      return Promise.resolve([]); // edges SELECTs
    });
    const r = await createWorkflowTool.execute(
      {
        nodes: [
          { key: 'crop-1', type: 'blank-website', content: '<html>mockup 1</html>' },
          { key: 'crop-2', type: 'blank-website', content: '<html>mockup 2</html>' },
        ],
        edges: [
          { from: 'anchor', to: 'crop-1' },
          { from: 'anchor', to: 'crop-2' },
        ],
        anchorNodeId: 'anchor-1',
      },
      { boardId: 'board-1', userId: 42 },
    );
    expect(r.error).toBeUndefined();
    expect(r.anchored).toBe(true);
    expect(r.created).toHaveLength(2);
    expect(r.edges).toBe(2);
    // Both edges originate at the EXISTING anchor node.
    expect(edgeInserts[0][1]).toBe('anchor-1');
    expect(edgeInserts[1][1]).toBe('anchor-1');
    expect(edgeInserts[0][2]).toBe('n-1');
    expect(edgeInserts[1][2]).toBe('n-2');
    // The chain starts to the RIGHT of the anchor (anchor right edge = 500).
    expect(nodeInserts[0][2]).toBeGreaterThan(500);
    expect(nodeInserts[1][2]).toBeGreaterThan(500);
  });

  it('measures the chain area before inserting (positions come from the plan, horizontal flow)', async () => {
    const captured = [];
    sql.mockImplementation((strings, ...vals) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (/FROM boards/.test(q)) return Promise.resolve([{ id: 'board-1' }]);
      if (/INSERT INTO nodes/.test(q)) {
        captured.push(vals); // (boardId, kind, x, y, w, h, meta)
        return Promise.resolve([{ id: `n-${captured.length}`, pos_x: vals[2], pos_y: vals[3] }]);
      }
      if (/INSERT INTO snapshots/.test(q)) return Promise.resolve([{ id: 'snap-x' }]);
      if (/INSERT INTO edges/.test(q)) return Promise.resolve([{ id: 'edge-1' }]);
      return Promise.resolve([]);
    });
    await createWorkflowTool.execute(
      {
        nodes: [
          { key: 'brief', type: 'prompt', content: 'brief' },
          { key: 'site', type: 'blank-website' },
        ],
        edges: [{ from: 'brief', to: 'site' }],
      },
      { boardId: 'board-1', userId: 42 },
    );
    const briefX = captured[0][2];
    const siteX = captured[1][2];
    expect(siteX).toBeGreaterThan(briefX); // dependency advances rightward
  });
});
