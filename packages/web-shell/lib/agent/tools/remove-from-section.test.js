import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._impl = null;
  sql.mockImplementation((...a) => (sql._impl ? sql._impl(...a) : Promise.resolve([])));
  return { sql };
});
vi.mock('../../canvas-layout.js', () => ({
  resolvePlacement: vi.fn(async () => ({ x: 5000, y: 200 })),
}));

const { sql } = await import('../../db.js');
const { resolvePlacement } = await import('../../canvas-layout.js');
const { removeFromSectionTool } = await import('./remove-from-section.js');

describe('removeFromSectionTool', () => {
  it('classification is destructive', () => {
    expect(removeFromSectionTool.classification).toBe('destructive');
  });

  it('errors when nodeId missing', async () => {
    const r = await removeFromSectionTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('forbids a node not on the user board', async () => {
    sql._impl = () => Promise.resolve([]); // ownership empty
    const r = await removeFromSectionTool.execute({ nodeId: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('forbidden');
  });

  it('cuts edges, repositions, and reports the count', async () => {
    let call = 0;
    sql._impl = () => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: { name: 'Landing' }, pos_x: 100, pos_y: 100, width: 1280, height: 720 }]); // ownership
      if (call === 2) return Promise.resolve([{ id: 'e1' }, { id: 'e2' }]); // DELETE edges RETURNING
      return Promise.resolve([]); // UPDATE node
    };
    const r = await removeFromSectionTool.execute({ nodeId: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r).toMatchObject({ removed: true, id: 'n1', edgesCut: 2 });
    expect(resolvePlacement).toHaveBeenCalled();
    expect(r.summary).toContain('cut 2 edges');
  });

  it('summarize names the node', async () => {
    sql._impl = () => Promise.resolve([{ kind: 'site', meta: { name: 'Home' } }]);
    const s = await removeFromSectionTool.summarize({ nodeId: 'n1' }, { boardId: 'b1' });
    expect(s).toContain('Home');
  });
});
