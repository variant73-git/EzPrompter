# Handoff — Task 16 persisted `/canvas` E2E gate build (Phase 1 in progress)

**Date:** 2026-07-28 · **Branch:** `codex/live-animated-clone-editing` · **HEAD:** `4387cab8`

**Type:** EXECUTION of a written, audited plan (not brainstorm). Continue building from **Task 4**.

> **First step for the next session:** read the canonical plan
> `docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md` IN FULL, then
> continue with **Task 4**. Use `superpowers:executing-plans`. Keep TDD + one commit per task +
> explicit-path `git add` (never `git add -A` — 65 untracked noise files present). Run **Sol
> audits at consequential points** (the fault-injection seam in Task 6a, the green gate in Task 19).

## 1. What this is
Building the persisted `/canvas` acceptance path of Task 16: an idempotent, endpoint-guarded
**fixture seed** (the "mutation pack") + the real persisted **scenarios** that replace the
`native-motion-editing.spec.js` line-509 placeholder, so `npm run e2e:native-motion --canvas-only`
runs green with saved evidence. Part of the `live-animated-clone-editing` front (freeze-frame
editing of animated clones; product decision **C hybrid** already made). CLAUDE.md 165.

## 2. State — DONE and committed
- `24e9f2c6` — the **audited plan** (Codex/Sol + independent Claude reviewer; guard hardened, fault
  slice corrected to path A, bundle-store root + `--canvas-only` gating added).
- `7266acaa` — **Task 1**: `assertIsolatedTarget` seed guard (`new URL().hostname`, allowlist). 5 tests.
- `972f8dd8` — **Task 2**: `seedUsers` (admin + non-admin + `uncraft_sess` cookie, idempotent). Integration test passes against the isolated DB.
- `4387cab8` — **Task 3**: `fixture-site/index.html` (finite `#hero` / loop `#badge` / ambiguous `#ambiguous`) + `seedBundle` (content-addressed native-bundle registration). Integration: 3/3.

**Phase 1 is 3/5.** Next: Task 4 (`seedBoardAndNodes`), Task 5 (orchestrator + `/canvas` smoke), then Phases 2–5.

Files created so far (all under `packages/web-shell/e2e/fixtures/native-motion/`):
`seed.mjs` (exports `assertIsolatedTarget`, `FIXTURE_TAG`, `ALLOWLIST_ENDPOINT`, `seedUsers`, `seedBundle`),
`seed.guard.test.js`, `seed.integration.test.js`, `fixture-site/index.html`.

## 3. Environment — READY (do not re-provision)
- **Isolated disposable DB** provisioned by the user: `E2E_ISOLATED_DATABASE_URL` in
  `packages/web-shell/.env.local`, endpoint **`ep-orange-frost-acaedcil`** (São Paulo). **Schema
  already APPLIED** (19 tables, `migrated:true` confirmed by the runner preflight). NEVER touch the
  production `DATABASE_URL` (endpoint `ep-lingering-shadow-achloaoq`).
- Scaffolding in `.env.local` (gitignored): `UNCRAFT_NATIVE_BUNDLE_STORE_ROOT=/tmp/uncraft-task16-bundle-store`,
  `UNCRAFT_RUNTIME_SESSION_SECRET` + `UNCRAFT_RUNTIME_ORIGIN` (test values), plus the pre-existing
  `JWT_SECRET` (real) and `UNCRAFT_NATIVE_CLONE_ROOT` (for the `runLab` lab).
- **Standing authorization (user, 2026-07-28):** the seed MAY write fixtures (users/board/nodes/
  bundles/sessions) to the **isolated** DB, and use the `/tmp` bundle store. This is the rule-4
  explicit authorization — scoped to the isolated endpoint only.

**Run the seed integration tests (they SKIP without the DB env):**
```bash
cd packages/web-shell
E2E_URL=$(grep '^E2E_ISOLATED_DATABASE_URL=' .env.local | cut -d= -f2-)
JWT=$(grep '^JWT_SECRET=' .env.local | cut -d= -f2-)
STORE=$(grep '^UNCRAFT_NATIVE_BUNDLE_STORE_ROOT=' .env.local | cut -d= -f2-)
E2E_ISOLATED_DATABASE_URL="$E2E_URL" JWT_SECRET="$JWT" UNCRAFT_NATIVE_BUNDLE_STORE_ROOT="$STORE" \
  npx vitest run e2e/fixtures/native-motion/seed.integration.test.js
```

## 4. Gotchas discovered (don't rediscover)
- **`import.meta.url` is NOT `file://` under vitest** → resolve fixture paths via `process.cwd()`
  (both vitest and the runner execute from `packages/web-shell`). See `seed.mjs` `seedBundle`.
- **Endpoint guard MUST use `new URL(url).hostname`** — a two-`@` URL connects to the LAST `@`'s
  host (production) while a raw regex matches the first (Codex finding).
- **The native clone iframe is opaque** (`sandbox="allow-scripts allow-pointer-lock"`, NO
  `allow-same-origin`) → Phase 4 scenarios drive selection/edits through **host panels** (Layers
  list buttons, timeline rows, inspector fields) and assert host state attributes
  (`data-motion-loop`, `data-edit-state`, `data-previewing`, `data-selected`), never iframe DOM.
- **Native-ness comes from the snapshot, not node kind** (`kind='site'` + snapshot with
  `native_bundle_id` + `motion_manifest_version=2` + flag `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true`).
- **`snapshots_native_manifest_shape` CHECK** requires `motion_manifest->>'baseBundleId' == native_bundle_id`.
- **Fault slice = path A (LOCKED):** faults are a RUNTIME overlay (`controlAvailability`/`recoveryStatus`
  in `useNativeMotionController.js`), NOT a manifest field. Task 6a spikes the injection seam; the
  control manifest can only hold `status:'ready'` accepted controls (strict `control-manifest.js`).
- **`registerNativeBundle`**: omit `assetIndex` (auto-computed; `validateDeclaredIndex` returns early
  on null). Store via `createConfiguredBundleStore()` (reads `UNCRAFT_NATIVE_BUNDLE_STORE_ROOT`).
- Green gate on **`--canvas-only`** (default `all` also runs `runLab`, needs the clone root).

## 5. Key code pointers (from the 3 exploration agents — the plan embeds most)
- **Seed data model:** users `app/api/auth/signup/route.js:40`; `createToken`/`hashPassword` `lib/auth.js:16/8`;
  board `app/api/boards/route.js:52`; node `app/api/nodes/route.js:20`; native snapshot insert mirrors
  `lib/deferred-reconstruction.js:71-88`; `createEmptyMotionManifest` `lib/motion-editor/manifest.js:282`;
  edit sessions `openOrResumeEditSession`/`commitEditSession` `lib/motion-editor/edit-session-store.js:107/274`;
  `resolveNodeEditorKind` `lib/node-editor-kind.js:46`.
- **Runner harness:** `runLab` `native-motion-editing.spec.js:198` (template); `createRecorder:141`;
  `runCanvasGate:497` (widen to `{browser,baseUrl,evidenceDir,report}`); replace throw at `:509`;
  call site `:545`; `REQUIRED_CANVAS_ENV:18`; `loadLocalEnv` only fills missing (:84).
- **`/canvas` surface:** `app/canvas/[boardId]/page.jsx`; `components/CanvasClient.jsx` (provider +
  topbar, `uncraft:editor-action`, device buttons `aria-label="Tablet editing viewport"` `:5983`);
  `NativeMotionEditChrome.jsx` (Undo/Redo/Preview/Back-to-Edit); `NativeEditSidebar.jsx` (Layers rows);
  `NativeMotionInspector.jsx` (tabs, `[data-motion-loop]` `:50`); `NativeEditViewport.jsx:168` (iframe
  sandbox); exhausted tooltip verbatim at `CustomControlsSection.jsx:6`
  (`This website doesn't support this control.`).

## 6. Audits + decisions log
- Schema-apply approach audited by Sol (fail-open guard → hardened). Plan audited by Codex/Sol
  (timed out on `max` but caught the two-`@` guard hole) + an independent Claude reviewer (caught the
  fault-slice impossibility + under-scoped accepted control + bundle-store-root gap). All folded in.
- Product decision **C (hybrid freeze-frame)** for editing animated clones; **Sol drives** that front,
  **Claude reviews + [SALVAR]**. Fault-slice fork → **path A** (build the injection seam).

## 7. Pending
- Tasks 4–20 (Phases 1 tail → 5). Task 6a spike is the riskiest (fault-injection seam feasibility).
- [SALVAR] for this build session: memory checkpoint written; CLAUDE.md item **166** + vault note
  still TODO (context ran low). Next session or a [SALVAR] should add them.
- When Task 16 is finally green: delete the disposable Neon project + revert the scaffolding env.
