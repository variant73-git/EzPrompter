import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  return { sql };
});
const { sql } = await import('../../db.js');
const { addEdgeTool } = await import('./add-edge.js');

describe('addEdge tool', () => {
  it('creates edge between two nodes in the board', async () => {
    sql.mockResolvedValueOnce([{ id: 'n1' }, { id: 'n2' }]); // both nodes belong to board
    sql.mockResolvedValueOnce([{ id: 'edge-1', from_node_id: 'n1', to_node_id: 'n2' }]);
    const r = await addEdgeTool.execute(
      { fromNodeId: 'n1', toNodeId: 'n2' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.id).toBe('edge-1');
  });

  it('returns invalid_args when ids missing', async () => {
    const r = await addEdgeTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('returns target_not_found when a node is not in board', async () => {
    sql.mockResolvedValueOnce([{ id: 'n1' }]); // only one returned
    const r = await addEdgeTool.execute(
      { fromNodeId: 'n1', toNodeId: 'n-missing' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.error).toBe('target_not_found');
  });
});
