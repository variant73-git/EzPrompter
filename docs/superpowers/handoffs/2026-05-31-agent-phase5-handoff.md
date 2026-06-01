# Agent PromptDock — Handoff for Phase 5+ (after Phase 4 ships)

> Written 2026-05-31 right after Phase 4 (Smart Edit dock canvas-mode wire-up) shipped on branch `feat/canvas`. 146/146 tests green.

## What state you're picking up

End of Phase 4 — the full 4-phase agent feature is functional end-to-end:

**Phase 1+5a** — chat agent with 6 safe tools + multi-provider routing (Claude/GPT/Gemini)
**Phase 2** — 3 destructive tools (deleteNode/runFlow/editSite) + pause/resume + caps + agent_runs persistence
**Phase 3** — createImage (10th tool) + Gemini Imagen + OpenAI gpt-image-1 adapters + needs_choice + PromptDock auto-confirm
**Phase 4** — Smart Edit dock canvas-mode + buildAssetRegistry + asset-scoped threads + SSE consumer in editor.js + inline image render

Total: 146 tests, 4 phase plans, 4 handoff docs, items 128/129/130/131 in CLAUDE.md.

## Smoke tests not yet run (5 scenarios, all phases)

Phase 2 §8 + Phase 3 + Phase 4 manual scenarios accumulated:

**Phase 2 — destructive flow:**
1. `delete the blank website node` → amber confirm chip → Confirm → node deleted; canvas refetches
2. `UNCRAFT_AGENT_SOFT_ITER=2` + `create 5 prompt nodes` → SoftPauseChip at iter 2 + breakdown → Continue → done
3. `UNCRAFT_AGENT_HARD_ITER=3` + same prompt → hard_limited at 3
4. Cancel mid-run via devtools fetch /api/chat/cancel → status=cancelled
5. `psql … SELECT … FROM agent_runs ORDER BY started_at DESC LIMIT 5` → verify status transitions

**Phase 3 — image gen:**
6. Default (UNCRAFT_AGENT_MODEL=gemini-2.5-flash) + `generate teal mountain and attach to board` → silent auto-confirm → asset node appears
7. `UNCRAFT_AGENT_MODEL=claude-sonnet-4-6` + same prompt → 2-button needs_choice chip → click Gemini or GPT → image gens
8. Explicit `use openai to generate a cat` → silent single-confirm → openai gens
9. `psql … SELECT … FROM assets ORDER BY created_at DESC LIMIT 5` → verify

**Phase 4 — Smart Edit:**
10. Click Smart Edit on agent-generated asset → type "make it sunset colored" → image regenerates inline
11. Click Smart Edit on uploaded asset (no meta.assetId) → "needs asset record" error
12. Smart Edit in extension still works (chrome.runtime path) → no regression

These should run first thing next session.

## Suggested next pickup

**Phase 4b — orphan asset backfill (small, ~30min)**
- When canvas Smart Edit clicks on an asset node without `meta.assetId`, auto-create an `assets` row from the node's existing data (kind='asset', meta.dataUrl or .source_url, etc.)
- Update `node.meta.assetId` after insert
- Smart Edit then proceeds normally
- One new function in lib/agent/canvas-asset-bridge.js; one new flow in editor.js's submit canvas path

**Phase 5b — history reconstruction (medium, ~2-3hr)**
- Currently `appendMessage({role:'assistant', content:''})` saves empty stub. Phase 5b populates content + saves separate `role:'tool'` messages with tool_call_id + result JSON + builds tool_calls JSONB on assistant message → ChatPanel rehydrates on reload
- Affects: route.js (collect tokens during stream, save proper messages), ChatPanel (render tool_calls from messages instead of activeToolCalls), GET /api/chat (currently returns messages as-is — should work with new shape)

**Phase 5c — cost tracking + credits (medium, ~3-4hr)**
- `agent_runs.{tokens_in, tokens_out, cost_cents}` columns exist but never written
- New: `lib/agent-cost.js` price table per model + per image gen
- Driver tallies usage from message_complete events
- Route persists at run end via finishAgentRun
- `lib/credits.js` decrements user balance; route returns 402 if balance would go negative
- Tier ladder routing in `getAgentModel(user)`:
  ```js
  if (user.plan === 'free') return 'gemini-2.5-flash';
  if (user.plan === 'pro')  return 'deepseek-chat';
  return 'claude-sonnet-4-6';
  ```

**Phase 3b — image-to-image (medium, ~2hr)**
- Pass existing image as input to next generation (regenerate with edits as reference)
- Both Gemini Imagen and gpt-image-1 support reference images — add `referenceImageUrl` / `referenceImageBase64` to createImage's input schema + adapter signatures
- Smart Edit becomes higher fidelity — current Phase 4 just regenerates from text, doesn't use the existing image visually

**Phase 4b — proper picker for needs_choice in Smart Edit dock (small, ~1hr)**
- Currently auto-picks first choice — Phase 4b adds inline picker UI inside the dock
- Same pattern as ToolChip's `awaiting_choice` but rendered in the asset-edit panel

**Phase 6 — Redis-backed runMap (only when scaling)**
- Currently in-memory singleton (lib/agent/run-map.js). Same API surface migrates to Redis cleanly.

## Things NOT to do (lessons from Phase 4)

- **Don't try to do canvas analyze without implementing the vision call** — the extension's describeImage handler calls /api/agent/describe with the image URL; reimplementing that in canvas would need a new route. Phase 4 MVP correctly skips analyze and lets the user write instructions directly.
- **Don't share state between extension `submitExtension` and canvas `submitCanvas`** — they use different state paths (`assetEditState.resultUrl` vs `assetEditState.result.dataUrl`) so reload/swap doesn't get confused. Keep them separate.
- **Don't make `chat_threads.asset_id` nullable** — schema invariant is important for thread isolation. Phase 4b orphan backfill is the right pattern, not relaxing the constraint.

## How to run / develop

```bash
# Tests:
cd packages/web-shell && npm test
# Expected: 146/146 passing

# Dev server:
cd packages/web-shell && npm run dev
# → http://localhost:3030/canvas/<board-id>

# Editor source vs dist:
# Edit packages/editor-core/src/editor.js
# Then: bash scripts/build-editor.sh   (syncs to editor/editor.js + extension paths)

# Env vars (.env.local):
#   GEMINI_API_KEY=<key>
#   OPENAI_API_KEY=<key>
#   ANTHROPIC_API_KEY=<key>
#   UNCRAFT_AGENT_MODEL=gemini-2.5-flash  (override for Claude/GPT smoke)
```

## End-of-feature status

The PromptDock agent feature spec (`docs/superpowers/specs/2026-05-31-agent-promptdock-design.md`) is now substantially complete:

| Spec section | Status |
|---|---|
| §1-4 Goals + UX | ✅ Phase 1-4 |
| §5 Architecture (SSE, pause/resume) | ✅ Phase 1+2 |
| §6 10-tool catalog | ✅ Phase 1+2+3 |
| §7 Anti-loop caps | ✅ Phase 2 |
| §8 Chat UI + Smart Edit | ✅ Phase 1+2+4 |
| §9 Persistence (chat_threads, chat_messages, agent_runs) | ✅ Phase 1+2 (history reconstruction = 5b) |
| §10 createImage provider routing | ✅ Phase 3 |
| §11 System prompts | ✅ Phase 1 |
| §12 Cost tracking | ⏸ Phase 5c |
| §13 Error handling | ✅ Phase 1+2 |
| §14 Testing | ✅ unit + integration (manual smoke pending) |

Phase 5b (history) + 5c (cost) are the remaining spec items. Phase 3b/4b are quality-of-life follow-ups. Phase 6 (Redis) is scale-driven.
