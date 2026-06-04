import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  return { sql };
});

vi.mock('../../run-flow.js', () => ({
  runCompose: vi.fn(async () => ({ html: '<html><body>edited</body></html>' })),
}));

const { sql } = await import('../../db.js');
const { editSiteTool } = await import('./edit-site.js');

describe('editSiteTool', () => {
  it('classification is destructive', () => {
    expect(editSiteTool.classification).toBe('destructive');
  });

  it('returns error when required args missing', async () => {
    const r = await editSiteTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('returns node_open_in_edit when meta.editing=true', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: { editing: true } }]);
      return Promise.resolve([]);
    });
    const r = await editSiteTool.execute({ nodeId: 'n1', instruction: 'make it red' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('node_open_in_edit');
  });
});
