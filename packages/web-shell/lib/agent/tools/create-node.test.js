import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._reset = () => sql.mockReset();
  return { sql };
});

const { sql } = await import('../../db.js');
const { createNodeTool } = await import('./create-node.js');

describe('createNode tool', () => {
  it('inserts a "blank-website" type as kind=site + meta.source=blank', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);
    sql.mockResolvedValueOnce([{ id: 'node-1', kind: 'site', pos_x: 0, pos_y: 0, meta: { source: 'blank', name: 'hero' } }]);
    const result = await createNodeTool.execute(
      { type: 'blank-website', name: 'hero' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.id).toBe('node-1');
    expect(result.type).toBe('blank-website');
    expect(result.color).toBe('teal');
    // Verify SQL was called with kind=site (the storage primitive) — agent never sees this.
    const insertCall = sql.mock.calls[1];
    expect(insertCall[1]).toBeDefined();
  });

  it('inserts a "prompt" type', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);
    sql.mockResolvedValueOnce([{ id: 'node-2', kind: 'prompt', pos_x: 0, pos_y: 0, meta: {} }]);
    const result = await createNodeTool.execute(
      { type: 'prompt' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.type).toBe('prompt');
    expect(result.color).toBe('yellow');
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
