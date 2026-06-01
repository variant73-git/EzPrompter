# Agent PromptDock — Handoff for Phase 3+ (after Phase 2 ships)

> Written 2026-05-31 right after Phase 2 (destructive tools + pause/resume + caps + persistence) shipped on branch `feat/canvas`, 17 commits `8891f33`→`d34f7f9`. All 113 tests green.

## What state you're picking up

The agent chat is now end-to-end functional for the FULL Phase-1 + Phase-2 tool surface:
- **6 safe tools** auto-execute (createNode with semantic type, addEdge, updateNode, queryNodes, getNodeOutput, listAssets)
- **3 destructive tools** pause for user confirmation (deleteNode, runFlow, editSite)
- **Soft-pause** at every 10 iterations with breakdown + Continue/Stop chip
- **Hard kill** at 50 iterations
- **Per-tool retry budget** of 3 — 4th call short-circuits with `too_many_failures`
- **Wall-clock timeout** of 5min (run gets `failed` status, no zombie loops)
- **Cancel** mid-run via `POST /api/chat/cancel`
- **agent_runs** table tracks status transitions + iterations + tool_call_counts + completed_at

Configurable env vars: `UNCRAFT_AGENT_SOFT_ITER`, `UNCRAFT_AGENT_HARD_ITER`, `UNCRAFT_AGENT_RETRY_BUDGET`, `UNCRAFT_AGENT_WALL_TIMEOUT_MS`.

Default agent model: still **Gemini 2.5 Flash** (`UNCRAFT_AGENT_MODEL` env override). Picker is separate from agent model.

## Smoke tests not yet run

The plan §8 has 5 manual smoke tests that need the user to validate in browser:
1. Confirm flow — `delete the blank website node` → amber chip + Confirm/Skip
2. Soft-pause cap=2 — `create 5 prompt nodes` → SoftPauseChip every 2 iter
3. Hard kill cap=3 — same prompt → run_status: hard_limited at 3
4. Cancel mid-run — devtools fetch /api/chat/cancel
5. DB verification — `psql … SELECT … FROM agent_runs ORDER BY started_at DESC LIMIT 5`

These should be the first thing you do in the next session before building on top.

## File map (new in Phase 2)

```
packages/web-shell/
├── app/api/chat/
│   ├── confirm/route.js          POST — resolveConfirm/resolveChoice + 204
│   ├── confirm/route.test.js     4 tests
│   ├── continue/route.js         POST — resolveContinue + 204
│   ├── continue/route.test.js    4 tests
│   ├── cancel/route.js           POST — cancelRun + 204
│   ├── cancel/route.test.js      3 tests
│   ├── route.js                  Phase 2 wiring (registerRun, getCaps, full registry, finishAgentRun, new SSE events)
│   └── route.post.test.js        Phase 2 wiring test
├── lib/
│   ├── agent/
│   │   ├── run-map.js            Singleton Map<runId,handles> for pause/resume
│   │   ├── run-map.test.js       10 tests (8 original + 2 orphan-fix)
│   │   ├── caps.js               getCaps() from env
│   │   ├── caps.test.js          3 tests
│   │   ├── driver.js             Refactored for caps + destructive + retry + soft-pause + cancellation
│   │   ├── driver.test.js        8 tests (3 Phase 1 + 5 Phase 2)
│   │   └── tools/
│   │       ├── delete-node.js    Destructive — ownership-check + DELETE + summary
│   │       ├── delete-node.test.js  4 tests
│   │       ├── run-flow.js       Destructive — load incoming edges + runCompose + new snapshot
│   │       ├── run-flow.test.js  3 tests
│   │       ├── edit-site.js      Destructive — runCompose with EDIT_SITE_SYSTEM override; refuses when meta.editing=true
│   │       ├── edit-site.test.js 3 tests
│   │       └── index.js          buildFullRegistry() adds the 3 destructive on top of buildSafeRegistry
│   ├── chat-persistence.js       + startAgentRun/finishAgentRun/updateAgentRunStatus
│   └── run-flow.js               + systemPromptOverride param
├── app/api/edges/route.js        + 'generic' added to VALID_KINDS
└── components/
    ├── chat/
    │   ├── ToolChip.jsx          + awaiting_confirm/awaiting_choice/skipped + Confirm/Skip/Choice buttons
    │   ├── SoftPauseChip.jsx     New whole-run pause chip with breakdown
    │   ├── ChatPanel.jsx         + softPause/onSoftContinue/onSoftStop/onConfirmTool/onSkipTool/onChooseTool props
    │   └── chat.css              + new state colors + button styles + soft-pause chip styles
    └── PromptDock.jsx            + 6 reducer actions + 4 SSE event maps + 3 control-call helpers + ChatPanel callbacks
```

## Next phases (un-shipped)

### Phase 3 — image gen (most likely next)

- New: `POST /api/images/generate` with provider routing (Gemini Imagen + OpenAI gpt-image-1)
- New: `lib/agent/tools/create-image.js` — classification `'destructive'` BUT also `needs_choice` when conversation model is Claude + `provider:'auto'` (the driver already supports needs_choice — emits `needs_choice` SSE event with choices array)
- New: `attachToBoard:true` flag creates an asset node on the canvas at the cursor's last position
- The provider-router contract:
  ```
  provider='auto':
    if conversation model is Claude → emit needs_choice {Gemini, OpenAI}
    if Gemini → use Gemini Imagen direct
    if OpenAI → use gpt-image-1 direct
  provider='gemini': always Gemini
  provider='openai': always gpt-image-1
  provider='claude': error (Claude doesn't generate images)
  ```
- Cost recording → `agent_runs.cost_cents` (table column exists, never written)
- Spec §10 has the full provider routing logic

### Phase 4 — Smart Edit chat dock

- `buildAssetChatDock()` in `editor.js` already has UI (textarea + model picker + send arrow) — works in extension, silently fails in canvas (`if (typeof chrome === 'undefined') return;`)
- Replace the `chrome.runtime.sendMessage({action:'generateImage'})` with `POST /api/chat` carrying `{threadScope: 'asset', assetId, tools: ['createImage', 'getNodeOutput'], systemPromptKey: 'EDIT_IMAGE_SYSTEM'}`
- Asset-scoped threads already supported in schema (`chat_threads.scope='asset', asset_id NOT NULL`) and in `getOrCreateActiveThread`
- POST /api/chat already routes asset-scope to `buildSafeRegistry` — so Phase 4 just needs the UI wire-up

### Phase 5b — history reconstruction

- Currently `appendMessage({role:'assistant', content:''})` saves an empty stub at end of run with `agentRunId` set (the linking IS in place now in Phase 2). Phase 5b should:
  1. Populate `chat_messages.content` with the actual assistant text accumulated during streaming
  2. Save separate `role:'tool'` messages with `tool_call_id` + result JSON
  3. Build proper `tool_calls` JSONB on the assistant message
  4. On reload, ChatPanel reconstructs the tool chips + their results from these persisted messages

### Phase 5c — cost tracking + credits

- `agent_runs.{tokens_in, tokens_out, cost_cents}` columns exist + never written
- `lib/agent-cost.js` price table per model
- Driver tally usage from `message_complete` events
- Route persist tokens at run end
- `lib/credits.js` decrements user balance; route returns 402 if balance would go negative
- Tier ladder routing in `getAgentModel(user)`:
  ```js
  if (user.plan === 'free') return 'gemini-2.5-flash';
  if (user.plan === 'pro')  return 'deepseek-chat';
  return 'claude-sonnet-4-6';
  ```

### Phase 6 (if/when needed) — Redis-backed runMap

The current `lib/agent/run-map.js` is an in-memory singleton. Works for a single Next.js instance. If we ever horizontally scale, port the same shape to Redis (the API surface — `registerRun`/`awaitConfirm`/`resolveConfirm`/`cancelRun` — is provider-agnostic).

## Things actively flagged for follow-up

### Hot follow-ups from this session

1. **PromptDock UI may not handle `wall_timeout` / `cancelled` / `cancelled_softpause` statuses gracefully** — the code reviewer flagged this. `wall_timeout` shows as "failed" (correct-ish). `cancelled` paths may show no feedback. Quick fix in PromptDock's `run_status` handler: add specific message strings per status. Not blocking, but worth a 10-min polish pass.

2. **`unknown_tool` errors don't increment `toolFailures`** — if the LLM hallucinates a tool name repeatedly, only the soft-pause cap saves us. Acceptable for Phase 2 (no destructive tools are hallucinable from the registry), but worth a comment in driver.js.

3. **Smoke tests pending** — must run before declaring Phase 2 actually solid (see §8 in plan).

### Carry-overs from Phase 1 (still open)

- **History reconstruction** (Phase 5b) — visible regression: assistant messages don't show in reload
- **Tool-use telemetry persisted but not surfaced** — same root cause as history reconstruction

### Resolved follow-ups from Phase 1

- ✅ Follow-up #1 (debug log in PromptDock) — removed in commit 8891f33
- ✅ Follow-up #3 (edge kind divergence) — `/api/edges` allow-list widened to include 'generic' in commit 12c66c7

## Things NOT to do (lessons from this session)

- **Don't refetch on every tool done** (Phase 1 lesson, still applies) — refetch once at end of run
- **Don't expose raw `kind` / `meta` to the agent** (Phase 1 lesson) — use semantic `type` enum
- **Don't hardcode Anthropic spec emitter** in driver (Phase 5a lesson) — route picks via providerLabel
- **Don't orphan Promises** — `unregisterRun` must flush pending awaits via `cancelRun` first (caught in Phase 2 code review)
- **Don't put 60vh chat panel** in NATIVE_WHEEL_SELECTOR area (Phase 1 lesson) — 28vh ceiling
- **Don't skip the `finally { clearTimeout(wallTimer) }`** — node timer leaks fail vitest with detectOpenHandles

## How to run / develop

```bash
# Tests:
cd packages/web-shell && npm test
# Expected: 113/113 passing across 28 files

# Dev server:
cd packages/web-shell && npm run dev
# → http://localhost:3030/canvas/<board-id>

# Override caps for testing soft/hard limits:
# Add to packages/web-shell/.env.local:
#   UNCRAFT_AGENT_SOFT_ITER=2     # soft pause every 2 iterations
#   UNCRAFT_AGENT_HARD_ITER=5     # hard kill at 5
# Then restart dev.
```

## Suggested next pickup

**Phase 3 (image gen)** if you want to expand agent power — largest user-visible value.

**Phase 5b (history reconstruction)** if you want to fix the visible regression first — chat reload currently shows empty assistant bubbles.

Either way, run the smoke tests from §8 of the Phase 2 plan first. Cheap insurance.
