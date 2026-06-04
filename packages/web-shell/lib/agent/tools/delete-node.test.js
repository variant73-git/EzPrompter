import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._nextResult = null;
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  return { sql };
});

const { sql } = await import('../../db.js');
const { deleteNodeTool } = await import('./delete-node.js');

describe('deleteNodeTool', () => {
  it('classification is destructive', () => {
    expect(deleteNodeTool.classification).toBe('destructive');
  });

  it('returns error when id missing', async () => {
    const r = await deleteNodeTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('returns error when node not owned', async () => {
    sql._nextResult = []; // ownership check empty
    const r = await deleteNodeTool.execute({ id: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('forbidden');
  });

  it('deletes node when owned and returns deleted summary', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: { name: 'demo' } }]); // ownership ok
      return Promise.resolve([{ id: 'n1' }]); // delete returning
    });
    const r = await deleteNodeTool.execute({ id: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r).toMatchObject({ deleted: true, id: 'n1' });
  });
});
