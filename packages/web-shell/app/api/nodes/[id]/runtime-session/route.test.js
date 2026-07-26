import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn(async () => ({ user: { id: 42 } }));
vi.mock('../../../../../lib/auth.js', () => ({ requireUser }));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock.mockImplementation(() => Promise.resolve(sqlMock._results.shift() || []));
vi.mock('../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const openOrResumeEditSession = vi.fn();
vi.mock('../../../../../lib/motion-editor/edit-session-store.js', () => ({ openOrResumeEditSession }));

const issueRuntimeSessionToken = vi.fn();
const resolveRuntimeOrigin = vi.fn();
const assertRuntimeSessionSigningConfiguration = vi.fn();
vi.mock('../../../../../lib/motion-editor/runtime-session-token.js', () => ({
  assertRuntimeSessionSigningConfiguration,
  issueRuntimeSessionToken,
  resolveRuntimeOrigin,
}));

const { POST } = await import('./route.js');

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const BUNDLE_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function request() {
  return new Request(`http://app.test/api/nodes/${NODE_ID}/runtime-session`, { method: 'POST' });
}

const context = { params: Promise.resolve({ id: NODE_ID }) };

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { id: 42 } });
  sqlMock.mockClear();
  sqlMock._results = [];
  openOrResumeEditSession.mockReset();
  issueRuntimeSessionToken.mockReset();
  assertRuntimeSessionSigningConfiguration.mockReset();
  resolveRuntimeOrigin.mockReset();
  resolveRuntimeOrigin.mockReturnValue('http://runtime.test');
});

describe('POST /api/nodes/[id]/runtime-session', () => {
  it('creates a runtime URL only for the owner of the current native snapshot', async () => {
    sqlMock._results = [[{
      node_id: NODE_ID,
      snapshot_id: SNAPSHOT_ID,
      native_bundle_id: BUNDLE_ID,
      entry_path: 'site/index.html',
      runtime_fingerprint: FINGERPRINT,
    }]];
    openOrResumeEditSession.mockResolvedValue({
      id: SESSION_ID,
      baseSnapshotId: SNAPSHOT_ID,
      revision: 3,
      status: 'active',
    });
    issueRuntimeSessionToken.mockReturnValue({
      token: 'signed.runtime.token',
      nonce: 'nonce-123',
      expiresAt: '2027-01-15T08:02:00.000Z',
    });

    const response = await POST(request(), context);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(openOrResumeEditSession).toHaveBeenCalledWith({
      sql: sqlMock,
      userId: 42,
      nodeId: NODE_ID,
      baseSnapshotId: SNAPSHOT_ID,
    });
    expect(issueRuntimeSessionToken).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      entryPrefix: 'site',
    }));
    expect(json).toMatchObject({
      runtime: {
        url: 'http://runtime.test/api/runtime/signed.runtime.token/site/index.html',
        expiresAt: '2027-01-15T08:02:00.000Z',
        bundleId: BUNDLE_ID,
        runtimeFingerprint: FINGERPRINT,
      },
      session: { id: SESSION_ID, baseSnapshotId: SNAPSHOT_ID, revision: 3 },
    });
    expect(JSON.stringify(json)).not.toContain('storage_key');
    expect(JSON.stringify(json)).not.toContain('storageKey');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not create a token for an unowned, legacy, or stale node snapshot', async () => {
    sqlMock._results = [[]];
    const response = await POST(request(), context);
    expect(response.status).toBe(404);
    expect(openOrResumeEditSession).not.toHaveBeenCalled();
    expect(issueRuntimeSessionToken).not.toHaveBeenCalled();
  });

  it('passes through login authorization failures before touching the database', async () => {
    requireUser.mockResolvedValue({
      user: null,
      error: Response.json({ error: 'unauthorized' }, { status: 401 }),
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('does not open an edit session when the dedicated runtime boundary is misconfigured', async () => {
    assertRuntimeSessionSigningConfiguration.mockImplementation(() => {
      throw new Error('missing secret');
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    expect(sqlMock).not.toHaveBeenCalled();
    expect(openOrResumeEditSession).not.toHaveBeenCalled();
  });
});
