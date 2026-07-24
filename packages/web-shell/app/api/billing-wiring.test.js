// app/api/billing-wiring.test.js — billable route wrappers (Tasks 13-15)
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Scripted sql: returns queued row-sets in order.
function fakeSql(results) {
  let i = 0;
  const calls = [];
  const sql = (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join('¶') : String(strings);
    calls.push({ text, values });
    // The reconstruction helper re-reads the current snapshot authoritatively
    // (Codex #2). Answer it off a side-channel — as the plain 'capture' — so the
    // scripted row-sets keep their original ordering and count.
    if (/SELECT\s+n\.current_snapshot_id\s+AS\s+id/i.test(text)) {
      return Promise.resolve([{ id: 'cur-snap', source: 'capture' }]);
    }
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
vi.mock('../../lib/auth.js', () => ({
  requireUser: async () => ({ user: { id: 1 }, error: null }),
  hashPassword: async () => 'hashed',
  createToken: () => 'tok',
  sessionCookieHeader: () => 'uncraft_session=tok; Path=/',
}));
vi.mock('../../lib/run-flow.js', () => ({ runCompose: vi.fn(async () => ({ html: '<html>composed</html>' })) }));
vi.mock('../../lib/reconstruct.js', () => ({
  reconstructPage: vi.fn(async () => ({ html: '<html>rebuilt</html>', screenshotDataUrl: null })),
}));
vi.mock('../../lib/billing/ledger.js', () => ({
  holdCredits: (...a) => holdMock(...a),
  refundHold: (...a) => refundMock(...a),
  settleOperation: (...a) => settleMock(...a),
  grantCredits: vi.fn(async () => ({ balanceAfter: 500 })),
  getBalance: vi.fn(async () => 500),
  recentLedger: vi.fn(async () => []),
}));
// Operations lifecycle: bridge claim → the existing hold mock so held:false still
// surfaces as insufficient (402), preserving every hold assertion below.
vi.mock('../../lib/billing/operations.js', () => ({
  claimOperation: async ({ estimate = 0 }) => {
    const r = await holdMock({ credits: estimate });
    return r.held ? { outcome: 'claimed', operationId: 'op-test' } : { outcome: 'insufficient', balance: r.balance };
  },
  reclaimOperation: async () => ({ outcome: 'reclaimed', operationId: 'op-test' }),
}));
vi.mock('../../lib/billing/rate-limit.js', () => ({
  checkOpsRate: vi.fn(async () => ({ allowed: true })),
  checkChatRate: vi.fn(async () => ({ allowed: true })),
}));

const { POST: runPost } = await import('./nodes/[id]/run/route.js');
const { POST: reconstructPost } = await import('./nodes/[id]/reconstruct/route.js');
const { POST: signupPost } = await import('./auth/signup/route.js');
const { grantCredits: grantMock } = await import('../../lib/billing/ledger.js');
const { reconstructPage: reconstructPageMock } = await import('../../lib/reconstruct.js');

const makeRequest = (body = {}) => ({ json: async () => body, headers: { get: () => null } });
const runParams = { params: Promise.resolve({ id: 'node-1' }) };

beforeEach(() => {
  holdMock.mockClear();
  settleMock.mockClear();
  reconstructPageMock.mockClear();
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

  it('reconstructs an animated runtime source only when its binding requires it', async () => {
    currentSql = fakeSql([
      [{ id: 'node-1', kind: 'site', meta: {}, board_id: 'b1', origin_url: null, current_html: '<html>target</html>', current_design_md: null, current_snapshot_source: 'upload' }],
      [{ id: 'source-1', edge_id: 'e1', edge_payload: { binding: { motion: 'preserve' } }, source_node_id: 'source-1', kind: 'site', meta: { animatedDetected: true }, board_id: 'b1', origin_url: 'https://example.com', source_html: '<html>frozen</html>', source_design_md: null, current_snapshot_source: 'capture' }],
      [{ id: 'source-snap' }], // deferred reconstruction snapshot
      [],                      // reconstructed source metadata
      [{ id: 'target-snap' }], // composed target snapshot
      [],                      // target metadata
      [],                      // applied edges
    ]);

    const res = await runPost(makeRequest(), runParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.reconstructions).toHaveLength(1);
    expect(json.reconstructions[0]).toMatchObject({ nodeId: 'source-1', reason: 'runtime-source' });
    expect(holdMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ credits: 200 }));
    expect(holdMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ credits: 75 }));
    expect(reconstructPageMock).toHaveBeenCalledWith('https://example.com');
  });
});

describe('POST /api/nodes/[id]/reconstruct billing wrapper (Task 15)', () => {
  it('bills the reconstruct and returns credits', async () => {
    currentSql = fakeSql([
      [{ id: 'node-1', kind: 'site', meta: { animatedDetected: true }, board_id: 'b1', origin_url: 'https://example.com', current_snapshot_source: 'capture' }],
      [{ id: 'snap-1' }], // snapshot INSERT RETURNING
      [],                 // UPDATE nodes
    ]);
    const res = await reconstructPost(makeRequest(), runParams);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(holdMock).toHaveBeenCalledWith(expect.objectContaining({ credits: 200 })); // reconstruct estimate
  });

  it('returns 402 when the hold fails', async () => {
    holdMock.mockImplementation(async () => ({ held: false, balance: 5 }));
    currentSql = fakeSql([
      [{ id: 'node-1', kind: 'site', meta: { animatedDetected: true }, board_id: 'b1', origin_url: 'https://example.com', current_snapshot_source: 'capture' }],
    ]);
    const res = await reconstructPost(makeRequest(), runParams);
    const json = await res.json();
    expect(res.status).toBe(402);
    expect(json).toMatchObject({ error: 'insufficient_credits', estimate: 200, balance: 5 });
  });
});

describe('POST /api/auth/signup welcome pack (Task 15)', () => {
  it('grants the welcome pack to a clean signup', async () => {
    currentSql = fakeSql([
      [{ id: 7, email: 'novo@gmail.com', name: null, plan: 'free' }], // users INSERT RETURNING
      [],           // welcome: prior email grant → none
      [],           // welcome: ip/device window → none
      // budget env unset → skipped
    ]);
    const req = {
      json: async () => ({ email: 'novo@gmail.com', password: 'longenough1', deviceHash: 'd1' }),
      headers: { get: (h) => (h === 'x-forwarded-for' ? '9.9.9.9' : null) },
    };
    const res = await signupPost(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.welcome).toEqual({ granted: true, credits: 500 });
    expect(grantMock).toHaveBeenCalledWith(expect.objectContaining({ credits: 500, reason: 'welcome' }));
  });
});
