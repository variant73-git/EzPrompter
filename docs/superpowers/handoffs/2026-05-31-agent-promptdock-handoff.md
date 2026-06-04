# Agent PromptDock — Handoff for Next Session

> Written 2026-05-31 after Phase 1 + 5a shipped. Branch: `feat/canvas` (26 commits ahead, head `2a1788d`). All tests green: 62/62.

## What state you're picking up

The agent chat is **functional end-to-end** in the canvas PromptDock. User can type "cria 3 nodes website e conecta" and the agent does it. Conversation persists per board. Canvas refetches + auto-frames new nodes at end of each turn. Errors surface inline as `⚠️` bubbles. Chat panel auto-collapses after each turn back to compact input.

Default model: **Gemini 2.5 Flash** (`UNCRAFT_AGENT_MODEL` env override). User has OpenAI + Gemini keys; Anthropic key set but creditless.

**The 6 tools currently wired** (all `safe`, auto-execute):
`createNode` (with semantic `type` enum), `addEdge`, `updateNode`, `queryNodes`, `getNodeOutput`, `listAssets`.

## Read first

1. **Spec** — `docs/superpowers/specs/2026-05-31-agent-promptdock-design.md` (16 sections, source of truth)
2. **Phase 1 plan** — `docs/superpowers/plans/2026-05-31-agent-promptdock-phase1.md` (executed)
3. **This session's memo** — `~/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/memory/checkpoint_2026-05-31_046.md`
4. **CLAUDE.md item 128** — the one-line index entry

## File map

```
packages/web-shell/
├── app/api/chat/
│   ├── route.js                  POST (SSE) + GET (load thread). AGENT_MODEL env override here.
│   ├── route.test.js             GET tests
│   └── route.post.test.js        POST + provider routing tests
├── lib/
│   ├── agent/
│   │   ├── driver.js             Generic LLM-agnostic agent loop
│   │   ├── registry.js           Tool registry + toAnthropicSpec/toOpenAISpec/toGeminiSpec
│   │   ├── prompts.js            BOARD_AGENT, EDIT_IMAGE_SYSTEM, EDIT_SITE_SYSTEM
│   │   ├── sse-bridge.js         SSE writer helper
│   │   ├── llm-anthropic.js      Anthropic adapter (streaming + tool-use)
│   │   ├── llm-openai.js         OpenAI adapter (chat.completions + tool_calls)
│   │   ├── llm-gemini.js         Gemini adapter (generateContentStream + functionCall)
│   │   └── tools/
│   │       ├── index.js          buildSafeRegistry() — wires the 6 tools
│   │       ├── create-node.js    Semantic `type` enum, seeds BLANK_SITE_HTML for blank-website
│   │       ├── add-edge.js
│   │       ├── update-node.js
│   │       ├── query-nodes.js
│   │       ├── get-node-output.js  Truncates to maxChars to keep context manageable
│   │       └── list-assets.js
│   ├── chat-persistence.js       getOrCreateActiveThread, appendMessage, loadMessages, archiveActiveThread
│   ├── chat-client.js            EventSource wrapper (typed events, unused by PromptDock for now — POST uses fetch)
│   └── blank-site-html.js        Shared seed HTML + defaults — both "+" button + agent use this
├── components/
│   ├── PromptDock.jsx            Chat reducer, sendChatMessage SSE reader, ChatPanel wiring, collapse state
│   ├── CanvasClient.jsx          onAgentMutatedGraph callback (refetch + auto-frame new nodes)
│   ├── CanvasNode.jsx            cnode-empty branch (kept as safety fallback)
│   └── chat/
│       ├── ChatPanel.jsx         Auto-scroll on changes, chevron collapse button
│       ├── ChatBubble.jsx
│       ├── ToolChip.jsx          pending/running/done/error states (done now grey, was green)
│       └── chat.css
├── schema.sql                    chat_threads, chat_messages, agent_runs tables added
└── vitest.config.js, vitest.setup.js
```

## Things actively flagged for follow-up

### Hot follow-ups (probably first thing to tackle)

1. **Remove the debug log** in `PromptDock.jsx:296` (`console.log('[chat-sse]', name, payload)`). Was added to debug Gemini Flash behavior — leave only if you're still iterating on adapter reliability.

2. **Tool-use telemetry visible**: `tool-chip-summary` shows short results, but tool calls in chat history (loaded from DB on reload) only see the user message — the agent's assistant message + tool calls + tool results aren't persisted. So reload shows truncated history. Fix in **Phase 5b** below.

3. **Edge kind divergence** (per commit `2c600f5`): agent inserts edges with `kind='generic'` via direct SQL, bypassing the `/api/edges` route's allow-list. Won't bite until runFlow tool (Phase 2) needs edge kinds to drive composition. Then either widen the route allow-list to include `'generic'`, or change tool default to `'transplant'`.

### Next phases per spec (Phase 2-5)

Pick one when you're ready. Each is a new plan + execution.

**Phase 2 — destructive tools + caps**
- `deleteNode`, `runFlow`, `editSite`, `createImage` (real)
- Confirm chip in ToolChip (`awaiting_confirm`, `awaiting_choice`, `skipped` states already designed in spec)
- SSE pause/resume via `POST /api/chat/confirm`
- Soft pause at 10 iter / hard kill at 50 / 3 retries / 5min wall (env-configurable)
- `agent_runs` table actually populated (currently empty — Phase 1 stub)

**Phase 3 — image gen**
- `POST /api/images/generate` route with provider routing (Gemini Imagen + OpenAI gpt-image-1)
- `createImage` tool — when conversation model is Claude + `provider:'auto'`, emit `needs_choice` event
- `attachToBoard:true` flag creates asset node on the canvas

**Phase 4 — Smart Edit chat dock**
- Existing `buildAssetChatDock()` in `editor.js` already has UI (textarea + model picker + send). Currently silently fails in canvas (`if (typeof chrome === 'undefined') return;`)
- Replace `chrome.runtime.sendMessage({action:'generateImage'})` with `POST /api/chat` carrying `threadScope: 'asset'` + `assetId` + `tools: ['createImage', 'getNodeOutput']` + `systemPromptKey: 'EDIT_IMAGE_SYSTEM'`
- Server: add asset-scoped thread support (already in schema — `chat_threads.scope='asset', asset_id NOT NULL`)

**Phase 5b — history reconstruction**
- Currently `appendMessage({role: 'assistant', content: ''})` saves empty stub at end of run. Should save the full assistant message with tool_calls JSONB + add separate `role: 'tool'` messages per tool result
- Reload should reconstruct the full conversation visually

**Phase 5c — cost tracking + credits**
- `agent_runs.{tokens_in, tokens_out, cost_cents}` columns exist but never written
- Add a `lib/agent-cost.js` price table; driver tallies usage from `message_complete` events; route persists at run end
- `lib/credits.js` decrements user balance; POST /api/chat returns 402 if balance would go negative
- Tier ladder routing in `getAgentModel()`:
  ```js
  function getAgentModel(user) {
    if (user.plan === 'free') return 'gemini-2.5-flash';
    if (user.plan === 'pro')  return 'deepseek-chat';
    return 'claude-sonnet-4-6';  // enterprise
  }
  ```

### DeepSeek wiring (15 min when you want a cheaper "pro" tier)

DeepSeek is OpenAI-compatible. Three changes:
1. Add to `MODEL_ALIAS`: `'deepseek-chat': 'deepseek-chat'`
2. Extend `resolveAdapter()` with a deepseek branch that uses `callOpenAI` but passes `baseURL: 'https://api.deepseek.com'` (need to thread baseURL through llm-openai.js — currently it instantiates OpenAI client without baseURL override; ~5 line change)
3. Add `DEEPSEEK_API_KEY` to `.env.local` (user gets one from platform.deepseek.com, $5 min top-up)

## How to run / develop

```bash
# Already running in background (task bo1s8gaax). If not:
cd packages/web-shell && npm run dev
# → http://localhost:3030/canvas/<board-id>

# Tests:
npm --prefix packages/web-shell test

# Override agent model (e.g. when Anthropic credits land):
# Add to packages/web-shell/.env.local:
#   UNCRAFT_AGENT_MODEL=claude-sonnet-4-6
# Then restart dev.
```

## Things NOT to do (lessons from this session)

- **Don't refetch on every tool done** — was the cause of canvas freeze. Tearing down TransformWrapper state mid-stream. Refetch ONCE at end of run.
- **Don't expose raw `kind` / `meta` to the agent in tools** — was the cause of agent creating orange "html-origin" nodes when user said "blank website". Use semantic `type` enum that wraps the storage primitive.
- **Don't put green on every successful tool chip** — read as "feedback pill" the user wanted gone. Neutral grey for done state.
- **Don't put `.chat-panel` border** — created visible line above input that read as "form field outline". Panel sits transparent over dock's existing chrome.
- **Don't make chat panel `max-height: 60vh`** — `.prompt-dock` is in `NATIVE_WHEEL_SELECTOR` so any area it covers is dead to canvas wheel. 28vh is the safe ceiling. Even safer: don't keep panel expanded after turn ends (auto-collapse landed this session).
- **Don't hardcode `toAnthropicSpec()` in driver** — broke OpenAI/Gemini with 400 "Missing required parameter 'tools[0].type'". Route picks emitter based on `providerLabel`.

## Suggested next pickup

If unclear, **start with Phase 2** (destructive tools + confirm flow). It's the largest chunk of value remaining: lets the agent actually edit/delete/runFlow on the user's behalf, with safety. Plus the SSE pause/resume mechanism is reusable across all destructive flows in later phases.

If user wants polish/quality first instead, **Phase 5b (history reconstruction)** is small and removes a visible papercut: chat history shows full agent replies + tool calls on reload, instead of empty assistant stubs.
