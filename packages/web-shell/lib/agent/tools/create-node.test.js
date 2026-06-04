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
    sql.mockResolvedValueOnce([{ right_edge: -240, top_edge: 0 }]); // auto-place query (empty board)
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
    sql.mockResolvedValueOnce([{ right_edge: -240, top_edge: 0 }]); // auto-place query
    sql.mockResolvedValueOnce([{ id: 'node-2', kind: 'prompt', pos_x: 0, pos_y: 0, width: 1280, height: 800, meta: {} }]);
    const result = await createNodeTool.execute(
      { type: 'prompt' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.type).toBe('prompt');
    expect(result.color).toBe('yellow');
    expect(sql.mock.calls.length).toBe(3); // SELECT board + SELECT auto-place + INSERT node
  });

  it('skips the auto-place query when posX and posY are explicit', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);
    sql.mockResolvedValueOnce([{ id: 'node-3', kind: 'prompt', pos_x: 500, pos_y: 200, width: 1280, height: 800, meta: {} }]);
    const result = await createNodeTool.execute(
      { type: 'prompt', posX: 500, posY: 200 },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.posX).toBe(500);
    expect(result.posY).toBe(200);
    expect(sql.mock.calls.length).toBe(2); // SELECT board + INSERT node, no auto-place
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
});
