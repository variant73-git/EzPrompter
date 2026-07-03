// lib/agent/llm-usage.test.js — agent adapters record into billing context (Task 12)
import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } };
      yield { type: 'content_block_stop', index: 0 };
    },
    finalMessage: async () => ({
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 1500, output_tokens: 250, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
      stop_reason: 'end_turn',
    }),
  };
  return {
    default: class {
      constructor() {
        this.messages = { stream: () => mockStream };
      }
    },
  };
});

const { callAnthropic } = await import('./llm-anthropic.js');
const { runMeteredOperation } = await import('../billing/context.js');

const noDb = { holdCredits: vi.fn(), refundHold: vi.fn() };

describe('agent adapter metering', () => {
  it('callAnthropic records usage into the ambient billing context', async () => {
    const settle = vi.fn(async () => ({ balanceAfter: 0 }));
    await runMeteredOperation({ sql: () => Promise.resolve([]), userId: 'u1', op: 'chat' }, async () => {
      await callAnthropic({
        model: 'claude-sonnet-4-6', system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [], apiKey: 'k', onEvent: () => {},
      });
    }, { ...noDb, settleOperation: settle });
    const events = settle.mock.calls[0][0].events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4-6', tokensIn: 1500, tokensOut: 250, cachedIn: 100 });
  });
});
