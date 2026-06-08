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
import { logAgentEvent } from '../agent-events.js';
import { startAgentTrace, logGeneration, logToolSpan, endAgentTrace } from './trace.js';

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
  // cached_input_tokens is a SUBSET of input_tokens (already counted there);
  // cost.js subtracts it from the fresh-rate calculation and re-applies the
  // discounted cache-read rate. cache_write_tokens is Anthropic-only and
  // bills at +25% of fresh input.
  const totalUsage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_write_tokens: 0 };
  const toolCounts = {};        // toolName → invocation count
  const toolFailures = {};      // toolName → consecutive failures (resets on success)
  let iterations = 0;
  let lastSoftPauseAt = 0;      // last iteration count at which we paused

  // Wall-clock timer.
  let wallExpired = false;
  const wallTimer = setTimeout(() => { wallExpired = true; }, effectiveCaps.wallTimeoutMs);

  // "Announce-and-stop" safety net counter. Gemini in particular loves to
  // narrate intent ("Agora vou aplicar o estilo…") and then end_turn
  // without calling the next tool. When we detect that pattern, inject a
  // synthetic user nudge and loop again. Hard-capped so we don't fight an
  // adversarial model forever.
  let forcedContinues = 0;
  const MAX_FORCED_CONTINUES = 2;
  const INTENT_RX = /\b(vou|vamos)\s+(criar|gerar|aplicar|fazer|trazer|transferir|montar|conectar|construir|preparar|adicionar)\b|\bagora\s+(vou|vamos)\b|\bem\s+seguida\b|\b(now|next)\s+(i('|')?ll|i\s+will|i'?m\s+going\s+to)\b|\blet\s+me\s+(create|generate|apply|do|make|build)\b/i;
  // Track the most recent non-empty assistant text emitted ANYWHERE in
  // this run. Intent like "Agora vou gerar a imagem" is usually emitted
  // in the same iter as the previous tool_use (so stop_reason='tool_use'
  // there). When the LATER iter ends with 'end_turn' and an empty text,
  // we still want to catch the unfulfilled promise from an earlier iter.
  let lastNonEmptyAssistantText = '';

  // Open a Langfuse trace for the whole run. Returns null when not
  // configured — every other trace call below null-checks the handle.
  const trace = startAgentTrace({
    runId,
    userId: ctx?.userId,
    model: modelId,
    sessionId: ctx?.threadId,
    threadId: ctx?.threadId,
    input: messages.slice(-1)?.[0]?.content,
  });

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
      // Audit: open a new iteration. Lets us reconstruct timeline + measure
      // per-iter latency from the event stream alone.
      if (runId && ctx?.userId) {
        logAgentEvent({ runId, userId: ctx.userId, type: 'iter_start', payload: { iter: iterations } });
      }
      const iterStartTs = Date.now();

      // ── LLM call ───────────────────────────────────────────────────────
      // Race the LLM call against the same wall-clock deadline so a slow
      // adapter / hung provider stream cannot stall the entire run beyond
      // the configured wall_timeout. The original `wallExpired` flag only
      // helps BETWEEN iterations; without this race a 25-minute Anthropic
      // / Gemini stream gets to run to completion before we notice.
      const toolCalls = [];
      if (runId && ctx?.userId) {
        logAgentEvent({ runId, userId: ctx.userId, type: 'llm_call', payload: { iter: iterations, model: modelId } });
      }
      const llmCallStartTs = Date.now();
      const llmPromise = llm({
        model: modelId, system: systemPrompt, messages: history, tools, apiKey,
        // OpenAI uses this as a routing hint (same user → same cache replica);
        // other adapters ignore the extra field.
        userId: ctx?.userId || null,
        onEvent: (ev) => {
          if (ev.type === 'tool_use') toolCalls.push(ev);
          if (ev.type === 'message_complete') {
            totalUsage.input_tokens         += ev.usage?.input_tokens         || 0;
            totalUsage.output_tokens        += ev.usage?.output_tokens        || 0;
            totalUsage.cached_input_tokens  += ev.usage?.cached_input_tokens  || 0;
            totalUsage.cache_write_tokens   += ev.usage?.cache_write_tokens   || 0;
          }
          onEvent(ev);
        },
      });
      const LLM_HARD_TIMEOUT_MS = Math.min(effectiveCaps.wallTimeoutMs, 4 * 60 * 1000);
      let finalMsg;
      try {
        finalMsg = await Promise.race([
          llmPromise,
          new Promise((_, reject) => setTimeout(
            () => reject(new Error(`llm call exceeded ${LLM_HARD_TIMEOUT_MS / 1000}s`)),
            LLM_HARD_TIMEOUT_MS,
          )),
        ]);
      } catch (e) {
        if (runId && ctx?.userId) {
          logAgentEvent({
            runId, userId: ctx.userId, type: 'error',
            payload: { iter: iterations, where: 'llm_call', message: String(e?.message || e), code: e?.code || null },
            durationMs: Date.now() - llmCallStartTs,
          });
        }
        onEvent({ type: 'run_status', status: 'failed', err: e?.message || 'llm_timeout' });
        return { stop_reason: 'failed', iterations, usage: totalUsage, toolCounts };
      }
      const llmDuration = Date.now() - llmCallStartTs;
      if (runId && ctx?.userId) {
        logAgentEvent({
          runId, userId: ctx.userId, type: 'llm_response',
          payload: {
            iter: iterations,
            stop_reason: finalMsg.stop_reason,
            tool_calls_pending: toolCalls.length,
            usage_input: finalMsg.usage?.input_tokens || 0,
            usage_output: finalMsg.usage?.output_tokens || 0,
          },
          durationMs: llmDuration,
        });
      }
      logGeneration(trace, {
        name: `llm.iter-${iterations}`,
        model: modelId,
        input: history,
        output: finalMsg.content,
        usage: finalMsg.usage,
        durationMs: llmDuration,
      });
      history.push({ role: 'assistant', content: finalMsg.content });

      // After the agent has seen the user's multimodal attachment in iter 1,
      // replace the image block with a slim text placeholder so subsequent
      // iterations don't re-send the full base64 payload (which trivially
      // pushes a Gemini call past the 1M-token cap when combined with tool
      // outputs). The model already has the asset id via the hint text and
      // can use baseImageAssetId to operate on it through tools.
      if (iterations === 1) {
        for (let i = 0; i < history.length; i++) {
          const m = history[i];
          if (m.role !== 'user' || !Array.isArray(m.content)) continue;
          let touched = false;
          const nextContent = [];
          for (const block of m.content) {
            if (block && block.type === 'image') {
              touched = true;
              nextContent.push({
                type: 'text',
                text: `[image attachment from the user — already shown to you in this conversation; refer to the assetIds in the user's text to operate on it via tools]`,
              });
            } else {
              nextContent.push(block);
            }
          }
          if (touched) history[i] = { ...m, content: nextContent };
        }
      }

      // Track the latest assistant text BEFORE the end_turn branch — the
      // announce-and-stop pattern often hides in the same iter as the
      // last tool_use, so by the time we hit end_turn the current iter's
      // content is empty.
      const thisIterText = (finalMsg.content || [])
        .filter((b) => b?.type === 'text')
        .map((b) => b.text || '')
        .join(' ');
      if (thisIterText.trim()) lastNonEmptyAssistantText = thisIterText;

      if (finalMsg.stop_reason === 'end_turn' || finalMsg.stop_reason === 'stop_sequence') {
        // Announce-and-stop guard: a cheap model occasionally says
        // "vou fazer X" and then ends the turn without calling X. When
        // that pattern shows up, force one more iteration with a neutral
        // nudge so the user isn't stranded. Capped at MAX_FORCED_CONTINUES.
        // The "ingestedButDidntGenerate" heuristic that used to live here
        // was removed — it assumed every addAssetFromUrl was meant to be
        // followed by a createImage, which over-prescribed the agent's
        // intent (e.g. user just wants to save a reference image, no edit).
        const lastText = lastNonEmptyAssistantText || thisIterText;
        const announcedIntent = INTENT_RX.test(lastText);
        if (announcedIntent && forcedContinues < MAX_FORCED_CONTINUES) {
          forcedContinues++;
          // Visible in dev-server stdout so we can verify the safety net
          // actually fires when the agent stops after announcing intent.
          // eslint-disable-next-line no-console
          console.log(`[agent] safety-net fired (#${forcedContinues}, announced intent) — last text: ${lastText.slice(0, 120)}`);
          history.push({
            role: 'user',
            content: 'Continue. Você anunciou um próximo passo mas terminou o turno sem chamá-lo. Se ainda pretende executá-lo, chame a ferramenta agora; se não, conclua com uma frase curta dizendo o que ficou pendente.',
          });
          continue;
        }
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
        if (runId && ctx?.userId) {
          logAgentEvent({
            runId, userId: ctx.userId, type: 'tool_call',
            payload: { iter: iterations, tool: call.name, args: call.input, callId: call.id },
          });
        }
        const toolStartTs = Date.now();
        try {
          // Per-tool hard timeout. The wall_timeout cap only fires between
          // iterations; if a single tool hangs (e.g. an upstream API stuck
          // in retry-loop), the loop never gets to check it. Race the tool
          // promise against a 3-minute reject so a single bad call can't
          // freeze the whole run.
          const TOOL_TIMEOUT_MS = 3 * 60 * 1000;
          // Let tools emit arbitrary SSE events mid-execution. Used by
          // createImage to push a graph_mutated event the moment the
          // placeholder node + edges are INSERTed — the user sees the
          // workflow skeleton BEFORE the long image-gen call returns.
          const emit = (eventName, payload) => {
            onEvent({ type: 'custom_emit', name: eventName, payload });
          };
          const result = await Promise.race([
            tool.execute(call.input, { ...ctx, choice: decision.choice ?? null, emit }),
            new Promise((_, reject) => setTimeout(
              () => reject(new Error(`tool ${call.name} exceeded ${TOOL_TIMEOUT_MS / 1000}s — likely a stuck upstream call`)),
              TOOL_TIMEOUT_MS,
            )),
          ]);
          const toolDuration = Date.now() - toolStartTs;
          if (result && result.error) {
            toolFailures[call.name] = (toolFailures[call.name] || 0) + 1;
            onEvent({ type: 'tool_status', id: call.id, status: 'error', error: result.message || result.error });
            toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(slimForHistory(result)), is_error: true });
            if (runId && ctx?.userId) {
              logAgentEvent({
                runId, userId: ctx.userId, type: 'tool_error',
                payload: { tool: call.name, callId: call.id, error: result.message || result.error },
                durationMs: toolDuration,
              });
            }
            logToolSpan(trace, { name: call.name, input: call.input, output: result, durationMs: toolDuration, error: result.message || result.error });
          } else {
            toolFailures[call.name] = 0;
            onEvent({ type: 'tool_status', id: call.id, status: 'done', result });
            toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(slimForHistory(result)) });
            if (runId && ctx?.userId) {
              logAgentEvent({
                runId, userId: ctx.userId, type: 'tool_result',
                payload: { tool: call.name, callId: call.id, result: slimForHistory(result) },
                durationMs: toolDuration,
              });
            }
            logToolSpan(trace, { name: call.name, input: call.input, output: slimForHistory(result), durationMs: toolDuration });
          }
        } catch (e) {
          const toolDuration = Date.now() - toolStartTs;
          toolFailures[call.name] = (toolFailures[call.name] || 0) + 1;
          const errPayload = { error: 'execution_failed', message: String(e?.message || e) };
          onEvent({ type: 'tool_status', id: call.id, status: 'error', error: errPayload.message });
          toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(errPayload), is_error: true });
          if (runId && ctx?.userId) {
            logAgentEvent({
              runId, userId: ctx.userId, type: 'tool_error',
              payload: { tool: call.name, callId: call.id, error: errPayload.message, threw: true },
              durationMs: toolDuration,
            });
          }
          logToolSpan(trace, { name: call.name, input: call.input, output: errPayload, durationMs: toolDuration, error: errPayload.message });
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
    // Close the Langfuse trace with whatever final state we have. The
    // SDK batches and flushes async; we don't await here — the route's
    // finally block calls flushLangfuse() before the response ends.
    endAgentTrace(trace, {
      output: lastNonEmptyAssistantText,
      status: 'completed',
      iterations,
    });
  }
}

// Strip huge fields from a tool result before it goes into the LLM history.
// The full result still streams to the UI via tool_status; only the agent's
// view gets trimmed. Without this, createImage's `dataUrl` (often >700KB of
// base64) lands as text in the next iteration's prompt and pushes the call
// past the model's context window (Gemini 1M hard cap was hit on the very
// first style-transfer attempt). Replace large strings with a short
// placeholder so the agent still knows the field existed.
const LARGE_STRING_THRESHOLD = 4000; // chars
const NOISY_FIELD_RX = /^(dataUrl|base64|html|raw|content)$/i;
function slimForHistory(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > LARGE_STRING_THRESHOLD
      ? `[omitted ${value.length} chars — too large for LLM history]`
      : value;
  }
  if (Array.isArray(value)) return value.map(slimForHistory);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && (NOISY_FIELD_RX.test(k) || v.length > LARGE_STRING_THRESHOLD)) {
        out[k] = `[omitted ${v.length} chars]`;
      } else {
        out[k] = slimForHistory(v);
      }
    }
    return out;
  }
  return value;
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
