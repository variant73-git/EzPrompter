/**
 * OpenAI adapter — streams chat.completions.create() with tool calling and
 * normalizes to the agent-driver event shape:
 *   { type: 'text_delta', text }
 *   { type: 'tool_use', id, name, input }
 *   { type: 'message_complete', stop_reason, usage }
 *
 * Mirrors lib/agent/llm-anthropic.js conventions.
 *
 * OpenAI specifics:
 * - tool_calls arrive as deltas across multiple chunks. Each delta carries
 *   {index, [id], [function.{name, arguments}]}. arguments is a partial JSON
 *   STRING that we concatenate per index. At finish_reason='tool_calls' we
 *   parse the full string and emit one tool_use event per call.
 * - usage is on the FINAL chunk (with `stream_options:{include_usage:true}`).
 * - max_completion_tokens replaces deprecated max_tokens for newer models.
 * - GPT-5 / o-series reject custom temperature — omit it entirely.
 */
import OpenAI from 'openai';

const MAX_TOKENS = 8000;

export async function callOpenAI({ model, system, messages, tools, apiKey, onEvent, userId = null }) {
  const client = new OpenAI({ apiKey });

  // Translate the agent-driver messages format (Anthropic-style content blocks
  // for tool_result) into OpenAI's expected shape. Phase 5a covers the
  // common path: plain user/assistant strings + tool_result blocks from the
  // driver get repackaged as OpenAI's `role:'tool'` messages.
  const oaMessages = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      oaMessages.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      // Either assistant tool_use blocks (re-emit as assistant message with tool_calls)
      // or user tool_result blocks (re-emit as one tool message per result)
      // or multimodal user blocks (text + image → OpenAI's content array).
      const toolUseBlocks = m.content.filter((b) => b.type === 'tool_use');
      const toolResultBlocks = m.content.filter((b) => b.type === 'tool_result');
      const textBlocks = m.content.filter((b) => b.type === 'text');
      const imageBlocks = m.content.filter((b) => b.type === 'image' && typeof b.dataUrl === 'string');
      if (toolUseBlocks.length) {
        oaMessages.push({
          role: 'assistant',
          content: textBlocks.map((b) => b.text).join('') || null,
          tool_calls: toolUseBlocks.map((b) => ({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
          })),
        });
      } else if (toolResultBlocks.length) {
        for (const b of toolResultBlocks) {
          oaMessages.push({
            role: 'tool',
            tool_call_id: b.tool_use_id,
            content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
          });
        }
      } else if (imageBlocks.length) {
        // Multimodal user message — OpenAI takes a content array with
        // {type:'text'} and {type:'image_url', image_url:{url}} entries.
        // Data URLs work directly; no CDN required.
        const parts = [];
        for (const t of textBlocks) parts.push({ type: 'text', text: t.text });
        for (const im of imageBlocks) parts.push({ type: 'image_url', image_url: { url: im.dataUrl } });
        oaMessages.push({ role: m.role, content: parts });
      } else if (textBlocks.length) {
        oaMessages.push({ role: m.role, content: textBlocks.map((b) => b.text).join('') });
      }
    }
  }

  // ── Prompt caching ─────────────────────────────────────────────────
  // OpenAI auto-caches any prefix ≥1024 tokens that repeats across calls
  // (since Oct 2024). Cached input tokens are billed at 50% of fresh rate.
  // `prompt_cache_key` (optional) is an internal routing hint: requests
  // sharing the same key are routed to the same replica's cache, raising
  // hit rate in multi-replica deployments. Scoping per-user gives each
  // user a stable cache hot path without leaking prompts across tenants.
  const stream = await client.chat.completions.create({
    model,
    messages: oaMessages,
    tools: tools && tools.length ? tools : undefined,
    max_completion_tokens: MAX_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
    ...(userId ? { prompt_cache_key: `u-${userId}` } : {}),
  });

  // tool_calls accumulator: index → {id, name, argsBuf}
  const toolBuf = new Map();
  let stopReason = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  // Mirror the assembled assistant message back for the driver's history push.
  let assembledText = '';
  const assembledToolCalls = [];

  for await (const chunk of stream) {
    const choice = chunk?.choices?.[0];
    if (choice) {
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        onEvent({ type: 'text_delta', text: delta.content });
        assembledText += delta.content;
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          let buf = toolBuf.get(idx);
          if (!buf) {
            buf = { id: tc.id || null, name: '', argsBuf: '' };
            toolBuf.set(idx, buf);
          }
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name += tc.function.name;
          if (tc.function?.arguments) buf.argsBuf += tc.function.arguments;
        }
      }
      if (choice.finish_reason) {
        stopReason = choice.finish_reason;
      }
    }
    if (chunk?.usage) {
      // OpenAI surfaces cache hits as `prompt_tokens_details.cached_tokens`
      // (subset of prompt_tokens — NOT additive). Cached portion costs 50%.
      // No "cache_write" line item — writes are free, only reads discount.
      usage = {
        input_tokens: chunk.usage.prompt_tokens || 0,
        output_tokens: chunk.usage.completion_tokens || 0,
        cached_input_tokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
        cache_write_tokens: 0,
      };
    }
  }

  // Emit consolidated tool_use events + build the content array for history.
  const content = [];
  if (assembledText) content.push({ type: 'text', text: assembledText });
  for (const buf of toolBuf.values()) {
    let parsedInput = {};
    try { parsedInput = JSON.parse(buf.argsBuf || '{}'); }
    catch { parsedInput = { _raw: buf.argsBuf, _parse_error: true }; }
    onEvent({ type: 'tool_use', id: buf.id, name: buf.name, input: parsedInput });
    content.push({ type: 'tool_use', id: buf.id, name: buf.name, input: parsedInput });
    assembledToolCalls.push({ id: buf.id, name: buf.name, input: parsedInput });
  }

  // Normalize OpenAI's finish_reason to Anthropic-style stop_reason.
  let normalizedStop;
  if (stopReason === 'tool_calls') normalizedStop = 'tool_use';
  else if (stopReason === 'stop') normalizedStop = 'end_turn';
  else if (stopReason === 'length') normalizedStop = 'max_tokens';
  else normalizedStop = stopReason || 'end_turn';

  onEvent({ type: 'message_complete', stop_reason: normalizedStop, usage });

  return { content, stop_reason: normalizedStop, usage };
}
