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
import { breakerFor }    from '../../../lib/agent/circuit.js';
import { BOARD_AGENT, EDIT_IMAGE_SYSTEM } from '../../../lib/agent/prompts.js';
import { buildBoardSummary } from '../../../lib/agent/board-summary.js';
import { createSseStream, SSE_HEADERS } from '../../../lib/agent/sse-bridge.js';
import { registerRun, unregisterRun } from '../../../lib/agent/run-map.js';
import { getCaps } from '../../../lib/agent/caps.js';
import { runMeteredOperation } from '../../../lib/billing/context.js';
import { checkChatRate } from '../../../lib/billing/rate-limit.js';
import { checkRateLimit, CHAT_POLICY } from '../../../lib/rate-limit.js';
import { moderateText, flaggedCategories } from '../../../lib/moderation.js';
import { scanPrompt } from '../../../lib/llm-guard.js';
import { flushLangfuse } from '../../../lib/agent/trace.js';
import { renderHtmlScreenshot } from '../../../lib/site-screenshot.js';

export const runtime = 'nodejs';

// Picker scope (vault decision, reaffirmed 2026-07-22): the chat dropdown
// governs SITE CREATION only — it reaches compose/edit/image tools raw via
// ctx.pickerModel, and run-flow resolves it through its own MODEL_ALIAS.
// The ORCHESTRATOR never follows the picker (the 2026-06-19 picker-wins
// change was a workaround for a then-depleted Gemini key; key is funded).

/**
 * Pick the model that orchestrates the agent (tool calls). Tier ladder per
 * the Billing decision (vault: "Free=Flash, Pro=Flash, Enterprise=Sonnet")
 * and the operator evals — Flash beat gpt-4o-mini 82%×71% with a safer
 * failure mode, and 7/7 × 2/7 on the 2026-07 derive/selection suite:
 *   - free:       gemini-2.5-flash
 *   - pro:        gemini-2.5-flash  (was gpt-4o-mini — drifted from the
 *                 eval-backed decision; DeepSeek stays a future candidate)
 *   - enterprise: claude-sonnet-4-6 (best function-calling quality)
 *
 * Cost floor math per turn @ ~15k in + 1.5k out:
 *   gemini-2.5-flash  — $0.0015 / turn  ($1.8M/yr @ 1M users)
 *   claude-sonnet-4-6 — $0.07           ($84M/yr)
 *
 * UNCRAFT_AGENT_MODEL env override always wins (dev/test). Clone requests
 * are the one exception above (UNCRAFT_CLONE_MODEL / Opus). The chat
 * picker NEVER reaches this — it only feeds creation tools.
 * Wrapped in a function so tests can override the env var per-test and
 * hot-reload picks up changes without restarting the dev server.
 */
export function getAgentModel(user) {
  if (process.env.UNCRAFT_AGENT_MODEL) return process.env.UNCRAFT_AGENT_MODEL;
  const plan = user?.plan || 'free';
  if (plan === 'enterprise') return 'claude-sonnet-4-6';
  return 'gemini-2.5-flash';
}

// Clones always run on Opus (best reconstruction + it narrates the capture).
// UNCRAFT_CLONE_MODEL is dual-bound (also retargets the clone CONTENT seam in
// lib/extract-llm.js), so an operator tuning one seam can silently retarget
// the other — the guard below keeps the "clone never orchestrated by a
// cheap-tier model" invariant env-proof (adversarial-review find).
export function resolveCloneModel(envValue) {
  if (!envValue) return 'claude-opus-4-7';
  if (/flash|mini|haiku/i.test(envValue)) {
    // eslint-disable-next-line no-console
    console.warn(`[chat] UNCRAFT_CLONE_MODEL=${envValue} is below the clone quality bar — ignoring, using claude-opus-4-7`);
    return 'claude-opus-4-7';
  }
  return envValue;
}
const CLONE_AGENT_MODEL = resolveCloneModel(process.env.UNCRAFT_CLONE_MODEL);

/** True when the user's message is asking to clone/capture/replicate a site. */
export function isCloneRequest(message) {
  return typeof message === 'string'
    && /\b(clon(e|es|ed|ar|ando|ing)?|captur(e|es|ed|ar|ando|ing)?|replicat(e|es|ed|ar)?|recriar|recreate)\b/i.test(message);
}

// Each provider gets a singleton circuit breaker — declared once at module
// scope so the breaker state persists across requests within the Node
// process. After N consecutive failures inside the rolling window, the
// breaker opens and subsequent calls fail-fast with code='circuit_open'
// for ~45s, then probes again. Spares us from bombarding a provider mid-
// outage and gives the agent loop a clear early exit.
const callAnthropicSafe = breakerFor('anthropic', callAnthropic);
const callOpenAISafe    = breakerFor('openai',    callOpenAI);
const callGeminiSafe    = breakerFor('gemini',    callGemini);

/**
 * Pick the LLM adapter for a resolved model string.
 * Returns {adapter, apiKey, providerLabel} or {error: string} if no key/unsupported.
 */
function resolveAdapter(resolvedModel) {
  if (/^(claude|opus|sonnet|haiku)/i.test(resolvedModel)) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured on server' };
    return { adapter: callAnthropicSafe, apiKey, providerLabel: 'anthropic' };
  }
  if (/^(gpt|openai|o[1-9])/i.test(resolvedModel)) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { error: 'OPENAI_API_KEY not configured on server' };
    return { adapter: callOpenAISafe, apiKey, providerLabel: 'openai' };
  }
  if (/^gemini/i.test(resolvedModel)) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) return { error: 'GEMINI_API_KEY (or GOOGLE_API_KEY) not configured on server' };
    return { adapter: callGeminiSafe, apiKey, providerLabel: 'gemini' };
  }
  return { error: `unsupported model: ${resolvedModel} (Phase 5a supports Claude / GPT / Gemini)` };
}

// ── Per-operation failover policy (2026-07-22 model-policy audit) ───────────
// Failover is a PRODUCT decision, not just an availability mechanism. Chat is
// an orchestrator where availability beats quality parity; clone and the
// enterprise tier are sold on a specific quality bar, where silently
// degrading model tier is WORSE than being briefly unavailable. Declared as
// data so the whole rule is auditable in one place instead of scattered ifs.
//
// `chain` lists candidate alternates tried in order (entries matching the
// primary's provider are skipped at build time; entries without a server key
// are skipped too). `unavailableMessage` is the product text surfaced when
// the entire chain is exhausted by availability failures — fail closed, in
// plain English, never pretending the run happened on the promised model.
export const FAILOVER_POLICIES = {
  chat: {
    // Cost-ascending so a forced failover never silently jumps to the
    // priciest model.
    chain: [
      { model: 'gemini-2.5-flash',          label: 'gemini'    },
      { model: 'gpt-4o-mini',               label: 'openai'    },
      { model: 'claude-haiku-4-5-20251001', label: 'anthropic' },
    ],
    unavailableMessage: null, // raw availability error is acceptable for chat
  },
  clone: {
    // Opus (or UNCRAFT_CLONE_MODEL) ↔ GPT-5.5 — the two models field-tested
    // for reconstruction quality (checkpoint 145). NEVER Flash: a clone the
    // user asked for on the strong model must not silently ship slop.
    chain: [
      { model: 'gpt-5.5',         label: 'openai'    },
      { model: 'claude-opus-4-7', label: 'anthropic' },
    ],
    unavailableMessage: 'Clone is temporarily unavailable — the models it needs are down right now. Nothing was run on a lower-quality model. Please try again in a few minutes.',
  },
  enterprise: {
    // Sonnet is the tier promise. No approved same-quality fallback exists
    // yet → fail closed with a clear error (audit decision: silent tier
    // degradation is worse than unavailability).
    chain: [],
    unavailableMessage: 'The assistant is temporarily unavailable. Your plan runs on a dedicated model tier and we won’t silently downgrade it. Please try again in a few minutes.',
  },
};

/** Which failover policy governs this turn. Clone wins over plan tier —
 *  an enterprise user asking for a clone gets the clone quality contract. */
export function resolveOperation({ message, hasText, user }) {
  if (hasText && isCloneRequest(message)) return 'clone';
  if ((user?.plan || 'free') === 'enterprise') return 'enterprise';
  return 'chat';
}

/**
 * Build the ordered list of alternate providers for the driver's failover
 * from the operation's policy chain. Reuses resolveAdapter (so each entry
 * inherits the same circuit-breaker-wrapped adapter + server key) and builds
 * the provider-specific tool spec. Skips providers with no key and the
 * primary's own provider.
 */
function buildAgentFallbacks({ policy, primaryLabel, registry, toolAllowlist }) {
  const out = [];
  for (const entry of policy.chain) {
    if (entry.label === primaryLabel) continue;
    const r = resolveAdapter(entry.model);
    if (r.error) continue; // provider has no key on this server — skip silently
    const tools = entry.label === 'openai'
      ? registry.toOpenAISpec(toolAllowlist)
      : entry.label === 'gemini'
      ? registry.toGeminiSpec(toolAllowlist)
      : registry.toAnthropicSpec(toolAllowlist);
    out.push({ llm: r.adapter, modelId: entry.model, apiKey: r.apiKey, tools, label: entry.label });
  }
  return out;
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

/**
 * Build the surgical context hint sent with every chat turn.
 *
 * Architecture: tools-first. The hint stays MINIMAL — it only carries
 * what the agent would otherwise need a tool call to learn, but only
 * for cases common enough that the round-trip savings matter:
 *
 *   1. Active selection ids (10 tokens, agent always wants this)
 *   2. Workflow terminal info when a section is selected (avoids 2-3
 *      tool calls for the most common "re-run / tweak" flow)
 *
 * Everything else — proximity searches, board listings, viewing the
 * content of non-selected nodes — is on-demand via the exploration
 * tools (listBoard / findNearest / viewNode / getWorkflow).
 */
async function buildWorkflowHint({ activeContexts, sql, userId, boardId }) {
  if (!Array.isArray(activeContexts) || activeContexts.length === 0) return '';
  const lines = [];

  const sectionCtx = activeContexts.find((c) => c?.kind === 'section');
  if (sectionCtx) {
    const memberIds = Array.isArray(sectionCtx.memberIds) ? sectionCtx.memberIds.filter((s) => typeof s === 'string') : [];
    if (memberIds.length > 0) {
      lines.push(`[Active workflow: "${sectionCtx.name || 'workflow'}" — ${memberIds.length} nodes (ids: ${memberIds.map((id) => id.slice(0, 8)).join(', ')}).]`);
      // Terminal = asset member with incoming-from-member edges and no
      // outgoing-to-member edges. Mirrors the section-rerun endpoint
      // heuristic so both paths agree on what "terminal" means.
      const edgeRows = await sql`
        SELECT id, source_node_id, target_node_id
        FROM edges
        WHERE board_id = ${boardId}
          AND source_node_id = ANY(${memberIds})
          AND target_node_id = ANY(${memberIds})
      `;
      const nodeRows = await sql`
        SELECT id, kind, meta FROM nodes
        WHERE id = ANY(${memberIds}) AND board_id = ${boardId}
      `;
      const terminals = nodeRows.filter((n) => {
        if (n.kind !== 'asset') return false;
        const incoming = edgeRows.some((e) => e.target_node_id === n.id);
        const outgoing = edgeRows.some((e) => e.source_node_id === n.id);
        return incoming && !outgoing;
      });
      if (terminals.length === 1) {
        const terminal = terminals[0];
        const tAssetId = terminal.meta?.assetId;
        if (tAssetId) {
          const arows = await sql`SELECT meta FROM assets WHERE id = ${tAssetId} AND user_id = ${userId}`;
          if (arows.length) {
            const m = arows[0].meta || {};
            const rawPrompt = (m.prompt ?? '').toString();
            const promptTrunc = rawPrompt.length > 240 ? rawPrompt.slice(0, 240) + '…' : rawPrompt;
            const refIds = Array.isArray(m.styleReferenceAssetIds) ? m.styleReferenceAssetIds : [];
            lines.push(
              `[Terminal of this workflow: nodeId=${terminal.id}, assetId=${tAssetId}, mode=${m.mode || 'unknown'}, base=${m.baseImageAssetId || 'none'}, refs=[${refIds.join(', ')}], prompt="${promptTrunc}". To update this terminal IN PLACE, pass replaceAssetId=${tAssetId} to createImage.]`
            );
          }
        }
      }
    }
  }

  // Active node lines — one short line per selected node. Asset nodes
  // expose their assetId (so the agent can pass it to createImage
  // without a viewNode call), other kinds just expose nodeId + kind.
  // No proximity listings, no "this is what the user means by 'this'"
  // prose — the BOARD_AGENT system prompt covers that once, here we
  // just deliver IDs.
  const nodeCtxs = activeContexts.filter((c) => c?.kind === 'node');
  const activeIds = nodeCtxs.map((c) => c?.id).filter((id) => typeof id === 'string' && id);
  if (activeIds.length > 0) {
    const activeNodeRows = await sql`
      SELECT id, kind, meta
      FROM nodes
      WHERE id = ANY(${activeIds}) AND board_id = ${boardId}
    `;
    // The user SELECTED these nodes (shown as chips in the chat). That
    // selection is the target of the request — the agent must apply the
    // request to the selected node(s) and NOT ask which one, unless the
    // user clearly names a different node. With exactly one selected node,
    // say so unambiguously.
    const single = activeNodeRows.length === 1;
    for (const n of activeNodeRows) {
      const name = n.meta?.name || n.kind;
      const assetId = n.kind === 'asset' ? (n.meta?.assetId || null) : null;
      const lead = single
        ? `The user SELECTED this node (its chip is shown in the chat) — apply the request to it; do NOT ask which one`
        : `The user SELECTED this node (chip shown) — the request targets the selected node(s)`;
      if (assetId) {
        lines.push(`[${lead}: image asset "${name}" nodeId=${n.id} assetId=${assetId}.]`);
      } else {
        lines.push(`[${lead}: ${n.kind} "${name}" nodeId=${n.id}.]`);
      }
    }
  }

  return lines.join('\n');
}

// How many prior turns to replay into the agent's context. The thread persists
// across page loads / sessions, so this is a sliding window — enough for
// continuity without unbounded token growth.
const HISTORY_LIMIT = 20;
const HISTORY_MSG_CAP = 4000; // chars per replayed message

/**
 * Convert persisted chat_messages rows into LLM message turns. Text-only: we
 * replay the conversational prose (user asks, assistant answers) so the agent
 * REMEMBERS the thread — without this each message was an amnesiac fresh start
 * and the agent re-asked "which node?" even right after the user answered.
 * Prior tool calls/results are NOT replayed (re-derived on demand). Skips
 * empty rows (tool-only assistant turns) and non-user/assistant roles.
 */
export function historyToLLMMessages(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const m of rows) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = (m.content ?? '').toString().trim();
    if (!text) continue;
    out.push({
      role: m.role,
      content: text.length > HISTORY_MSG_CAP ? text.slice(0, HISTORY_MSG_CAP) + '…' : text,
    });
  }
  return out;
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
    activeContexts = null,
    modelId = null,        // chat dropdown pick — drives the assistant model
  } = body || {};

  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 });
  const hasText = !!message?.trim();
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!hasText && !hasAttachments) return NextResponse.json({ error: 'message or attachments required' }, { status: 400 });

  // Input size validation — prevents two attack classes:
  //   1. Token-bomb: user pastes 5MB of text to burn agent tokens (each turn
  //      can blow the wall-clock cap and rack up bills before fail-fast).
  //   2. Memory exhaustion: huge JSON payloads can OOM the route worker.
  // Caps:
  //   - text message: 16k chars (~4k tokens) — enough for thoughtful prompts,
  //     well below any realistic abuse pattern.
  //   - attachments: 6 images max, 10MB each (the dataUrl base64 inflates 33%,
  //     so 10MB ≈ 7.5MB raw; matches what gpt-image-1 accepts).
  //   - activeContexts: 64 entries (user can't realistically select more).
  const MAX_MESSAGE_CHARS = 16_000;
  const MAX_ATTACHMENTS = 6;
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
  const MAX_ACTIVE_CONTEXTS = 64;
  if (hasText && message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: `message exceeds ${MAX_MESSAGE_CHARS} characters` }, { status: 413 });
  }
  if (hasAttachments) {
    if (attachments.length > MAX_ATTACHMENTS) {
      return NextResponse.json({ error: `too many attachments (max ${MAX_ATTACHMENTS})` }, { status: 413 });
    }
    for (const a of attachments) {
      if (typeof a?.dataUrl === 'string' && a.dataUrl.length > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: 'attachment exceeds 10MB' }, { status: 413 });
      }
    }
  }
  if (Array.isArray(activeContexts) && activeContexts.length > MAX_ACTIVE_CONTEXTS) {
    return NextResponse.json({ error: `too many activeContexts (max ${MAX_ACTIVE_CONTEXTS})` }, { status: 413 });
  }

  // Per-user rate limit. Caps cost-attack speed and accidental hammering.
  // Returns 429 with a Retry-After hint when exceeded. Fails open if
  // Upstash isn't configured (warns once in dev/staging).
  const rl = await checkRateLimit({
    key: `chat:user:${user.id}`,
    limit: CHAT_POLICY.limit,
    windowSec: CHAT_POLICY.windowSec,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', message: `Too many chat turns. Wait a moment and try again.` },
      { status: 429, headers: { 'Retry-After': String(CHAT_POLICY.windowSec) } }
    );
  }

  // Pre-filter pipeline. Run in parallel (each ~100-500ms) so the cumulative
  // gate stays well under a second:
  //   1. OpenAI Moderation — blocks content that violates LLM provider TOS
  //      (CSAM, real-world violence, etc.); free.
  //   2. LLM Guard — prompt-injection scan + PII sanitization (anonymize);
  //      requires LLM_GUARD_URL sidecar to be active.
  // Both fail OPEN when unavailable — security gates shouldn't take down
  // the whole chat.
  let sanitizedMessage = message;
  if (hasText) {
    const [mod, guard] = await Promise.all([
      moderateText(message),
      scanPrompt(message),
    ]);
    if (mod.flagged) {
      const cats = flaggedCategories(mod).join(', ') || 'content policy';
      return NextResponse.json(
        { error: 'content_policy', message: `Mensagem bloqueada por política de conteúdo (${cats}).` },
        { status: 400 }
      );
    }
    if (guard.ok === false) {
      return NextResponse.json(
        { error: 'prompt_blocked', message: guard.reason || 'Sua mensagem foi bloqueada pela proteção de prompt.' },
        { status: 400 }
      );
    }
    // LLM Guard may have redacted PII; downstream uses the sanitized text.
    if (guard.sanitizedPrompt && guard.sanitizedPrompt !== message) {
      sanitizedMessage = guard.sanitizedPrompt;
    }
  }

  // The agent's orchestrating model is OUR choice (cost/quality), not the
  // user's picker. The picker on PromptDock chooses which model runs
  // INSIDE a node when the agent calls runFlow/createImage — that's a
  // different concern handled by run-flow.js / image gen routes.
  // Picker scope (refined 2026-07-22): the chat dropdown governs SITE
  // CREATION only — it reaches compose/edit/image tools as ctx.pickerModel.
  // The ORCHESTRATOR (this assistant: tool calls, node orchestration,
  // extracts) always runs on the tier ladder, never on the picker.
  let resolvedModel = getAgentModel(user);
  // The operation decides BOTH the primary model exception and the failover
  // contract below (clone → never Flash; enterprise → fail closed).
  const operation = resolveOperation({ message, hasText, user });
  // Clones ALWAYS run on Opus — it gives the best reconstruction and narrates
  // the capture. A clone/capture request forces Opus over the picker/tier.
  // (The reconstruction pipeline itself stays gpt-5.5; this is the chat agent.)
  if (operation === 'clone') resolvedModel = CLONE_AGENT_MODEL;
  if (!/^(claude|opus|sonnet|haiku|gpt|gemini)/i.test(resolvedModel)) {
    return NextResponse.json({ error: `unsupported model: ${resolvedModel}` }, { status: 500 });
  }

  // Chat is FREE but fenced (spec §5): burst + daily light-turn windows read
  // straight from usage_events, so no extra infrastructure.
  const chatRate = await checkChatRate({ sql, userId: user.id });
  if (!chatRate.allowed) {
    const detail = chatRate.reason === 'daily_light_turns'
      ? 'Daily free chat limit reached — paid operations are still available.'
      : 'Slow down a little — too many messages in the last minute.';
    return NextResponse.json({ error: 'rate_limited', reason: chatRate.reason, detail }, { status: 429 });
  }

  // Route to the correct provider adapter based on the resolved model.
  const resolved = resolveAdapter(resolvedModel);
  if (resolved.error) {
    return NextResponse.json({ error: resolved.error }, { status: 500 });
  }

  const thread = await getOrCreateActiveThread({ boardId, userId: user.id, scope: threadScope, assetId });

  // Replay recent conversation so the agent has MEMORY across turns. Loaded
  // BEFORE we append the current message below, so the current turn isn't
  // duplicated into the history. This is the fix for the amnesiac loop where
  // the agent re-asked "which node?" right after the user answered.
  const priorRows = await loadMessages({ threadId: thread.id, limit: HISTORY_LIMIT });
  const historyMessages = historyToLLMMessages(priorRows);

  // Persist the user message immediately so it's visible on reload even if the run errors out.
  // Attachments are NOT persisted yet — they only travel with this turn so the agent can see
  // them. The result (asset nodes, generated images) IS the durable record.
  // Persist the SANITIZED message (LLM Guard may have anonymized PII). The
  // chat_messages row is what gets exported on LGPD right-to-access, so we
  // store the redacted version everywhere except the agent's working copy.
  const persistedText = hasText
    ? sanitizedMessage
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

  // Resolve the dataUrls of any IMAGE assets the user has selected as
  // active context. We feed those bytes to the agent as multimodal
  // image blocks even when the user didn't attach anything in chat —
  // otherwise the agent can only "read about" the selection via assetId
  // text, which is what made it operate blind in cheap models.
  //
  // The cap matches gpt-image-1's own image-edit input limit (4): if
  // the user selects more than 4 assets, the agent can't fit them in
  // an edit call anyway, so injecting more than 4 just wastes tokens.
  // For 1-4 active assets we inject ALL of them — multi-image flows
  // (base + style refs) are first-class.
  const CONTEXT_IMAGE_CAP = 4;
  const contextImages = [];
  if (Array.isArray(activeContexts) && activeContexts.length > 0) {
    const activeNodeIds = activeContexts
      .filter((c) => c?.kind === 'node' && typeof c.id === 'string')
      .map((c) => c.id);
    if (activeNodeIds.length > 0) {
      const rows = await sql`
        SELECT n.id AS node_id, n.meta AS node_meta,
               (n.meta->>'assetId') AS asset_id
        FROM nodes n
        WHERE n.id = ANY(${activeNodeIds})
          AND n.board_id = ${boardId}
          AND n.kind = 'asset'
      `;
      const assetIds = rows.map((r) => r.asset_id).filter((s) => typeof s === 'string' && s);
      let assetMetaById = new Map();
      if (assetIds.length > 0) {
        const aRows = await sql`SELECT id, meta FROM assets WHERE id = ANY(${assetIds}) AND user_id = ${user.id}`;
        assetMetaById = new Map(aRows.map((a) => [a.id, a.meta || {}]));
      }
      for (const r of rows) {
        if (contextImages.length >= CONTEXT_IMAGE_CAP) break;
        const aMeta = assetMetaById.get(r.asset_id) || {};
        const dataUrl = aMeta.dataUrl || r.node_meta?.dataUrl || null;
        if (typeof dataUrl !== 'string' || !dataUrl) continue;
        const mimeType = aMeta.mimeType || r.node_meta?.mimeType
          || (/^data:([^;]+);/.exec(dataUrl)?.[1])
          || 'image/png';
        const name = r.node_meta?.name || 'active';
        let assetId = r.asset_id;
        // Orphan backfill: image nodes dropped straight on the canvas (ghost
        // placement / uploads) carry the dataUrl in node meta but have NO
        // assets row — so the agent could SEE the image yet couldn't use it
        // as createImage base ("assetId=null"). Create the asset row on the
        // fly and link it, so a selected image is always actionable.
        if (!assetId) {
          try {
            const backfillMeta = { dataUrl, mimeType, source: 'canvas-upload-backfill' };
            const [assetRow] = await sql`
              INSERT INTO assets (user_id, project_id, type, name, meta)
              VALUES (${user.id}, ${boardId}, 'image', ${name}, ${JSON.stringify(backfillMeta)}::jsonb)
              RETURNING id
            `;
            assetId = assetRow.id;
            await sql`UPDATE nodes SET meta = meta || ${JSON.stringify({ assetId })}::jsonb WHERE id = ${r.node_id}`;
          } catch (e) {
            console.warn('[chat] orphan asset backfill failed', e?.message || e);
          }
        }
        contextImages.push({ kind: 'image', dataUrl, mimeType, name, nodeId: r.node_id, assetId });
      }

      // SITE nodes: the agent can't "see" a site from truncated HTML the way
      // it sees an image from its dataUrl — that's what made it blind to a
      // selected clone ("preciso enxergar o conteúdo — o snapshot foi
      // truncado"). Attach a rendered screenshot of the node's current
      // snapshot as a context image. Capture-sourced snapshots already carry
      // one in screenshot_url; everything else is rendered headless once and
      // cached back on the snapshot row.
      const SITE_CONTEXT_CAP = 2;
      let sitesAttached = 0;
      const siteRows = await sql`
        SELECT n.id AS node_id, n.meta AS node_meta,
               s.id AS snapshot_id, s.html, s.screenshot_url
        FROM nodes n
        JOIN snapshots s ON s.id = n.current_snapshot_id
        WHERE n.id = ANY(${activeNodeIds})
          AND n.board_id = ${boardId}
          AND n.kind = 'site'
      `;
      for (const r of siteRows) {
        if (sitesAttached >= SITE_CONTEXT_CAP || contextImages.length >= CONTEXT_IMAGE_CAP) break;
        const name = r.node_meta?.name || 'site';
        let shot = (typeof r.screenshot_url === 'string' && r.screenshot_url.startsWith('data:'))
          ? r.screenshot_url
          : null;
        if (!shot && typeof r.html === 'string' && r.html.trim()) {
          try {
            // baseUrl so relative assets (reconstruct /rasters/…) resolve —
            // without it the agent "saw" broken-image icons.
            shot = await renderHtmlScreenshot(r.html, { baseUrl: new URL(request.url).origin });
            await sql`UPDATE snapshots SET screenshot_url = ${shot} WHERE id = ${r.snapshot_id}`;
          } catch (e) {
            console.warn('[chat] site context render failed', e?.message || e);
          }
        }
        if (!shot) continue;
        contextImages.push({
          kind: 'image', dataUrl: shot, mimeType: 'image/png', name,
          nodeId: r.node_id, assetId: null, isSiteRender: true,
        });
        sitesAttached++;
      }
    }
  }

  // Build the message history for the LLM. When attachments are present the
  // user content becomes an Anthropic-style array of blocks: one text block
  // (the typed message + a hint about persisted assetIds + the fact that the
  // node already lives on the canvas, or a default cue if user only attached
  // without text) plus one image block per attachment. Each adapter
  // translates this shape into its provider's native multimodal format.
  // Surgical context hint resolved server-side from activeContexts:
  // active selection ids + workflow terminal info when a section is
  // selected. Everything else (board listings, proximity, viewing
  // other nodes, etc.) is on-demand via the exploration tools.
  // Two cheap, independent context hints, fetched concurrently so the added
  // latency stays flat:
  //   - workflow hint: active selection + workflow terminal (always).
  //   - board summary: a one-line overview of every node, so the agent
  //     skips its reflexive `listBoard` reconnaissance turn. Board-scope
  //     only — asset-scoped Smart Edit chats don't reason over the graph.
  const [workflowHint, boardSummary] = await Promise.all([
    buildWorkflowHint({ activeContexts, sql, userId: user.id, boardId }),
    threadScope === 'board'
      ? buildBoardSummary({ sql, boardId })
      : Promise.resolve(''),
  ]);
  // Broad context first (board shape), then the specific selection/workflow
  // hint closest to the user's message.
  const fullHint = [boardSummary, workflowHint].filter(Boolean).join('\n');
  const hasContextImages = contextImages.length > 0;
  const goesMultimodal = hasAttachments || hasContextImages;
  let initialMessages;
  if (goesMultimodal) {
    let textPart = hasText
      ? sanitizedMessage
      : (hasAttachments
        ? 'Anexei a(s) imagem(s) acima. Use seu próprio julgamento sobre o que fazer com ela(s).'
        : 'Veja a(s) imagem(s) do meu contexto ativo acima.');
    if (persistedAttachmentAssets.length) {
      const inv = persistedAttachmentAssets
        .map((a) => `assetId=${a.id}${a.nodeId ? `, nodeId=${a.nodeId}` : ''} (${a.name})`)
        .join('; ');
      textPart += `\n\n[The attached image(s) are ALREADY on the canvas as asset nodes. Do NOT call createNode for them — they exist. Inventory: ${inv}. Use the assetId as baseImageAssetId in createImage when doing image-to-image edits / style transfer.]`;
    }
    if (hasContextImages) {
      const inv = contextImages
        .map((c) => c.isSiteRender
          ? `nodeId=${c.nodeId} ("${c.name}") — RENDERED SCREENSHOT of this site node's current HTML`
          : `assetId=${c.assetId} nodeId=${c.nodeId} ("${c.name}")`)
        .join('; ');
      textPart += `\n\n[The image(s) below this text are the user's ACTIVE CONTEXT — already on the canvas. You can SEE them now. Inventory: ${inv}. Image assets: use the assetId in createImage calls. Site renders: this is what the site node currently LOOKS like — describe/act on it from the render, and use getNodeOutput/runFlow/editSite on the nodeId to work with its HTML.]`;
    }
    if (fullHint) textPart = `${fullHint}\n\n${textPart}`;
    const blocks = [{ type: 'text', text: textPart }];
    if (hasAttachments) {
      for (const a of attachments) {
        if (a?.kind === 'image' && typeof a.dataUrl === 'string') {
          blocks.push({ type: 'image', dataUrl: a.dataUrl, name: a.name, mimeType: a.mimeType });
        }
      }
    }
    for (const c of contextImages) {
      blocks.push({ type: 'image', dataUrl: c.dataUrl, name: c.name, mimeType: c.mimeType });
    }
    initialMessages = [...historyMessages, { role: 'user', content: blocks }];
  } else {
    const text = fullHint ? `${fullHint}\n\n${sanitizedMessage}` : sanitizedMessage;
    initialMessages = [...historyMessages, { role: 'user', content: text }];
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
      // Meter-only wrapper (spec §5): the conversation is FREE but every
      // provider call the adapters make records usage into this context.
      // Billable tools (runFlow/createImage/editSite) open their OWN billed
      // context inside — innermost wins, so their usage never lands here.
      await runMeteredOperation({ sql, userId: user.id, op: 'chat', boardId }, async () => {
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

      // Outer hard cap on the whole agent run. If runAgentLoop's own
      // wall_timeout, per-tool cap, and per-LLM 4-min cap somehow
      // all miss, this is the last line of defense to keep the SSE
      // stream from staying open for 20+ minutes. Must stay ABOVE the
      // driver's wallTimeoutMs (10min) so the driver's clean wall_timeout
      // fires first — this cap dying first produces an opaque hard_cap
      // error instead.
      const RUN_HARD_CAP_MS = 12 * 60 * 1000;
      // Alternate providers the driver falls over to when the primary returns
      // a retriable error mid-run (the depleted-prepaid-credits case is the
      // motivating one). Which alternates are ALLOWED is the operation's
      // policy — clone never degrades to Flash; enterprise fails closed.
      const failoverPolicy = FAILOVER_POLICIES[operation] || FAILOVER_POLICIES.chat;
      const agentFallbacks = buildAgentFallbacks({
        policy: failoverPolicy, primaryLabel: resolved.providerLabel, registry, toolAllowlist,
      });
      const loopPromise = runAgentLoop({
        llm: resolved.adapter,
        registry,
        systemPrompt,
        messages: initialMessages,
        modelId: resolvedModel,
        apiKey: resolved.apiKey,
        providerLabel: resolved.providerLabel,
        fallbacks: agentFallbacks,
        unavailableMessage: failoverPolicy.unavailableMessage,
        // pickerModel = the user's EXPLICIT dock selection (raw, un-aliased).
        // Tools that route to a provider (createImage) assume it instead of
        // asking — the conversation model can diverge from the picker (clone
        // requests force Opus) and must not resurface the provider question.
        ctx: { boardId, userId: user.id, conversationModel: resolvedModel, pickerModel: modelId || null },
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
            case 'custom_emit':
              // A tool fired an arbitrary SSE event mid-execution. Pass it
              // straight through to the client so things like graph_mutated
              // can flow without waiting for the tool to complete.
              send(ev.name, ev.payload || {});
              break;
            case 'message_complete':
              break;
            case 'provider_failover':
              // The primary provider failed mid-run; the driver switched to a
              // backup. Surface it so the client can optionally note the
              // degraded-mode switch. Unknown event types are ignored client-side.
              send('provider_failover', { from: ev.from, to: ev.to, reason: ev.reason, iter: ev.iter });
              break;
            case 'run_status':
              send('run_status', { status: ev.status, err: ev.err });
              break;
          }
        },
      });
      try {
        loopResult = await Promise.race([
          loopPromise,
          new Promise((_, reject) => setTimeout(
            () => reject(new Error(`agent run exceeded ${RUN_HARD_CAP_MS / 1000}s`)),
            RUN_HARD_CAP_MS,
          )),
        ]);
      } catch (e) {
        // Hard cap fired — surface a clean error to the client and let
        // the outer catch finish up the run rows + close the SSE.
        send('run_status', { status: 'failed', err: e?.message || 'hard_cap' });
        loopResult = { stop_reason: 'failed', iterations: 0, usage: { input_tokens: 0, output_tokens: 0 }, toolCounts: {} };
      }

      const tokensIn  = loopResult.usage?.input_tokens  || 0;
      const tokensOut = loopResult.usage?.output_tokens || 0;

      const finalStatus = mapLoopResultToRunStatus(loopResult.stop_reason);
      await finishAgentRun({
        runId,
        status: finalStatus,
        iterations: loopResult.iterations,
        toolCallCounts: loopResult.toolCounts || {},
        tokensIn,
        tokensOut,
      });
      const toolCallsForPersistence = Array.from(toolCallMap.values());
      await appendMessage({
        threadId: thread.id,
        role: 'assistant',
        content: accumulatedText,
        toolCalls: toolCallsForPersistence.length > 0 ? toolCallsForPersistence : null,
        // The model that actually SERVED the run — after a failover this
        // differs from the promised primary, and the durable record must
        // tell the truth (adversarial-review find: it used to log Opus for
        // runs GPT-5.5 carried).
        model: loopResult.usedModelId || resolvedModel,
        agentRunId: runId,
      });
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
      // Langfuse batches events — flush BEFORE close() so the SSE
      // response doesn't tear down the serverless worker while traces
      // are still queued.
      try { await flushLangfuse(); } catch (_) {}
      close();
    }
  })();

  return new Response(stream, { headers: SSE_HEADERS });
}
