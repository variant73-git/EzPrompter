# Handoff — Canvas UX + Clone/Transplant fidelity + Anti-slop training

**Date:** 2026-07-01 · **Branch:** `feat/canvas` · **Tests:** 423 passing (`cd packages/web-shell && npx vitest run`)
**Last commits:** `b33c8a0` (extract 500 + section-drag loop) ← `9256fa1`/`224f58f` (colour + 3 bugs) ← `9f8b3da`/`a2f127b`/`59f60ae` (big canvas batch) ← `ebcb6be` (baseline)

Web-shell only (`packages/web-shell/`) unless noted. Dev is LOCAL (auto-reloads). Model keys: OpenAI (GPT-5.5) + Anthropic funded; Gemini prepaid-depleted.

---

## DONE (this arc — for context, all committed)
- **Canvas UX:** run STOP-state (chat arrow bare-run + section pill + floating button → clickable square that AbortControllers the run; node keeps pre-run state); Cmd+V clipboard paste (image/.md/.html/URL) + "Paste from clipboard" context-menu item; duplicate→ghost; **Alt+drag duplicate** (optimistic local ghost, copy cursor); **Opera-GX browser-zoom fix** (Ctrl/Cmd+wheel/pinch over dock/sidebar was page-zooming — now blocked everywhere, routed to canvas zoom over canvas; Ctrl/Cmd+0 free); selected-ring visible at far zoom.
- **Extract/clone/transplant:** edge-drop menu INVERTED (Extract-to primary, Connect-to submenu); **clone website** (asset→blue site node; nodeOrigin clone=blue; placeholder kind matches final); **crop-and-embed** real images (`lib/clone-images.js`, CONSERVATIVE — clean bounded images only, skips bleeding heroes >35% area); **clone ISOLATE** (discard presentation backdrop — first checklist item); **clone model → GPT-5.5** + OpenAI branch added to `lib/extract-llm.js` (was Sonnet-hardwired, picker never reached it); **exact colour ground-truth** (`lib/design/sample-palette.js` — per-cluster real averages + role-labelled background + saturated accent, for clone AND transplant); **structural style-extraction** (`lib/design/style-extract.js` — the "DOM" equivalent: outer-vs-inner spacing, container variants/states, gradient placement, heading↔subheading; `HOUSE_STYLE_ABSORB` told to reproduce not re-derive).
- **Bugs fixed:** extension "Save your assets?" modal never sticks (`panel/panel.js`); section-merge/overlap de-overlap at addEdge (`deoverlapSectionForEdge`, earlier commit); immediate remove-from-section (cut edges + drop below frame, no re-adopt); lateral attach-preview clip; **extract placeholder 500** (`tmp-extract-`→`temp-extract-` prefix); **section-drag "Maximum update depth" loop** (startSectionMove now sets `dragFreeze`).

## KEY LESSON (drives everything below)
Prompt-only hit its ceiling: the model ignores explicit instructions (encapsulated nav, frames, exact colour, radius) and piling on prompt gave NEGATIVE returns. The wins came from **right model (GPT-5.5) + deterministic ground-truth (measure colour from pixels, crop real images)**. **Colour is now measured + pinned exactly (confirmed: no `[sample-palette]` warning in the server log = sampler works).** Remaining drift = the model, not a bug — the user confirmed "não tem o que consertar na cor". The path forward for fidelity is the training roadmap, NOT more prompt.

---

## PENDING

### The parked queue (user said "tudo isso" — do all)
1. **#1 Merge-confirm popup** — when a MANUAL cord connects a node in section A to a node in section B (both ≥2 members, distinct sections), the sections merge. Show a popup BEFORE creating the edge: **"The node position will blend different sections. Proceed?"** [Cancel] [Yes]. Yes → create edge (merge); Cancel → don't. Only when connecting two DISTINCT sections. Location: manual edge-create — `app/api/edges/route.js` (POST) + client `CanvasClient.jsx` (`api.createEdge` ~line 698/2908, `onStartEdge`/edge-drop). **BLOCKED on user confirming they still want Cancel/Yes as specced** (they were asked, then interrupted by the 500 bug — re-confirm first).
2. **#5 Section-expand wall** — a section growing (frame resize `startSectionResize`, or expand) must NEVER invade another section's space. `planSectionDeoverlap` exists for the addEdge path; the resize/expand path doesn't enforce a section-vs-section wall. Reuse the frame-overlap logic from `lib/canvas-layout.js`.
3. **#2 Verify URL-node drag-out** — user couldn't reproduce a bug where dragging a URL node out of a section re-adopts it; verify the membership logic in the drag path (`handleNodeMoveEnd` / `section-membership.js`) for URL/site nodes specifically. May already be fine.

### Deferred by the user (don't do unless asked)
- **Model picker → clone/transplant:** clone hardwired to GPT-5.5 (env `UNCRAFT_CLONE_MODEL`); transplant forces gpt-5.5 when an image asset is present; the chat dropdown controls neither. User said "por enquanto deixe como está." If revisited: plumb the picker with a FLOOR (never let a weak model like Flash do the vision task).

### Known limitations / tech debt (not bugs)
- **Colour = model drift** (GPT-5.5), not a code bug. Fix = training path (below), not prompt.
- **`samplePalette` samples raw image EDGES** → for a Dribbble-style shot those are the BACKDROP, not the UI bg. The in-prompt caveat handles it; the real fix is to crop the UI region before sampling (deeper CV step).
- **Spatial precision** (container gaps, inner margins, corner radius) + **artifacts** (broken HTML, e.g. the "389 150 171 ExcelenteMuito ruim" mash) — model limitations; need a stronger model, a measurement/segmentation step, or a validation/repair pass.
- **Clone perf: ~123 s** per clone (GPT-5.5 ~16k-token HTML + sampling + crop). Optimize later.
- **Manual cord de-overlap:** the agent `addEdge` path de-overlaps sections; the manual `/api/edges` cord path does not (deferred — server-moving nodes desyncs the client until refetch).

### The big prize — anti-slop generation training roadmap
`docs/superpowers/plans/2026-06-28-anti-slop-generation-training-path.md`. Moat = owning a machine-checkable **criteria rubric** + a **taste-filtered dataset**; one rubric feeds few-shot + eval + ground-truth + LoRA labels. Stages: (1) inference levers now, (2) dataset flywheel, (3) open-VLM (Qwen2.5-VL) + QLoRA (frontier models aren't fine-tunable). **BLOCKED on the user providing: gold reference sites + their explicit anti-slop signature** to seed the rubric. This is the unlock for the fidelity ceiling.

---

## Where things live (quick map)
- Clone: `lib/extract.js` (runExtract, asset→clone/styleclone) + `lib/extract-llm.js` (cloneImageToHtml, has Anthropic/OpenAI/Gemini branches) + `lib/clone-images.js` (crop-and-embed).
- Transplant: `lib/run-flow.js` (runCompose, forces gpt-5.5 on image) + `lib/design/style-extract.js` (extractStyleFromImage → brief) + `lib/design/house-style.js` (HOUSE_STYLE_ABSORB).
- Colour ground-truth: `lib/design/sample-palette.js` (samplePalette, browser part isolated + pure formatting; `console.warn` on failure).
- Canvas interactions: `components/CanvasClient.jsx` (~5200 lines) + `components/CanvasNode.jsx`. Section move = `startSectionMove`; remove-from-section = `armNodeRemoval`→`commitNodeRemoval`; extract UI = `handleExtractTo` + `EmptyDropMenu`.
- Node colour: `lib/node-origin.js`.
- Memory checkpoint: `~/.claude/projects/.../memory/checkpoint_2026-06-28_canvas-clone-transplant.md` (has a 2026-07-01 follow-up section).
