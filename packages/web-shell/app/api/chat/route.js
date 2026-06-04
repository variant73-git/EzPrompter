import { NextResponse } from 'next/server';
import { requireUser } from '../../../lib/auth.js';
import { getOrCreateActiveThread, loadMessages, appendMessage } from '../../../lib/chat-persistence.js';
import { buildSafeRegistry } from '../../../lib/agent/tools/index.js';
import { runAgentLoop } from '../../../lib/agent/driver.js';
import { callAnthropic } from '../../../lib/agent/llm-anthropic.js';
import { callOpenAI }    from '../../../lib/agent/llm-openai.js';
import { callGemini }    from '../../../lib/agent/llm-gemini.js';
import { BOARD_AGENT, EDIT_IMAGE_SYSTEM } from '../../../lib/agent/prompts.js';
import { createSseStream, SSE_HEADERS } from '../../../lib/agent/sse-bridge.js';

export const runtime = 'nodejs';

// Picker IDs → SDK-friendly model strings (mirror MODEL_ALIAS in run-flow.js).
const MODEL_ALIAS = {
  // Anthropic
  'claude-4.6-opus':   'claude-opus-4-6',
  'claude-4.7-opus':   'claude-opus-4-7',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  // OpenAI
  'gpt-5.5':           'gpt-5.5',
  // Gemini
  'gemini-3.1-pro':    'gemini-3.1-pro-preview',
  // Kimi (deferred — accepted alias, falls through to error below for now)
};

/**
 * Pick the LLM adapter for a resolved model string.
 * Returns {adapter, apiKey, providerLabel} or {error: string} if no key/unsupported.
 */
function resolveAdapter(resolvedModel) {
  if (/^(claude|opus|sonnet|haiku)/i.test(resolvedModel)) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured on server' };
    return { adapter: callAnthropic, apiKey, providerLabel: 'anthropic' };
  }
  if (/^(gpt|openai|o[1-9])/i.test(resolvedModel)) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { error: 'OPENAI_API_KEY not configured on server' };
    return { adapter: callOpenAI, apiKey, providerLabel: 'openai' };
  }
  if (/^gemini/i.test(resolvedModel)) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) return { error: 'GEMINI_API_KEY (or GOOGLE_API_KEY) not configured on server' };
    return { adapter: callGemini, apiKey, providerLabel: 'gemini' };
  }
  return { error: `unsupported model: ${resolvedModel} (Phase 5a supports Claude / GPT / Gemini)` };
}

const PROMPT_KEYS = { BOARD_AGENT, EDIT_IMAGE_SYSTEM };

export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const url = new URL(request.url);
  const boardId = url.searchParams.get('boardId');
  const scope = url.searchParams.get('scope') || 'board';
  const assetId = url.searchParams.get('assetId');
  const before = url.searchParams.get('before');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 });
  if (scope === 'asset' && !assetId) return NextResponse.json({ error: 'assetId required for scope=asset' }, { status: 400 });

  try {
    const thread = await getOrCreateActiveThread({ boardId, userId: user.id, scope, assetId });
    const messages = await loadMessages({ threadId: thread.id, limit, before });
    return NextResponse.json({ thread, messages });
  } catch (e) {
    console.error('[GET /api/chat] error', e);
    return NextResponse.json({ error: e.message || 'failed' }, { status: 500 });
  }
}

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const {
    boardId,
    threadScope = 'board',
    assetId = null,
    message,
    modelId = 'claude-sonnet-4-6',
    tools: toolAllowlist = null,
    systemPromptKey = 'BOARD_AGENT',
  } = body || {};

  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 });
  if (!message?.trim()) return NextResponse.json({ error: 'message required' }, { status: 400 });

  // Resolve the picker ID to an SDK-friendly model string.
  const resolvedModel = MODEL_ALIAS[modelId];
  if (!resolvedModel) {
    return NextResponse.json({ error: `unknown modelId: ${modelId}` }, { status: 400 });
  }

  // Route to the correct provider adapter based on the resolved model.
  const resolved = resolveAdapter(resolvedModel);
  if (resolved.error) {
    return NextResponse.json({ error: resolved.error }, { status: 500 });
  }

  const thread = await getOrCreateActiveThread({ boardId, userId: user.id, scope: threadScope, assetId });

  // Persist the user message immediately so it's visible on reload even if the run errors out.
  await appendMessage({ threadId: thread.id, role: 'user', content: message });

  const registry = buildSafeRegistry();
  const systemPrompt = PROMPT_KEYS[systemPromptKey] || PROMPT_KEYS.BOARD_AGENT;

  // Build the message history for the LLM from the new user msg.
  // (Cheap path for Phase 1: just the current user message; richer history support in Phase 5.)
  const initialMessages = [{ role: 'user', content: message }];

  const { stream, send, close } = createSseStream();

  // Fire and forget: run the agent, stream events as they happen.
  (async () => {
    send('thread_id', { threadId: thread.id });
    try {
      // Each provider expects a different tool spec shape (Anthropic uses
      // {name, input_schema}; OpenAI wraps in {type:'function', function:{...}};
      // Gemini wraps everything in [{functionDeclarations:[...]}]). Pick the
      // right emitter based on the provider chosen above.
      const tools = resolved.providerLabel === 'openai'
        ? registry.toOpenAISpec(toolAllowlist)
        : resolved.providerLabel === 'gemini'
        ? registry.toGeminiSpec(toolAllowlist)
        : registry.toAnthropicSpec(toolAllowlist);

      await runAgentLoop({
        llm: resolved.adapter,
        registry,
        systemPrompt,
        messages: initialMessages,
        modelId: resolvedModel,
        apiKey: resolved.apiKey,
        ctx: { boardId, userId: user.id },
        toolAllowlist,
        tools,
        onEvent: (ev) => {
          // Normalize driver events to SSE event names per spec §5.
          switch (ev.type) {
            case 'text_delta':
              send('assistant_token', { delta: ev.text });
              break;
            case 'tool_use':
              send('tool_call', {
                id: ev.id, name: ev.name, args: ev.input,
                classification: registry.get(ev.name)?.classification || 'safe',
              });
              break;
            case 'tool_status':
              send('tool_status', { id: ev.id, status: ev.status, result: ev.result, error: ev.error });
              break;
            case 'message_complete':
              // Not surfaced as a dedicated SSE event in Phase 1; usage rolled up at run_status.
              break;
            case 'run_status':
              send('run_status', { status: ev.status, err: ev.err });
              break;
          }
        },
      });

      // Persist final assistant message stub.
      // (Phase 1: minimal — store the run summary; Phase 5 will reconstruct per-iteration messages.)
      await appendMessage({
        threadId: thread.id,
        role: 'assistant',
        content: '',
        model: resolvedModel,
        agentRunId: null,
      });
    } catch (e) {
      console.error('[POST /api/chat] agent error', e);
      send('run_status', { status: 'failed', err: String(e?.message || e) });
    } finally {
      close();
    }
  })();

  return new Response(stream, { headers: SSE_HEADERS });
}
