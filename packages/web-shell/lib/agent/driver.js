/**
 * Agent loop driver. Generic over LLM adapter (Claude / OpenAI / Gemini wired in Phase 5a).
 *
 *   while not done:
 *     1. Call LLM with current message history + tool spec.
 *     2. Stream text deltas + tool_use events out via onEvent.
 *     3. If stop_reason='tool_use', execute each tool call:
 *        - safe → run immediately
 *        - destructive → emit needs_confirm, await user decision via runMap
 *        - needs_choice (Phase 3) → emit needs_choice, await with choice
 *     4. If stop_reason='end_turn', exit loop.
 *     5. Soft-pause when iterations ≥ softIterations (env-configurable, default 10).
 *     6. Hard-kill when iterations ≥ hardIterations (default 50).
 *     7. Per-tool retry budget — 3 failures of the same tool short-circuit the 4th call.
 *     8. Wall-clock timeout (5min default) wraps the loop in Promise.race.
 */
import {
  awaitConfirm, awaitChoice, awaitContinue,
  isCancelled,
} from './run-map.js';

const DEFAULT_CAPS = {
  softIterations: 10,
  hardIterations: 50,
  retryBudget: 3,
  wallTimeoutMs: 5 * 60 * 1000,
};

export async function runAgentLoop(opts) {
  const {
    llm, registry, systemPrompt, messages, modelId, apiKey, ctx, onEvent,
    toolAllowlist = null,
    tools: providedTools = null,
    runId = null,                 // null = Phase 1 callers without pause/resume support
    caps = DEFAULT_CAPS,
    // Legacy compat: Phase 1 callers pass maxIterations instead of caps.
    maxIterations = null,
  } = opts;

  // Merge legacy maxIterations into caps so Phase 1 tests keep passing.
  const effectiveCaps = maxIterations != null
    ? { ...DEFAULT_CAPS, ...caps, hardIterations: maxIterations }
    : { ...DEFAULT_CAPS, ...caps };

  const tools = providedTools || registry.toAnthropicSpec(toolAllowlist);
  const history = [...messages];
  const totalUsage = { input_tokens: 0, output_tokens: 0 };
  const toolCounts = {};        // toolName → invocation count
  const toolFailures = {};      // toolName → consecutive failures (resets on success)
  let iterations = 0;
  let lastSoftPauseAt = 0;      // last iteration count at which we paused

  // Wall-clock timer.
  let wallExpired = false;
  const wallTimer = setTimeout(() => { wallExpired = true; }, effectiveCaps.wallTimeoutMs);

  try {
    while (true) {
      if (runId && isCancelled(runId)) {
        onEvent({ type: 'run_status', status: 'cancelled' });
        return { stop_reason: 'cancelled', iterations, usage: totalUsage, toolCounts };
      }
      if (wallExpired) {
        onEvent({ type: 'run_status', status: 'failed', err: 'wall_timeout' });
        return { stop_reason: 'wall_timeout', iterations, usage: totalUsage, toolCounts };
      }
      if (iterations >= effectiveCaps.hardIterations) {
        onEvent({ type: 'run_status', status: 'hard_limited' });
        return { stop_reason: 'hard_limited', iterations, usage: totalUsage, toolCounts };
      }

      // Soft pause: pause every `softIterations` steps (10, 20, 30, …).
      if (runId && iterations > 0 && iterations - lastSoftPauseAt >= effectiveCaps.softIterations) {
        onEvent({
          type: 'needs_softlimit_continue',
          id: `soft-${iterations}`,
          iterationsSoFar: iterations,
          breakdown: { ...toolCounts },
        });
        const decision = await awaitContinue(runId);
        if (decision.action !== 'continue') {
          onEvent({ type: 'run_status', status: 'cancelled' });
          return { stop_reason: 'cancelled_softpause', iterations, usage: totalUsage, toolCounts };
        }
        lastSoftPauseAt = iterations;
      }
      iterations++;

      // ── LLM call ───────────────────────────────────────────────────────
      const toolCalls = [];
      const finalMsg = await llm({
        model: modelId, system: systemPrompt, messages: history, tools, apiKey,
        onEvent: (ev) => {
          if (ev.type === 'tool_use') toolCalls.push(ev);
          if (ev.type === 'message_complete') {
            totalUsage.input_tokens  += ev.usage?.input_tokens  || 0;
            totalUsage.output_tokens += ev.usage?.output_tokens || 0;
          }
          onEvent(ev);
        },
      });
      history.push({ role: 'assistant', content: finalMsg.content });

      if (finalMsg.stop_reason === 'end_turn' || finalMsg.stop_reason === 'stop_sequence') {
        onEvent({ type: 'run_status', status: 'completed' });
        return { stop_reason: 'end_turn', iterations, usage: totalUsage, toolCounts };
      }
      if (finalMsg.stop_reason !== 'tool_use') {
        onEvent({ type: 'run_status', status: 'failed', err: `unexpected stop_reason: ${finalMsg.stop_reason}` });
        return { stop_reason: 'failed', iterations, usage: totalUsage, toolCounts };
      }

      // ── Execute tool calls ────────────────────────────────────────────
      const toolResultsForHistory = [];
      for (const call of toolCalls) {
        const tool = registry.get(call.name);
        toolCounts[call.name] = (toolCounts[call.name] || 0) + 1;

        if (!tool) {
          const err = { error: 'unknown_tool', message: `no tool named ${call.name}` };
          onEvent({ type: 'tool_status', id: call.id, status: 'error', error: err.message });
          toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(err), is_error: true });
          continue;
        }

        // Retry budget check: short-circuit if this tool already failed `retryBudget` times.
        if ((toolFailures[call.name] || 0) >= effectiveCaps.retryBudget) {
          const err = { error: 'too_many_failures', message: `tool ${call.name} exceeded retry budget — too many failures in this run` };
          onEvent({ type: 'tool_status', id: call.id, status: 'error', error: err.message });
          toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(err), is_error: true });
          continue;
        }

        // ── Classification routing ──────────────────────────────────────
        let decision = null;
        if (tool.classification === 'destructive') {
          if (!runId) {
            // No runId means caller doesn't support pause (legacy Phase 1 path).
            // Treat as auto-confirm but log a warning so we notice in dev.
            console.warn(`[agent] destructive tool ${call.name} executed without runId — pause/resume unavailable`);
            decision = { action: 'confirm' };
          } else {
            onEvent({
              type: 'needs_confirm',
              id: call.id,
              name: call.name,
              args: call.input,
              summary: summarizeDestructiveCall(call.name, call.input),
            });
            decision = await awaitConfirm(runId, call.id);
          }
        } else if (tool.classification === 'needs_choice') {
          // Phase 3 wires this for real; Phase 2 still emits the event for the UI.
          if (!runId) {
            decision = { action: 'confirm', choice: null };
          } else {
            onEvent({
              type: 'needs_choice',
              id: call.id,
              name: call.name,
              args: call.input,
              summary: summarizeDestructiveCall(call.name, call.input),
              choices: tool.choices?.(call.input, ctx) || [],
            });
            decision = await awaitChoice(runId, call.id);
          }
        } else {
          decision = { action: 'confirm' };
        }

        if (decision.action === 'skip') {
          onEvent({ type: 'tool_status', id: call.id, status: 'skipped' });
          toolResultsForHistory.push({
            tool_use_id: call.id,
            content: JSON.stringify({ skipped: true, reason: 'user_skipped' }),
          });
          continue;
        }
        if (decision.action === 'cancelled') {
          // Surface to outer loop on next iter via isCancelled() check.
          onEvent({ type: 'tool_status', id: call.id, status: 'skipped' });
          toolResultsForHistory.push({
            tool_use_id: call.id,
            content: JSON.stringify({ skipped: true, reason: 'cancelled' }),
          });
          continue;
        }

        // ── Execute ─────────────────────────────────────────────────────
        onEvent({ type: 'tool_status', id: call.id, status: 'running' });
        try {
          const result = await tool.execute(call.input, { ...ctx, choice: decision.choice || null });
          if (result && result.error) {
            toolFailures[call.name] = (toolFailures[call.name] || 0) + 1;
            onEvent({ type: 'tool_status', id: call.id, status: 'error', error: result.message || result.error });
            toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(result), is_error: true });
          } else {
            toolFailures[call.name] = 0;
            onEvent({ type: 'tool_status', id: call.id, status: 'done', result });
            toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(result) });
          }
        } catch (e) {
          toolFailures[call.name] = (toolFailures[call.name] || 0) + 1;
          const errPayload = { error: 'execution_failed', message: String(e?.message || e) };
          onEvent({ type: 'tool_status', id: call.id, status: 'error', error: errPayload.message });
          toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(errPayload), is_error: true });
        }
      }

      history.push({
        role: 'user',
        content: toolResultsForHistory.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.tool_use_id,
          content: r.content,
          ...(r.is_error ? { is_error: true } : {}),
        })),
      });
    }
  } finally {
    clearTimeout(wallTimer);
  }
}

/** Short human-readable summary shown in confirm chips. Per-tool overrides preferred. */
function summarizeDestructiveCall(name, args) {
  switch (name) {
    case 'deleteNode': return `Delete node ${String(args?.id || '').slice(0, 8)}`;
    case 'runFlow':    return `Run flow on node ${String(args?.nodeId || '').slice(0, 8)}${args?.modelId ? ` with ${args.modelId}` : ''}`;
    case 'editSite':   return `Edit site ${String(args?.nodeId || '').slice(0, 8)} — "${(args?.instruction || '').slice(0, 60)}"`;
    case 'createImage': return `Generate image — "${(args?.prompt || '').slice(0, 60)}"`;
    default:           return `${name}(...)`;
  }
}
