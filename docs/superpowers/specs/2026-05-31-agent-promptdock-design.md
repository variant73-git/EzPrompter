# Agent-driven PromptDock + Smart Edit chat — design spec

> **Slice 1 of the chat-agent feature** for Uncraft canvas. Brainstorm + design session 2026-05-30/31, branch `feat/canvas`. Implementation plan follows via `writing-plans`.

## 1. Summary

The bottom-of-canvas prompt input becomes a conversational agent that can build and operate the user's node graph on their behalf. The same engine powers the Smart Edit chat inside the image editor panel (with a reduced tool surface). Both are wired to the user's chosen LLM (Claude / GPT / Gemini / Kimi) and execute tool calls against existing Uncraft APIs.

## 2. Goals

- Conversational chat in the bottom PromptDock with full history per board.
- LLM operates Uncraft via 10 tools: create / read / update / delete nodes, add edges, query graph, get node output, list assets, run flows, edit live site content, generate images.
- "Hybrid approval": safe tools (graph reads + structural ops) auto-execute; destructive tools (run flow, delete, edit site, generate image) require user click before running.
- Smart Edit chat dock (inside the image-edit panel) uses the same backend, scoped to a single asset and a single tool (image generation).
- Cost is recorded but not yet charged. Hooks ready for the credits system in slice 2.
- Image generation uses providers we already integrate (Google, OpenAI); no new provider integration.

## 3. Non-goals (deferred)

- Credit system enforcement (recording only this slice).
- Resuming a paused agent run after a hard browser reload (run keeps going server-side; user sees the final result on next load but doesn't see live progress for that orphaned run).
- Multiple parallel threads per board (one active thread, archive-and-start-new only).
- "Continue" button on a soft-paused run that survives reload.
- ReAct-style narrative traces, planner+executor two-pass.
- Generic "input from user" tool pattern (only `createImage` provider-choice is wired; others use confirm/skip).
- Resume / replay an arbitrary historical run.

## 4. User experience (plain)

### Bottom chat — the main agent

User opens a board. The bottom of the canvas has the prompt input as it does today. They type "monte um workflow que clona stripe.com e gera 3 variantes de heading com claude" and press Enter.

The input area expands upward into a chat panel showing the bubbles. The agent (the model the user picked in the dropdown) writes back what it's doing as it does it: "I'll start by creating a website node for stripe…" — and small action chips appear inline showing each step (create node, add edge, run flow). Safe steps run automatically. The first time the agent wants to run a costly flow, an inline `[Confirm] [Skip] [Confirm + auto-OK all runFlow this turn]` chip appears and the agent pauses, waiting on the user.

After ~10 actions the agent pauses on its own and asks: "Did 10 things on your board so far (8 nodes, 2 edges). Continue?" with `[Continue] [Stop]`. This is a safety check-in, not a failure. After 50 actions total in one user message, the run hard-stops; user sends a new message to do more.

When the user opens the board next day, the chat is still there. They scroll up to see what they did. The "+ New thread" button archives the current thread and starts fresh.

### Smart Edit chat — the image-focused agent

User selects an image on the canvas, opens Smart Edit. The chat dock that was already there in the UI (textarea + model picker + send arrow) now actually works in the canvas (it was extension-only before). The user types "tira o background" and the agent generates a new image. Limited tools — it can't create nodes or edit sites from this surface; it's image-focused.

### Approval model

| Tool | Behavior |
|---|---|
| createNode, addEdge, updateNode, queryNodes, listAssets, getNodeOutput | Auto-execute, show ✓ chip |
| deleteNode, runFlow, editSite, createImage | Show confirm chip first, agent pauses, user clicks Confirm/Skip |
| createImage with Claude as conversation model and `provider:'auto'` | Show choice chip first: `[Gemini auto/cheaper] [GPT-5.5 expensive]` — Claude can't generate images so the image tool needs a different provider |

## 5. Architecture

### Engine: single-loop tool-use

The standard pattern supported by all three SDKs (Anthropic, OpenAI Chat Completions, Google `@google/genai`). One LLM call with tools attached → LLM emits text + tool calls in a stream → backend executes tools (or pauses on destructive/choice) → results sent back → loop until LLM stops emitting tool calls.

### HTTP shape

**`POST /api/chat`** — opens an SSE stream for one user message → one agent run.

Request body:
```jsonc
{
  "boardId": "...",
  "threadId": "...",      // optional; omit for first message in a new thread
  "threadScope": "board", // 'board' | 'asset' (Smart Edit uses 'asset')
  "assetId": "...",       // when scope='asset'
  "message": "user text",
  "modelId": "claude-4.6-opus",  // picker selection
  "tools": null            // null = full set; allowlist for Smart Edit, e.g. ['createImage','getNodeOutput']
}
```

SSE events emitted:
- `event: thread_id` — `{threadId}` (lets frontend save it when starting from null)
- `event: run_id` — `{runId}`
- `event: assistant_token` — `{delta: "..."}`
- `event: tool_call` — `{id, name, args, classification: 'safe'|'destructive'|'needs_choice'}`
- `event: tool_status` — `{id, status: 'running'|'done'|'error'|'skipped', result?, error?}`
- `event: needs_confirm` — `{id, summary, costEstimate?}`
- `event: needs_choice` — `{id, summary, choices: [{id, label, hint}]}`
- `event: needs_softlimit_continue` — `{id, iterationsSoFar, breakdown: {createNode: 5, runFlow: 1, ...}}`
- `event: run_status` — `{status: 'completed'|'failed'|'cancelled'|'hard_limited', err?}`

**`POST /api/chat/confirm`** — user clicked Confirm/Skip/choice button.

Request:
```jsonc
{ "runId": "...", "toolCallId": "...", "action": "confirm" | "skip", "choice"?: "gemini" }
```

Returns 204. The original `/api/chat` SSE connection continues emitting; the agent loop resumes inside the server.

**`POST /api/chat/continue`** — soft-pause approval. Same shape as confirm but for the run-level continuation.

**`POST /api/chat/cancel`** — `{runId}`. Marks run as cancelled, resolves the pending Promise.

**`POST /api/chat/new-thread`** — `{boardId}`. Archives current active thread for the board, returns `{threadId}` of the new one.

**`GET /api/chat?boardId=...`** — returns `{thread, messages}`. Pagination via `?before=msgId&limit=50`.

### Pause/resume

The agent loop runs inside the POST /api/chat handler (Node runtime). On a destructive/choice tool, the loop `await`s a Promise that's keyed by `toolCallId` in a `Map<runId, {confirm: Promise.resolve, choice?: Promise.resolve}>`. POST /api/chat/confirm looks up the runId, resolves the Promise with the user's decision. Loop continues. Hard timeout (5min wall) wraps the whole loop in `Promise.race` to guarantee no zombie runs.

Slice 1 = single Next.js instance. Slice 2 will move the Map to Redis if we ever scale horizontally.

## 6. Tool catalog

JSON Schemas live in `lib/agent-tools.js`. Each tool object:
```js
{
  name: 'createNode',
  description: 'Create a new node on the current board.',
  classification: 'safe' | 'destructive' | 'needs_choice',
  // JSON Schema (Anthropic, OpenAI, Gemini all accept this format directly)
  inputSchema: {...},
  // Server-side executor. ctx has {boardId, userId, db, conversationModel}.
  async execute(args, ctx) { ... }
}
```

The 10 tools:

| # | Name | Classification | Backend |
|---|---|---|---|
| 1 | `createNode({kind, name?, meta?, posX?, posY?})` | safe | reuses `POST /api/nodes` logic |
| 2 | `addEdge({fromNodeId, toNodeId, kind?})` | safe | reuses `POST /api/edges` |
| 3 | `updateNode({id, name?, meta?, posX?, posY?})` | safe | new `PATCH /api/nodes/[id]` (~20 lines) |
| 4 | `deleteNode({id})` | destructive | reuses `DELETE /api/nodes/[id]` |
| 5 | `runFlow({nodeId, modelId?})` | destructive | reuses `POST /api/nodes/[id]/run` |
| 6 | `queryNodes({kind?, namePattern?, limit?=30})` | safe | new helper over `nodes` table |
| 7 | `listAssets({scope?='library', kind?, limit?=20})` | safe | reuses asset GET logic |
| 8 | `getNodeOutput({nodeId, maxChars?=4000})` | safe | reads current snapshot text, truncates |
| 9 | `editSite({nodeId, instruction})` | destructive | wraps `runCompose` with `EDIT_SITE_SYSTEM` prompt + synthetic prompt-kind source |
| 10 | `createImage({prompt, aspectRatio?='1:1', provider?='auto', attachToBoard?=false})` | destructive (and `needs_choice` when conversation model is Claude + provider='auto') | new `POST /api/images/generate` route, routes to Gemini Imagen or OpenAI gpt-image-1; if `attachToBoard:true`, also creates an asset node on the board |

Each tool returns either a structured result object or a structured error: `{ error: 'too_many_failures'|'invalid_args'|'forbidden'|'rate_limited'|..., message: string }`. LLM sees these and decides the next move.

### Tool dispatch driver

```text
1. LLM emits tool_calls in stream.
2. For each tool_call:
   a. Look up tool in registry.
   b. Validate args against inputSchema.
   c. Check classification:
      - safe → execute, emit tool_status events.
      - destructive → emit needs_confirm, await POST /api/chat/confirm, then execute (or skip).
      - needs_choice (only createImage + Claude conversation + provider='auto') → emit needs_choice, await POST /api/chat/confirm with choice, then execute with chosen provider.
   d. Append the result as a 'tool' role message in chat_messages.
3. Send tool results back to the LLM (next iteration in the loop).
4. Increment agent_runs.iterations.
5. Check caps (see §7). If hit soft, emit needs_softlimit_continue and pause. If hit hard, abort.
6. If LLM responds with text only (no tool_calls), loop ends: persist final assistant message, mark agent_run completed.
```

## 7. Anti-loop caps

Per agent run (= per user message):

| Cap | Default | Behavior |
|---|---|---|
| Soft-pause iterations | 10 | Backend pauses, emits `needs_softlimit_continue` with breakdown ("8 nodes, 2 edges"). User clicks Continue (next pause at 20, then 30, etc.) or Stop. |
| Hard kill iterations | 50 | Backend aborts the loop, emits `run_status: hard_limited`. No way to continue this run; user starts a new message. |
| Per-tool retry budget | 3 | If `createNode` (any args) failed 3 times in this run, the 4th invocation returns `{error: 'too_many_failures'}` to the LLM without executing. |
| Wall-clock timeout | 5min | The whole agent run is wrapped in `Promise.race` against a 5min timer. Timer wins → cancel pending tool, mark `failed`, emit error to client. |

All four are env-configurable: `UNCRAFT_AGENT_SOFT_ITER`, `UNCRAFT_AGENT_HARD_ITER`, `UNCRAFT_AGENT_RETRY_BUDGET`, `UNCRAFT_AGENT_WALL_TIMEOUT_MS`. Per-tier overrides come in slice 2.

## 8. Chat UI (PromptDock)

### Layout (compact → expanded)

```
Compact (no chat yet):
┌──────────────────────────────────────────┐
│  ┃ what do you want to build?       ▸  │
│  [Sonnet 4.6 ▾]  [+ New thread]         │
└──────────────────────────────────────────┘

Expanded (after first message; max-height ~60% of viewport):
┌──────────────────────────────────────────┐
│  ⌃ chevron (collapse)             ⋯     │
│ ┌──────────────────────────────────────┐ │
│ │ [user] crie 3 nodes website e roda  │ │  ← bubbles
│ │                                      │ │     scroll
│ │ [agent] Vou começar criando…        │ │     when
│ │                                      │ │     full
│ │  ┌─ ⚙ createNode kind=site ───────┐ │ │
│ │  │ ✓ done                         │ │ │
│ │  └────────────────────────────────┘ │ │
│ │  ┌─ ⚠ runFlow node_a model=opus ──┐ │ │
│ │  │ Estimated $0.20                │ │ │
│ │  │ [Confirm] [Skip] [Auto-OK all] │ │ │
│ │  └────────────────────────────────┘ │ │
│ └──────────────────────────────────────┘ │
│  ┃ next message…                     ▸  │
│  [Sonnet 4.6 ▾]  [+ New thread]         │
└──────────────────────────────────────────┘
```

### Components (file paths assumed for the plan)

- `components/PromptDock.jsx` — expand to host chat panel state. Stay the entry point.
- `components/chat/ChatPanel.jsx` — new. Scroll container, message list, soft-pause chip.
- `components/chat/ChatBubble.jsx` — new. Renders user bubble (right) or assistant bubble (left).
- `components/chat/ToolChip.jsx` — new. State machine: `pending | running | awaiting_confirm | awaiting_choice | done | error | skipped`. Inline buttons for confirm flows.
- `components/chat/SoftPauseChip.jsx` — new. Variant of ToolChip but covers the whole-run pause.
- `lib/chat-client.js` — new. Wraps EventSource for `/api/chat`, handles reconnect, exposes a typed event emitter.

### Tool chip states (visual hint, exact styling deferred to UI session)

| State | Color | Affordances |
|---|---|---|
| pending | gray | spinner |
| running | blue | spinner + animated dots |
| awaiting_confirm | amber | summary text + Confirm + Skip + "Auto-OK this tool this turn" |
| awaiting_choice | amber | summary text + choice buttons |
| done | green | ✓ + short result summary ("created node_abc") |
| error | red | ✕ + short error |
| skipped | gray | ⊘ + "user skipped" |

### Soft-pause chip

Distinct visual treatment from a tool chip (covers the whole agent at this moment, not one action). Shows the breakdown: "Worked on 10 things so far — 8 nodes created, 2 edges. Continue?" with `[Continue] [Stop]`.

### State management

PromptDock holds a `chatState` reducer:
```js
{
  threadId,
  messages: [{id, role, content, tool_calls, model, createdAt}],
  activeRun: { runId, status, iterations, pendingToolCallId, breakdown } | null,
  inputDisabled: boolean,
  loading: 'idle' | 'streaming' | 'paused' | 'submitting'
}
```

Actions: `MSG_RECEIVED`, `TOOL_STARTED`, `TOOL_DONE`, `TOOL_NEEDS_CONFIRM`, `TOOL_CONFIRMED`, `TOOL_SKIPPED`, `RUN_PAUSED_SOFT`, `RUN_CONTINUED`, `RUN_COMPLETED`, `RUN_FAILED`, `THREAD_LOADED`, `NEW_THREAD`.

## 9. Persistence

### DB schema (3 new tables)

```sql
CREATE TABLE chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL DEFAULT 'board' CHECK (scope IN ('board','asset')),
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CHECK ((scope = 'board' AND asset_id IS NULL) OR (scope = 'asset' AND asset_id IS NOT NULL))
);
-- one active board-thread per board; one active asset-thread per asset
CREATE UNIQUE INDEX chat_threads_one_active_per_board
  ON chat_threads(board_id) WHERE status = 'active' AND scope = 'board';
CREATE UNIQUE INDEX chat_threads_one_active_per_asset
  ON chat_threads(asset_id) WHERE status = 'active' AND scope = 'asset';

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content TEXT,
  tool_calls JSONB,           -- assistant role: [{id, name, args, status, result, error}]
  tool_call_id TEXT,          -- tool role: which tool_call this responds to
  model TEXT,
  agent_run_id UUID,          -- logical FK to agent_runs.id
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX chat_messages_thread_ts ON chat_messages(thread_id, created_at);

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN (
    'running','paused_confirm','paused_choice','paused_softlimit',
    'completed','failed','cancelled','hard_limited'
  )),
  iterations INT NOT NULL DEFAULT 0,
  tool_call_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  err TEXT,
  tokens_in INT,
  tokens_out INT,
  cost_cents INT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX agent_runs_thread_status ON agent_runs(thread_id, status);
```

### Operations

- **Open board**: `GET /api/chat?boardId=...` returns the active board-scope thread + last 50 messages (server creates on-the-fly if none).
- **Open Smart Edit on asset**: `GET /api/chat?boardId=...&assetId=...&scope=asset`. Same shape.
- **Send message**: POST /api/chat with the body in §5. If no `threadId`, server resolves the active thread for board+scope+asset.
- **New thread**: POST /api/chat/new-thread archives current active for the same scope; returns the new id.
- **Concurrency**: POST /api/chat first checks for any agent_run with `status IN ('running','paused_*')` on the same thread. If yes → 409 with `{activeRunId, status}`. Frontend renders "Agent is working" overlay and offers a "View progress" button that swaps to the live SSE for that run.

### Smart Edit chat wiring

- The existing `buildAssetChatDock()` in `editor.js` keeps its UI (textarea + model picker + send arrow).
- Replace the `chrome.runtime.sendMessage({action:'generateImage'})` path with a POST to `/api/chat`. Body:
  ```js
  { boardId, assetId, threadScope: 'asset', tools: ['createImage', 'getNodeOutput'], systemPromptKey: 'EDIT_IMAGE_SYSTEM', message, modelId }
  ```
- The editor needs to know `boardId` — it's already available via `window.__uncraftMountOptions.boardId` (per project context).
- When the call returns an `imageGenerated` result, the dock renders the new image as the "result" panel (already implemented).

## 10. Provider routing for `createImage`

```
provider='auto':
  if conversation_model startsWith('claude'):
    → emit needs_choice {Gemini auto, GPT-5.5}, await user pick
    → run with chosen provider
  else if conversation_model startsWith('gpt'):
    → run with OpenAI gpt-image-1
  else if conversation_model startsWith('gemini'):
    → run with Gemini Imagen (Imagen via @google/genai)
  else:
    → default to Gemini Imagen (cheapest)

provider='gemini': always Gemini Imagen
provider='openai': always gpt-image-1
provider='claude': error — Claude does not generate images
```

Concrete provider calls:
- **Gemini Imagen**: `client.models.generateImage({model: 'imagen-3.0-fast-generate-001', prompt, aspectRatio})`. Returns image bytes → save as asset record + return data URL.
- **OpenAI gpt-image-1**: `openai.images.generate({model: 'gpt-image-1', prompt, size, ...})`. Returns base64 → same.

Cost recorded per call into `agent_runs.cost_cents`. Provider price tables in `lib/agent-cost.js`.

## 11. System prompts

`lib/agent-prompts.js` exports a map:

```js
{
  BOARD_AGENT: `You are Uncraft's canvas agent. Help the user assemble and operate a graph of website snapshots, prompts, design.md, and assets. You have access to tools to read and modify the graph and to run generative flows on it. Be brief in your responses — show your work via tool calls rather than narrating. When the user is ambiguous, ask one clarifying question before taking destructive actions.`,
  EDIT_IMAGE_SYSTEM: `You are editing a single image. Tools available: createImage (to regenerate), getNodeOutput. Do not create nodes or alter the graph. Pass the user's plain-language instruction into createImage's prompt argument, preserving aspect ratio unless they ask otherwise.`,
  EDIT_SITE_SYSTEM: `Internal prompt used by the editSite tool wrapper. Receives the current snapshot HTML + the user's instruction. Produce minimal-diff modified HTML preserving structure, classes, and unaffected text.`
}
```

These will be tuned via the standard Anthropic/OpenAI/Gemini eval loops once we have real conversation traces from real users. Slice 1 ships first draft; slice 2 iterates.

## 12. Cost tracking (recording only)

Each SDK call returns token counts. The agent loop tallies into the `agent_runs` row:

| Field | What |
|---|---|
| `tokens_in` | total input tokens across all LLM calls in this run |
| `tokens_out` | total output tokens |
| `cost_cents` | total cost in cents, computed via `lib/agent-cost.js` pricing table |

Slice 1: numbers recorded, nothing enforced. Slice 2: a `lib/credits.js` reads `cost_cents` and decrements the user's credit balance; if balance would go negative, POST /api/chat returns 402 Payment Required before starting the run.

## 13. Error handling

| Failure | Behavior |
|---|---|
| Invalid tool args (Zod-style validation fails) | Tool returns `{error: 'invalid_args', detail: '...'}` to LLM. Counts as a retry. |
| Tool execution throws | Catch, return `{error: 'execution_failed', message: e.message}` to LLM. Counts as retry. |
| 3 retries of same tool name | Force the 4th `{error: 'too_many_failures'}` without executing. |
| LLM API timeout / 5xx | Wait 1s, retry up to 2x. If still failing, end run with `failed`, surface error in chat. |
| LLM emits malformed tool call (missing required field) | Return validation error to LLM. Counts as retry. |
| LLM produces no tool call AND no text | End run with `completed` (empty). |
| Hard iteration cap hit | End run with `hard_limited`, emit `run_status` event with `{status:'hard_limited'}`. Chat shows "Hit the 50-action limit for this message. Send a new message to continue." |
| Wall-clock timeout (5min) | Cancel in-flight LLM call, mark `failed`, emit error. |
| Client disconnects mid-stream (browser closed, network drop) | Agent run continues server-side until completion or 5min timeout. Final results persisted to chat_messages. Next time client loads, sees the result without streaming. |
| Tool execution succeeds but DB write fails (transient) | Retry the write once; if fails again, return error to LLM as `{error: 'persistence_failed'}`. |
| Concurrent run blocked (409 from /api/chat) | Frontend shows "Agent is working" overlay with the active runId + a "View progress" button that opens an SSE on that run. |
| User confirms a destructive tool but the underlying node was deleted by another tab between confirm and execution | Tool returns `{error: 'target_not_found'}`. LLM gets the error and decides. |

## 14. Testing strategy

### Unit
- Each tool's executor: happy path + invalid args + permission failure (user not on board) + target-not-found.
- Agent driver: classification routing (safe vs destructive vs choice), retry budget counting, iteration counter, soft/hard cap handling.
- Provider router for `createImage`: each branch (claude+auto → choice, gemini+auto → gemini, openai+auto → openai, explicit provider override).

### Integration
- `/api/chat` end-to-end: POST opens SSE, agent runs 3 safe tools, completes, persists. Replay via test client.
- Pause/resume: SSE pauses on destructive tool, POST /confirm resumes, tool executes, SSE keeps emitting.
- Soft pause: configure cap to 2 for tests, run 4-tool flow, verify pause at 2 with `needs_softlimit_continue`, POST /continue, run continues to 4.
- Hard kill: cap=3, run 5-tool flow, verify abort at 3 with `hard_limited`.
- Concurrency: open two SSE streams against same thread, second gets 409.
- Cancel: POST /cancel mid-run → SSE emits `cancelled`, no further tool calls.

### Manual
- Bottom chat: type "monte um workflow…" and verify the three demo scenarios from §4 work end-to-end with each of Claude / GPT / Gemini.
- Smart Edit: open Smart Edit on an image, type instruction, verify image regenerates and asset row updates.
- Refresh mid-run: open chat, send long task, refresh page. Verify thread reloads with completed messages from the orphan run.
- Approval chips: trigger each kind (confirm, choice, soft-pause) and verify the buttons resume the loop correctly.

## 15. Out of scope (named explicitly so we don't forget)

- A "resume live progress for an orphaned run" feature (run survives, but live SSE doesn't reconnect after browser reload — user just sees the final state).
- Multiple parallel threads per board.
- Streaming tool _results_ back into the LLM mid-execution (e.g. for runFlow, the result is the full snapshot at the end; the LLM doesn't get progressive token deltas).
- Tool composition (LLM defining new compound tools from primitives).
- Per-organization tool registries.
- A "rewind to message N" history feature.
- Showing the conversation to other users on the same board (chat is per-user; same board could have N independent threads, one per user).
- Replaying historical runs as a sanity check (the snapshot of args + results is there in chat_messages.tool_calls, but no replay UI).

## 16. Open questions for implementation plan

These are real implementation decisions the plan needs to make, not user-facing choices:

- Where does the SSE connection live in the React tree? PromptDock root, or a context provider higher up so other components (like a future "minimap of running flows") can observe?
- How to attach the Anthropic / OpenAI / Gemini SDK token usage callbacks. Each SDK exposes it differently; need a normalized adapter.
- For `editSite`: when the node iframe is currently open in edit mode AND the agent fires editSite on it, do we (a) push the new snapshot and force-reload the iframe (loses unsaved user edits), (b) refuse with `{error: 'node_open_in_edit'}`, or (c) merge somehow. Default: (b) — refuse cleanly, agent re-prompts user to close edit mode first.
- For `createImage`'s `attachToBoard:true` flag: where does it position the new asset node on the canvas? Auto-layout next to the cursor's last position? Below the last-created node? Configurable in slice 2.

## Implementation plan

Generated next via `writing-plans`. The plan will break this spec into ordered, testable steps suitable for execution in subagents.
