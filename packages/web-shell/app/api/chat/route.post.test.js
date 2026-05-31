import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));
vi.mock('../../../lib/chat-persistence.js', () => ({
  getOrCreateActiveThread: vi.fn(async () => ({ id: 'thread-1' })),
  appendMessage: vi.fn(async (m) => ({ id: 'msg-x', ...m })),
  loadMessages: vi.fn(async () => []),
}));
vi.mock('../../../lib/agent/tools/index.js', () => ({
  buildSafeRegistry: () => ({
    get: () => ({ name: 'noop', classification: 'safe' }),
    all: () => [],
    toAnthropicSpec: () => [],
  }),
}));
vi.mock('../../../lib/agent/driver.js', () => ({
  runAgentLoop: vi.fn(async ({ onEvent }) => {
    onEvent({ type: 'text_delta', text: 'hi' });
    onEvent({ type: 'message_complete', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    onEvent({ type: 'run_status', status: 'completed' });
    return { stop_reason: 'end_turn', iterations: 1, usage: { input_tokens: 1, output_tokens: 1 } };
  }),
}));

const { POST } = await import('./route.js');

describe('POST /api/chat', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('returns SSE response with events', async () => {
    const req = new Request('http://test/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi', modelId: 'claude-sonnet-4-6' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');

    // Consume the stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    expect(buf).toContain('event: assistant_token');
    expect(buf).toContain('event: run_status');
  });

  it('returns 400 when boardId missing', async () => {
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
