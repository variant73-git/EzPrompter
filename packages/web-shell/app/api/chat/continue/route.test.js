import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const runMap = await import('../../../../lib/agent/run-map.js');
const { POST } = await import('./route.js');

beforeEach(() => runMap._resetForTests());

describe('POST /api/chat/continue', () => {
  it('returns 400 when missing runId', async () => {
    const req = new Request('http://test/api/chat/continue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('returns 404 when run unknown', async () => {
    const req = new Request('http://test/api/chat/continue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'nope', action: 'continue' }),
    });
    expect((await POST(req)).status).toBe(404);
  });

  it('resolves a pending soft pause with continue', async () => {
    runMap.registerRun('run-1');
    const p = runMap.awaitContinue('run-1');
    const req = new Request('http://test/api/chat/continue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1', action: 'continue' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(204);
    await expect(p).resolves.toEqual({ action: 'continue' });
  });

  it('resolves a pending soft pause with stop', async () => {
    runMap.registerRun('run-2');
    const p = runMap.awaitContinue('run-2');
    const req = new Request('http://test/api/chat/continue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-2', action: 'stop' }),
    });
    expect((await POST(req)).status).toBe(204);
    await expect(p).resolves.toEqual({ action: 'stop' });
  });
});
