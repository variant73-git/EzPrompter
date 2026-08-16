# Handoff — Task 16 persisted `/canvas` gate: resume at Task 12 (ambiguous owner · unlink · reconnect)

> **⚠️ ADDENDUM 2026-07-29 (supersedes §2-item-2 and §3 fixture guidance):** the GSAP-ownership audit (`2026-07-29-gsap-ownership-audit-finding.md`, Claude probe + Sol/Claude 2-vendor audit) changed the picture. (a) **Product decision (Adilson, standing):** an element with 2 animations must show BOTH in the controls, each editable — even on a true same-property conflict, show both separately; no blocking modal. (b) The chooser fixture material must NOT be CSS drift+pulse (coarse artifact) **nor GSAP x+x** (fake ambiguity, last-wins) — use **two independent-behavior writers (Entrance + Hover / Scroll + Hover)**. (c) The frente's Task 10 (ownership) has a verified 5-hole inventory (keyframes: ignored → style-stomp; transform-string coarse in GSAP; `gsap.from()` opens a locked chooser with zero conflict; multi-target/split-text unowned; loop writeback not component-aware) — the `canvas.ambiguous-owner-resolution` scenario design should be settled WITH Sol against that finding before coding.

**Date:** 2026-07-28 · **Branch:** `codex/live-animated-clone-editing` · **HEAD:** `07ae0a5c`

**Type:** EXECUTION of `docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md` → **Task 12**. Use `superpowers:executing-plans` (one commit per task, explicit-path `git add` — untracked noise present, NEVER `-A`). Coordination: **Sol drives the frente; Claude executes the gate sub-plan task-by-task + does [SALVAR].** Tasks 10 (`e859faba`) and 11 (`46c109c9`, stability-confirmed 3× cold 7/7) are DONE — 7/7 canvas checks green.

## ⭐⭐ READ FIRST — two things about Task 12 that need a decision BEFORE coding
Grounded in the actual components (not the plan's prose), Task 12 step 2 as written **cannot be implemented against the current fixture, and its mechanic contradicts the code**. Surface this to the user/Sol before starting — same lesson as Task 11's "check-name is the contract": verify the runtime, don't trust the plan's narrative.

1. **`canvas.unlink-cancel-then-confirm` is BLOCKED on two counts:**
   - **No shared animation in the fixture.** The timeline Unchain button (`aria-label="Unchain <label> from its shared animation"`, `NativeMotionEditor.jsx:1850`) renders **only when `sharedLinks.length > 0`** — i.e. one animation touches ≥2 layers/rows (`sharedLinks = row.links.filter(id => linkRowCount[id] > 1)`, `:1796`). The fixture's four `@keyframes` each target exactly ONE element (`rise`→hero, `spin`→badge, `drift`+`pulse`→ambiguous) → **no link touches >1 row → the Unchain button never renders → the check is untestable as-is.** Fixing it needs a fixture-site + seed change: an animation shared across ≥2 elements (a stagger group). How the bridge forms a shared link: `clipGroupMeta`/`targetCount>1` for a multi-target tween, or the CSS **split-token stagger** group it detects (`runtime-bridge-source.js:213-217`, a common parent with >1 `SPLIT_TOKEN`). This is a small spike — pick the cheapest shape the bridge reports as one motion over multiple rows, then re-seed.
   - **The timeline unlink has NO confirm dialog.** `unlinkMotion` (`useNativeMotionController.js:1543`) applies a `link.detach` patch **directly** — there is no confirm/cancel/confirm modal anywhere for it (grep for `role="dialog"` finds only the curve editor). So "click Unchain → **confirm dialog → Cancel → reopen → Confirm**" does not exist in the code. Decision needed: (a) re-scope the check to the **direct** detach (click → assert chain icon gone, no dialog); or (b) the "confirm dialog" the plan means is actually the **field-level scope popover** (see below), not the timeline Unchain; or (c) add a confirm dialog to timeline unlink (a PROD product change — out of scope for an e2e gate, needs Sol/user). My read: the plan conflates the timeline Unchain with the field scope button.

2. **`canvas.ambiguous-owner-resolution` works, but the candidate labels COLLIDE.** For `#ambiguous`, both motions are infinite → behavior `loop` → **both candidates label "Loop"** → the chooser renders **two `button[aria-label="Edit Loop"]`** (`MotionOwnershipChoice.jsx:33`). Pick by `.nth(0/1)` or by the owning channel, not by aria-label alone. Assert the edit applied to the CHOSEN motion (the chooser `onChoose(channelId)` → `chooseOwnership`).

## Grounded selectors / mechanics for Task 12
- **Ambiguous chooser** (`MotionOwnershipChoice.jsx`, rendered at `NativeMotionEditor.jsx:2348` AND in the inspector `NativeMotionInspector.jsx:99`): `section[aria-labelledby="native-motion-ownership-heading"]`, heading text `Multiple motions control <label>`, a `role="list"` of `button[aria-label="Edit <candidate.label>"]`. Renders only when `ownership.status==='ambiguous'` AND `candidates.length ≥ 2`. Trigger: select `#ambiguous` (`LABEL_AMBIGUOUS='ambiguous'`), open Properties, edit a transform field (e.g. `setTransform(page,'X','20px')`) — `applyStyle` sees ambiguous ownership and calls `setOwnershipConflict` (with `pending={property,value,before}`) INSTEAD of applying (`useNativeMotionController.js:1320-1333`). Also reachable via the field's `OwnershipIndicator` button `aria-label="Choose controlling motion for <label>"` (`NativeMotionEditor.jsx:222`), which opens the chooser + switches to the Motion tab.
- **Field scope button** (`PropertyScopeButton.jsx`, inside each Field's `<label>`): `button[data-scope="per-device|shared|computed"]`. per-device → `Unlink2`, `aria-label="Apply <label> to all devices"`, click → `onRequest({action:'reconnect'})`. shared → `Link2`, `aria-label="Change device scope for <label>"`, click → `onRequest({action:'unlink'})`. computed → disabled. `onRequest` = `commands.requestResponsiveScopeChange` — CHECK whether it opens a popover/menu (that popover, not the timeline, is the likely "dialog" for cancel/confirm). NOTE: this scope button is exactly the accessible-name pollution that made me use the **leaf-text locator** in Task 11 — keep using `transformInput`'s pattern.
- **Device switch** (canvas edit chrome, `CanvasClient.jsx:5983`): `button[aria-label="Desktop editing viewport" | "Tablet editing viewport" | "Mobile editing viewport"]` → `changeDevice(id)`. Widths desktop 1280 / tablet 768 / mobile 390.
- **Per-device fixture data**: the seed carries ONE per-device binding — `hero:opacity` overrides `{desktop:1, tablet:0.9, mobile:0.8}` (`build-fixture-manifest.mjs:110-116`). So `reconnect-matches-device-values` reads the hero **Opacity** field (Appearance section) across device switches. Reconnect (per-device→shared) collapses to the shared value, after which desktop/tablet read the same → they "match". (Read the Opacity field via the inspector; the runtime iframe is opaque.)

## Reusable harness (Task 11 shipped these — reuse, don't rebuild)
In `packages/web-shell/e2e/native-motion/canvas-scenarios.mjs` / `canvas-helpers.mjs`:
- `transformInput(page, field)` — leaf-text `<label>` locator scoped to the motion inspector (NOT `getByLabel`, which timed out). `openProperties`, `setTransform(page,field,value)`, `readTransform(page,field)`, `waitUndoDisabled(page,bool)`, `undoButton(page)`.
- `selectStripByLabel(page, label)` / `selectLayer` / `openInspectorTab(page, 'properties'|'motion'|'code')` / `openNativeEdit` / `gotoBoard` / `waitIdle` / `boardTransform`.
- **Read state via the INSPECTOR** (opaque runtime iframe). The LAB analogs in `native-motion-editing.spec.js` (`lab.*`) read the same-origin target and are the proven behavior template — mirror their assertions, adapt the reads.
- **Diagnostic-record trick**: when a locator times out ambiguously, add a temp `record('canvas.__diag', …)` that `page.evaluate`-dumps the inspector (active tab, input names+values, innerText) and `throw`s the JSON → it lands in `report.json` `checks[].error`. One cold run = definitive DOM truth. Remove after.

## Run command / env (unchanged, isolated DB — NEVER production)
```bash
cd packages/web-shell
val(){ grep "^$1=" .env.local | cut -d= -f2-; }
DATABASE_URL="$(val E2E_ISOLATED_DATABASE_URL)" node --input-type=module -e "import{neon}from'@neondatabase/serverless';const s=neon(process.env.DATABASE_URL);await s\`DELETE FROM boards WHERE name='e2e-native-motion-fixture'\`"
lsof -tiTCP:34316 -sTCP:LISTEN | xargs -r kill -9
DATABASE_URL="$(val E2E_ISOLATED_DATABASE_URL)" JWT_SECRET="$(val JWT_SECRET)" \
  UNCRAFT_NATIVE_BUNDLE_STORE_ROOT="$(val UNCRAFT_NATIVE_BUNDLE_STORE_ROOT)" \
  UNCRAFT_RUNTIME_SESSION_SECRET="$(val UNCRAFT_RUNTIME_SESSION_SECRET)" \
  E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1 \
  npm run e2e:native-motion -- --canvas-only
```
Do NOT set `UNCRAFT_RUNTIME_ORIGIN` (the runner pins it to `http://localhost:34316`). Report → `/tmp/uncraft-task16-e2e/<runId>/report.json`. `JWT_SECRET` MUST be on the CLI (captured at import by `lib/auth.js`). Isolated Neon `ep-orange-frost-acaedcil` (schema applied); bundle store `/tmp/uncraft-task16-bundle-store` (fixture bundle `f26db766`). NEVER production `ep-lingering-shadow-achloaoq`. If you edit the fixture (for the shared-animation gap), re-seed: delete the board first, then run — a truly fresh seed is the clean path. Cold run ~3 min; runtime iframe attach is occasionally slow (`openNativeEdit` retries) but attaches ~17s.

## Order of attack (suggested)
1. Raise the two blockers above with Sol/user; get the unlink semantics + fixture-extension decision.
2. `canvas.ambiguous-owner-resolution` first (fully supported today; only the label-collision to handle).
3. `canvas.reconnect-matches-device-values` (supported by `hero:opacity`; confirm the field scope-button reconnect flow + device reads).
4. `canvas.unlink-cancel-then-confirm` LAST (needs the fixture shared-animation spike + the confirm-dialog decision).
5. When Task 16 is finally green: delete the disposable Neon project + revert scaffolding env. Task 19's command block still needs the JWT_SECRET + drop-`UNCRAFT_RUNTIME_ORIGIN` corrections.

Prior handoffs (context): `2026-07-28-task16-task11-done-handoff.md` (Task 11 detail), `2026-07-28-task16-phase4-task10-done-handoff.md` (§2 infra fixes, §3 full selector map). Memory: [[checkpoint_2026-07-28_task16-task11-transform-undo]], [[checkpoint_2026-07-28_task16-task10-persisted-canvas]].
