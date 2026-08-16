import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn(async () => ({ user: { id: 42 } }));
vi.mock('../../../../../lib/auth.js', () => ({ requireUser }));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock.mockImplementation(() => Promise.resolve(sqlMock._results.shift() || []));
vi.mock('../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const openOrResumeEditSession = vi.fn();
const updateEditSessionDraft = vi.fn();
vi.mock('../../../../../lib/motion-editor/edit-session-store.js', () => ({
  openOrResumeEditSession,
  updateEditSessionDraft,
}));

const { PATCH, POST } = await import('./route.js');

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const BUNDLE_ID = '44444444-4444-4444-8444-444444444444';
const FINGERPRINT = `sha256:${'a'.repeat(64)}`;
const DRAFT = {
  schemaVersion: 2,
  baseBundleId: BUNDLE_ID,
  transactions: [],
  controlManifest: {},
  responsiveManifest: {},
  runtimeFingerprint: FINGERPRINT,
};
const context = { params: Promise.resolve({ id: NODE_ID }) };

function request(method, body) {
  return new Request(`http://app.test/api/nodes/${NODE_ID}/motion-session`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function session(overrides = {}) {
  return {
    id: SESSION_ID,
    nodeId: NODE_ID,
    userId: 42,
    baseSnapshotId: SNAPSHOT_ID,
    baseBundleId: BUNDLE_ID,
    draftManifest: DRAFT,
    revision: 0,
    status: 'active',
    ...overrides,
  };
}

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { id: 42 } });
  sqlMock.mockClear();
  sqlMock._results = [];
  openOrResumeEditSession.mockReset();
  updateEditSessionDraft.mockReset();
});

describe('/api/nodes/[id]/motion-session', () => {
  it('opens or resumes the current owned native snapshot', async () => {
    sqlMock._results = [[{ snapshot_id: SNAPSHOT_ID }]];
    openOrResumeEditSession.mockResolvedValue(session());

    const response = await POST(request('POST'), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(openOrResumeEditSession).toHaveBeenCalledWith({
      sql: sqlMock,
      userId: 42,
      nodeId: NODE_ID,
      baseSnapshotId: SNAPSHOT_ID,
    });
    expect(body.session).toMatchObject({ id: SESSION_ID, draftManifest: DRAFT, revision: 0 });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('persists a draft only at the expected monotonic revision', async () => {
    updateEditSessionDraft.mockResolvedValue(session({ revision: 3 }));
    const response = await PATCH(request('PATCH', {
      sessionId: SESSION_ID,
      expectedRevision: 2,
      draftManifest: DRAFT,
    }), context);

    expect(response.status).toBe(200);
    expect(updateEditSessionDraft).toHaveBeenCalledWith({
      sql: sqlMock,
      userId: 42,
      nodeId: NODE_ID,
      sessionId: SESSION_ID,
      expectedRevision: 2,
      draftManifest: DRAFT,
    });
  });

  it('maps optimistic conflicts without exposing database details', async () => {
    updateEditSessionDraft.mockRejectedValue(Object.assign(new Error('stale'), {
      code: 'revision_conflict',
      currentRevision: 5,
    }));
    const response = await PATCH(request('PATCH', {
      sessionId: SESSION_ID,
      expectedRevision: 2,
      draftManifest: DRAFT,
    }), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'revision_conflict', currentRevision: 5 });
  });
});
