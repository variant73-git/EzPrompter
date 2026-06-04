/**
 * Agent loop driver. Generic over LLM adapter (Claude only in Phase 1).
 *
 *   while not done:
 *     1. Call LLM with current message history + tool spec.
 *     2. Stream text deltas + tool_use events out via onEvent.
 *     3. If stop_reason='tool_use', execute each tool call (safe = run immediately,
 *        Phase 1 has no destructive yet), append tool results to history, loop.
 *     4. If stop_reason='end_turn', exit loop.
 *     5. Hard cap at maxIterations (default 10 for Phase 1).
 *
 * Phase 2 adds: pause for destructive tool confirmation, soft-pause, retry budget,
 * wall-clock timeout, tool error recovery.
 */
export async function runAgentLoop({
  llm,                       // LLM adapter fn ({model, system, messages, tools, apiKey, onEvent}) → Promise<final>
  registry,                  // Registry instance
  systemPrompt,              // string
  messages,                  // initial messages (just the user msg in fresh run)
  modelId,                   // 'claude-sonnet-4-6' etc — already aliased
  apiKey,
  ctx,                       // { boardId, userId, db, conversationModel, ... } passed to tool executors
  onEvent,                   // ({type, ...payload}) => void  (caller emits SSE)
  maxIterations = 10,
  toolAllowlist = null,
}) {
  const tools = registry.toAnthropicSpec(toolAllowlist);
  const history = [...messages];
  const totalUsage = { input_tokens: 0, output_tokens: 0 };
  let iterations = 0;

  while (true) {
    if (iterations >= maxIterations) {
      onEvent({ type: 'run_status', status: 'hard_limited' });
      return { stop_reason: 'hard_limited', iterations, usage: totalUsage };
    }
    iterations++;

    // Track tool_use events from this iteration so we can execute them after.
    const toolCalls = [];
    const finalMsg = await llm({
      model: modelId,
      system: systemPrompt,
      messages: history,
      tools,
      apiKey,
      onEvent: (ev) => {
        if (ev.type === 'tool_use') toolCalls.push(ev);
        if (ev.type === 'message_complete') {
          totalUsage.input_tokens += ev.usage?.input_tokens || 0;
          totalUsage.output_tokens += ev.usage?.output_tokens || 0;
        }
        onEvent(ev);
      },
    });

    // Push the assistant message into history (Anthropic format: content blocks).
    history.push({ role: 'assistant', content: finalMsg.content });

    if (finalMsg.stop_reason === 'end_turn' || finalMsg.stop_reason === 'stop_sequence') {
      onEvent({ type: 'run_status', status: 'completed' });
      return { stop_reason: 'end_turn', iterations, usage: totalUsage };
    }

    if (finalMsg.stop_reason !== 'tool_use') {
      onEvent({ type: 'run_status', status: 'failed', err: `unexpected stop_reason: ${finalMsg.stop_reason}` });
      return { stop_reason: 'failed', iterations, usage: totalUsage };
    }

    // Execute each tool_use the model emitted.
    const toolResultsForHistory = [];
    for (const call of toolCalls) {
      const tool = registry.get(call.name);
      if (!tool) {
        const err = { error: 'unknown_tool', message: `no tool named ${call.name}` };
        onEvent({ type: 'tool_status', id: call.id, status: 'error', error: err.message });
        toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(err), is_error: true });
        continue;
      }
      // Phase 1: classification is always 'safe' (other tools not yet registered).
      onEvent({ type: 'tool_status', id: call.id, status: 'running' });
      try {
        const result = await tool.execute(call.input, ctx);
        onEvent({ type: 'tool_status', id: call.id, status: 'done', result });
        toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(result) });
      } catch (e) {
        const errPayload = { error: 'execution_failed', message: String(e?.message || e) };
        onEvent({ type: 'tool_status', id: call.id, status: 'error', error: errPayload.message });
        toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(errPayload), is_error: true });
      }
    }

    // Append tool results as a 'user' role message (Anthropic convention).
    history.push({
      role: 'user',
      content: toolResultsForHistory.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.tool_use_id,
        content: r.content,
        ...(r.is_error ? { is_error: true } : {}),
      })),
    });

    // Loop continues with appended results.
  }
}
