import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ sql: vi.fn() }));
const { sql } = await import('../../db.js');
const { updateNodeTool } = await import('./update-node.js');

describe('updateNode tool', () => {
  it('updates pos_x, pos_y, meta when provided', async () => {
    sql.mockResolvedValueOnce([{ id: 'n1', board_id: 'b1' }]); // SELECT (ownership check)
    sql.mockResolvedValueOnce([{ id: 'n1', pos_x: 100, pos_y: 200, meta: { name: 'updated' } }]);
    const r = await updateNodeTool.execute(
      { id: 'n1', posX: 100, posY: 200, name: 'updated' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.id).toBe('n1');
    expect(r.posX).toBe(100);
  });

  it('returns target_not_found when node missing', async () => {
    sql.mockResolvedValueOnce([]); // ownership query empty
    const r = await updateNodeTool.execute({ id: 'missing' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('target_not_found');
  });

  it('returns invalid_args when nothing to update', async () => {
    sql.mockResolvedValueOnce([{ id: 'n1', board_id: 'b1' }]);
    const r = await updateNodeTool.execute({ id: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });
});
