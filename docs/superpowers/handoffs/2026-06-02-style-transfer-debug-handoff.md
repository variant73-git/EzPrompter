# Style-Transfer Debug Marathon — Handoff (2026-06-02)

> Long session that started on canvas / chat polish work and ended after we found and fixed the root cause of the style-transfer "stops after addAssetFromUrl" bug. Branch `feat/canvas`, 130 commits ahead of origin, working tree clean.

## TL;DR

The style-transfer flow (agent ingests a Pinterest URL, edits the user's attached image to apply the reference style, drops both source nodes + the result + edges on the canvas) **works end-to-end now**. Validated run took ~25s wall-clock:

```
iter=1 → addAssetFromUrl (213ms)
iter=2 → createImage tool_use
  EXEC createImage → openai images.edit 21s + DB persist 521ms = 22s
iter=3 → end_turn ("Criei uma nova imagem…")
POST /api/chat 200 in 33601ms
```

## Root cause that ate most of the session

`POST /api/chat/confirm 404` triggered by Next.js dev-server HMR re-evaluating `lib/agent/run-map.js` between when `/api/chat` registered the runId and when `/api/chat/confirm` tried to look it up.

Sequence:
1. `/api/chat` enters agent loop, calls `registerRun(runId)`, runMap has runId
2. Agent calls `createImage` (classification: `needs_choice`)
3. Driver emits `needs_choice` and awaits `awaitChoice(runId, callId)`
4. Client auto-confirms via POST `/api/chat/confirm` (single-choice short-circuit)
5. Confirm route was JUST COMPILED by Next dev HMR → `run-map.js` re-evaluated → `const runs = new Map()` ran again → empty Map
6. `hasRun(runId)` returns false → 404
7. Client fires-and-forgets confirm, never retries
8. Server's `awaitChoice` never resolves
9. Tool execute stuck forever
10. Outer 6-min route hard-cap closes SSE with `agent run exceeded 360s`

User saw the same 6:00 hang multiple times. Diagnostic logging (`[agent] EXEC tool=… DONE …`, `[createImage] starting gen … DB persistence …`) was what finally revealed the gap between iter=2 and the cap fire — no EXEC for the next tool meant the loop was stuck in `awaitChoice` before reaching tool execution.

**Fix (commit `d60b8fa`)**: stash `runs` Map on `globalThis.__uncraft_runMap` so HMR re-evaluations reuse the existing instance. One-line change to `lib/agent/run-map.js`. Same pattern applies in production for serverless cold restarts.

## Everything else shipped this session (commit log highlights)

Canvas:
- `space-to-pan + drag-to-marquee multi-select` — Figma-style canvas gesture model
- `marquee live highlight + selection ring on intersect` — nodes light up as the rect crosses them
- `shift-click toggle (add/remove from selection)` — clean Figma convention
- `Cmd/Ctrl+Z undo for delete-nodes` — POST `/api/nodes/restore` reinserts with original IDs
- `marquee rect → white + lighter` — less visual noise
- `Delete focus fix` — blur active input on node/edge/marquee select so the keypress reaches the canvas handler

Chat:
- `hide routine tool chips + agent narrates` — only `awaiting_confirm` / `awaiting_choice` chips render
- `split assistant bubbles per iter (TOOL_CALL_STARTED seals tmp-asst-)` — two responses in one turn no longer merge
- `thinking-dots reappear between iters` — visible signal that agent is still working after sealing
- `attachment auto-creates node + drops auto-prefill text + early refetch`
- `unique tool ids (crypto.randomUUID) + scoped React keys (m-/a-)` — Gemini per-call counter collisions fixed
- `prompt-dock + menu portal to body` — escapes the dock's `translateX(-50%)` containing block

Agent infrastructure:
- `multimodal chat + image-to-image + addAssetFromUrl tool` — Phase 3b lit up
- `auto-edge wiring in createImage` — `inputAssetIds` arg creates source → result edges so the workflow is visible
- `cap LLM history bloat (slimForHistory strips dataUrl/html/large strings)` — Gemini 1M token cap stopped getting hit
- `attached-image stripping after iter 1` — replace image block with text placeholder in subsequent iters
- `wall_timeout race for LLM call` — 4-min hard cap per LLM call
- `Gemini Imagen 120s timeout + outer 6-min route cap` — bounds total run time
- `announce-and-stop safety net (intent regex + semantic check)` — forces continuation when agent says "vou criar" without calling the tool
- `runMap globalThis singleton` — the actual root-cause fix

Layout:
- `placeStackDown / placeRightOfSources` shared helpers — workflow respects gaps (GAP_X=360, GAP_Y=200)
- end-of-run framing — single camera move at RUN_FINISHED instead of jumping per-node mid-stream

## Diagnostic logging still in place

These should come out next session once the fix has held in real use:

1. `[agent] iter=N stop=… tools=… text=…` (driver, after every LLM call) — both stdout AND stderr
2. `[agent] EXEC tool=… args=…` / `[agent] DONE tool=… status=… duration=Xms` (driver, around tool execute)
3. `[createImage] starting gen / gen ok / gen FAILED / DB persistence ok / DB persistence FAILED` (create-image tool)

Remove with a single commit once the user reports a few more successful runs.

## Known-pending / deferred

Carried over from prior session (2026-06-01 handoff) — not touched this session:
1. **SmartEditDockWrap flicker** — first render always right-side, useEffect flips afterwards. Fix: `useLayoutEffect` or sync `node.pos_x + node.width` calc. ~10 min.
2. **Stale `node.meta.assetId` after backfill** — local `resolvedAssetId` is correct but the parent Map doesn't update until refetch. No data loss, just confusing UX on reload. ~20 min.

New this session:
3. **Placeholder skeleton during createImage gen** — user explicitly asked for the result node + edges to appear BEFORE the long gen call, so they see the workflow assemble during the wait instead of a flat "thinking dots" stretch. First attempt (commit `1a58f8e`) introduced a hang and was reverted (`a53e112`). **The hang was probably masked by the same confirm 404 we just fixed** — worth re-attempting now that runMap is sane.
4. **Image-to-image quality "mal feito"** — user said the visual result was acceptable but quality wasn't great. "Vamos falar disso depois". Likely fixes: tune `BOARD_AGENT` prompt to coach the agent on composition-preservation phrasing inside the `createImage` prompt arg.
5. **Diagnostic logs still in place** — `[agent] iter/EXEC/DONE` (driver), `[createImage] starting/gen/persist` (create-image). Remove with one commit once the runMap fix has held for a few more real sessions.
6. **"Could not reach the site" overlay UX** — Pinterest CDN blocked by Cloudflare when the user pastes the URL into the URL+ chip (separate from chat attachment flow). Currently shows a console-error red overlay; should be a friendly toast.
7. **Anthropic Sonnet bump** — attempted mid-session, user's Anthropic console balance was empty. claude.ai Pro/Max is a separate billing bucket; the API needs credits at `console.anthropic.com/settings/billing`.
8. **`/api/chat/confirm` 404 in production** — the globalThis singleton fix is per-process. A load-balanced multi-node deployment would still 404 if the confirm POST lands on a different replica than the one that called `registerRun`. Move runMap to Redis when horizontalizing.

### Antipattern grep before shipping

Catch other HMR-vulnerable / cross-process-vulnerable singletons we may have written:

```bash
grep -rn "^const \w\+ = new Map()" packages/web-shell/lib/
grep -rn "^const \w\+ = new Set()" packages/web-shell/lib/
```

Stash any of these on `globalThis` (dev safety) and document as "needs Redis if horizontalizing" (prod safety).

---

## Strategic: who fills the "cheap pro tier" slot (was: DeepSeek)

Prior plan was DeepSeek for the pro tier (cheaper than Sonnet, more disciplined than Gemini Flash). Reconsidering before wiring:

**DeepSeek concerns (as of knowledge cutoff Jan 2026):**
- **Latency**: inference is China-hosted. US/EU users see +200–500ms vs Anthropic/OpenAI regional endpoints. Noticeable in SSE streaming.
- **Regulatory**: Italy banned for privacy (Jan 2025), Korea suspended, several US states (TX, NY, OH) banned on gov devices. TikTok-style federal debate ongoing in the US.
- **GDPR**: data flows through Chinese servers, subject to PIPL + Cybersecurity Law. DeepSeek almost certainly does not qualify as a GDPR data processor — real risk for any EU user.
- **Self-censorship**: model refuses on Tiananmen / Taiwan / Xi. Doesn't affect image-gen but could affect future copy/branding flows.
- **Distillation lawsuits**: OpenAI alleged DeepSeek trained on GPT outputs. Litigation open.

**Alternatives for the pro tier slot:**
| Model | Host | $/1M in | Function calling | Notes |
|---|---|---|---|---|
| **GPT-4o-mini** | OpenAI (US/EU) | $0.15 | Tested in our codebase via gpt-5.5 path | Compliance handled by existing OPENAI_API_KEY. Recommended. |
| **Groq + Llama 3.3 70B** | Groq (US) | $0.59 | Decent | Super low latency (~50ms first token). Adds a new provider integration. |
| **Mistral Large** | Mistral (Paris) | ~$2 | Solid | EU-friendly. ~13× cost of mini. |
| Qwen 2.5 via Together.ai | Together (US) | $0.88 | OK | Resolves DeepSeek's latency, doesn't fully resolve compliance for sensitive data. |

**Recommended:** GPT-4o-mini fills the pro slot. We already have the OpenAI adapter wired, the OPENAI_API_KEY is in `.env.local`, no new provider integration needed — flip `getAgentModel` for `plan === 'pro'` to `gpt-4o-mini` (or whatever we call it in `MODEL_ALIAS`) and lock the cost ladder: free = Gemini Flash ($1.8M/yr @ 1M users), pro = GPT-4o-mini (~$15M/yr), enterprise = Sonnet (~$84M/yr).

Killing DeepSeek from the plan also kills the Phase 5d wiring TODO that's been hanging around. Item 3 in the deferred list above becomes "wire `gpt-4o-mini` (or chosen pro model) in `getAgentModel`" — ~5 lines instead of a new SDK integration.

## Files touched this session (high-traffic)

- `packages/web-shell/lib/agent/run-map.js` — root-cause fix
- `packages/web-shell/lib/agent/driver.js` — diagnostics, safety net, timeouts, ctx.emit infra
- `packages/web-shell/lib/agent/tools/create-image.js` — placeholder attempt + revert + step timing
- `packages/web-shell/lib/agent/tools/add-asset-from-url.js` — placement helper integration
- `packages/web-shell/lib/agent/tools/create-node.js` — placement helper integration
- `packages/web-shell/lib/canvas-layout.js` — NEW shared placement helpers
- `packages/web-shell/lib/image-gen/gemini-imagen.js` — 120s timeout race
- `packages/web-shell/lib/image-gen/openai-image.js` — earlier session, image-to-image edit support
- `packages/web-shell/app/api/chat/route.js` — 6min outer hard cap, custom_emit forwarder, graph_mutated on tool done
- `packages/web-shell/app/api/nodes/restore/route.js` — NEW for undo
- `packages/web-shell/components/CanvasClient.jsx` — marquee, multi-select, undo, framing
- `packages/web-shell/components/PromptDock.jsx` — bubble seal, dots, portal fixes
- `packages/web-shell/components/chat/ChatPanel.jsx` — chip hide, thinking dots, current-turn anchor
- `packages/web-shell/lib/agent/prompts.js` — BOARD_AGENT prompt iterations (don't announce without acting, build workflow as graph, ask when attachment missing, etc.)

## Pickup commands

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft
git log --oneline feat/canvas | head -30           # latest 30 commits
cd packages/web-shell
npm test                                            # 189/189 expected
npm run dev                                         # http://localhost:3030
```

To verify the runMap fix is holding under real HMR pressure:
```bash
grep "POST /api/chat/confirm 404" <dev-server-log>  # should be EMPTY
```

To strip diagnostic logs (after the fix has held for a few more runs):
```bash
# Remove these specific lines:
# - driver.js: [agent] iter=, [agent] EXEC, [agent] DONE
# - create-image.js: [createImage] starting, gen ok/FAILED, DB persistence ok/FAILED
```

## State

- Branch `feat/canvas`, 130 commits ahead of `origin/feat/canvas`, **unpushed**
- 189/189 unit tests passing
- Working tree clean
- Dev server background task running (task id last known: `b78ahti3f`, may need restart if user reopens session)
- Style transfer e2e validated visually + via diagnostic logs at the end of session
