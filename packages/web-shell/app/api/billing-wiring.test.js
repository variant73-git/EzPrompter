// app/api/billing-wiring.test.js — billable route wrappers (Tasks 13-15)
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Scripted sql: returns queued row-sets in order.
function fakeSql(results) {
  let i = 0;
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: Array.isArray(strings) ? strings.join('¶') : String(strings), values });
    return Promise.resolve(results[i++] ?? []);
  };
  sql.calls = calls;
  return sql;
}

let currentSql = fakeSql([]);
const holdMock = vi.fn(async () => ({ held: true, balance: 500 }));
const refundMock = vi.fn(async () => ({ balance: 500 }));
const settleMock = vi.fn(async ({ chargeCredits }) => ({ balanceAfter: 500 - chargeCredits }));

vi.mock('../../lib/db.js', () => ({ db: async () => currentSql, sql: (...a) => currentSql(...a) }));
vi.mock('../../lib/auth.js', () => ({ requireUser: async () => ({ user: { id: 1 }, error: null }) }));
vi.mock('../../lib/run-flow.js', () => ({ runCompose: vi.fn(async () => ({ html: '<html>composed</html>' })) }));
vi.mock('../../lib/billing/ledger.js', () => ({
  holdCredits: (...a) => holdMock(...a),
  refundHold: (...a) => refundMock(...a),
  settleOperation: (...a) => settleMock(...a),
  grantCredits: vi.fn(async () => ({ balanceAfter: 500 })),
  getBalance: vi.fn(async () => 500),
  recentLedger: vi.fn(async () => []),
}));
vi.mock('../../lib/billing/rate-limit.js', () => ({
  checkOpsRate: vi.fn(async () => ({ allowed: true })),
  checkChatRate: vi.fn(async () => ({ allowed: true })),
}));

const { POST: runPost } = await import('./nodes/[id]/run/route.js');

const makeRequest = (body = {}) => ({ json: async () => body, headers: { get: () => null } });
const runParams = { params: Promise.resolve({ id: 'node-1' }) };

beforeEach(() => {
  holdMock.mockClear();
  settleMock.mockClear();
  holdMock.mockImplementation(async () => ({ held: true, balance: 500 }));
});

describe('POST /api/nodes/[id]/run billing wrapper', () => {
  it('bills the compose and returns credits + balanceAfter', async () => {
    currentSql = fakeSql([
      [{ id: 'node-1', kind: 'site', meta: {}, board_id: 'b1', current_html: '<html>t</html>', current_design_md: null }],
      [{ edge_id: 'e1', edge_payload: {}, source_node_id: 's1', kind: 'prompt', meta: { prompt: 'x' }, source_html: null, source_design_md: null }],
      [{ id: 'snap-1' }], // snapshot INSERT RETURNING
      [],                 // UPDATE nodes
      [],                 // UPDATE edges applied
    ]);
    const res = await runPost(makeRequest(), runParams);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.balanceAfter).toBeDefined();
    expect(holdMock).toHaveBeenCalledWith(expect.objectContaining({ credits: 75 })); // compose estimate
    expect(settleMock).toHaveBeenCalledOnce();
  });

  it('returns 402 with estimate + balance when the hold fails', async () => {
    holdMock.mockImplementation(async () => ({ held: false, balance: 10 }));
    currentSql = fakeSql([
      [{ id: 'node-1', kind: 'site', meta: {}, board_id: 'b1', current_html: '<html>t</html>', current_design_md: null }],
      [{ edge_id: 'e1', edge_payload: {}, source_node_id: 's1', kind: 'prompt', meta: { prompt: 'x' }, source_html: null, source_design_md: null }],
    ]);
    const res = await runPost(makeRequest(), runParams);
    const json = await res.json();
    expect(res.status).toBe(402);
    expect(json).toMatchObject({ error: 'insufficient_credits', estimate: 75, balance: 10 });
    expect(settleMock).not.toHaveBeenCalled();
  });
});
