// lib/agent/tools/billing.test.js — billable tools bill as their own operations (Task 14)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlResults = [];
vi.mock('../../db.js', () => ({
  sql: (strings, ...values) => Promise.resolve(sqlResults.shift() ?? []),
  db: async () => (strings, ...values) => Promise.resolve(sqlResults.shift() ?? []),
}));
vi.mock('../../run-flow.js', () => ({
  runCompose: vi.fn(async () => ({ html: '<html>composed</html>' })),
}));

const holdMock = vi.fn(async () => ({ held: true, balance: 500 }));
const settleMock = vi.fn(async ({ chargeCredits }) => ({ balanceAfter: 500 - chargeCredits }));
vi.mock('../../billing/ledger.js', () => ({
  holdCredits: (...a) => holdMock(...a),
  refundHold: vi.fn(async () => ({ balance: 500 })),
  settleOperation: (...a) => settleMock(...a),
  grantCredits: vi.fn(async () => ({ balanceAfter: 500 })),
  getBalance: vi.fn(async () => 500),
  recentLedger: vi.fn(async () => []),
}));
// Bridge claim → the hold mock so held:false still surfaces as insufficient.
vi.mock('../../billing/operations.js', () => ({
  claimOperation: async ({ estimate = 0 }) => {
    const r = await holdMock({ credits: estimate });
    return r.held ? { outcome: 'claimed', operationId: 'op-test' } : { outcome: 'insufficient', balance: r.balance };
  },
  reclaimOperation: async () => ({ outcome: 'reclaimed', operationId: 'op-test' }),
}));

const { runFlowTool } = await import('./run-flow.js');
const { runMeteredOperation } = await import('../../billing/context.js');

const ctx = { userId: 1, boardId: 'b1' };

beforeEach(() => {
  sqlResults.length = 0;
  holdMock.mockClear();
  settleMock.mockClear();
  holdMock.mockImplementation(async () => ({ held: true, balance: 500 }));
});

describe('runFlow tool billing', () => {
  it('bills its own compose operation inside a free chat context', async () => {
    sqlResults.push(
      [{ id: 'n1', kind: 'site', meta: {}, board_id: 'b1', current_html: '<html>t</html>', current_design_md: null }],
      [{ edge_id: 'e1', source_node_id: 's1', kind: 'prompt', meta: { prompt: 'x' }, source_html: null, source_design_md: null }],
      [{ id: 'snap1' }], // snapshot insert
      [],                // node update
    );
    const outer = await runMeteredOperation({ sql: () => Promise.resolve([]), userId: 1, op: 'chat' }, async () => {
      return runFlowTool.execute({ nodeId: 'n1' }, ctx);
    });
    expect(outer.credits).toBe(0); // chat itself free
    expect(outer.result.ran).toBe(true);
    expect(outer.result.credits).toBeDefined();
    // The inner compose op held its estimate (75) and settled separately.
    expect(holdMock).toHaveBeenCalledWith(expect.objectContaining({ credits: 75 }));
    const composeSettle = settleMock.mock.calls.find((c) => c[0].op === 'compose');
    expect(composeSettle).toBeTruthy();
  });

  it('returns a structured insufficient_credits error instead of crashing the run', async () => {
    holdMock.mockImplementation(async () => ({ held: false, balance: 10 }));
    sqlResults.push(
      [{ id: 'n1', kind: 'site', meta: {}, board_id: 'b1', current_html: '<html>t</html>', current_design_md: null }],
      [{ edge_id: 'e1', source_node_id: 's1', kind: 'prompt', meta: { prompt: 'x' }, source_html: null, source_design_md: null }],
    );
    const out = await runFlowTool.execute({ nodeId: 'n1' }, ctx);
    expect(out).toMatchObject({ error: 'insufficient_credits', estimate: 75, balance: 10 });
  });
});
