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
  RUNTIME_SESSION_EDIT_TTL_SECONDS: 4 * 60 * 60,
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
    }), { ttlSeconds: 4 * 60 * 60 });
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

describe('POST /api/nodes/[id]/runtime-session — lease mode (flag on)', () => {
  const SECRET = 'runtime-only-secret-with-at-least-32-characters';
  const HOST = 'a1b2c3d4e5f60718293a4b5c6d7e8f90.rt.uncraft.test';

  beforeEach(() => {
    process.env.UNCRAFT_RUNTIME_LEASE = '1';
    process.env.UNCRAFT_RUNTIME_SESSION_SECRET = SECRET;
    process.env.UNCRAFT_RUNTIME_HOST_SUFFIX = 'rt.uncraft.test';
    process.env.UNCRAFT_RUNTIME_AUTHORITY_TEMPLATE = 'https://{host}';
    requireUser.mockResolvedValue({ user: { id: 42 } });
    assertRuntimeSessionSigningConfiguration.mockReturnValue(true);
    openOrResumeEditSession.mockResolvedValue({ id: SESSION_ID, baseSnapshotId: SNAPSHOT_ID, revision: 3, status: 'active' });
  });

  it('emits a bootstrap URL on the persisted per-session hostname, not a token URL', async () => {
    // 1) snapshot SELECT, 2) CAS UPDATE claims the hostname
    sqlMock._results = [
      [{ node_id: NODE_ID, snapshot_id: SNAPSHOT_ID, native_bundle_id: BUNDLE_ID, entry_path: 'site/index.html', runtime_fingerprint: FINGERPRINT }],
      [{ runtime_hostname: HOST }],
    ];
    const response = await POST(request(), context);
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.runtime.mode).toBe('lease');
    expect(json.runtime.origin).toBe(`https://${HOST}`);
    expect(json.runtime.url).toMatch(new RegExp(`^https://${HOST.replace(/\./g, '\\.')}/api/runtime-bootstrap/`));
    expect(json.runtime.url).not.toContain('/api/runtime/'); // legacy token path gone
    expect(json.runtime.nonce).toMatch(/^[a-zA-Z0-9_-]{12,128}$/);
    expect(issueRuntimeSessionToken).not.toHaveBeenCalled();
    expect(json.session).toMatchObject({ id: SESSION_ID, revision: 3 });
  });

  it('reuses the hostname already persisted on the session (resume returns the same host)', async () => {
    // CAS UPDATE claims nothing (row exists) -> SELECT returns the persisted host
    sqlMock._results = [
      [{ node_id: NODE_ID, snapshot_id: SNAPSHOT_ID, native_bundle_id: BUNDLE_ID, entry_path: 'site/index.html', runtime_fingerprint: FINGERPRINT }],
      [], // UPDATE ... WHERE runtime_hostname IS NULL RETURNING -> no row
      [{ runtime_hostname: HOST }], // SELECT persisted
    ];
    const response = await POST(request(), context);
    const json = await response.json();
    expect(json.runtime.origin).toBe(`https://${HOST}`);
  });

  it('flag on without a host suffix is a misconfig -> 503, no token fallback', async () => {
    delete process.env.UNCRAFT_RUNTIME_HOST_SUFFIX;
    sqlMock._results = [
      [{ node_id: NODE_ID, snapshot_id: SNAPSHOT_ID, native_bundle_id: BUNDLE_ID, entry_path: 'site/index.html', runtime_fingerprint: FINGERPRINT }],
    ];
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    expect(issueRuntimeSessionToken).not.toHaveBeenCalled();
  });

  afterEach(() => {
    delete process.env.UNCRAFT_RUNTIME_LEASE;
    delete process.env.UNCRAFT_RUNTIME_SESSION_SECRET;
    delete process.env.UNCRAFT_RUNTIME_HOST_SUFFIX;
    delete process.env.UNCRAFT_RUNTIME_AUTHORITY_TEMPLATE;
  });
});
