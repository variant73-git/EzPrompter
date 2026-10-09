import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._reset = () => sql.mockReset();
  return { sql };
});

const { sql } = await import('../../db.js');
const { createNodeTool } = await import('./create-node.js');

describe('createNode tool', () => {
  beforeEach(() => sql.mockReset());

  it('inserts a "blank-website" type as kind=site + meta.source=blank with seed snapshot', async () => {
    // 5 SQL calls for blank-website: SELECT board ownership, SELECT auto-place
    // (no posX/posY given), INSERT node, INSERT snapshot, UPDATE current_snapshot_id.
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);
    sql.mockResolvedValueOnce([]); // auto-place query — empty board (placeStackDown returns 0,0, no edges query) (empty board)
    sql.mockResolvedValueOnce([{ id: 'node-1', kind: 'site', pos_x: 0, pos_y: 0, width: 1280, height: 720, meta: { source: 'blank', name: 'hero' } }]);
    sql.mockResolvedValueOnce([{ id: 'snap-1' }]);
    sql.mockResolvedValueOnce([]); // UPDATE returning nothing
    const result = await createNodeTool.execute(
      { type: 'blank-website', name: 'hero' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.id).toBe('node-1');
    expect(result.type).toBe('blank-website');
    expect(result.color).toBe('teal');
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(sql.mock.calls.length).toBe(5);
  });

  it('inserts a "prompt" type (no seed snapshot)', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);
    sql.mockResolvedValueOnce([]); // auto-place query — empty board (placeStackDown returns 0,0, no edges query)
    sql.mockResolvedValueOnce([{ id: 'node-2', kind: 'prompt', pos_x: 0, pos_y: 0, width: 1280, height: 800, meta: {} }]);
    const result = await createNodeTool.execute(
      { type: 'prompt' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.type).toBe('prompt');
    expect(result.color).toBe('yellow');
    expect(sql.mock.calls.length).toBe(3); // SELECT board + SELECT auto-place + INSERT node
  });

  it('ignores legacy coordinates and always uses automatic placement', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);           // SELECT board (owner check)
    sql.mockResolvedValueOnce([]);                             // placeStackDown: empty board → 0,0
    sql.mockResolvedValueOnce([{ id: 'node-3', kind: 'prompt', pos_x: 0, pos_y: 0, width: 1280, height: 800, meta: {} }]); // INSERT
    const result = await createNodeTool.execute(
      { type: 'prompt', posX: 500, posY: 200 },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.posX).toBe(0);
    expect(result.posY).toBe(0);
    expect(sql.mock.calls.length).toBe(3);
  });

  it('returns invalid_args for missing type', async () => {
    const result = await createNodeTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(result.error).toBe('invalid_args');
  });

  it('returns invalid_args for unknown type', async () => {
    const result = await createNodeTool.execute({ type: 'wat' }, { boardId: 'b1', userId: 42 });
    expect(result.error).toBe('invalid_args');
  });

  it('returns forbidden when board not owned by user', async () => {
    sql.mockResolvedValueOnce([]); // SELECT board → empty
    const result = await createNodeTool.execute(
      { type: 'prompt' }, { boardId: 'b1', userId: 42 },
    );
    expect(result.error).toBe('forbidden');
  });

  it('stores content as meta.prompt for a prompt node', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);                                  // SELECT board
    sql.mockResolvedValueOnce([]);                                                   // placeStackDown SELECT nodes
    sql.mockResolvedValueOnce([{ id: 'node-9', kind: 'prompt', pos_x: 0, pos_y: 0, width: 600, height: 200, meta: { name: 'prompt', prompt: 'a fintech website' } }]); // INSERT
    const result = await createNodeTool.execute(
      { type: 'prompt', content: 'a fintech website' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.meta.prompt).toBe('a fintech website');
    const insertCall = sql.mock.calls.find((c) => String(c[0].join('')).includes('INSERT INTO nodes'));
    expect(JSON.stringify(insertCall)).toContain('a fintech website');
  });

  it('seeds a site node snapshot with the provided content HTML (derived/split page)', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);                                  // SELECT board
    sql.mockResolvedValueOnce([]);                                                   // placeStackDown
    sql.mockResolvedValueOnce([{ id: 'node-12', kind: 'site', pos_x: 0, pos_y: 0, width: 1280, height: 720, meta: { source: 'blank', name: 'Mockup 1' } }]); // INSERT node
    sql.mockResolvedValueOnce([{ id: 'snap-7' }]);                                   // INSERT snapshot
    sql.mockResolvedValueOnce([]);                                                   // UPDATE current_snapshot_id
    const html = '<html><body><section class="mockup-one">Grocery Shopping</section></body></html>';
    const result = await createNodeTool.execute(
      { type: 'blank-website', name: 'Mockup 1', content: html },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.id).toBe('node-12');
    const snapCall = sql.mock.calls.find((c) => String(c[0].join('')).includes('INSERT INTO snapshots'));
    expect(snapCall).toBeTruthy();
    // The seeded snapshot carries the caller's HTML, not the blank-site seed.
    expect(JSON.stringify(snapCall)).toContain('mockup-one');
    expect(JSON.stringify(snapCall)).not.toContain('Blank website');
  });

  it('seeds a design_md snapshot for a design-system node with content', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);                                  // SELECT board
    sql.mockResolvedValueOnce([]);                                                   // placeStackDown
    sql.mockResolvedValueOnce([{ id: 'node-10', kind: 'designmd', pos_x: 0, pos_y: 0, width: 600, height: 600, meta: { name: 'Untitled.md' } }]); // INSERT node
    sql.mockResolvedValueOnce([{ id: 'snap-1' }]);                                   // INSERT snapshot
    sql.mockResolvedValueOnce([]);                                                   // UPDATE current_snapshot_id
    const result = await createNodeTool.execute(
      { type: 'design-system', content: '# Colors\n- navy #0b1f3a' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.id).toBe('node-10');
    const snapCall = sql.mock.calls.find((c) => String(c[0].join('')).includes('INSERT INTO snapshots'));
    expect(snapCall).toBeTruthy();
    expect(JSON.stringify(snapCall)).toContain('navy #0b1f3a');
  });

  it('leaves a design-system node blank when no content given (no snapshot)', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);                                  // SELECT board
    sql.mockResolvedValueOnce([]);                                                   // placeStackDown
    sql.mockResolvedValueOnce([{ id: 'node-11', kind: 'designmd', pos_x: 0, pos_y: 0, width: 600, height: 600, meta: { name: 'Untitled.md' } }]); // INSERT node
    const result = await createNodeTool.execute(
      { type: 'design-system' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.id).toBe('node-11');
    const snapCall = sql.mock.calls.find((c) => String(c[0].join('')).includes('INSERT INTO snapshots'));
    expect(snapCall).toBeFalsy();
  });

  it('announces the persisted node as the camera focus without a placement ghost', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);
    sql.mockResolvedValueOnce([]);
    sql.mockResolvedValueOnce([{ id: 'node-focus', kind: 'prompt', pos_x: 0, pos_y: 0, width: 600, height: 200, meta: {} }]);
    const emit = vi.fn();

    await createNodeTool.execute(
      { type: 'prompt' },
      { boardId: 'board-1', userId: 42, emit },
    );

    expect(emit).toHaveBeenCalledWith('graph_mutated', {
      reason: 'createNode',
      nodeIds: ['node-focus'],
      focus: 'node',
    });
  });
});
