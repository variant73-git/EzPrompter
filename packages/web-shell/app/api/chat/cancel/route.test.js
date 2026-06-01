import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const runMap = await import('../../../../lib/agent/run-map.js');
const { POST } = await import('./route.js');

beforeEach(() => runMap._resetForTests());

describe('POST /api/chat/cancel', () => {
  it('returns 400 when missing runId', async () => {
    const req = new Request('http://test/api/chat/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('returns 404 when run unknown', async () => {
    const req = new Request('http://test/api/chat/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'nope' }),
    });
    expect((await POST(req)).status).toBe(404);
  });

  it('marks run cancelled and returns 204', async () => {
    runMap.registerRun('run-1');
    const req = new Request('http://test/api/chat/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1' }),
    });
    expect((await POST(req)).status).toBe(204);
    expect(runMap.isCancelled('run-1')).toBe(true);
  });
});
