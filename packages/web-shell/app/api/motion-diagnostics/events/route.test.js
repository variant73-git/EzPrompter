import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUserMock = vi.fn();
const dbMock = vi.fn();

vi.mock('../../../../lib/auth.js', () => ({
  requireUser: (...args) => requireUserMock(...args),
}));

vi.mock('../../../../lib/db.js', () => ({
  db: (...args) => dbMock(...args),
}));

const { POST } = await import('./route.js');
const SESSION_ID = '10000000-0000-4000-8000-000000000001';

function fakeSql(results = []) {
  let index = 0;
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: Array.isArray(strings) ? strings.join(' ') : String(strings), values });
    return Promise.resolve(results[index++] || []);
  };
  sql.calls = calls;
  return sql;
}

function request(body) {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  };
}

beforeEach(() => {
  requireUserMock.mockReset();
  dbMock.mockReset();
  requireUserMock.mockResolvedValue({ user: { id: 7 }, error: null });
});

describe('POST /api/motion-diagnostics/events', () => {
  it('rejects unknown schemas before persistence', async () => {
    const response = await POST(request({
      sessionId: SESSION_ID,
      events: [{ schemaVersion: 99, code: 'bridge_timeout' }],
    }));

    expect(response.status).toBe(400);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('does not accept events for an unowned edit session', async () => {
    const sql = fakeSql([[]]);
    dbMock.mockResolvedValue(sql);
    const response = await POST(request({
      sessionId: SESSION_ID,
      events: [{ schemaVersion: 1, code: 'bridge_timeout' }],
    }));

    expect(response.status).toBe(404);
    expect(sql.calls).toHaveLength(1);
  });

  it('derives ownership on the server and accepts a sanitized batch', async () => {
    const sql = fakeSql([[
      {
        user_id: 7,
        board_id: '20000000-0000-4000-8000-000000000001',
        node_id: '30000000-0000-4000-8000-000000000001',
        snapshot_id: '40000000-0000-4000-8000-000000000001',
        edit_session_id: SESSION_ID,
        runtime_fingerprint: `sha256:${'a'.repeat(64)}`,
        content_hash: `sha256:${'b'.repeat(64)}`,
      },
    ], [], []]);
    dbMock.mockResolvedValue(sql);

    const response = await POST(request({
      sessionId: SESSION_ID,
      events: [{
        schemaVersion: 1,
        code: 'bridge_timeout',
        source: 'smoke',
        origin: 'smoke',
        message: 'secret page text',
      }],
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({ accepted: 1 });
    expect(sql.calls[1].text).toMatch(/INSERT INTO motion_diagnostic_events/i);
    expect(JSON.stringify(sql.calls[1].values)).not.toMatch(/secret page text/i);
    expect(JSON.stringify(sql.calls[1].values)).toMatch(/production/);
    expect(JSON.stringify(sql.calls[1].values)).not.toMatch(/"smoke"/);
    expect(JSON.stringify(sql.calls[1].values)).toMatch(/bridge_timeout/);
  });
});
