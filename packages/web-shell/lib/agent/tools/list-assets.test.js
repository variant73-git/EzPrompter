import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ sql: vi.fn() }));
const { sql } = await import('../../db.js');
const { listAssetsTool } = await import('./list-assets.js');

describe('listAssets tool', () => {
  it('lists library-scope assets (project_id IS NULL)', async () => {
    sql.mockResolvedValueOnce([
      { id: 'a1', type: 'image', source_url: 'http://x/a.png', thumb_url: 'http://x/a-thumb.png' },
    ]);
    const r = await listAssetsTool.execute({ scope: 'library' }, { boardId: 'b1', userId: 42 });
    expect(r).toHaveLength(1);
  });

  it('lists project-scope assets when scope=project', async () => {
    sql.mockResolvedValueOnce([]);
    await listAssetsTool.execute({ scope: 'project' }, { boardId: 'b1', userId: 42 });
    expect(sql).toHaveBeenCalled();
  });
});
