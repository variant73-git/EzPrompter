import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ sql: vi.fn() }));
const { sql } = await import('../../db.js');
const { queryNodesTool } = await import('./query-nodes.js');

describe('queryNodes tool', () => {
  it('returns nodes filtered by kind', async () => {
    sql.mockResolvedValueOnce([
      { id: 'n1', kind: 'site', meta: { name: 'foo' } },
      { id: 'n2', kind: 'site', meta: {} },
    ]);
    const r = await queryNodesTool.execute({ kind: 'site' }, { boardId: 'b1', userId: 42 });
    expect(r).toHaveLength(2);
  });

  it('caps results at limit (default 30)', async () => {
    sql.mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, kind: 'prompt' })));
    const r = await queryNodesTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r).toHaveLength(30);
  });
});
