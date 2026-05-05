# Canvas + Editor-Core — Handoff

**Date:** 2026-05-05
**Branch:** `feat/canvas`
**Backup tag:** `backup-pre-host-target-refactor-2026-05-04` (one-shot rollback if needed)

## Where we are

Phase 3 of the canvas spec (editor.js host/target refactor) shipped + the
canvas web shell now boots the real editor-core inside the parent
document with the iframe as target. Polish iterations on top of that.

23 commits since the backup tag. Last commit:
`a6c2338 fix(editor-core): clear hover overlay when mouse leaves the node iframe`.

## What works (verified by user)

- Editor-core (~1MB IIFE) loads in the canvas host, panels render in the
  parent document, listeners attach to the iframe contentDocument.
- Selection / hover / drag / inspector / spacing guides / minidocks all
  align to the iframe content (host coords mapped via `getOverlayBox`).
- ResizeObserver + rAF poll keep overlays glued to the iframe through
  canvas pan/zoom.
- Editor-core stylesheet served as `/editor-core/editor.css` with id
  `rb-editor-stylesheet` (the legacy `rb-editor-styles` slot is still
  the saved-state recovery `<style>` that `initAutoSave` wipes — don't
  reuse that id).
- Editor.js exposes `window.__rbDeactivate` so the host can tear it
  down on unmount.
- Sticky-write framework override / ID-rule fallback / smart text
  cascade still in place — observers attach to target nodes, ID rule
  styled into target head.
- Canvas chrome neutralised while editing: `body.rb-ed-canvas` strips
  the body-margin / cursor / link-blocker rules that body.rb-ed-active
  applies in extension mode. `.canvas-header { display:none }` while
  editor active.
- Node visual: topbar lives INSIDE `.cnode` as a flex child; `.cnode`
  is the single rounded shape (overflow:hidden) so the selected/main
  ring wraps both topbar+body as one outline.
- Click-outside-iframe deselects the editor's element selection +
  cleans up half-armed drags.
- `mouseleave` on iframe clears the hover overlay.
- Minidock restore button disabled until a tracked element drifts
  from the snapshot (MutationObserver on style/class).
- Brand: `Repix` → `Uncraft` in logo + minimised mini-widget.
- Off-black canvas bg + brighter white dot grid (rgba(255,255,255,0.18)).

## What's NOT verified

- **Extension smoke test (Smoke A in the spec).** Not run during this
  refactor. Behaviour SHOULD be unchanged because every host/target
  helper falls back to `document`/`window` when the mountEditor globals
  aren't set, but all changes touched core code paths. Worth a 5-min
  sanity test on a real site (toolfolio.io for sticky-writes coverage)
  before claiming Phase 3 done.

## Open items / known caveats

1. **`reactStrictMode: false`** in `packages/web-shell/next.config.js`.
   Disabled while debugging the StrictMode mount→cleanup→mount cycle.
   The `CanvasEditorCore` *is* StrictMode-safe (deferred teardown +
   module-scope `scheduleTeardown`/`teardownEditor`), so flipping it
   back on should be safe. Confirm with the user before flipping —
   they were burned by the earlier "panels appear for 1 sec then
   disappear" symptom.

2. **Debug `console.log` in editor.js host-mousedown handler**
   (line ~7886). Logs `[uncraft] host mousedown:` whenever the user
   clicks outside the iframe with a selection active. Left in to help
   the user diagnose whether click-outside-deselect fires. Strip when
   they confirm it works (or leave if they prefer the visibility).

3. **Inspector input font-size override**. Canvas globals.css has
   `input[type='text'] { font-size:1rem; padding:.75rem 1rem;
   margin-bottom:1rem }` that wins the cascade against `.rb-insp-inp`.
   We bumped specificity to `#rb-editor-inspector input` with
   `!important` on size/padding/margin. Watch for new input field
   types in the inspector — they may need to be added to the override
   list if a new global rule lands.

4. **rb-editor-styles id collision risk.** The web shell uses
   `rb-editor-stylesheet` for its `<link>`. `initAutoSave` still wipes
   `rb-editor-styles`. Don't reuse that id for anything that should
   survive boot.

5. **Drag across iframe boundaries.** When user drags an element from
   inside the iframe and releases outside, the host-level mouseup
   fallback (`endDragSafe`) cleans up scroll-lock / ghost / selBox
   visibility. But mid-drag mouse moves outside the iframe DON'T
   reach the editor (target.mousemove only fires while the cursor is
   over the iframe). For now the user can still complete a drag by
   keeping the cursor over the iframe; cross-iframe drag would need
   a host-level mousemove handler that mirrors target coords.

6. **Extension manifest version is 2.5.0** (per
   `packages/extension-shell/manifest.json`). Bump per CLAUDE.md
   ("incrementar versão a cada release significativo") before next
   user-facing release.

7. **No tests.** Changes are validated manually by the user. Smoke
   harness at `tests/e2e/smoke.mjs` predates the monorepo split and
   loads from `REPO_ROOT` instead of `packages/extension-shell/` —
   would need rewiring to run again.

## Architecture cheatsheet

**Boot path (extension):**
- `background.js` injects detect → freeze → extractor → persist →
  mode-e → mode-e-classic → mode-e-diff → mode-e-refine → mode-b →
  mode-e2 → s2h → rebuild → fill-popup → editor.js.
- `chrome.scripting.insertCSS` injects editor.css as user-origin.
- editor.js IIFE auto-bootstraps. host === target === document.

**Boot path (web canvas):**
- `CanvasEditorCore` (`packages/web-shell/components/editor/`) sets
  `window.__rbHost = { doc, win }`, `window.__rbTarget = { doc:
  iframe.contentDocument, win: iframe.contentWindow }`.
- Injects `<link rel="stylesheet" id="rb-editor-stylesheet"
  href="/editor-core/editor.css">` into host head.
- Injects each editor-core script in order via `<script>` tag.
- editor.js IIFE auto-bootstraps. Reads `__rbHost`/`__rbTarget` for
  host (panels) vs target (site) routing.
- Cleanup: `scheduleTeardown` (50ms-deferred for StrictMode safety)
  → calls `window.__rbDeactivate()`, removes injected tags, clears
  registration globals.

**Host vs target rule of thumb:**
- Editor UI (panels, popups, mini-widget, keyboard shortcuts,
  custom cursor, body class state, --rb-* CSS vars) → HOST.
- Site DOM (selection target, mousedown for select, computed style,
  hover detection, freeze, rebuild, ID-rule sheet, fx style tags,
  Mode E capture/replace) → TARGET.
- Coordinate math: every overlay uses `getOverlayBox(el)` which
  factors `iframe.getBoundingClientRect() + el.getBoundingClientRect()
  * scale`. `getCS(el)` already routes through el.ownerDocument.

## How to resume

1. Read this doc + `CLAUDE.md` + spec at
   `docs/superpowers/specs/2026-05-03-canvas-design.md` Phase 3.
2. Boot: `npm run dev:web` from repo root, then localhost:3030.
3. Auth: log in with the user's email — Neon db is live.
4. Open a board, hit Edit on a node — the editor-core panels should
   appear in the parent document, target the iframe.
5. Console will show `[uncraft] host mousedown: {...}` when the
   user clicks outside the iframe with a selection (debug log).

## Likely next moves (if user wants to keep iterating)

- Smoke-test the extension end-to-end. If clean, flip
  `reactStrictMode: true` back on in `next.config.js` and re-test the
  canvas mount path.
- Strip the debug console.log when click-outside-deselect is
  confirmed.
- Tighten the host mousedown handler — currently it deselects on ANY
  click outside the iframe / editor UI; user might want to scope it
  to clicks on `.canvas-shell` only.
- Cross-iframe drag (open item #5) if users start hitting it.
- Image minidock (`showImgMenu`) restore-disabled parity if there
  is/will be a restore button there.
- Bump extension manifest version + memory check before next release.

## Files to read first

- `docs/superpowers/specs/2026-05-03-canvas-design.md` (Phase 3)
- `packages/editor-core/src/editor.js` (~8200 lines, the IIFE)
- `packages/editor-core/src/mountEditor.js` (the contract)
- `packages/web-shell/components/editor/CanvasEditorCore.jsx` (boot)
- `packages/web-shell/components/CanvasNode.jsx` (mounts the editor)
- `packages/web-shell/app/globals.css` (canvas-mode CSS)
- `packages/editor-core/src/editor.css` (editor UI CSS)

## Backups

- Filesystem: `~/Desktop/IA/Uncraft-2.4.0-backup-2026-05-03/`
- Git tags: `backup-pre-monorepo-2026-05-03`,
  `backup-pre-host-target-refactor-2026-05-04`.
- One-shot rollback to pre-Phase-3:
  `git reset --hard backup-pre-host-target-refactor-2026-05-04`.

## For the next session — exact prompt

> Read `docs/superpowers/specs/2026-05-05-canvas-editor-handoff.md`
> first, then `CLAUDE.md`. The canvas editor is functional end-to-end
> in dev (host=parent.document, target=iframe.contentDocument). Smoke
> A (extension on a real site) is unverified — please run that
> before any new feature work. Strip the debug `console.log` in the
> host-mousedown handler and flip `reactStrictMode: true` back on
> once smoke passes. Open items in the doc.
