// route.test.js — the extract route must bound its own total time with a
// server deadline BELOW the client's, so a slow multi-call extract (clone/
// styleclone) fails CLEANLY, REFUNDS the hold, and creates NO node — instead of
// the client aborting at 200s while the server keeps running, charges, and
// persists a node → double-charge + duplicate on retry (audit 2026-07-23,
// Claude lens A + Sol #1). Uses the REAL runBilledOperation over a FAKE ledger
// so the refund path is genuinely exercised (Sol #4 — the mock-passthrough
// earlier did not witness the refund).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock._templates = [];
sqlMock.mockImplementation((t) => {
  sqlMock._templates.push(Array.isArray(t) ? t.join(' ') : String(t));
  return Promise.resolve(sqlMock._results.shift() || []);
});
vi.mock('../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

vi.mock('../../../../../lib/billing/rate-limit.js', () => ({
  checkOpsRate: vi.fn(async () => ({ allowed: true })),
}));

// Real runBilledOperation (NOT mocked) over a FAKE ledger + priced op — so the
// hold → (refund | charge) path is actually driven by the route's deadline.
const holdCredits = vi.fn(async () => ({ held: true, balance: 100 }));
const refundHold = vi.fn(async () => {});
const settleOperation = vi.fn(async () => ({ balanceAfter: 95 }));
vi.mock('../../../../../lib/billing/ledger.js', () => ({ holdCredits, refundHold, settleOperation }));
vi.mock('../../../../../lib/billing/pricing.js', () => ({ estimateOp: () => 5, creditsForOperation: () => 3 }));

vi.mock('../../../../../lib/canvas-layout.js', () => ({
  placeStackDown: vi.fn(async () => ({ x: 0, y: 0 })),
  resolvePlacement: vi.fn(async () => ({ x: 0, y: 0 })),
}));

const runExtractMock = vi.fn();
vi.mock('../../../../../lib/extract.js', () => ({ runExtract: (...a) => runExtractMock(...a) }));

// The route reads + clamps the deadline at module load — set it BEFORE import.
// Clamp floor is 1s, so drive the timeout with a >1s slow extract below.
process.env.UNCRAFT_EXTRACT_ROUTE_DEADLINE_MS = '1000';
const { POST } = await import('./route.js');

const srcRow = { id: 'n1', board_id: 'b1', kind: 'site', meta: {}, html: '<h1>x</h1>', design_md: null };
const okResult = { kind: 'designmd', designMd: '# spec', meta: { name: 'x' } };
const insertedNode = { id: 'new', board_id: 'b1', kind: 'designmd', pos_x: 0, pos_y: 0, width: 600, height: 600, meta: {}, created_at: 't' };

beforeEach(() => {
  sqlMock._results = []; sqlMock._templates = []; sqlMock.mockClear();
  runExtractMock.mockReset();
  holdCredits.mockClear(); refundHold.mockClear(); settleOperation.mockClear();
});

function makeReq() {
  return new Request('http://test/api/nodes/n1/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: 'designmd' }),
  });
}

describe('POST /api/nodes/[id]/extract — route deadline', () => {
  it('a slow extract times out cleanly (502), REFUNDS the hold, and creates NO node', async () => {
    sqlMock._results = [[srcRow], [insertedNode], [{ id: 'snap' }], [], []];
    // 1500ms > the 1000ms clamped deadline → the route deadline trips first.
    runExtractMock.mockImplementation(
      () => new Promise((res) => setTimeout(() => res(okResult), 1500))
    );

    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'n1' }) });

    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/timed out/i);
    // The hold (estimate 5) was restored by an atomic zero-charge settle — no
    // silent debit, and no reliance on a separate swallowable refundHold.
    expect(settleOperation).toHaveBeenCalledWith(expect.objectContaining({ holdCredits: 5, chargeCredits: 0 }));
    expect(refundHold).not.toHaveBeenCalled();
    // And no node/snapshot was persisted — no duplicate on retry.
    expect(sqlMock._templates.some((t) => /INSERT INTO nodes/i.test(t))).toBe(false);
  });

  it('a fast extract succeeds, charges, and creates the node', async () => {
    sqlMock._results = [[srcRow], [insertedNode], [{ id: 'snap' }], [], []];
    runExtractMock.mockResolvedValue(okResult);

    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'n1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.node.id).toBe('new');
    // Charged (non-zero), not refunded, and the node was persisted.
    expect(settleOperation).toHaveBeenCalledWith(expect.objectContaining({ chargeCredits: 3 }));
    expect(refundHold).not.toHaveBeenCalled();
    expect(sqlMock._templates.some((t) => /INSERT INTO nodes/i.test(t))).toBe(true);
  });
});
