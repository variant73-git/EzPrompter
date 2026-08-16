# Handoff — Task 16 persisted `/canvas` gate: Task 11 DONE, resume at Task 12

**Date:** 2026-07-28 · **Branch:** `codex/live-animated-clone-editing` · **HEAD:** `46c109c9`

**Type:** EXECUTION of `docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md`. Continue at **Task 12** with `superpowers:executing-plans` (one commit per task, explicit-path `git add` — untracked noise present, NEVER `-A`). Coordination: Sol drives the frente; Claude executes the gate sub-plan task-by-task + does [SALVAR].

## 1. What shipped — Task 11 (commit `46c109c9`)
Three persisted `/canvas` acceptance checks added to `packages/web-shell/e2e/native-motion/canvas-scenarios.mjs` (+108 lines, ONLY file changed). **7/7 canvas green on a fresh cold seed**; e2e vitest 13 passed / 6 skipped (Neon-gated), 0 failed. Clean-integer results:
- `canvas.single-undo-disables` → `{original:0, afterEdit:12, reverted:0}`
- `canvas.direct-retarget` → `{appliedX:18, motionSurvived:true}`
- `canvas.independent-transform-components` → `{appliedRotate:7, retainedX:18}`

## 2. ⭐ Facts learned (reuse for Tasks 12–18)
- **The LAB analogs are the proven template.** `lab.direct-retarget-and-single-undo` + `lab.independent-transform-components` (`native-motion-editing.spec.js`) test the same behavior on the same-origin lab target; the canvas versions differ only in reading via the INSPECTOR (opaque runtime iframe) and using the Undo disabled-state (the "N changes" counter is LAB-ONLY).
- **Element choice = ownership.** Fixture: `#hero`(rise, translateY+opacity) · `#badge`(spin, rotate) · `#ambiguous`(drift translateX + pulse scale). `#hero`'s single motion owns the whole transform channel → editing X/Rotate is a genuine single-owner retarget, both composing. **`#ambiguous` raises the ownership chooser for ANY transform component** (both motions write `transform`) — that is exactly **Task 12**'s `canvas.ambiguous-owner-resolution`. So for Task 12: select `#ambiguous` (`LABEL_AMBIGUOUS='ambiguous'`), edit a transform property (e.g. X) → `MotionOwnershipChoice` appears; pick an owner; assert it applies.
- **Transform fields render only when `transform.reliable`** (`PropertiesPanel`, `NativeMotionEditor.jsx:579`); else the "Position and rotation are controlled by a complex motion" fallback. Verified hero is reliable (X=`0px`, Rotate=`0deg`).
- **Locate a transform field DOM-structurally**, NOT `getByLabel` (which timed out even though the field exists with accessible name exactly "X"). Helper (already in canvas-scenarios.mjs): `transformInput(page, field)` = `page.locator('<inspector> label').filter({ has: page.getByText(field,{exact}) }).locator('input')`. `readTransform` / `setTransform` / `openProperties` / `waitUndoDisabled` are also there and reusable.
- **Don't bounce selection to read committed** — the Field is `key={label:value}` and re-mounts on a genuine edit; read directly after `waitIdle`. No-op edits are ruled out by the undo-transaction signal (`waitUndoDisabled(false)`).
- **Undo/Redo (canvas chrome):** `div[role="toolbar"][aria-label="Edit history"]` → `button[aria-label="Undo"|"Redo"]`, `disabled = !canUndo || busy`. Preview: `button[aria-label="Preview website"]` in the same toolbar (Task 13). Each field commit is ONE transaction.

## 3. Task 12 selectors (from the plan + ownership analysis)
- `canvas.ambiguous-owner-resolution`: `#ambiguous` edit → `MotionOwnershipChoice` (the chooser). Ownership indicator on the field is `button[aria-label="Choose controlling motion for <label>"]` (`OwnershipIndicator`, renders only when `ownership.status==='ambiguous'`). Opening it switches the inspector to the Motion tab (`onOwnershipOpen` → `focusOwnership` + `selectTab('motion')`).
- `canvas.unlink-cancel-then-confirm`: timeline shared-animation row → `[aria-label^="Unchain"]` → confirm dialog → Cancel, reopen, Confirm; assert chain icon gone.
- `canvas.reconnect-matches-device-values`: reconnect (no dialog per plan) + switch device via canvas viewport buttons (`aria-label="Tablet editing viewport"`); assert per-device values match. The seed carries ONE per-device binding: `hero:opacity` overrides `{desktop:1, tablet:0.9, mobile:0.8}` (see `build-fixture-manifest.mjs`).

## 4. Run command / env (unchanged from Task 10)
Working command + env in `2026-07-28-task16-phase4-task10-done-handoff.md` §4/§5 (isolated Neon `ep-orange-frost-acaedcil`, bundle store `/tmp/uncraft-task16-bundle-store`, `E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1`, `JWT_SECRET` on the CLI, runner pins `UNCRAFT_RUNTIME_ORIGIN`). Report → `/tmp/uncraft-task16-e2e/<runId>/report.json`. NEVER production `ep-lingering-shadow-achloaoq`.

## 5. Status / caveats
- **Stability CONFIRMED**: **3 consecutive fresh cold `--canvas-only` runs, all 7/7**, every Task-11 check green in each (matches Task 10's 3× bar). One cold run during earlier debugging flaked at scenario 1 with the **runtime iframe not attaching in 120s** — pre-existing infra non-determinism (`openNativeEdit` already retries entering edit), ORTHOGONAL to Task 11 logic; it did NOT recur across the 3 stability runs (all attached ~17s).
- When Task 16 is finally green: delete the disposable Neon project + revert scaffolding env. Task 19's command block still needs the JWT_SECRET + drop-`UNCRAFT_RUNTIME_ORIGIN` corrections (carried from Task 10 handoff).
