import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop } from './driver.js';
import { Registry } from './registry.js';
import {
  registerRun, resolveContinue, resolveConfirm, _resetForTests,
} from './run-map.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

const reg = new Registry();
reg.register({
  name: 'noop',
  description: 'no-op',
  classification: 'safe',
  inputSchema: { type: 'object' },
  async execute() { return { ok: true }; },
});

function buildRegistry(toolDefs) {
  const r = new Registry();
  for (const def of toolDefs) r.register(def);
  return r;
}

function buildLLM(scenarios) {
  // Each call to the LLM dequeues one scenario from the list.
  // Scenario shape: { events: [...], finalContent: [...], stop_reason }
  const queue = [...scenarios];
  return vi.fn(async ({ onEvent }) => {
    const s = queue.shift();
    if (!s) throw new Error('llm called more times than scenarios');
    for (const ev of s.events || []) onEvent(ev);
    return { content: s.finalContent || [], stop_reason: s.stop_reason, usage: { input_tokens: 1, output_tokens: 1 } };
  });
}

// ── Phase 1 tests (preserved) ─────────────────────────────────────────────────

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

// ── Phase 2 tests ─────────────────────────────────────────────────────────────

describe('runAgentLoop — caps', () => {
  it('hard-limits when iterations exceed hardIterations cap', async () => {
    const r = buildRegistry([{
      name: 'noop', classification: 'safe',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true }),
    }]);
    const llm = buildLLM([
      { events: [{ type: 'tool_use', id: 't1', name: 'noop', input: {} }],
        finalContent: [{ type: 'tool_use', id: 't1', name: 'noop', input: {} }],
        stop_reason: 'tool_use' },
      { events: [{ type: 'tool_use', id: 't2', name: 'noop', input: {} }],
        finalContent: [{ type: 'tool_use', id: 't2', name: 'noop', input: {} }],
        stop_reason: 'tool_use' },
      { events: [{ type: 'tool_use', id: 't3', name: 'noop', input: {} }],
        finalContent: [{ type: 'tool_use', id: 't3', name: 'noop', input: {} }],
        stop_reason: 'tool_use' },
    ]);
    const events = [];
    await runAgentLoop({
      llm, registry: r, systemPrompt: 's', messages: [{ role: 'user', content: 'go' }],
      modelId: 'm', apiKey: 'k', ctx: {},
      onEvent: (ev) => events.push(ev),
      caps: { softIterations: 99, hardIterations: 2, retryBudget: 3, wallTimeoutMs: 60000 },
    });
    const status = events.find((e) => e.type === 'run_status');
    expect(status.status).toBe('hard_limited');
  });
});

describe('runAgentLoop — soft pause', () => {
  it('emits needs_softlimit_continue and waits for resolveContinue', async () => {
    _resetForTests();
    registerRun('run-soft');
    const r = buildRegistry([{
      name: 'noop', classification: 'safe',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true }),
    }]);
    const llm = buildLLM([
      { events: [{ type: 'tool_use', id: 't1', name: 'noop', input: {} }],
        finalContent: [{ type: 'tool_use', id: 't1', name: 'noop', input: {} }],
        stop_reason: 'tool_use' },
      { events: [{ type: 'tool_use', id: 't2', name: 'noop', input: {} }],
        finalContent: [{ type: 'tool_use', id: 't2', name: 'noop', input: {} }],
        stop_reason: 'tool_use' },
      { events: [], finalContent: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
    ]);
    const events = [];
    const loopP = runAgentLoop({
      llm, registry: r, systemPrompt: 's', messages: [{ role: 'user', content: 'go' }],
      modelId: 'm', apiKey: 'k', ctx: {}, runId: 'run-soft',
      onEvent: (ev) => events.push(ev),
      caps: { softIterations: 2, hardIterations: 99, retryBudget: 3, wallTimeoutMs: 60000 },
    });
    // Wait one microtask cycle for the loop to emit the soft-pause event.
    await new Promise((r) => setTimeout(r, 10));
    expect(events.some((e) => e.type === 'needs_softlimit_continue')).toBe(true);
    resolveContinue('run-soft', { action: 'continue' });
    const result = await loopP;
    expect(result.stop_reason).toBe('end_turn');
  });
});

describe('runAgentLoop — destructive confirm', () => {
  it('emits needs_confirm and awaits user decision', async () => {
    _resetForTests();
    registerRun('run-conf');
    const r = buildRegistry([{
      name: 'zap', classification: 'destructive',
      inputSchema: { type: 'object' },
      execute: async (args) => ({ ok: true, args }),
    }]);
    const llm = buildLLM([
      { events: [{ type: 'tool_use', id: 'tc-1', name: 'zap', input: { x: 1 } }],
        finalContent: [{ type: 'tool_use', id: 'tc-1', name: 'zap', input: { x: 1 } }],
        stop_reason: 'tool_use' },
      { events: [], finalContent: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
    ]);
    const events = [];
    const loopP = runAgentLoop({
      llm, registry: r, systemPrompt: 's', messages: [{ role: 'user', content: 'go' }],
      modelId: 'm', apiKey: 'k', ctx: {}, runId: 'run-conf',
      onEvent: (ev) => events.push(ev),
      caps: { softIterations: 99, hardIterations: 99, retryBudget: 3, wallTimeoutMs: 60000 },
    });
    await new Promise((r) => setTimeout(r, 10));
    const confirmEv = events.find((e) => e.type === 'needs_confirm');
    expect(confirmEv).toBeTruthy();
    expect(confirmEv.name).toBe('zap');
    resolveConfirm('run-conf', 'tc-1', { action: 'confirm' });
    await loopP;
    expect(events.some((e) => e.type === 'tool_status' && e.status === 'done')).toBe(true);
  });

  it('skips destructive tool when user clicks Skip', async () => {
    _resetForTests();
    registerRun('run-skip');
    const r = buildRegistry([{
      name: 'zap', classification: 'destructive',
      inputSchema: { type: 'object' },
      execute: async () => { throw new Error('should not be called'); },
    }]);
    const llm = buildLLM([
      { events: [{ type: 'tool_use', id: 'tc-1', name: 'zap', input: {} }],
        finalContent: [{ type: 'tool_use', id: 'tc-1', name: 'zap', input: {} }],
        stop_reason: 'tool_use' },
      { events: [], finalContent: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' },
    ]);
    const events = [];
    const loopP = runAgentLoop({
      llm, registry: r, systemPrompt: 's', messages: [{ role: 'user', content: 'go' }],
      modelId: 'm', apiKey: 'k', ctx: {}, runId: 'run-skip',
      onEvent: (ev) => events.push(ev),
      caps: { softIterations: 99, hardIterations: 99, retryBudget: 3, wallTimeoutMs: 60000 },
    });
    await new Promise((r) => setTimeout(r, 10));
    resolveConfirm('run-skip', 'tc-1', { action: 'skip' });
    await loopP;
    expect(events.some((e) => e.type === 'tool_status' && e.status === 'skipped')).toBe(true);
  });
});

describe('runAgentLoop — retry budget', () => {
  it('short-circuits 4th call with too_many_failures after 3 errors', async () => {
    _resetForTests();
    const r = buildRegistry([{
      name: 'flaky', classification: 'safe',
      inputSchema: { type: 'object' },
      execute: async () => ({ error: 'execution_failed', message: 'boom' }),
    }]);
    const llm = buildLLM([
      ...Array.from({ length: 4 }).map((_, i) => ({
        events: [{ type: 'tool_use', id: `tc-${i}`, name: 'flaky', input: {} }],
        finalContent: [{ type: 'tool_use', id: `tc-${i}`, name: 'flaky', input: {} }],
        stop_reason: 'tool_use',
      })),
      { events: [], finalContent: [{ type: 'text', text: 'give up' }], stop_reason: 'end_turn' },
    ]);
    const events = [];
    await runAgentLoop({
      llm, registry: r, systemPrompt: 's', messages: [{ role: 'user', content: 'go' }],
      modelId: 'm', apiKey: 'k', ctx: {},
      onEvent: (ev) => events.push(ev),
      caps: { softIterations: 99, hardIterations: 99, retryBudget: 3, wallTimeoutMs: 60000 },
    });
    const errors = events.filter((e) => e.type === 'tool_status' && e.status === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors[3].error).toMatch(/too many failures/i);
  });
});
