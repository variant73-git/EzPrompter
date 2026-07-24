import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  return { sql };
});

vi.mock('../../run-flow.js', () => ({
  runCompose: vi.fn(async () => ({ html: '<html><body>edited</body></html>' })),
}));

// Billing (Task 14): the tool wraps its work in runBilledOperation — mock the
// ledger + operations so hold/claim/settle don't consume the scripted sql sequences above.
vi.mock('../../billing/operations.js', () => ({
  claimOperation: vi.fn(async () => ({ outcome: 'claimed', operationId: 'op-test' })),
  reclaimOperation: vi.fn(async () => ({ outcome: 'reclaimed', operationId: 'op-test' })),
}));
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

  it('forwards the dock picker model to runCompose (agent edits honor the picker)', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: {}, board_id: 'b1', current_html: '<div>page</div>', current_design_md: null }]);
      return Promise.resolve([{ id: 'snap-new' }]);
    });
    runCompose.mockResolvedValueOnce({ html: '<html><body>edited</body></html>' });
    const r = await editSiteTool.execute(
      { nodeId: 'n1', instruction: 'make it red' },
      { boardId: 'b1', userId: 42, pickerModel: 'gpt-5.5' },
    );
    expect(r.error).toBeUndefined();
    expect(runCompose).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'gpt-5.5' }));
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
    expect(call).toBe(1); // ownership query only — no snapshot INSERT/UPDATE ran (ledger is mocked)
  });
});
