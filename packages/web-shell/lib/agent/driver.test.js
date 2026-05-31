import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop } from './driver.js';
import { Registry } from './registry.js';

const reg = new Registry();
reg.register({
  name: 'noop',
  description: 'no-op',
  classification: 'safe',
  inputSchema: { type: 'object' },
  async execute() { return { ok: true }; },
});

describe('runAgentLoop', () => {
  it('completes in one iteration when LLM returns no tool calls', async () => {
    const events = [];
    const llm = vi.fn(async ({ onEvent }) => {
      onEvent({ type: 'text_delta', text: 'done' });
      onEvent({ type: 'message_complete', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
      return { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
    });

    const result = await runAgentLoop({
      llm,
      registry: reg,
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      modelId: 'claude-sonnet-4-6',
      apiKey: 'fake',
      ctx: {},
      onEvent: (e) => events.push(e),
      maxIterations: 10,
    });

    expect(result.iterations).toBe(1);
    expect(result.stop_reason).toBe('end_turn');
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);
  });

  it('iterates when LLM returns tool calls, executes them, and resends to LLM', async () => {
    let call = 0;
    const llm = vi.fn(async ({ onEvent }) => {
      call++;
      if (call === 1) {
        onEvent({ type: 'tool_use', id: 'tc1', name: 'noop', input: {} });
        onEvent({ type: 'message_complete', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } });
        return { content: [{ type: 'tool_use', id: 'tc1', name: 'noop', input: {} }], stop_reason: 'tool_use' };
      }
      onEvent({ type: 'message_complete', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
      return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' };
    });

    const events = [];
    const result = await runAgentLoop({
      llm, registry: reg, systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'do it' }],
      modelId: 'claude-sonnet-4-6', apiKey: 'fake',
      ctx: {}, onEvent: (e) => events.push(e), maxIterations: 10,
    });

    expect(result.iterations).toBe(2);
    expect(events.some((e) => e.type === 'tool_status' && e.status === 'done')).toBe(true);
  });

  it('stops at maxIterations (hard kill)', async () => {
    const llm = vi.fn(async ({ onEvent }) => {
      onEvent({ type: 'tool_use', id: `tc-${Math.random()}`, name: 'noop', input: {} });
      onEvent({ type: 'message_complete', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } });
      return { content: [{ type: 'tool_use', id: 'x', name: 'noop', input: {} }], stop_reason: 'tool_use' };
    });
    const result = await runAgentLoop({
      llm, registry: reg, systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'loop' }],
      modelId: 'claude-sonnet-4-6', apiKey: 'fake',
      ctx: {}, onEvent: () => {}, maxIterations: 3,
    });
    expect(result.stop_reason).toBe('hard_limited');
    expect(result.iterations).toBe(3);
  });
});
