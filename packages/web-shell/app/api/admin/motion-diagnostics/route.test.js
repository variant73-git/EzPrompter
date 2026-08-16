import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminMock = vi.fn();
const dbMock = vi.fn();

vi.mock('../../../../lib/admin-auth.js', () => ({
  requireAdmin: (...args) => requireAdminMock(...args),
}));

vi.mock('../../../../lib/db.js', () => ({
  db: (...args) => dbMock(...args),
}));

const { GET } = await import('./route.js');

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

beforeEach(() => {
  requireAdminMock.mockReset();
  dbMock.mockReset();
});

describe('GET /api/admin/motion-diagnostics', () => {
  it('does not expose data to normal users', async () => {
    requireAdminMock.mockResolvedValue({
      user: null,
      error: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });
    const response = await GET(new Request('https://uncraft.test/api/admin/motion-diagnostics'));

    expect(response.status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('returns sanitized groups and limits affected-node links to owned projects', async () => {
    requireAdminMock.mockResolvedValue({ user: { id: 7, role: 'admin' }, error: null });
    const sql = fakeSql([
      [{ total: '2', recovered: '1', disabled: '1', failed: '1' }],
      [{
        key: 'target_missing', label: 'target_missing', count: '2',
        supported: '0', recovered: '1', disabled: '1', failed: '0',
      }],
      [
        {
          id: 'event-own', occurred_at: '2026-07-27T10:00:00.000Z', source: 'recovery',
          failure_code: 'target_missing', final_outcome: 'recovered', user_id: 7,
          board_id: 'board-own', node_id: 'node-own', control_id: 'speed', device: 'mobile',
        },
        {
          id: 'event-customer', occurred_at: '2026-07-27T09:00:00.000Z', source: 'runtime',
          failure_code: 'runtime_exception', final_outcome: 'failed', user_id: 8,
          board_id: 'board-customer', node_id: 'node-customer', control_id: null, device: 'desktop',
        },
      ],
    ]);
    dbMock.mockResolvedValue(sql);

    const response = await GET(new Request('https://uncraft.test/api/admin/motion-diagnostics?view=failures'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events[0]).toMatchObject({
      id: 'event-own',
      canOpenAffectedNode: true,
      affectedNodeHref: '/canvas/board-own?focusNode=node-own',
    });
    expect(body.events[1]).toMatchObject({
      id: 'event-customer',
      canOpenAffectedNode: false,
    });
    expect(body.events[1].affectedNodeHref).toBeUndefined();
    expect(body.groups[0]).toMatchObject({ supported: 0, recovered: 1, disabled: 1, failed: 0 });
  });
});
