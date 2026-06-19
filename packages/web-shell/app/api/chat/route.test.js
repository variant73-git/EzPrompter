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

const { GET, resolveAgentModel } = await import('./route.js');

describe('resolveAgentModel', () => {
  beforeEach(() => { delete process.env.UNCRAFT_AGENT_MODEL; });

  it('honors a known dropdown pick over the tier default', () => {
    expect(resolveAgentModel('gpt-5.5', { plan: 'free' })).toBe('gpt-5.5');
    expect(resolveAgentModel('claude-sonnet-4-6', { plan: 'free' })).toBe('claude-sonnet-4-6');
    expect(resolveAgentModel('gemini-3.1-pro', { plan: 'free' })).toBe('gemini-3.1-pro-preview');
  });

  it('falls back to the tier ladder for an unknown/absent pick', () => {
    expect(resolveAgentModel('kimi-k2.6', { plan: 'free' })).toBe('gemini-2.5-flash'); // unknown alias
    expect(resolveAgentModel(null, { plan: 'free' })).toBe('gemini-2.5-flash');
    expect(resolveAgentModel(null, { plan: 'pro' })).toBe('gpt-4o-mini');
    expect(resolveAgentModel(null, { plan: 'enterprise' })).toBe('claude-sonnet-4-6');
  });

  it('lets UNCRAFT_AGENT_MODEL env win when no explicit pick', () => {
    process.env.UNCRAFT_AGENT_MODEL = 'gemini-2.5-flash';
    expect(resolveAgentModel(null, { plan: 'enterprise' })).toBe('gemini-2.5-flash');
    // …but an explicit pick still overrides the env default.
    expect(resolveAgentModel('gpt-5.5', { plan: 'enterprise' })).toBe('gpt-5.5');
  });
});

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
