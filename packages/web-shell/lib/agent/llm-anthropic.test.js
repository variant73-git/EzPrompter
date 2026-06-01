import { describe, it, expect, vi } from 'vitest';

const capturedStreamArgs = [];

vi.mock('@anthropic-ai/sdk', () => {
  class MockClient {
    constructor() {
      this.messages = {
        stream: vi.fn((args) => {
          capturedStreamArgs.push(args);
          return mockStream;
        }),
      };
    }
  }
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } };
      yield { type: 'content_block_stop', index: 0 };
      yield {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'queryNodes', input: {} },
      };
      yield { type: 'content_block_stop', index: 1 };
      yield { type: 'message_stop', usage: { input_tokens: 10, output_tokens: 5 } };
    },
    finalMessage: async () => ({
      content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 'toolu_1', name: 'queryNodes', input: {} },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'tool_use',
    }),
  };
  return { default: MockClient };
});

const { callAnthropic } = await import('./llm-anthropic.js');

describe('callAnthropic', () => {
  it('streams text deltas and emits tool_use events', async () => {
    const events = [];
    const final = await callAnthropic({
      model: 'claude-sonnet-4-6',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'queryNodes', description: 'd', input_schema: { type: 'object' } }],
      apiKey: 'fake',
      onEvent: (ev) => events.push(ev),
    });

    expect(events.some((e) => e.type === 'text_delta' && e.text === 'hi')).toBe(true);
    expect(events.some((e) => e.type === 'tool_use' && e.name === 'queryNodes' && e.id === 'toolu_1')).toBe(true);
    expect(final.stop_reason).toBe('tool_use');
    expect(final.usage.input_tokens).toBe(10);
  });

  it('translates {type:image, dataUrl} blocks into Anthropic image source shape', async () => {
    capturedStreamArgs.length = 0;
    await callAnthropic({
      model: 'claude-sonnet-4-6',
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            { type: 'image', dataUrl: 'data:image/png;base64,ABC' },
          ],
        },
      ],
      tools: [],
      apiKey: 'fake',
      onEvent: () => {},
    });
    expect(capturedStreamArgs.length).toBe(1);
    const sent = capturedStreamArgs[0].messages;
    const userBlocks = sent[0].content;
    expect(userBlocks[0]).toEqual({ type: 'text', text: 'describe' });
    expect(userBlocks[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'ABC' },
    });
  });
});
