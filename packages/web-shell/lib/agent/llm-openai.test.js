import { describe, it, expect, vi } from 'vitest';

// Shared capture across tests so we can assert the messages OpenAI received.
const capturedCreateArgs = [];

vi.mock('openai', () => {
  function makeStream() {
    return {
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
  }
  class MockClient {
    constructor() {
      this.chat = {
        completions: {
          create: vi.fn(async (args) => {
            capturedCreateArgs.push(args);
            return makeStream();
          }),
        },
      };
    }
  }
  return { default: MockClient };
});

const { callOpenAI } = await import('./llm-openai.js');

describe('callOpenAI', () => {
  it('streams text deltas, accumulates tool_calls, emits message_complete with usage', async () => {
    capturedCreateArgs.length = 0;
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

  it('translates multimodal user content into OpenAI content array with image_url parts', async () => {
    capturedCreateArgs.length = 0;
    await callOpenAI({
      model: 'gpt-5.5',
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is in this?' },
            { type: 'image', dataUrl: 'data:image/png;base64,ABC' },
          ],
        },
      ],
      tools: [],
      apiKey: 'fake',
      onEvent: () => {},
    });
    expect(capturedCreateArgs.length).toBe(1);
    const sent = capturedCreateArgs[0].messages;
    const userMsg = sent.find((m) => m.role === 'user');
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content[0]).toEqual({ type: 'text', text: 'what is in this?' });
    expect(userMsg.content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } });
  });
});
