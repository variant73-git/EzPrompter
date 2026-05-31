import { NextResponse } from 'next/server';
import { requireUser } from '../../../lib/auth.js';
import { getOrCreateActiveThread, loadMessages, appendMessage } from '../../../lib/chat-persistence.js';
import { buildSafeRegistry } from '../../../lib/agent/tools/index.js';
import { runAgentLoop } from '../../../lib/agent/driver.js';
import { callAnthropic } from '../../../lib/agent/llm-anthropic.js';
import { BOARD_AGENT, EDIT_IMAGE_SYSTEM } from '../../../lib/agent/prompts.js';
import { createSseStream, SSE_HEADERS } from '../../../lib/agent/sse-bridge.js';

export const runtime = 'nodejs';

// Picker IDs → SDK-friendly model strings (mirror MODEL_ALIAS in run-flow.js).
const MODEL_ALIAS = {
  'claude-4.6-opus':   'claude-opus-4-6',
  'claude-4.7-opus':   'claude-opus-4-7',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  // Phase 1 is Claude-only; non-Claude picker IDs error below.
};

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

  // Phase 1: Claude-only.
  const resolvedModel = MODEL_ALIAS[modelId];
  if (!resolvedModel) {
    return NextResponse.json({ error: `Phase 1 supports Claude models only. Got: ${modelId}` }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured on server' }, { status: 500 });
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
      await runAgentLoop({
        llm: callAnthropic,
        registry,
        systemPrompt,
        messages: initialMessages,
        modelId: resolvedModel,
        apiKey,
        ctx: { boardId, userId: user.id },
        toolAllowlist,
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
