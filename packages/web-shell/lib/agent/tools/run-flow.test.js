import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  return { sql };
});

vi.mock('../../run-flow.js', () => ({
  runCompose: vi.fn(async () => ({
    html: '<html><body>fresh</body></html>',
    snapshotId: 'snap-1',
  })),
}));

const { sql } = await import('../../db.js');
const { runFlowTool } = await import('./run-flow.js');

describe('runFlowTool', () => {
  it('classification is safe — confirm chips are reserved for deletes (2026-06-12)', () => {
    expect(runFlowTool.classification).toBe('safe');
  });

  it('returns error when nodeId missing', async () => {
    const r = await runFlowTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('returns error when target node not owned', async () => {
    sql._nextResult = [];
    const r = await runFlowTool.execute({ nodeId: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('forbidden');
  });
});
