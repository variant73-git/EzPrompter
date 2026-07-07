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

// Ledger mocked so runBilledOperation's hold/settle don't consume the
// scripted sql sequences (same pattern as edit-site.test.js).
vi.mock('../../billing/ledger.js', () => ({
  holdCredits: vi.fn(async () => ({ held: true, balance: 500 })),
  refundHold: vi.fn(async () => ({ balance: 500 })),
  settleOperation: vi.fn(async ({ chargeCredits }) => ({ balanceAfter: 500 - chargeCredits })),
  grantCredits: vi.fn(async () => ({ balanceAfter: 500 })),
  getBalance: vi.fn(async () => 500),
  recentLedger: vi.fn(async () => []),
}));

const { sql } = await import('../../db.js');
const { runCompose } = await import('../../run-flow.js');
const { runFlowTool } = await import('./run-flow.js');

function mockRunSequence() {
  let call = 0;
  sql.mockImplementation(() => {
    call++;
    if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: {}, board_id: 'b1', current_html: '<div>old</div>', current_design_md: null }]);
    if (call === 2) return Promise.resolve([{ edge_id: 'e1', edge_payload: null, source_node_id: 's1', kind: 'prompt', meta: { prompt: 'a brief' }, source_html: null, source_design_md: null }]);
    return Promise.resolve([{ id: 'snap-new' }]);
  });
}

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
    sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
    const r = await runFlowTool.execute({ nodeId: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('forbidden');
  });

  it('forwards the dock picker model to runCompose when the agent passes no override', async () => {
    mockRunSequence();
    const r = await runFlowTool.execute(
      { nodeId: 'n1' },
      { boardId: 'b1', userId: 42, pickerModel: 'gpt-5.5' },
    );
    expect(r.error).toBeUndefined();
    expect(runCompose).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'gpt-5.5' }));
  });

  it('an explicit tool-arg modelId wins over the picker', async () => {
    mockRunSequence();
    const r = await runFlowTool.execute(
      { nodeId: 'n1', modelId: 'gemini-3.1-pro' },
      { boardId: 'b1', userId: 42, pickerModel: 'gpt-5.5' },
    );
    expect(r.error).toBeUndefined();
    expect(runCompose).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'gemini-3.1-pro' }));
  });
});
