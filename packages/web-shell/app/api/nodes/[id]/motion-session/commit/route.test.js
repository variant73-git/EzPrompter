import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn(async () => ({ user: { id: 42 } }));
vi.mock('../../../../../../lib/auth.js', () => ({ requireUser }));
const sqlMock = vi.fn();
vi.mock('../../../../../../lib/db.js', () => ({ db: async () => sqlMock }));
const commitEditSession = vi.fn();
vi.mock('../../../../../../lib/motion-editor/edit-session-store.js', () => ({ commitEditSession }));

const { POST } = await import('./route.js');
const NODE_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const BUNDLE_ID = '44444444-4444-4444-8444-444444444444';
const context = { params: Promise.resolve({ id: NODE_ID }) };

function request(body) {
  return new Request(`http://app.test/api/nodes/${NODE_ID}/motion-session/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { id: 42 } });
  commitEditSession.mockReset();
  sqlMock.mockClear();
});

describe('POST /api/nodes/[id]/motion-session/commit', () => {
  it.each([
    ['exit', false, 'committed'],
    ['save-version', true, 'active'],
    ['before-structural-operation', true, 'active'],
  ])('commits reason %s with the expected session lifecycle', async (reason, continueEditing, status) => {
    commitEditSession.mockResolvedValue({
      sessionId: SESSION_ID,
      snapshotId: SNAPSHOT_ID,
      baseSnapshotId: SNAPSHOT_ID,
      baseBundleId: BUNDLE_ID,
      nodeId: NODE_ID,
      revision: continueEditing ? 4 : 3,
      status,
    });
    const response = await POST(request({ sessionId: SESSION_ID, expectedRevision: 3, reason }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(commitEditSession).toHaveBeenCalledWith({
      sql: sqlMock,
      userId: 42,
      nodeId: NODE_ID,
      sessionId: SESSION_ID,
      expectedRevision: 3,
      continueEditing,
    });
    expect(body).toMatchObject({
      reason,
      snapshot: { id: SNAPSHOT_ID, nativeBundleId: BUNDLE_ID, motionManifestVersion: 2 },
      session: { id: SESSION_ID, status },
    });
  });

  it('rejects unknown commit reasons before touching persistence', async () => {
    const response = await POST(request({ sessionId: SESSION_ID, expectedRevision: 3, reason: 'mystery' }), context);
    expect(response.status).toBe(400);
    expect(commitEditSession).not.toHaveBeenCalled();
  });
});
