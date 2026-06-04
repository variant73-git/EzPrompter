import { NextResponse } from 'next/server';
import { requireUser } from '../../../lib/auth.js';
import { sql } from '../../../lib/db.js';
import { placeStackDown } from '../../../lib/canvas-layout.js';
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
import { computeCost } from '../../../lib/agent/cost.js';
import { hasEnoughCredits } from '../../../lib/credits.js';

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

/**
 * Pick the model that orchestrates the agent (tool calls). Tier ladder:
 *   - free:       gemini-2.5-flash (cheap, weaker function-calling but adequate)
 *   - pro:        gemini-2.5-flash (temporarily same as free; DeepSeek adapter pending Phase 5d)
 *   - enterprise: claude-sonnet-4-6 (best function-calling quality)
 *
 * Cost floor math per turn @ ~15k in + 1.5k out:
 *   gemini-2.5-flash  — $0.0015 / turn  ($1.8M/yr @ 1M users)
 *   deepseek-chat     — $0.006          ($7.2M/yr)  [TODO Phase 5d]
 *   claude-sonnet-4-6 — $0.07           ($84M/yr)
 *
 * UNCRAFT_AGENT_MODEL env override always wins (dev/test).
 * Wrapped in a function so tests can override the env var per-test and
 * hot-reload picks up changes without restarting the dev server.
 */
function getAgentModel(user) {
  if (process.env.UNCRAFT_AGENT_MODEL) return process.env.UNCRAFT_AGENT_MODEL;
  const plan = user?.plan || 'free';
  if (plan === 'enterprise') return 'claude-sonnet-4-6';
  // TODO Phase 5d: wire DeepSeek adapter (OpenAI-compatible, baseURL=https://api.deepseek.com).
  // Until then, pro tier downgrades to the same model as free to avoid 500s.
  if (plan === 'pro') return 'gemini-2.5-flash';
  return 'gemini-2.5-flash';
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
    attachments = null,
  } = body || {};

  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 });
  const hasText = !!message?.trim();
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!hasText && !hasAttachments) return NextResponse.json({ error: 'message or attachments required' }, { status: 400 });

  // The agent's orchestrating model is OUR choice (cost/quality), not the
  // user's picker. The picker on PromptDock chooses which model runs
  // INSIDE a node when the agent calls runFlow/createImage — that's a
  // different concern handled by run-flow.js / image gen routes.
  const resolvedModel = getAgentModel(user);
  if (!/^(claude|opus|sonnet|haiku|gpt|gemini)/i.test(resolvedModel)) {
    return NextResponse.json({ error: `unsupported AGENT_MODEL configured: ${resolvedModel}` }, { status: 500 });
  }

  // Phase 5c credit gate — currently permissive (lib/credits.js stub always returns true).
  // Flipping enforcement on requires only lib/credits.js changing.
  const enough = await hasEnoughCredits({ userId: user.id, cents: 100 }); // pre-check notional budget
  if (!enough) {
    return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
  }

  // Route to the correct provider adapter based on the resolved model.
  const resolved = resolveAdapter(resolvedModel);
  if (resolved.error) {
    return NextResponse.json({ error: resolved.error }, { status: 500 });
  }

  const thread = await getOrCreateActiveThread({ boardId, userId: user.id, scope: threadScope, assetId });

  // Persist the user message immediately so it's visible on reload even if the run errors out.
  // Attachments are NOT persisted yet — they only travel with this turn so the agent can see
  // them. The result (asset nodes, generated images) IS the durable record.
  const persistedText = hasText
    ? message
    : `[image attachment${attachments.length > 1 ? 's' : ''}: ${attachments.map((a) => a.name || 'image').join(', ')}]`;
  await appendMessage({ threadId: thread.id, role: 'user', content: persistedText });

  // Asset-scoped chats (Smart Edit) get the asset registry (safe + createImage) —
  // they can't delete/runFlow/editSite from there. Board chats get the full registry.
  const registry = threadScope === 'asset' ? buildAssetRegistry() : buildFullRegistry();
  const systemPrompt = PROMPT_KEYS[systemPromptKey] || PROMPT_KEYS.BOARD_AGENT;

  // Persist image attachments BEFORE building the LLM message. For each one
  // we create BOTH an `assets` row (so it has an id the agent can pass to
  // createImage) AND a `nodes` row with the dataUrl baked into meta (so the
  // user immediately sees a node on the canvas — matches the ChatGPT
  // pattern where uploads visibly appear in the conversation). The agent
  // then doesn't need to redundantly call createNode for the attachment;
  // we tell it the node already exists.
  const persistedAttachmentAssets = [];
  if (hasAttachments) {
    for (const a of attachments) {
      if (a?.kind !== 'image' || typeof a.dataUrl !== 'string') continue;
      const mimeType = a.mimeType || (/^data:([^;]+);/.exec(a.dataUrl)?.[1]) || 'image/png';
      const displayName = a.name || 'attachment';
      const assetMeta = { dataUrl: a.dataUrl, mimeType, source: 'chat-attachment' };
      try {
        const [assetRow] = await sql`
          INSERT INTO assets (user_id, project_id, type, name, meta)
          VALUES (${user.id}, ${boardId}, 'image', ${displayName}, ${JSON.stringify(assetMeta)}::jsonb)
          RETURNING id
        `;
        const nodeMeta = {
          source: 'chat-attachment',
          assetId: assetRow.id,
          name: displayName,
          dataUrl: a.dataUrl,
          mimeType,
        };
        let nodeId = null;
        try {
          const { x: placedX, y: placedY } = await placeStackDown(boardId, 512, 512, sql);
          const [nodeRow] = await sql`
            INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
            VALUES (${boardId}, 'asset', ${placedX}, ${placedY}, 512, 512, ${JSON.stringify(nodeMeta)}::jsonb)
            RETURNING id
          `;
          nodeId = nodeRow.id;
        } catch (e) {
          console.warn('[chat] failed to create node for attachment', e?.message || e);
        }
        persistedAttachmentAssets.push({
          id: assetRow.id,
          nodeId,
          name: displayName,
          mimeType,
        });
      } catch (e) {
        console.warn('[chat] failed to persist attachment as asset', e?.message || e);
      }
    }
  }

  // Build the message history for the LLM. When attachments are present the
  // user content becomes an Anthropic-style array of blocks: one text block
  // (the typed message + a hint about persisted assetIds + the fact that the
  // node already lives on the canvas, or a default cue if user only attached
  // without text) plus one image block per attachment. Each adapter
  // translates this shape into its provider's native multimodal format.
  let initialMessages;
  if (hasAttachments) {
    let textPart = hasText
      ? message
      : 'Anexei a(s) imagem(s) acima. Use seu próprio julgamento sobre o que fazer com ela(s).';
    if (persistedAttachmentAssets.length) {
      const inv = persistedAttachmentAssets
        .map((a) => `assetId=${a.id}${a.nodeId ? `, nodeId=${a.nodeId}` : ''} (${a.name})`)
        .join('; ');
      textPart += `\n\n[The attached image(s) are ALREADY on the canvas as asset nodes. Do NOT call createNode for them — they exist. Inventory: ${inv}. Use the assetId as baseImageAssetId in createImage when doing image-to-image edits / style transfer.]`;
    }
    const blocks = [{ type: 'text', text: textPart }];
    for (const a of attachments) {
      if (a?.kind === 'image' && typeof a.dataUrl === 'string') {
        blocks.push({ type: 'image', dataUrl: a.dataUrl, name: a.name, mimeType: a.mimeType });
      }
    }
    initialMessages = [{ role: 'user', content: blocks }];
  } else {
    initialMessages = [{ role: 'user', content: message }];
  }

  const { stream, send, close } = createSseStream();

  // Fire and forget: run the agent, stream events as they happen.
  (async () => {
    send('thread_id', { threadId: thread.id });
    // If we already created asset nodes for the user's attachments, tell
    // the client to refetch the graph NOW — don't make them wait for the
    // agent run to finish for their upload to appear on the canvas.
    if (persistedAttachmentAssets.length > 0) {
      send('graph_mutated', {
        reason: 'attachments_persisted',
        nodeIds: persistedAttachmentAssets.map((a) => a.nodeId).filter(Boolean),
      });
    }
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

      // Phase 5b: accumulators for assistant content + tool calls.
      let accumulatedText = '';
      const toolCallMap = new Map(); // toolCallId → {id, name, args, status, result?, error?}

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
              accumulatedText += ev.text;
              send('assistant_token', { delta: ev.text });
              break;
            case 'tool_use':
              toolCallMap.set(ev.id, {
                id: ev.id,
                name: ev.name,
                args: ev.input,
                status: 'pending',
              });
              send('tool_call', {
                id: ev.id, name: ev.name, args: ev.input,
                classification: registry.get(ev.name)?.classification || 'safe',
              });
              break;
            case 'tool_status': {
              const existing = toolCallMap.get(ev.id) || { id: ev.id };
              const updated = { ...existing, status: ev.status };
              if (ev.result !== undefined) updated.result = ev.result;
              if (ev.error !== undefined) updated.error = ev.error;
              toolCallMap.set(ev.id, updated);
              send('tool_status', { id: ev.id, status: ev.status, result: ev.result, error: ev.error });
              // Mid-run canvas refetch trigger for tools that change the
              // graph. Without this, addAssetFromUrl / createImage results
              // only become visible at end-of-run — long agent turns end
              // up looking dead from the user's POV.
              if (ev.status === 'done') {
                const toolName = updated.name || '';
                const GRAPH_MUTATING = new Set([
                  'createNode', 'addEdge', 'updateNode', 'deleteNode',
                  'addAssetFromUrl', 'createImage', 'runFlow', 'editSite',
                ]);
                if (GRAPH_MUTATING.has(toolName)) {
                  send('graph_mutated', { reason: `tool:${toolName}` });
                }
              }
              break;
            }
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

      const tokensIn = loopResult.usage?.input_tokens || 0;
      const tokensOut = loopResult.usage?.output_tokens || 0;
      const costCents = computeCost({ model: resolvedModel, tokensIn, tokensOut });

      const finalStatus = mapLoopResultToRunStatus(loopResult.stop_reason);
      await finishAgentRun({
        runId,
        status: finalStatus,
        iterations: loopResult.iterations,
        toolCallCounts: loopResult.toolCounts || {},
        tokensIn,
        tokensOut,
        costCents,
      });
      const toolCallsForPersistence = Array.from(toolCallMap.values());
      await appendMessage({
        threadId: thread.id,
        role: 'assistant',
        content: accumulatedText,
        toolCalls: toolCallsForPersistence.length > 0 ? toolCallsForPersistence : null,
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
