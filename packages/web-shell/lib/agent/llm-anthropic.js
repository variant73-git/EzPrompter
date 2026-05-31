/**
 * Anthropic adapter. Wraps the SDK's streaming + tool-use API into the
 * normalized event shape the driver consumes:
 *   { type: 'text_delta', text }
 *   { type: 'tool_use',  id, name, input }
 *   { type: 'message_complete', stop_reason, usage }
 */
import Anthropic from '@anthropic-ai/sdk';

const MAX_TOKENS = 8000;

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
  const stream = client.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages,
    tools,
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
  onEvent({ type: 'message_complete', stop_reason: final.stop_reason, usage: final.usage });

  return final;
}
