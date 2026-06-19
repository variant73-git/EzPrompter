# Session handoff — 2026-06-19

**Branch:** `feat/canvas` — **~65 commits ahead of `origin/feat/canvas`, ALL LOCAL/UNPUSHED.** Suite: **311/311** (run `cd packages/web-shell && npx vitest run`; MUST run from `packages/web-shell` — jsdom config lives there; from repo root you get false "document is not defined").

**This was a very long multi-feature session.** Full detail in CLAUDE.md items **137, 138, 139** and memory `checkpoint_2026-06-19_session.md`. Read the ⭐ pinned principle first: `principle_agent_macro_operating_model.md` (the agent IS the selected AI operating normally; nodes are the delivery medium; tools are power-ups not a cage).

---

## What shipped this session (all committed, tested)

1. **Node progress ring** — category-colored SVG arc filling the node border clockwise + grey `NN%`. `lib/generation-progress.js`, `components/NodeProgressRing.jsx`. Replaced the Uiverse spin + run-status chip. (CLAUDE.md 137)
2. **6 canvas bugfixes** — D infinite-loop (epsilon guard on `setCanvasScale` in CanvasClient), F humanized delete chip, B 100px no-overlap, C auto-focus on new content, E save-popup → `<body>` portal fixed-size, hydration `suppressHydrationWarning`. (137)
3. **Chat model-picker fix** — `/api/chat` now honors the dropdown via `resolveAgentModel(modelId, user)`. caps 5→10min. (137)
4. **Extract to ▸** — full 7-combo feature (`lib/extract.js` dispatcher, `lib/extract-llm.js`, `lib/browser.js`, `POST /api/nodes/[id]/extract`, submenu in EmptyDropMenu). (137)
5. **Agent conversational-orchestrator** — `createNode` `content` param (the unblocker so "create a fintech site" generates) + `BOARD_AGENT` rewrite in `lib/agent/prompts.js`. (138)
6. **Batch 5-fix** (CLAUDE.md 139, commits `c75f90c`→`06a4650`):
   - #1 selection=target (assertive active-node hint in `/api/chat` `buildWorkflowHint`)
   - #3 section-aware placement (`lib/canvas-layout.js` `loadBoardObstacles` — section frames as obstacles)
   - #5 clones → Opus + forced narration (`isCloneRequest` in `/api/chat`, `CLONE_AGENT_MODEL`)
   - #4 ring during clone (`captureUrl` placeholder node w/ `meta.status='generating'` before capture)
   - #2 animated working feedback (`components/chat/WorkingIndicator.jsx`)

---

## PENDING — do these next session

### A. Browser smoke tests (the only real validation left — cost AI credit; Claude + Gemini are funded now)
Run the dev server (`cd packages/web-shell && npm run dev`, port 3030), pick a funded model in the chat dropdown. Confirm:
- **#1** — select a site node, type "use a different color palette" → it applies to the selected site, does NOT ask "which site?".
- **#2** — while the agent works: collapsed shows animated "working on it" (10 langs/1.5s) over the input field, colored by the node category; expanded shows it beside the thinking dots. With 2+ different-category nodes selected → gradient.
- **#4 / #5** — ask the agent to clone a URL. It should: announce "capturing now, using Opus because it gives the best clone"; show the **outline ring + %** on the new node during the 2-3 min capture; run on **Opus**.
- **Node progress ring** (item 137) — live animation during any generation (clone/compose/image): ring fills, % climbs, swaps to content on done. (Static render was verified; live motion was not.)
- **Extract to ▸** (137) — drag a cord from a site/asset node to empty canvas → submenu; each combo lands a populated derived node. LLM/screenshot combos cost credit.
- **Orchestrator** (138) — smoke checklist at `docs/superpowers/smoke-tests/2026-06-19-agent-orchestrator-smoke.md`. The make-or-break case: "create a fintech site" → a **generated** site, not an empty node.

### B. Verify the Opus model id for clones
`CLONE_AGENT_MODEL` defaults to `claude-opus-4-7` (`app/api/chat/route.js`). If the Anthropic account's Opus is `claude-opus-4-8` (or other), set env `UNCRAFT_CLONE_MODEL` or the clone routing 404s. Anthropic API IS funded; Gemini has ~R$58. The chat dropdown can pick **GPT-5.5** (OpenAI, always funded) to sidestep a depleted provider.

### C. Decide: push to origin
~65 commits sit only on the local `feat/canvas`. Offer to `git push origin feat/canvas` (or open a PR to `claude/ai-image-description-extension-Tp3jY`).

### D. The user's uncommitted in-progress refactor was committed as WIP
Earlier this session the user's half-done agent-tool refactor (apply-design/capture-url/extract-design/run-flow/etc.) was committed as one WIP commit at their request. It's now part of the branch history. If they want to reorganize those commits, that's a future cleanup.

---

## Gotchas the next session needs

- **Run vitest from `packages/web-shell`** — not repo root (jsdom).
- **`bun.lock` is source-of-truth** for deps (project uses bun, not npm).
- **Placement helpers now query edges** (`loadBoardObstacles`) — any test mocking `sql` for `createNode`/`captureUrl`/`addAssetFromUrl`/`applyDesign` auto-place must account for the extra edges query (use an empty-board `[]` to skip it, or add an edges mock). This already bit create-node/add-asset tests this session.
- **The reconstruct/clone vision pipeline is gpt-5.5** (`lib/reconstruct.js:606`), separate from the chat agent model. The user chose NOT to change it — only the chat agent is forced to Opus for clones. If they later want clones literally generated by Opus, that's a `reconstruct.js` change (Anthropic SDK + multimodal shape).
- **`run-flow` reads** a prompt source from `meta.prompt` and a design source from the snapshot's `design_md` — that's why `createNode` now writes those (item 138). Keep them aligned.
- **The macro principle** (`principle_agent_macro_operating_model.md`) governs all agent-behavior work — don't regress the agent into a caged tool-caller.

---

## Quick orientation map
- Chat agent route + model routing: `packages/web-shell/app/api/chat/route.js`
- Agent system prompts: `packages/web-shell/lib/agent/prompts.js` (`BOARD_AGENT`)
- Agent tools: `packages/web-shell/lib/agent/tools/*`
- Placement: `packages/web-shell/lib/canvas-layout.js`
- Canvas client + node render + ring: `packages/web-shell/components/CanvasClient.jsx`, `CanvasNode.jsx`, `NodeProgressRing.jsx`
- Chat UI: `packages/web-shell/components/PromptDock.jsx`, `components/chat/*`
- Extract: `lib/extract.js`, `lib/extract-llm.js`, `app/api/nodes/[id]/extract/route.js`
- Specs/plans/smokes: `docs/superpowers/{specs,plans,smoke-tests,audits}/`
