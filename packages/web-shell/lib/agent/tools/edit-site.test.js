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
const { runCompose } = await import('../../run-flow.js');
const { editSiteTool } = await import('./edit-site.js');

describe('editSiteTool', () => {
  it('classification is safe — confirm chips are reserved for deletes (2026-06-12)', () => {
    expect(editSiteTool.classification).toBe('safe');
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

  it('rejects prose output — no_change, no snapshot saved', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: {}, board_id: 'b1', current_html: '<div>real page</div>', current_design_md: null }]);
      return Promise.resolve([{ id: 'snap-new' }]);
    });
    runCompose.mockResolvedValueOnce({ html: 'Looking at the HTML, there is no such element, so I will return the HTML unchanged.' });
    const r = await editSiteTool.execute({ nodeId: 'n1', instruction: 'swap the logo' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('no_change');
    expect(call).toBe(1); // ownership query only — no INSERT/UPDATE ran
  });
});
