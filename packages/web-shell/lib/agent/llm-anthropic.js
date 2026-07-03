/**
 * Anthropic adapter. Wraps the SDK's streaming + tool-use API into the
 * normalized event shape the driver consumes:
 *   { type: 'text_delta', text }
 *   { type: 'tool_use',  id, name, input }
 *   { type: 'message_complete', stop_reason, usage }
 */
import Anthropic from '@anthropic-ai/sdk';
import { recordUsage } from '../billing/context.js';

const MAX_TOKENS = 8000;

// Translate the route-emitted multimodal blocks ({type:'image', dataUrl})
// into Anthropic's native image-block shape ({type:'image', source:{...}}).
// Other block types (text, tool_use, tool_result) pass through untouched.
function normalizeContentForAnthropic(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;
  return content.map((b) => {
    if (b?.type === 'image' && typeof b.dataUrl === 'string') {
      const m = /^data:([^;]+);base64,(.+)$/.exec(b.dataUrl);
      if (m) {
        return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
      }
    }
    return b;
  });
}

/**
 * @param {object} opts
 * @param {string} opts.model        — provider model id (already resolved via MODEL_ALIAS upstream)
 * @param {string} opts.system       — system prompt
 * @param {Array}  opts.messages     — Anthropic-format messages
 * @param {Array}  opts.tools        — Anthropic tools[] spec
 * @param {string} opts.apiKey       — Anthropic API key
 * @param {(ev) => void} opts.onEvent
 * @returns {Promise<{content, stop_reason, usage}>}
 */
export async function callAnthropic({ model, system, messages, tools, apiKey, onEvent }) {
  const client = new Anthropic({ apiKey });
  const normalizedMessages = messages.map((m) => ({ ...m, content: normalizeContentForAnthropic(m.content) }));

  // ── Prompt caching ─────────────────────────────────────────────────
  // Anthropic requires explicit breakpoints (no auto-cache). Strategy:
  //   1. Wrap the system string as a single content block + mark it ephemeral
  //      so the system prompt is cached on its own (survives even when the
  //      tools list changes).
  //   2. Clone the tools array and tag the LAST tool with cache_control.
  //      Anthropic caches everything up to and including that breakpoint,
  //      which means system + all tools land in one cached prefix.
  // 5min TTL. Writes cost +25% vs base input; reads cost only 10%.
  // Break-even: 2 hits — any agent loop with ≥2 iterations is in the black.
  const systemBlocks = typeof system === 'string'
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : system;
  let cachedTools = tools;
  if (Array.isArray(tools) && tools.length > 0) {
    cachedTools = tools.map((t, i) => (
      i === tools.length - 1
        ? { ...t, cache_control: { type: 'ephemeral' } }
        : t
    ));
  }

  const stream = client.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    system: systemBlocks,
    messages: normalizedMessages,
    tools: cachedTools,
  });

  // Accumulator for tool_use input (the SDK emits input deltas as partial JSON strings)
  const toolInputBuf = new Map(); // index → string

  for await (const ev of stream) {
    switch (ev.type) {
      case 'content_block_start':
        if (ev.content_block?.type === 'text') {
          // text block starts — nothing to emit yet
        } else if (ev.content_block?.type === 'tool_use') {
          toolInputBuf.set(ev.index, '');
        }
        break;
      case 'content_block_delta':
        if (ev.delta?.type === 'text_delta') {
          onEvent({ type: 'text_delta', text: ev.delta.text });
        } else if (ev.delta?.type === 'input_json_delta') {
          const buf = toolInputBuf.get(ev.index) || '';
          toolInputBuf.set(ev.index, buf + ev.delta.partial_json);
        }
        break;
      case 'content_block_stop': {
        // If this was a tool_use block, emit the assembled tool_use event.
        // We need the final block info from finalMessage() to get id/name.
        // For now, we rely on finalMessage() below for the consolidated view.
        break;
      }
      case 'message_stop':
        // usage attached
        break;
    }
  }

  const final = await stream.finalMessage();

  // Emit one tool_use event per tool_use content block (driver matches by id).
  for (const block of final.content || []) {
    if (block.type === 'tool_use') {
      onEvent({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    }
  }
  // Normalize usage shape so cached_input_tokens is a first-class field
  // alongside input_tokens / output_tokens. Anthropic returns
  // cache_read_input_tokens (charged at 10% — these are the hits) and
  // cache_creation_input_tokens (charged at 125% — these are the writes).
  // For accurate cost we surface BOTH so cost.js can split-price them.
  const usage = {
    input_tokens:           final.usage?.input_tokens || 0,
    output_tokens:          final.usage?.output_tokens || 0,
    cached_input_tokens:    final.usage?.cache_read_input_tokens || 0,
    cache_write_tokens:     final.usage?.cache_creation_input_tokens || 0,
  };
  recordUsage({
    provider: 'anthropic', model,
    tokensIn: usage.input_tokens, tokensOut: usage.output_tokens,
    cachedIn: usage.cached_input_tokens, cacheWrite: usage.cache_write_tokens,
  });
  onEvent({ type: 'message_complete', stop_reason: final.stop_reason, usage });

  return { ...final, usage };
}
