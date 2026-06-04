import { NextResponse } from 'next/server';
import { requireUser } from '../../../lib/auth.js';
import { getOrCreateActiveThread, loadMessages, appendMessage,
         startAgentRun, finishAgentRun } from '../../../lib/chat-persistence.js';
import { buildFullRegistry, buildSafeRegistry, buildAssetRegistry } from '../../../lib/agent/tools/index.js';
import { runAgentLoop } from '../../../lib/agent/driver.js';
import { callAnthropic } from '../../../lib/agent/llm-anthropic.js';
import { callOpenAI }    from '../../../lib/agent/llm-openai.js';
import { callGemini }    from '../../../lib/agent/llm-gemini.js';
import { BOARD_AGENT, EDIT_IMAGE_SYSTEM } from '../../../lib/agent/prompts.js';
import { createSseStream, SSE_HEADERS } from '../../../lib/agent/sse-bridge.js';
import { registerRun, unregisterRun } from '../../../lib/agent/run-map.js';
import { getCaps } from '../../../lib/agent/caps.js';

export const runtime = 'nodejs';

// Picker IDs → SDK-friendly model strings (mirror MODEL_ALIAS in run-flow.js).
// NOTE: kept for completeness even though the picker no longer drives the
// agent — the picker selects which model runs INSIDE a node (runFlow / image
// gen). The agent itself (the assistant that orchestrates tools to build
// workflows) uses AGENT_MODEL below.
const MODEL_ALIAS = {
  // Anthropic
  'claude-4.6-opus':    'claude-opus-4-6',
  'claude-4.7-opus':    'claude-opus-4-7',
  'claude-sonnet-4-6':  'claude-sonnet-4-6',
  'claude-haiku-4-5':   'claude-haiku-4-5-20251001',
  // OpenAI
  'gpt-5.5':            'gpt-5.5',
  // Gemini
  'gemini-3.1-pro':     'gemini-3.1-pro-preview',
  'gemini-2.5-flash':   'gemini-2.5-flash',
  // Kimi (deferred — accepted alias, falls through to error below for now)
};

// Which model orchestrates the agent (tool calls, workflow building).
// Internal infrastructure choice — NOT the user's picker selection.
//
// Override per env: UNCRAFT_AGENT_MODEL=<id>
//
// Default is Gemini 2.5 Flash because at scale (target: 100k-1M users) the
// agent cost dominates. Math per turn @ ~15k in + 1.5k out:
//   gemini-2.5-flash      — $0.0015 / turn  ($1.8M/yr @ 1M users)
//   deepseek-chat         — $0.006        ($7.2M/yr)
//   claude-haiku-4-5      — $0.022        ($26M/yr)
//   claude-sonnet-4-6     — $0.07         ($84M/yr)
//
// Flash has slightly weaker function-calling quality than Sonnet/DeepSeek
// (BFCL ~85% vs ~94% / ~88%) but is the safest cost-floor for a free tier
// targeting millions of users. Tiered routing (free=Flash, pro=DeepSeek,
// enterprise=Sonnet) goes here when the credit system lands.
//
// Wrapped in a function so tests can override the env var per-test and
// hot-reload picks up changes without restarting the dev server.
function getAgentModel() {
  return process.env.UNCRAFT_AGENT_MODEL || 'gemini-2.5-flash';
}

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

function mapLoopResultToRunStatus(stopReason) {
  switch (stopReason) {
    case 'end_turn':            return 'completed';
    case 'hard_limited':        return 'hard_limited';
    case 'wall_timeout':        return 'failed';
    case 'cancelled':
    case 'cancelled_softpause': return 'cancelled';
    default:                    return 'failed';
  }
}

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
    tools: toolAllowlist = null,
    systemPromptKey = 'BOARD_AGENT',
  } = body || {};

  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 });
  if (!message?.trim()) return NextResponse.json({ error: 'message required' }, { status: 400 });

  // The agent's orchestrating model is OUR choice (cost/quality), not the
  // user's picker. The picker on PromptDock chooses which model runs
  // INSIDE a node when the agent calls runFlow/createImage — that's a
  // different concern handled by run-flow.js / image gen routes.
  const resolvedModel = getAgentModel();
  if (!/^(claude|opus|sonnet|haiku|gpt|gemini)/i.test(resolvedModel)) {
    return NextResponse.json({ error: `unsupported AGENT_MODEL configured: ${resolvedModel}` }, { status: 500 });
  }

  // Route to the correct provider adapter based on the resolved model.
  const resolved = resolveAdapter(resolvedModel);
  if (resolved.error) {
    return NextResponse.json({ error: resolved.error }, { status: 500 });
  }

  const thread = await getOrCreateActiveThread({ boardId, userId: user.id, scope: threadScope, assetId });

  // Persist the user message immediately so it's visible on reload even if the run errors out.
  await appendMessage({ threadId: thread.id, role: 'user', content: message });

  // Asset-scoped chats (Smart Edit) get the asset registry (safe + createImage) —
  // they can't delete/runFlow/editSite from there. Board chats get the full registry.
  const registry = threadScope === 'asset' ? buildAssetRegistry() : buildFullRegistry();
  const systemPrompt = PROMPT_KEYS[systemPromptKey] || PROMPT_KEYS.BOARD_AGENT;

  // Build the message history for the LLM from the new user msg.
  // (Cheap path for Phase 1: just the current user message; richer history support in Phase 5.)
  const initialMessages = [{ role: 'user', content: message }];

  const { stream, send, close } = createSseStream();

  // Fire and forget: run the agent, stream events as they happen.
  (async () => {
    send('thread_id', { threadId: thread.id });
    let runId = null;
    let loopResult = null;
    try {
      const run = await startAgentRun({ threadId: thread.id });
      runId = run.id;
      registerRun(runId);
      send('run_id', { runId });
      const caps = getCaps();

      // Each provider expects a different tool spec shape (Anthropic uses
      // {name, input_schema}; OpenAI wraps in {type:'function', function:{...}};
      // Gemini wraps everything in [{functionDeclarations:[...]}]). Pick the
      // right emitter based on the provider chosen above.
      const tools = resolved.providerLabel === 'openai'
        ? registry.toOpenAISpec(toolAllowlist)
        : resolved.providerLabel === 'gemini'
        ? registry.toGeminiSpec(toolAllowlist)
        : registry.toAnthropicSpec(toolAllowlist);

      loopResult = await runAgentLoop({
        llm: resolved.adapter,
        registry,
        systemPrompt,
        messages: initialMessages,
        modelId: resolvedModel,
        apiKey: resolved.apiKey,
        ctx: { boardId, userId: user.id, conversationModel: resolvedModel },
        toolAllowlist,
        tools,
        runId,
        caps,
        onEvent: (ev) => {
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
            case 'needs_confirm':
              send('needs_confirm', { id: ev.id, name: ev.name, args: ev.args, summary: ev.summary });
              break;
            case 'needs_choice':
              send('needs_choice', { id: ev.id, name: ev.name, args: ev.args, summary: ev.summary, choices: ev.choices });
              break;
            case 'needs_softlimit_continue':
              send('needs_softlimit_continue', {
                id: ev.id,
                iterationsSoFar: ev.iterationsSoFar,
                breakdown: ev.breakdown,
              });
              break;
            case 'message_complete':
              break;
            case 'run_status':
              send('run_status', { status: ev.status, err: ev.err });
              break;
          }
        },
      });

      const finalStatus = mapLoopResultToRunStatus(loopResult.stop_reason);
      await finishAgentRun({
        runId,
        status: finalStatus,
        iterations: loopResult.iterations,
        toolCallCounts: loopResult.toolCounts || {},
      });
      await appendMessage({
        threadId: thread.id,
        role: 'assistant',
        content: '',                       // Phase 5b will populate this from the run.
        model: resolvedModel,
        agentRunId: runId,
      });
    } catch (e) {
      console.error('[POST /api/chat] agent error', e);
      send('run_status', { status: 'failed', err: String(e?.message || e) });
      if (runId) {
        try {
          await finishAgentRun({ runId, status: 'failed', iterations: 0, err: String(e?.message || e) });
        } catch (_) {}
      }
    } finally {
      if (runId) unregisterRun(runId);
      close();
    }
  })();

  return new Response(stream, { headers: SSE_HEADERS });
}
