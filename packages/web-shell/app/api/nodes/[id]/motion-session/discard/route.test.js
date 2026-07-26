import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn(async () => ({ user: { id: 42 } }));
vi.mock('../../../../../../lib/auth.js', () => ({ requireUser }));
const sqlMock = vi.fn();
vi.mock('../../../../../../lib/db.js', () => ({ db: async () => sqlMock }));
const discardEditSession = vi.fn();
vi.mock('../../../../../../lib/motion-editor/edit-session-store.js', () => ({ discardEditSession }));

const { POST } = await import('./route.js');
const NODE_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ id: NODE_ID }) };

function request(body) {
  return new Request(`http://app.test/api/nodes/${NODE_ID}/motion-session/discard`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { id: 42 } });
  discardEditSession.mockReset();
  sqlMock.mockClear();
});

describe('POST /api/nodes/[id]/motion-session/discard', () => {
  it('closes only the owned active draft and leaves its base snapshot intact', async () => {
    discardEditSession.mockResolvedValue({
      id: SESSION_ID,
      nodeId: NODE_ID,
      baseSnapshotId: SNAPSHOT_ID,
      revision: 2,
      status: 'discarded',
    });
    const response = await POST(request({ sessionId: SESSION_ID }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(discardEditSession).toHaveBeenCalledWith({
      sql: sqlMock,
      userId: 42,
      nodeId: NODE_ID,
      sessionId: SESSION_ID,
    });
    expect(body.session).toMatchObject({ id: SESSION_ID, baseSnapshotId: SNAPSHOT_ID, status: 'discarded' });
  });
});
