import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._reset = () => sql.mockReset();
  return { sql };
});

const { sql } = await import('../../db.js');
const { createNodeTool } = await import('./create-node.js');

describe('createNode tool', () => {
  it('inserts a node and returns the row', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);              // SELECT board
    sql.mockResolvedValueOnce([{ id: 'node-1', kind: 'prompt' }]); // INSERT node
    const result = await createNodeTool.execute(
      { kind: 'prompt', name: 'idea 1' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.id).toBe('node-1');
  });

  it('returns invalid_args for missing kind', async () => {
    const result = await createNodeTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(result.error).toBe('invalid_args');
  });

  it('returns invalid_args for unknown kind', async () => {
    const result = await createNodeTool.execute({ kind: 'wat' }, { boardId: 'b1', userId: 42 });
    expect(result.error).toBe('invalid_args');
  });

  it('returns forbidden when board not owned by user', async () => {
    sql.mockResolvedValueOnce([]); // SELECT board → empty
    const result = await createNodeTool.execute(
      { kind: 'prompt' }, { boardId: 'b1', userId: 42 },
    );
    expect(result.error).toBe('forbidden');
  });
});
