# Handoff — Task 16 persisted `/canvas` E2E gate: Phases 1–3 DONE, Phase 4 ready

**Date:** 2026-07-28 · **Branch:** `codex/live-animated-clone-editing` · **HEAD:** `8058ff04`

**Type:** EXECUTION of the audited plan `docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md`. Continue at **Task 10** with `superpowers:executing-plans` (TDD, one commit per task, explicit-path `git add` — never `-A`, 65+ untracked noise files present).

## 1. What's DONE and committed this session (Tasks 4–9 + the 6a audit)
- `b6fb29e9` — **Task 4** `seedBoardAndNodes` (board + two native nodes + base native snapshots, idempotent).
- `37626923` — **Task 5** `seedNativeMotionFixture` orchestrator. **/canvas smoke PASSED** (both native nodes render "Ready to edit"; screenshot in scratch — not committed).
- `8a1a5e76` — **Task 6a spike** findings appended to the plan (see "Spike findings" section).
- `3901f4f0` + `aa01b70f` — **Task 6b** `buildFixtureManifest`, then the **audit correction**.
- `2dd47a8f` — **Task 7** `seedSnapshotHistory` (≥2 committed native-edit snapshots, distinct hero-opacity, idempotent).
- `e185ff59` — **Task 8** exported harness helpers + guarded `main()` auto-run + widened `runCanvasGate({browser,baseUrl,evidenceDir,report})`.
- `8058ff04` — **Task 9** `ensureFixtureEnv` seed hook (populates the four `E2E_NATIVE_MOTION_*` env vars only under `ALLOW_MUTATIONS=1`; no-op otherwise → gate stays fail-closed).

**Tests:** `npx vitest run e2e/` → **19 pass** (4 files: `seed.guard`, `seed.integration` [gated on `E2E_ISOLATED_DATABASE_URL`], `build-fixture-manifest`, `native-motion-editing.harness`). `--canvas-only` without approval still reports **blocked** (verified twice).

## 2. ⭐ Fault-seam audit (Task 6a) — Codex + Claude, each claim verified against code
Both models reviewed the fault-injection seam DESIGN (`fault-seam-design.md`). Full findings are in the plan's **"Spike findings"** section. The load-bearing outcomes that bind Task 14 and already changed the fixture:
- **Three ready controls, not one** (the overlay only lists manifest controls; each fault scenario needs its own). Shipped in 6b: `ctl-ok` (healthy), `ctl-recover`, `ctl-exhausted`.
- **Fixture controls could never reach the runtime `controlForPatch`** — Codex caught this; verified in code: `findElement` matches `data-uncraft-id` ONLY (authored `id` gets rewritten to `el-<hash>`), and `<span>` is NOT in the bridge `SELECTABLE` set. Fixed: selectable `<div>`s with explicit `data-uncraft-id`; `hero` too.
- **css-custom-property reads return STRINGS** → `slider-number` was type-incompatible. Fixed: string-valued **`color`** controls on inline-initialized + CSS-consumed custom properties.
- **⭐ Task 14 gating MUST be server-only + fail-closed:** `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT` is a rollout flag that ships `'true'` in prod — NOT a safety boundary. Gate on `NODE_ENV !== 'production'` AND server-only `E2E_NATIVE_MOTION_FAULT_INJECTION === '1'` AND fixture-node scoping; add a route test proving prod inertness.
- **Seam mechanics (verified):** chokepoint `controlForPatch` (`runtime-bridge-source.js:2817`); throw `bridgeError('write_failed', …)` WITH `.code`; phase-aware (recover = fail first WRITE `applyControlPatch`, exhaust = fail write + recovery reads); `REJECTED_MUTATION` sequence `[REINSPECT,REBIND,DISABLE_CONTROL]` disables on 3rd. Keep fixture `transactions: []`.
- **Residual (Codex):** runtime application of a control CANNOT be proven by parser round-trips — **Tasks 13/14 MUST assert live** (a patch reaches `controlForPatch` and commits) in the real browser.

## 3. Phase 4 (Tasks 10–18) — the persisted `/canvas` scenarios (NEXT)
All scenarios live in NEW files `packages/web-shell/e2e/native-motion/canvas-scenarios.mjs` + `canvas-helpers.mjs`, run by `runCanvasScenarios({browser,baseUrl,evidenceDir,report})`, which must be imported into `native-motion-editing.spec.js` and REPLACE the line-509 throw inside `runCanvasGate` (after the fail-closed preflight passes). See plan Phase-4 preamble for the `runLab`-mirroring harness (cookie `uncraft_sess`, `context.route` external-block, `createRecorder`).
- **Task 10** (start here): `canvas-helpers.mjs` (`gotoBoard`, `openNativeEdit`, `selectLayer`, `openInspectorTab`, `transformField`, `waitIdle`) + first 4 checks (framing / scroll-pan-disabled / partial-selection / finite-settlement+loop). Wire `runCanvasScenarios`.
- **Gotcha from the Task 5 smoke:** the node's **Edit button is hover-revealed** (topbar hidden by default, item 148) — `openNativeEdit` must hover the node first, then click. Node has no `origin_url` → button reads "Edit" (not "Clone & Edit"). The clone iframe is **opaque** — drive selection/edits through host panels (Layers rows, inspector fields, timeline rows), assert host state attributes (`data-motion-loop`, `data-selected`, `data-previewing`, `data-edit-state`), NEVER iframe DOM.
- **Task 14** builds the prod-code fault-injection seam (per §2) — give it its own adversarial review of the IMPLEMENTATION + the prod-inertness route test.

**Run the full green gate (Task 19) like this** (fresh disposable DB seeds the rich manifest on first run):
```bash
cd packages/web-shell
DATABASE_URL=<isolated> E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1 \
  UNCRAFT_RUNTIME_SESSION_SECRET=<test> UNCRAFT_RUNTIME_ORIGIN=<baseUrl> \
  UNCRAFT_NATIVE_BUNDLE_STORE_ROOT=<shared /tmp dir> \
  npm run e2e:native-motion -- --canvas-only
```

## 4. Environment — READY (do not re-provision)
- Isolated disposable DB in `.env.local` `E2E_ISOLATED_DATABASE_URL`, endpoint **`ep-orange-frost-acaedcil`** (schema applied). NEVER production (`ep-lingering-shadow-achloaoq`).
- `.env.local` also has `UNCRAFT_NATIVE_BUNDLE_STORE_ROOT` (`/tmp/uncraft-task16-bundle-store`), `UNCRAFT_RUNTIME_SESSION_SECRET`, `UNCRAFT_RUNTIME_ORIGIN`, `JWT_SECRET`, `UNCRAFT_NATIVE_CLONE_ROOT`.
- **Standing authorization (user, 2026-07-28):** the seed MAY write fixtures to the **isolated** DB + use the `/tmp` bundle store.
- Fixture-DB note: the seed is idempotent by REUSE, so a manifest change (empty→rich, span→div) does NOT rewrite an existing base snapshot. The `seed.integration.test.js` `beforeEach` deletes the fixture board so tests are order-independent; a real gate run seeds a fresh DB.
- When Task 16 is finally green: delete the disposable Neon project + revert the scaffolding env.

## 5. Gotchas discovered (don't rediscover)
- **Manual smoke / any standalone script** that imports repo modules must run **from `packages/web-shell`** and resolve bare specifiers via `createRequire(pathToFileURL(resolve(cwd,'package.json')))` (bun hoisted layout); `playwright-core`'s `chromium` came back on `.default` under dynamic CJS import; use `waitUntil: 'domcontentloaded'` (the canvas app never reaches `networkidle`) + long timeouts for the cold route compile.
- `import.meta.url` ≠ `file://` under vitest → resolve fixture paths via `process.cwd()`.
- `snapshots_native_manifest_shape` CHECK: `motion_manifest->>'baseBundleId' == native_bundle_id`, version 2.
- Native-ness = snapshot (`native_bundle_id` + `motion_manifest_version=2`) + flag, NOT node kind.

## 6. Pending / [SALVAR]
- Tasks 10–20 (Phase 4 → 5).
- [SALVAR] for this session: memory checkpoint updated + this handoff; CLAUDE.md item + vault note still TODO if a full [SALVAR] is wanted.
