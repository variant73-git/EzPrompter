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
    toOpenAISpec: () => [],
    toGeminiSpec: () => [{ functionDeclarations: [] }],
  }),
}));
vi.mock('../../../lib/agent/llm-anthropic.js', () => ({ callAnthropic: vi.fn() }));
vi.mock('../../../lib/agent/llm-openai.js', () => ({ callOpenAI: vi.fn() }));
vi.mock('../../../lib/agent/llm-gemini.js', () => ({ callGemini: vi.fn() }));
const driverCalls = [];
vi.mock('../../../lib/agent/driver.js', () => ({
  runAgentLoop: vi.fn(async (opts) => {
    driverCalls.push({ llm: opts.llm });
    opts.onEvent({ type: 'text_delta', text: 'hi' });
    opts.onEvent({ type: 'message_complete', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    opts.onEvent({ type: 'run_status', status: 'completed' });
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

  it('routes claude-sonnet-4-6 to callAnthropic', async () => {
    driverCalls.length = 0;
    process.env.ANTHROPIC_API_KEY = 'fake';
    const { callAnthropic } = await import('../../../lib/agent/llm-anthropic.js');
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi', modelId: 'claude-sonnet-4-6' }),
    });
    const res = await POST(req);
    // Consume to ensure handler runs to completion
    await res.body.getReader().read();
    await new Promise((r) => setTimeout(r, 50));
    expect(driverCalls[0]?.llm).toBe(callAnthropic);
  });

  it('routes gpt-5.5 to callOpenAI', async () => {
    driverCalls.length = 0;
    process.env.OPENAI_API_KEY = 'fake';
    const { callOpenAI } = await import('../../../lib/agent/llm-openai.js');
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi', modelId: 'gpt-5.5' }),
    });
    const res = await POST(req);
    await res.body.getReader().read();
    await new Promise((r) => setTimeout(r, 50));
    expect(driverCalls[0]?.llm).toBe(callOpenAI);
  });

  it('routes gemini-3.1-pro to callGemini', async () => {
    driverCalls.length = 0;
    process.env.GEMINI_API_KEY = 'fake';
    const { callGemini } = await import('../../../lib/agent/llm-gemini.js');
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi', modelId: 'gemini-3.1-pro' }),
    });
    const res = await POST(req);
    await res.body.getReader().read();
    await new Promise((r) => setTimeout(r, 50));
    expect(driverCalls[0]?.llm).toBe(callGemini);
  });
});
