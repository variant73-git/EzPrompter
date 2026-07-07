import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ sql: vi.fn() }));
const { sql } = await import('../../db.js');
const { getNodeOutputTool } = await import('./get-node-output.js');

describe('getNodeOutput tool', () => {
  it('returns truncated html when length exceeds maxChars', async () => {
    sql.mockResolvedValueOnce([{
      id: 'snap-1',
      html: 'x'.repeat(5000),
      design_md: null,
    }]);
    const r = await getNodeOutputTool.execute({ nodeId: 'n1', maxChars: 100 }, { boardId: 'b1', userId: 42 });
    expect(r.content.length).toBeLessThanOrEqual(100 + 50); // truncation marker
    expect(r.truncated).toBe(true);
  });

  it('returns full content when within maxChars', async () => {
    sql.mockResolvedValueOnce([{ id: 'snap-1', html: '<p>short</p>', design_md: null }]);
    const r = await getNodeOutputTool.execute({ nodeId: 'n1', maxChars: 4000 }, { boardId: 'b1', userId: 42 });
    expect(r.truncated).toBe(false);
  });

  it('reads a full site HTML (~70KB) untruncated with a high maxChars — the deterministic split path', async () => {
    sql.mockResolvedValueOnce([{ id: 'snap-1', html: '<html>' + 'y'.repeat(70000) + '</html>', design_md: null }]);
    const r = await getNodeOutputTool.execute({ nodeId: 'n1', maxChars: 200000 }, { boardId: 'b1', userId: 42 });
    expect(r.truncated).toBe(false);
    expect(r.content.length).toBeGreaterThan(70000);
  });

  it('caps maxChars at 200000', async () => {
    sql.mockResolvedValueOnce([{ id: 'snap-1', html: 'z'.repeat(250000), design_md: null }]);
    const r = await getNodeOutputTool.execute({ nodeId: 'n1', maxChars: 999999 }, { boardId: 'b1', userId: 42 });
    expect(r.truncated).toBe(true);
    expect(r.content.length).toBeLessThanOrEqual(200000 + 60);
  });

  it('returns target_not_found when snapshot missing', async () => {
    sql.mockResolvedValueOnce([]);
    const r = await getNodeOutputTool.execute({ nodeId: 'missing' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('target_not_found');
  });
});
