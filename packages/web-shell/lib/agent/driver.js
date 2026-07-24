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
import { classifyProviderError, isFailoverEligible } from './provider-errors.js';

const DEFAULT_CAPS = {
  softIterations: 10,
  hardIterations: 50,
  retryBudget: 3,
  // Keep in sync with lib/agent/caps.js DEFAULTS.
  wallTimeoutMs: 10 * 60 * 1000,
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
    // Provider failover (optional). Each entry is a fully-formed alternate
    // provider { llm, modelId, apiKey, tools, label } tried IN ORDER when the
    // primary LLM call fails with a retriable error (rate limit / depleted
    // credits / outage / open circuit / hung stream). Empty = no failover
    // (every pre-failover caller keeps its exact behaviour).
    fallbacks = [],
    providerLabel = null,         // human label for the primary (for the failover event)
    // Product text emitted as the run error when the WHOLE provider chain is
    // exhausted by availability failures (balance/rate-limit/outage/timeout/
    // open circuit). Set by the route from the operation's failover policy —
    // fail-closed operations (clone, enterprise) surface a clear message
    // instead of a raw SDK error. null = raw error message (chat).
    unavailableMessage = null,
  } = opts;
  const primaryLabel = providerLabel || labelForModel(modelId);

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
  // Sticky per-run confirm decisions (2026-06-12). "Clean my board" fans
  // out into N deleteNode calls; asking N times reads as the same chip
  // reappearing after Confirm, and skipping one delete used to spawn yet
  // another chip for the next. The FIRST answer for a tool name now
  // applies to every later call of that tool in the same run.
  const confirmMemo = {};       // toolName → 'confirm' | 'skip'
  let iterations = 0;
  let lastSoftPauseAt = 0;      // last iteration count at which we paused
  // Sticky failover (2026-07-22): once a run falls over to a fallback
  // provider, the REST of the run starts each iteration there instead of
  // re-trying the primary — re-probing a dead provider added a failed call
  // + failover event to every single iteration. Deliberate tradeoff: a
  // primary that recovers mid-run is only used again on the NEXT run.
  let stickyAttemptIdx = 0;
  // Attempt epoch (adversarial-review find): the llm_timeout race ABANDONS
  // the promise but cannot kill the underlying stream (adapters take no
  // AbortSignal). A hung stream that wakes up minutes later would push
  // text_delta to the client (duplicated output), tool_use into the CURRENT
  // attempt's toolCalls, and usage into totalUsage. Every attempt captures
  // its epoch; events from a non-current epoch are dropped.
  let llmCallEpoch = 0;
  // The model that actually SERVED the run (updated on every successful
  // attempt) — the route persists this, not the promised primary, so the
  // durable record never claims Opus for a run GPT-5.5 carried.
  let usedModelIdFinal = modelId;
  let usedLabelFinal = primaryLabel;

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
        return { stop_reason: 'cancelled', iterations, usage: totalUsage, toolCounts, usedModelId: usedModelIdFinal, usedLabel: usedLabelFinal };
      }
      if (wallExpired) {
        onEvent({ type: 'run_status', status: 'failed', err: 'wall_timeout' });
        return { stop_reason: 'wall_timeout', iterations, usage: totalUsage, toolCounts, usedModelId: usedModelIdFinal, usedLabel: usedLabelFinal };
      }
      if (iterations >= effectiveCaps.hardIterations) {
        onEvent({ type: 'run_status', status: 'hard_limited' });
        return { stop_reason: 'hard_limited', iterations, usage: totalUsage, toolCounts, usedModelId: usedModelIdFinal, usedLabel: usedLabelFinal };
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
          return { stop_reason: 'cancelled_softpause', iterations, usage: totalUsage, toolCounts, usedModelId: usedModelIdFinal, usedLabel: usedLabelFinal };
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
      // Ordered attempt list: primary first, then any configured fallbacks.
      // Each attempt carries its OWN model, key, and tool spec — the spec
      // shape differs per provider, so failover can't just swap the adapter.
      const attempts = [
        { llm, modelId, apiKey, tools, label: primaryLabel },
        ...fallbacks,
      ];
      let toolCalls = [];
      const llmCallStartTs = Date.now();
      const LLM_HARD_TIMEOUT_MS = Math.min(effectiveCaps.wallTimeoutMs, 4 * 60 * 1000);
      let finalMsg = null;
      let usedModelId = modelId;
      let usedLabel = primaryLabel;

      for (let attemptIdx = stickyAttemptIdx; attemptIdx < attempts.length; attemptIdx++) {
        const attempt = attempts[attemptIdx];
        // Fresh per attempt — a failed attempt's partial tool_use events are
        // discarded so we don't execute tools the failed provider proposed.
        toolCalls = [];
        // Once THIS attempt has streamed anything user-visible (text deltas
        // or tool_call chips), failing over would replay the same content
        // from the next provider — duplicated output with no rollback
        // mechanism on the SSE side. Such a failure must fail the run.
        let emittedToClient = false;
        llmCallEpoch += 1;
        const myEpoch = llmCallEpoch;
        if (runId && ctx?.userId) {
          logAgentEvent({
            runId, userId: ctx.userId, type: 'llm_call',
            payload: { iter: iterations, model: attempt.modelId, provider: attempt.label, fallback: attemptIdx > 0 },
          });
        }
        const llmPromise = attempt.llm({
          model: attempt.modelId, system: systemPrompt, messages: history, tools: attempt.tools, apiKey: attempt.apiKey,
          // OpenAI uses this as a routing hint (same user → same cache replica);
          // other adapters ignore the extra field.
          userId: ctx?.userId || null,
          onEvent: (ev) => {
            // Stale attempt (timed out / failed while its stream stayed
            // alive): drop everything — no client text, no tool contamination,
            // no double-counted usage.
            if (myEpoch !== llmCallEpoch) return;
            if (ev.type === 'text_delta' || ev.type === 'tool_use') emittedToClient = true;
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
        try {
          finalMsg = await Promise.race([
            llmPromise,
            new Promise((_, reject) => setTimeout(
              () => reject(Object.assign(new Error(`llm call exceeded ${LLM_HARD_TIMEOUT_MS / 1000}s`), { code: 'llm_timeout' })),
              LLM_HARD_TIMEOUT_MS,
            )),
          ]);
          usedModelId = attempt.modelId;
          usedLabel = attempt.label;
          usedModelIdFinal = attempt.modelId;
          usedLabelFinal = attempt.label;
          // Sticky: later iterations start from the provider that worked.
          stickyAttemptIdx = attemptIdx;
          break; // success — leave the failover loop
        } catch (e) {
          // Invalidate this attempt's epoch FIRST — if its stream is still
          // alive (llm_timeout race), nothing more from it may leak out.
          llmCallEpoch += 1;
          const category = classifyProviderError(e);
          const retriable = isRetriableProviderError(e);
          const hasNext = attemptIdx < attempts.length - 1;
          const blockedByPartialOutput = retriable && hasNext && emittedToClient;
          if (runId && ctx?.userId) {
            logAgentEvent({
              runId, userId: ctx.userId, type: 'error',
              payload: {
                iter: iterations, where: 'llm_call', provider: attempt.label,
                message: String(e?.message || e), code: e?.code || null, status: e?.status ?? null,
                category, retriable, partialOutput: emittedToClient,
                willFailover: retriable && hasNext && !emittedToClient,
              },
              durationMs: Date.now() - llmCallStartTs,
            });
          }
          if (retriable && hasNext && !emittedToClient) {
            const next = attempts[attemptIdx + 1];
            // eslint-disable-next-line no-console
            console.warn(`[agent] provider failover ${attempt.label} → ${next.label} (iter ${iterations}): ${category} — ${e?.code || e?.status || e?.message}`);
            onEvent({
              type: 'provider_failover',
              from: attempt.label, to: next.label,
              reason: category,
              iter: iterations,
            });
            continue; // try the next provider, same iteration
          }
          // Failing the run. Pick the honest message for the channel:
          //  - mid-stream failure we REFUSED to fail over: say so;
          //  - availability failure with the chain exhausted on a fail-closed
          //    operation: the policy's product message;
          //  - anything else (invalid_request / auth / unknown): the raw
          //    error — it's a real bug signal, don't soften it.
          let errMsg = e?.message || 'llm_error';
          if (blockedByPartialOutput) {
            errMsg = `Provider ${attempt.label} failed mid-response (${category}). The run was stopped instead of switching providers to avoid duplicated output.`;
          } else if (retriable && unavailableMessage) {
            errMsg = unavailableMessage;
          } else if (category === 'auth') {
            // Auth errors can embed key fragments ("Incorrect API key
            // provided: sk-…"). The raw message is already in the audit log
            // above — the client gets a clean signal instead.
            errMsg = 'The AI provider rejected this server’s credentials. This is a configuration problem on our side — please try again later.';
          }
          onEvent({ type: 'run_status', status: 'failed', err: errMsg });
          return { stop_reason: 'failed', iterations, usage: totalUsage, toolCounts, usedModelId: usedModelIdFinal, usedLabel: usedLabelFinal };
        }
      }

      const llmDuration = Date.now() - llmCallStartTs;
      if (runId && ctx?.userId) {
        logAgentEvent({
          runId, userId: ctx.userId, type: 'llm_response',
          payload: {
            iter: iterations,
            provider: usedLabel,
            model: usedModelId,
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
        model: usedModelId,
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
        return { stop_reason: 'end_turn', iterations, usage: totalUsage, toolCounts, usedModelId: usedModelIdFinal, usedLabel: usedLabelFinal };
      }
      if (finalMsg.stop_reason !== 'tool_use') {
        onEvent({ type: 'run_status', status: 'failed', err: `unexpected stop_reason: ${finalMsg.stop_reason}` });
        return { stop_reason: 'failed', iterations, usage: totalUsage, toolCounts, usedModelId: usedModelIdFinal, usedLabel: usedLabelFinal };
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
          } else if (confirmMemo[call.name]) {
            // User already answered for this tool in this run — reuse the
            // decision silently instead of re-raising the chip. No status
            // emit here: the skip/execute branches below emit their own.
            decision = { action: confirmMemo[call.name] };
          } else {
            // Per-tool summarize(args, ctx) can resolve a friendly message
            // (e.g. the node's name from the DB); fall back to the static
            // summary otherwise.
            let confirmSummary;
            try {
              confirmSummary = (await tool.summarize?.(call.input, ctx)) || summarizeDestructiveCall(call.name, call.input);
            } catch {
              confirmSummary = summarizeDestructiveCall(call.name, call.input);
            }
            onEvent({
              type: 'needs_confirm',
              id: call.id,
              name: call.name,
              args: call.input,
              summary: confirmSummary,
            });
            decision = await awaitConfirm(runId, call.id);
            if (decision.action === 'confirm' || decision.action === 'skip') {
              confirmMemo[call.name] = decision.action;
            }
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
          // freeze the whole run. Long-running tools (captureUrl's
          // reconstruct path takes 2-3min) override via `tool.timeoutMs`.
          const TOOL_TIMEOUT_MS = tool.timeoutMs || 3 * 60 * 1000;
          // Let tools emit arbitrary SSE events mid-execution. Used by
          // createImage to push a graph_mutated event the moment the
          // placeholder node + edges are INSERTed — the user sees the
          // workflow skeleton BEFORE the long image-gen call returns.
          const emit = (eventName, payload) => {
            onEvent({ type: 'custom_emit', name: eventName, payload });
          };
          const result = await Promise.race([
            // runId scopes derived idempotency keys (money-safety) so a paid tool
            // re-called after a false timeout dedups instead of double-charging.
            tool.execute(call.input, { ...ctx, runId, choice: decision.choice ?? null, emit }),
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

/** Map an SDK model string to its provider label (for failover telemetry). */
function labelForModel(modelId) {
  const m = String(modelId || '');
  if (/^(claude|opus|sonnet|haiku)/i.test(m)) return 'anthropic';
  if (/^(gpt|openai|o[1-9])/i.test(m)) return 'openai';
  if (/^gemini/i.test(m)) return 'gemini';
  return 'llm';
}

/**
 * Should this LLM error trigger failover to the next provider?
 * Delegates to the shared taxonomy (lib/agent/provider-errors.js):
 * YES for availability failures another provider might survive —
 * provider_balance (depleted credits: Anthropic's 400, OpenAI's
 * insufficient_quota 429, Gemini's prepayment message), rate_limit, outage
 * (5xx / network), timeout (hung stream), and a genuinely open circuit.
 * NO for invalid_request / auth — failover to a different provider wouldn't
 * fix a malformed request, and masking an auth misconfig would hide a real
 * bug — and for anything unclassifiable.
 */
function isRetriableProviderError(e) {
  if (!e) return false;
  return isFailoverEligible(classifyProviderError(e));
}

/** Human-readable summary shown in confirm chips. Per-tool overrides preferred.
 *  Node ids are abbreviated (they're opaque UUIDs), but user-authored text
 *  (prompt/instruction) is NEVER truncated — the chip wraps instead. */
function summarizeDestructiveCall(name, args) {
  switch (name) {
    case 'deleteNode': return `Delete node ${String(args?.id || '').slice(0, 8)}`;
    case 'runFlow':    return `Run flow on node ${String(args?.nodeId || '').slice(0, 8)}${args?.modelId ? ` with ${args.modelId}` : ''}`;
    case 'editSite':   return `Edit site ${String(args?.nodeId || '').slice(0, 8)} — "${args?.instruction || ''}"`;
    case 'createImage': return `Generate image — "${args?.prompt || ''}"`;
    default:           return `${name}(...)`;
  }
}
