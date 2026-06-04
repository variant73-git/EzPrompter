/**
 * Gemini adapter — streams generateContentStream() with function calling and
 * normalizes to the agent-driver event shape:
 *   { type: 'text_delta', text }
 *   { type: 'tool_use', id, name, input }
 *   { type: 'message_complete', stop_reason, usage }
 *
 * Mirrors lib/agent/llm-anthropic.js + llm-openai.js conventions.
 *
 * Gemini specifics:
 * - Tool spec is `[{functionDeclarations: [{name, description, parameters}]}]`
 *   (already shaped that way by registry.toGeminiSpec()).
 * - Stream chunks each contain `candidates[].content.parts[]` with either
 *   `{text}` or `{functionCall:{name, args}}` parts.
 * - Gemini doesn't assign per-call IDs to function calls — we synthesize
 *   `gemini-fc-<n>` ids per call within this turn so the driver can match
 *   tool results back. The id is round-tripped via the driver's history.
 * - `finishReason: 'STOP'` is the normal end. If any function calls were
 *   emitted, we normalize to 'tool_use' since the driver needs to execute
 *   them and re-call the model.
 * - usage is on the last chunk as `usageMetadata.{promptTokenCount, candidatesTokenCount}`.
 */
import { GoogleGenAI } from '@google/genai';

const MAX_TOKENS = 8000;

export async function callGemini({ model, system, messages, tools, apiKey, onEvent }) {
  const ai = new GoogleGenAI({ apiKey });

  // Translate driver-format (Anthropic-style) messages to Gemini's shape.
  // Gemini uses `contents: [{role, parts: [...]}]` with roles 'user' and
  // 'model'. tool_result blocks become {functionResponse:{name, response}}.
  const geminiContents = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      geminiContents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    } else if (Array.isArray(m.content)) {
      const parts = [];
      for (const b of m.content) {
        if (b.type === 'text') parts.push({ text: b.text });
        else if (b.type === 'image' && typeof b.dataUrl === 'string') {
          // Multimodal user content — Gemini takes {inlineData:{mimeType, data}}.
          const match = /^data:([^;]+);base64,(.+)$/.exec(b.dataUrl);
          if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
        else if (b.type === 'tool_use') parts.push({ functionCall: { name: b.name, args: b.input || {} } });
        else if (b.type === 'tool_result') {
          parts.push({
            functionResponse: {
              name: b.tool_use_id, // best effort — Gemini doesn't use id but needs name; driver may need to map
              response: { content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) },
            },
          });
        }
      }
      if (parts.length) {
        geminiContents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts,
        });
      }
    }
  }

  const stream = await ai.models.generateContentStream({
    model,
    contents: geminiContents,
    config: {
      systemInstruction: system,
      maxOutputTokens: MAX_TOKENS,
      tools: tools && tools.length ? tools : undefined,
    },
  });

  let assembledText = '';
  const assembledToolCalls = [];
  let stopReason = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  let fcCounter = 0;

  for await (const chunk of stream) {
    const candidate = chunk?.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (typeof part.text === 'string' && part.text) {
          onEvent({ type: 'text_delta', text: part.text });
          assembledText += part.text;
        }
        if (part.functionCall) {
          const id = `gemini-fc-${++fcCounter}`;
          const name = part.functionCall.name;
          const input = part.functionCall.args || {};
          onEvent({ type: 'tool_use', id, name, input });
          assembledToolCalls.push({ id, name, input });
        }
      }
    }
    if (candidate?.finishReason) {
      stopReason = candidate.finishReason;
    }
    if (chunk?.usageMetadata) {
      usage = {
        input_tokens: chunk.usageMetadata.promptTokenCount || 0,
        output_tokens: chunk.usageMetadata.candidatesTokenCount || 0,
      };
    }
  }

  // Build the assistant-message content array (driver pushes this into history).
  const content = [];
  if (assembledText) content.push({ type: 'text', text: assembledText });
  for (const fc of assembledToolCalls) {
    content.push({ type: 'tool_use', id: fc.id, name: fc.name, input: fc.input });
  }

  // Normalize stop_reason. Gemini emits 'STOP' as the catch-all; if function
  // calls were present, the driver needs to keep looping → 'tool_use'.
  let normalizedStop;
  if (assembledToolCalls.length > 0) normalizedStop = 'tool_use';
  else if (stopReason === 'STOP') normalizedStop = 'end_turn';
  else if (stopReason === 'MAX_TOKENS') normalizedStop = 'max_tokens';
  else if (stopReason === 'SAFETY') normalizedStop = 'safety';
  else normalizedStop = stopReason || 'end_turn';

  onEvent({ type: 'message_complete', stop_reason: normalizedStop, usage });

  return { content, stop_reason: normalizedStop, usage };
}
