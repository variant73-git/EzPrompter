import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));
vi.mock('../../../lib/chat-persistence.js', () => ({
  getOrCreateActiveThread: vi.fn(async () => ({ id: 'thread-1', board_id: 'b1', scope: 'board' })),
  loadMessages: vi.fn(async () => [
    { id: 'm1', role: 'user', content: 'hi', created_at: '2026-01-01T00:00:00Z' },
  ]),
}));

const { GET } = await import('./route.js');

describe('GET /api/chat', () => {
  it('returns 400 when boardId missing', async () => {
    const req = new Request('http://test/api/chat');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns thread + messages when boardId present', async () => {
    const req = new Request('http://test/api/chat?boardId=b1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.thread.id).toBe('thread-1');
    expect(body.messages).toHaveLength(1);
  });
});
