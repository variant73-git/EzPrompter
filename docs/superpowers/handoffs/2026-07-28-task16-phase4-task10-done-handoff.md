# Handoff — Task 16 persisted `/canvas` gate: Task 10 DONE, harness proven, resume at Task 11

**Date:** 2026-07-28 · **Branch:** `codex/live-animated-clone-editing` · **HEAD:** `e859faba`

**Type:** EXECUTION of `docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md`. Continue at **Task 11** with `superpowers:executing-plans` (TDD-ish, one commit per task, explicit-path `git add` — 65+ untracked noise files present, NEVER `-A`).

## 1. What shipped this session — Task 10 (commit `e859faba`)
The first four persisted `/canvas` scenarios + the host-panel driver, replacing the `runCanvasGate` placeholder throw. **4/4 green on a clean fresh seed via the full runner path**, 3 consecutive `--no-start-server` runs, e2e vitest 19/19.
- **New:** `packages/web-shell/e2e/native-motion/canvas-helpers.mjs`, `canvas-scenarios.mjs`.
- **Modified:** `native-motion-editing.spec.js` (import + wire `runCanvasScenarios` + the two runner fixes below), `e2e/fixtures/native-motion/seed.mjs` (node positions).
- Checks passing: `canvas.fixed-viewport-framing`, `canvas.scroll-pan-disabled`, `canvas.partial-selection`, `canvas.finite-settlement-and-loop-indicator`.

## 2. ⭐ Hard-won infra fixes (do NOT rediscover — this ate most of the session)
- **localhost, not 127.0.0.1 (the big one).** `next dev` ALWAYS reports `request.url` origin as `http://localhost:<port>` regardless of how the client connects. The native runtime gateway (`app/api/runtime/[token]/[...path]/route.js`) rejects any asset whose origin ≠ `UNCRAFT_RUNTIME_ORIGIN` → `wrong_runtime_origin` → **404 → blank runtime iframe → no layers/timeline**. Fix (shipped in the runner): `baseUrl → http://localhost:<port>` AND `startNextServer` pins the child's `UNCRAFT_RUNTIME_ORIGIN` to `http://localhost:<port>` (overrides the 127.0.0.1 in `.env.local`). Page origin + runtime origin + request.url must all be `localhost` (same-origin iframe). Verified: asset → 200 with the real clone HTML once aligned.
- **Entering native edit is intermittently a no-op** (was ~50% flaky) — the `?focusNode` selection + camera frame races the Edit click; `onEditSite` is a no-op if `selectedSiteNode` is momentarily null. Fix (in `openNativeEdit`): wait for `[data-node-id=<id>].selected` to settle, then **retry the inspector Edit click up to 3×** until `body.native-motion-editing` attaches. Safe against double-toggle: the inspector button reads "Edit" only while NOT editing.
- **JWT_SECRET (and other import-captured secrets) must be set BEFORE node starts.** `lib/auth.js:5` captures `const JWT_SECRET = process.env.JWT_SECRET` at module load, which happens on the runner's static import of the seed — BEFORE `loadLocalEnv()` runs. So the documented run command (which omits JWT_SECRET) fails the seed with `secretOrPrivateKey must have a value`. The working command sets them on the CLI (below). **The plan's Task 19 command block needs this correction.**
- **Don't interleave `seed.integration.test.js` with gate runs.** Its `beforeEach` does `DELETE FROM boards WHERE name='e2e-native-motion-fixture'`, churning ownership/session state and producing spurious runtime-session 404s (`b.user_id=user.id` / `openOrResumeEditSession not_found`). For a clean run, delete the fixture board first, then run the full gate — a clean fresh seed is 4/4 green.

## 3. ⭐ Selector map (verified live — reuse for Tasks 11-18)
Drive everything through HOST panels; the clone iframe is opaque.
- **Open a node into edit:** navigate `E2E_NATIVE_MOTION_BOARD_URL + '?focusNode=<primaryNodeId>'` (pre-selects + camera-frames), then click the side inspector's Edit action (`aside[aria-label="Selected node inspector"]` → `getByRole('button',{name:'Edit',exact:true})`). Viewport-stable, unlike the in-canvas float button.
- **Viewport wrapper:** `[aria-label="Native website editing viewport"]`, `data-viewport-width="1280"`, `data-edit-state` (default `navigating`), `data-previewing` ABSENT in edit mode (present only in preview). Runtime iframe: `iframe[title="Native animated website runtime"]`.
- **Board pan/zoom:** `.react-transform-component` inline `style.transform` (`translate(x,y) scale(s)`). Panning is disabled while editing.
- **Layer selection:** timeline strips `[data-layer-strip][aria-label="Select <label>"]` (inside `[data-element-row]`, carry `data-selected`). Fixture labels: **`We found a better way`** (hero/finite), **`badge`** (loop), **`ambiguous`** (2 motions). Sidebar layer buttons: `aside[aria-label="Website editing sidebar"] button[aria-label^="<label>"]` (aria-label = `"<label>, <kind>, N motions"`).
- **Inspector:** `aside[aria-label="Native website inspector"]`; header `<strong>` = selected label (or `Nothing selected`); tabs `#native-motion-inspector-tab-{properties|motion|code}`.
- **⭐ Loop vs finite discriminator:** the timeline shows a `[data-motion-loop="true"]` "Loop" badge for EVERY loop row always (badge, ambiguous) — NOT selection-specific and NOT inside `[data-element-row]`. The discriminating signal is the **inspector-scoped** loop badge: `aside[aria-label="Native website inspector"] [data-motion-loop="true"]` appears only when the SELECTED element (on the Motion tab, settled) loops. Finite hero → none. Duration readout: `getByText(/\d+(\.\d+)?s\s*\/\s*\d+(\.\d+)?s/)` (hero rise = `"0.80s / 0.80s"`).
- **Transform fields (Task 11):** `getByLabel('X',{exact:true})`, `getByLabel('Rotate',{exact:true})` — on the Properties tab, `exact:true` (else matches "Scale X"/"Skew X"). Undo/Redo: `aria-label="Undo"` / `"Redo"` in `div[role="toolbar"][aria-label="Edit history"]`. NOTE: the "N changes" counter is LAB-ONLY (not in canvas chrome); canvas commit = `.canvas-edit-done` "Done" button. `openInspectorTab`/`transformField`/`selectStripByLabel` helpers already exist in canvas-helpers.mjs.

## 4. Working run command (fresh disposable DB seeds on first run)
```bash
cd packages/web-shell
val(){ grep "^$1=" .env.local | cut -d= -f2-; }
# clean slate first if the board was churned by vitest:
DATABASE_URL="$(val E2E_ISOLATED_DATABASE_URL)" node --input-type=module -e "import{neon}from'@neondatabase/serverless';const s=neon(process.env.DATABASE_URL);await s\`DELETE FROM boards WHERE name='e2e-native-motion-fixture'\`"
lsof -tiTCP:34316 -sTCP:LISTEN | xargs -r kill -9   # sweep the port (stale servers happen)
DATABASE_URL="$(val E2E_ISOLATED_DATABASE_URL)" JWT_SECRET="$(val JWT_SECRET)" \
  UNCRAFT_NATIVE_BUNDLE_STORE_ROOT="$(val UNCRAFT_NATIVE_BUNDLE_STORE_ROOT)" \
  UNCRAFT_RUNTIME_SESSION_SECRET="$(val UNCRAFT_RUNTIME_SESSION_SECRET)" \
  E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1 \
  npm run e2e:native-motion -- --canvas-only
```
Do NOT set `UNCRAFT_RUNTIME_ORIGIN` (the runner pins it). Report: `/tmp/uncraft-task16-e2e/<runId>/report.json` + screenshots. **Fast-iteration tip:** keep a warm `next dev` on `localhost:34316` (same env, `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true`, `NEXT_DIST_DIR=.next-task16-e2e`) and run with `--no-start-server --base-url http://localhost:34316` (~1-2 min vs ~3 min cold).

## 5. Environment — READY (do not re-provision)
- Isolated disposable DB `.env.local` `E2E_ISOLATED_DATABASE_URL`, endpoint **`ep-orange-frost-acaedcil`** (schema applied). NEVER production (`ep-lingering-shadow-achloaoq`). Seed guards it (allowlist). Bundle store `/tmp/uncraft-task16-bundle-store` (has the `f26db766` fixture bundle). Standing authorization (user, 2026-07-28): seed MAY write the isolated DB + `/tmp` store.
- Fixture board currently seeded fresh + healthy (owner `e2e-native-motion-fixture-owner@example.test`).

## 6. Pending / next
- **Task 11** (retarget + independent transform components + single undo) — start here; selectors above.
- Tasks 12-18 (ambiguous owner, unlink, preview, custom controls, **Task 14 fault seam** = prod code, needs its own impl review + prod-inertness route test), Task 15 snapshot restore, 16 two-node isolation, 17 diagnostics/security, 18 a11y/perf/visual.
- Tasks 19-20 (green gate + README). **Task 19 command block must be corrected** for JWT_SECRET + `UNCRAFT_RUNTIME_ORIGIN` (drop it; pinned by runner) + the churn caveat.
- [SALVAR] not fully done this session (memory checkpoint written; CLAUDE.md item + vault note still TODO). When Task 16 is finally green: delete the disposable Neon project + revert the scaffolding env.
