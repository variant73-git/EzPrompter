import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));
vi.mock('../../../lib/db.js', () => ({
  sql: vi.fn(async () => [{ id: 'asset-mock-123' }]),
}));
vi.mock('../../../lib/chat-persistence.js', () => ({
  getOrCreateActiveThread: vi.fn(async () => ({ id: 'thread-1' })),
  appendMessage: vi.fn(async (m) => ({ id: 'msg-x', ...m })),
  loadMessages: vi.fn(async () => []),
  startAgentRun: vi.fn(async () => ({ id: 'run-99' })),
  finishAgentRun: vi.fn(async () => ({})),
}));
const mockRegistry = {
  get: () => ({ name: 'noop', classification: 'safe' }),
  all: () => [],
  toAnthropicSpec: () => [],
  toOpenAISpec: () => [],
  toGeminiSpec: () => [{ functionDeclarations: [] }],
};
vi.mock('../../../lib/agent/tools/index.js', () => ({
  buildSafeRegistry: () => mockRegistry,
  buildFullRegistry: () => mockRegistry,
}));
vi.mock('../../../lib/agent/run-map.js', () => ({
  registerRun: vi.fn(),
  unregisterRun: vi.fn(),
}));
vi.mock('../../../lib/agent/caps.js', () => ({
  getCaps: vi.fn(() => ({ softLimit: 10, hardLimit: 50 })),
}));
vi.mock('../../../lib/agent/llm-anthropic.js', () => ({ callAnthropic: vi.fn() }));
vi.mock('../../../lib/agent/llm-openai.js', () => ({ callOpenAI: vi.fn() }));
vi.mock('../../../lib/agent/llm-gemini.js', () => ({ callGemini: vi.fn() }));
// In tests we bypass the circuit breaker so route routing assertions can
// still rely on function identity. Breaker behaviour itself is verified
// directly against opossum at lib/agent/circuit.test.js when we add it.
vi.mock('../../../lib/agent/circuit.js', () => ({
  breakerFor: (_name, fn) => fn,
}));
const driverCalls = [];
vi.mock('../../../lib/agent/driver.js', () => ({
  runAgentLoop: vi.fn(async (opts) => {
    driverCalls.push({ llm: opts.llm, messages: opts.messages });
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
    // Default AGENT_MODEL for the generic SSE test that doesn't override.
    // Routing tests below set their own UNCRAFT_AGENT_MODEL per-case.
    process.env.UNCRAFT_AGENT_MODEL = 'claude-sonnet-4-6';
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
    process.env.UNCRAFT_AGENT_MODEL = 'claude-sonnet-4-6';
    const { callAnthropic } = await import('../../../lib/agent/llm-anthropic.js');
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi' }),
    });
    const res = await POST(req);
    // Consume to ensure handler runs to completion
    await res.body.getReader().read();
    await new Promise((r) => setTimeout(r, 50));
    expect(driverCalls[0]?.llm).toBe(callAnthropic);
  });

  it('routes UNCRAFT_AGENT_MODEL=gpt-5.5 to callOpenAI', async () => {
    driverCalls.length = 0;
    process.env.OPENAI_API_KEY = 'fake';
    process.env.UNCRAFT_AGENT_MODEL = 'gpt-5.5';
    const { callOpenAI } = await import('../../../lib/agent/llm-openai.js');
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi' }),
    });
    const res = await POST(req);
    await res.body.getReader().read();
    await new Promise((r) => setTimeout(r, 50));
    expect(driverCalls[0]?.llm).toBe(callOpenAI);
  });

  it('routes UNCRAFT_AGENT_MODEL=gemini-3.1-pro-preview to callGemini', async () => {
    driverCalls.length = 0;
    process.env.GEMINI_API_KEY = 'fake';
    process.env.UNCRAFT_AGENT_MODEL = 'gemini-3.1-pro-preview';
    const { callGemini } = await import('../../../lib/agent/llm-gemini.js');
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi' }),
    });
    const res = await POST(req);
    await res.body.getReader().read();
    await new Promise((r) => setTimeout(r, 50));
    expect(driverCalls[0]?.llm).toBe(callGemini);
  });
});

describe('POST /api/chat — Phase 2 wiring', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-fake';
    process.env.UNCRAFT_AGENT_MODEL = 'claude-sonnet-4-6';
  });

  async function readSseEvents(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const events = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const lines = block.split('\n');
        const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
        const data = lines.find((l) => l.startsWith('data:'))?.slice(5).trim();
        events.push({ event, data: data ? JSON.parse(data) : null });
      }
    }
    return events;
  }

  it('emits thread_id → run_id → assistant_token → run_status in order', async () => {
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi' }),
    });
    const res = await POST(req);
    const events = await readSseEvents(res);
    const order = events.map((e) => e.event);
    expect(order.indexOf('thread_id')).toBeLessThan(order.indexOf('run_id'));
    expect(order.indexOf('run_id')).toBeLessThan(order.indexOf('assistant_token'));
    expect(order[order.length - 1]).toBe('run_status');
  });

  it('Phase 5b: persists assistant message with accumulated text content', async () => {
    // The top-level runAgentLoop mock emits text_delta with 'hi'.
    // This test verifies route accumulates that text and saves it via appendMessage.
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hello' }),
    });
    const res = await POST(req);
    await readSseEvents(res);
    // Give the async IIFE a tick to complete after stream closes.
    await new Promise((r) => setTimeout(r, 30));

    const { appendMessage } = await import('../../../lib/chat-persistence.js');
    const calls = appendMessage.mock.calls;
    const assistantCall = calls.find((c) => c[0]?.role === 'assistant');
    expect(assistantCall).toBeTruthy();
    // The mock emits text_delta with 'hi' — accumulated text should be 'hi'.
    expect(assistantCall[0].content).toBe('hi');
    // No tool_use events from the mock, so toolCalls should be null.
    expect(assistantCall[0].toolCalls).toBeNull();
  });
});

describe('POST /api/chat — conversation memory', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-fake';
    process.env.UNCRAFT_AGENT_MODEL = 'claude-sonnet-4-6';
  });

  it('replays prior thread turns before the current message (no more amnesia loop)', async () => {
    driverCalls.length = 0;
    const { loadMessages } = await import('../../../lib/chat-persistence.js');
    loadMessages.mockResolvedValueOnce([
      { role: 'user', content: 'faça esse node em light mode' },
      { role: 'assistant', content: 'Which node? 1, 2, 3, 4?' },
      { role: 'user', content: 'Website from image' },
      { role: 'assistant', content: '', tool_calls: [{ name: 'viewNode' }] }, // tool-only → skipped
    ]);
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'faça em light mode' }),
    });
    await POST(req);
    await new Promise((r) => setTimeout(r, 30));

    const msgs = driverCalls[0].messages;
    // Prior text turns are present, the empty tool-only assistant turn is dropped,
    // and the current message is LAST.
    const texts = msgs.map((m) => (typeof m.content === 'string' ? m.content : ''));
    expect(texts.some((t) => t.includes('faça esse node em light mode'))).toBe(true);
    expect(texts.some((t) => t.includes('Website from image'))).toBe(true);
    expect(msgs.filter((m) => m.role === 'assistant').length).toBe(1); // the empty one skipped
    expect(texts[texts.length - 1]).toContain('faça em light mode'); // current is last
  });
});

describe('POST /api/chat — multimodal user content', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-fake';
    process.env.UNCRAFT_AGENT_MODEL = 'claude-sonnet-4-6';
  });

  it('builds a content array with text + image block when attachments are present', async () => {
    driverCalls.length = 0;
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        boardId: 'b1',
        message: 'what do you see?',
        attachments: [{ kind: 'image', dataUrl: 'data:image/png;base64,ABC', name: 'ref.png', mimeType: 'image/png' }],
      }),
    });
    const res = await POST(req);
    await res.body.getReader().read();
    await new Promise((r) => setTimeout(r, 30));

    expect(driverCalls.length).toBe(1);
    const userMsg = driverCalls[0].messages[0];
    expect(userMsg.role).toBe('user');
    expect(Array.isArray(userMsg.content)).toBe(true);
    // First text block carries: a compact board-state preamble (so the agent
    // skips its reflexive listBoard reconnaissance turn — board-scope only),
    // then the user's typed message + the attachment-inventory line.
    expect(userMsg.content[0].type).toBe('text');
    expect(userMsg.content[0].text).toMatch(/^\[Board has /);   // preamble first
    expect(userMsg.content[0].text).toMatch(/what do you see\?/); // message present
    expect(userMsg.content[0].text).toMatch(/asset-mock-123/);
    expect(userMsg.content[1]).toEqual({
      type: 'image',
      dataUrl: 'data:image/png;base64,ABC',
      name: 'ref.png',
      mimeType: 'image/png',
    });
  });

  it('accepts attachments without a text message + auto-prefills cue', async () => {
    driverCalls.length = 0;
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        boardId: 'b1',
        attachments: [{ kind: 'image', dataUrl: 'data:image/png;base64,XYZ' }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    await res.body.getReader().read();
    await new Promise((r) => setTimeout(r, 30));

    const userMsg = driverCalls[0].messages[0];
    expect(userMsg.content[0].type).toBe('text');
    expect(userMsg.content[0].text).toMatch(/anexei/i);
    expect(userMsg.content[1].type).toBe('image');
  });

  it('persists a text-only placeholder when only attachments were sent (no dataUrl bloat)', async () => {
    const { appendMessage } = await import('../../../lib/chat-persistence.js');
    appendMessage.mockClear?.();
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        boardId: 'b1',
        attachments: [{ kind: 'image', dataUrl: 'data:image/png;base64,XYZ', name: 'cat.png' }],
      }),
    });
    const res = await POST(req);
    await res.body.getReader().read();
    await new Promise((r) => setTimeout(r, 30));

    const userPersistCall = appendMessage.mock.calls.find((c) => c[0]?.role === 'user');
    expect(userPersistCall).toBeTruthy();
    expect(userPersistCall[0].content).toMatch(/\[image attachment.*cat\.png/);
    // Critically: no base64 leaks into the persisted content
    expect(userPersistCall[0].content).not.toContain('XYZ');
  });

  it('400s when neither message nor attachments provided', async () => {
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
