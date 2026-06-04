import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const runMap = await import('../../../../lib/agent/run-map.js');
const { POST } = await import('./route.js');

beforeEach(() => runMap._resetForTests());

describe('POST /api/chat/confirm', () => {
  it('returns 400 when body missing fields', async () => {
    const req = new Request('http://test/api/chat/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when runId unknown', async () => {
    const req = new Request('http://test/api/chat/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'nope', toolCallId: 'tc-1', action: 'confirm' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('resolves the pending confirm and returns 204', async () => {
    runMap.registerRun('run-1');
    const decisionP = runMap.awaitConfirm('run-1', 'tc-1');
    const req = new Request('http://test/api/chat/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1', toolCallId: 'tc-1', action: 'confirm' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(204);
    await expect(decisionP).resolves.toEqual({ action: 'confirm' });
  });

  it('passes choice when action="confirm" with choice', async () => {
    runMap.registerRun('run-2');
    const decisionP = runMap.awaitChoice('run-2', 'tc-2');
    const req = new Request('http://test/api/chat/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-2', toolCallId: 'tc-2', action: 'confirm', choice: 'gemini' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(204);
    await expect(decisionP).resolves.toEqual({ action: 'confirm', choice: 'gemini' });
  });
});
