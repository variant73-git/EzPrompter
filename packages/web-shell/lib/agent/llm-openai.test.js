import { describe, it, expect, vi } from 'vitest';

vi.mock('openai', () => {
  class MockClient {
    constructor() {
      this.chat = { completions: { create: vi.fn(async () => mockStream) } };
    }
  }
  // Mock stream emits text deltas + tool_call deltas, then a finish chunk.
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: 'hi' }, finish_reason: null }] };
      yield {
        choices: [{
          delta: {
            tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'queryNodes', arguments: '{}' } }],
          },
          finish_reason: null,
        }],
      };
      yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    },
  };
  return { default: MockClient };
});

const { callOpenAI } = await import('./llm-openai.js');

describe('callOpenAI', () => {
  it('streams text deltas, accumulates tool_calls, emits message_complete with usage', async () => {
    const events = [];
    const final = await callOpenAI({
      model: 'gpt-5.5',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'queryNodes', description: 'd', parameters: { type: 'object' } } }],
      apiKey: 'fake',
      onEvent: (ev) => events.push(ev),
    });

    expect(events.some((e) => e.type === 'text_delta' && e.text === 'hi')).toBe(true);
    expect(events.some((e) => e.type === 'tool_use' && e.name === 'queryNodes' && e.id === 'call_1')).toBe(true);
    expect(final.stop_reason).toBe('tool_use');
    expect(final.usage.input_tokens).toBe(10);
    expect(final.usage.output_tokens).toBe(5);
  });
});
