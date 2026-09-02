import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn(async () => ({ user: { id: 42 } }));
vi.mock('../../../../../../lib/auth.js', () => ({ requireUser }));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock.mockImplementation(() => Promise.resolve(sqlMock._results.shift() || []));
vi.mock('../../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const { POST } = await import('./route.js');

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const req = () => new Request(`http://app.test/api/nodes/${NODE_ID}/runtime-session/renew`, { method: 'POST' });
const ctx = { params: Promise.resolve({ id: NODE_ID }) };

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { id: 42 } });
  sqlMock.mockClear();
  sqlMock._results = [];
});

describe('POST /api/nodes/[id]/runtime-session/renew', () => {
  it('slides the session and the lease for the owner of an active session', async () => {
    const expiresAt = new Date(Date.now() + 4 * 3.6e6).toISOString();
    sqlMock._results = [
      [{ id: SESSION_ID, expires_at: expiresAt }], // session UPDATE ... RETURNING
      [{ expires_at: expiresAt }],                  // renewLease UPDATE ... RETURNING
    ];
    const res = await POST(req(), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ renewed: true, expiresAt, leaseRenewed: true });
    // The session UPDATE is fenced to active + unexpired + owner.
    const sessionSql = sqlMock.mock.calls[0][0].join('?');
    expect(sessionSql).toMatch(/status = 'active'/);
    expect(sessionSql).toMatch(/expires_at > NOW\(\)/);
    expect(sessionSql).toMatch(/b\.user_id =/);
  });

  it('a non-active or unowned session is not renewable -> 409 terminal', async () => {
    sqlMock._results = [[]]; // session UPDATE affects no row
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_renewable');
  });

  it('renews the session even if the lease row is not present yet (bootstrap not completed)', async () => {
    const expiresAt = new Date(Date.now() + 4 * 3.6e6).toISOString();
    sqlMock._results = [
      [{ id: SESSION_ID, expires_at: expiresAt }],
      [], // renewLease touched no lease row
    ];
    const res = await POST(req(), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ renewed: true, leaseRenewed: false });
  });

  it('passes through login failures before touching the database', async () => {
    requireUser.mockResolvedValue({ user: null, error: Response.json({ error: 'unauthorized' }, { status: 401 }) });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
