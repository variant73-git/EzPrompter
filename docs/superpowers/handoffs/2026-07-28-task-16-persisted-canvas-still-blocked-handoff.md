# Task 16 Checkpoint — Persisted Canvas STILL Blocked (verification pass)

**Date:** 2026-07-28

**Repository:** `/Users/adilsonporto/Desktop/IA/Uncraft`

**Branch:** `codex/live-animated-clone-editing`

**Initial commit (session start):** `624329c8 test(motion-editor): checkpoint task 16 browser qa`

**Final commit:** the commit containing this handoff (see git log)

**Status:** Task 16 remains **NOT complete** and **BLOCKED**. The persisted `/canvas`
exit gate is still unavailable because the isolated, migrated fixture infrastructure does
not exist and cannot be provisioned without applying migrations / seeding fixtures /
fixture-owner mutation-pack review — all of which are out of bounds under the task rules
and were not authorized. **No code was changed.** Task 17 was not touched.

This pass VERIFIED the blockage first-hand (it did not merely trust the 2026-07-27 handoff),
generated fresh dated evidence, ran the full test suite and build, ran an adversarial audit
(Codex/Sol + an independent Claude reviewer), and stops exactly at the blockage per rule 7.

## 1. What this pass did (and deliberately did NOT do)

Did (all read-only / non-mutating):
- Confirmed HEAD `624329c8`, clean tracked working tree, and that **nothing changed on this
  branch since the 2026-07-27 handoff** — no migration, no mutation pack, no new fixtures.
- Ran the persisted-gate preflight (`--canvas-only`, fail-closed, read-only) → fresh
  `blocked` verdict with saved evidence.
- Ran the full web-shell test suite and an isolated production build for current evidence.
- Ran an adversarial audit of the "blocked → stop" determination.

Did NOT (forbidden by the rules; not authorized):
- Did not apply any migration (rule 4).
- Did not create users, sessions, bundles, or a fixture board; did not fabricate
  credentials or results (rule 3).
- Did not run the persisted mutation pack, and did not weaken the fail-closed gate.
- Did not treat the `/motion-editor` lab as `/canvas` evidence (rule 5).
- Did not start or modify Task 17 (rule 1).
- Did not mark Task 16 complete (rule 6).

## 2. First-hand evidence (2026-07-28)

### Git state
- `git branch --show-current` → `codex/live-animated-clone-editing`.
- HEAD → `624329c8`.
- `git status --short --untracked-files=no` → empty (no tracked changes). 65 untracked
  files are pre-existing noise (`.firecrawl/*`, `Clone/`, `PROMPT_*.md`, build caches, …),
  unrelated to Task 16 and left untouched (rule 2).

### Persisted `/canvas` preflight — verdict: blocked
```text
Run: task16-20260728115329127-59f32fb3
Mode: canvas
Verdict: blocked
Evidence: /tmp/uncraft-task16-e2e/task16-20260728115329127-59f32fb3/report.json
explicitMutationApproval: false
missingEnvironment: E2E_NATIVE_MOTION_BOARD_URL, E2E_NATIVE_MOTION_PRIMARY_NODE_ID,
                    E2E_NATIVE_MOTION_SECONDARY_NODE_ID, E2E_NATIVE_MOTION_SESSION_COOKIE
schema.tables: ["native_bundles"]              (native_motion_edit_sessions ABSENT,
                                                 motion_diagnostic_events ABSENT)
schema.snapshotColumns: []                      (native_bundle_id, motion_manifest,
                                                 motion_manifest_version ABSENT)
schema.migrated: false
```
The preflight is read-only (two `SELECT ... information_schema` queries) and fails closed.
This is identical to the 2026-07-27 finding — the blockage is unchanged.

### Environment (`.env.local`, keys only, values not read)
- Present: `DATABASE_URL`, `JWT_SECRET`, `UNCRAFT_NATIVE_CLONE_ROOT` (lab), plus LLM/OAuth keys.
- Absent: `UNCRAFT_RUNTIME_SESSION_SECRET`, `UNCRAFT_RUNTIME_ORIGIN`, the selected native
  bundle store, and every `E2E_NATIVE_MOTION_*` value.
- `DATABASE_URL` is the real product Neon database, NOT a disposable isolated fixture DB.
  The fixture contract requires a disposable DB with no customer data.

### Tests
```text
Full suite (vitest run): 1294 passed | 4 skipped (1298 tests).
Files: 177 passed | 1 skipped | 1 FAILED (179).
```
The one failed file is `lib/snapshot.test.js` — the capture/pin CSSOM **integration** test
(checkpoint 164), which is UNRELATED to Task 16 (no motion-editor / native-clone code). It
failed with `Hook timed out in 10000ms` **during a concurrent `next build`**. Re-run in
isolation with no concurrent load:
```text
npx vitest run lib/snapshot.test.js → 1 file passed, 27/27 tests passed, 2.13s.
(An independent reviewer reproduced this: 27/27 passed in 2.20s.)
```
The failure did **not** reproduce in isolation. Suspected cause is Playwright browser-launch
contention under the concurrent build, but causation was **not reproduced or confirmed** — it
is reported here, not asserted. No code was changed in this pass, so it cannot be a regression
from this pass; it is a non-Task-16 file either way.

### Build
```text
NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true NEXT_DIST_DIR=.next-task16-verify npm run build
→ Compiled successfully in 50s; 41/41 static pages; exit 0.
```
The isolated build cache `.next-task16-verify` was removed afterward.

## 3. Exactly what is missing to unblock (unchanged from 2026-07-27)

The persisted `/canvas` exit gate cannot run until an isolated, disposable environment is
provisioned by the fixture owner:

1. The native-motion migrations **applied** to a **disposable isolated DB** (not the product
   `DATABASE_URL`). The migration *definitions already exist in-repo* and predate HEAD, so
   nothing needs to be authored — only *application* is missing, and applying migrations is
   forbidden here (rule 4):
   - `packages/web-shell/migrations/2026-07-26-native-motion-editing.sql` → `native_bundles`,
     `native_motion_edit_sessions`, and `snapshots.{native_bundle_id, motion_manifest,
     motion_manifest_version}`;
   - `packages/web-shell/migrations/2026-07-26-motion-diagnostics.sql` → `motion_diagnostic_events`.
   On the product DB the preflight currently sees only `native_bundles`.
2. Runtime boundary secrets/config: `UNCRAFT_RUNTIME_SESSION_SECRET`, `UNCRAFT_RUNTIME_ORIGIN`,
   `JWT_SECRET`, and the selected native bundle store.
3. A fixture board with two eligible native nodes and the exact cases in
   `packages/web-shell/e2e/fixtures/native-motion/README.md` (one finite motion, one loop, an
   ambiguous motion owner, responsive bindings, accepted custom controls, one recoverable and
   one exhausted fault binding, ≥2 committed snapshots; second node for isolation only).
4. Fixture-only Admin and non-admin sessions for the diagnostics authorization checks.
5. `E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1` plus `E2E_NATIVE_MOTION_BOARD_URL`,
   `E2E_NATIVE_MOTION_PRIMARY_NODE_ID`, `E2E_NATIVE_MOTION_SECONDARY_NODE_ID`,
   `E2E_NATIVE_MOTION_SESSION_COOKIE`.
6. Fixture-owner review and implementation of the concrete mutation pack against the fixture
   ownership record. (The runner deliberately stops after preflight even when 1–5 are present.)

**Precision note (from the audit):** items 3–5 are **not provided/configured for this run**;
this pass did not (and under rules 3–4 must not) create them, and did not independently verify
whether such fixtures/sessions might already exist in some external environment — the point is
only that they are not wired into this run. **The verdict is over-determined:** the four
missing `E2E_NATIVE_MOTION_*` values + missing `ALLOW_MUTATIONS` — verified first-hand in
`.env.local` — **alone** force `blocked`, and the runner throws unconditionally at
`packages/web-shell/e2e/native-motion-editing.spec.js:509` pending fixture-owner review even
if env + schema were fully satisfied. So the verdict does **not** depend on the DB or fixture
observations.

After unblocking: run the default `npm run e2e:native-motion`, attach saved evidence, and close
every remaining acceptance scenario (§4 of the 2026-07-27 handoff / the Task 16 plan
checklist). Only then may Task 16 be marked complete.

## 4. Adversarial audit (Codex/Sol at `max` + independent Claude reviewer)

Both models were asked to REFUTE the "blocked → stop" determination. **Both independently
agree it is correct and rule-compliant;** neither found a hole that flips it.

**High-confidence (both agree):**
- BLOCKED is correct; stop-at-blockage + record + new handoff + commit-only-the-handoff is
  the right action (rule 7). Every unblock path needs a forbidden action (apply migrations =
  rule 4; seed nodes/users/sessions/bundles = rule 3) or the human fixture-owner mutation-pack
  gate. The lab cannot substitute (rule 5); not-complete is correct (rule 6).
- Do **not** author a runnable mutation pack under this assignment. (Rules 3/4 do not by
  themselves forbid an inert, clearly-labeled placeholder outline, but rule 7's "stop while
  prerequisites remain absent" puts continuing that work out of scope here, and it unblocks
  nothing — the runner hard-stops at spec line 509 pending fixture-owner review regardless.)

**Codex-only findings — accepted; this handoff was corrected for both:**
1. "Fixtures/sessions absent" was over-claimed. This pass verified missing *tracked changes*,
   *schema* (read-only), and *env values* first-hand, but did not verify whether fixture
   boards/users/sessions exist in some external environment. Wording corrected to "not
   provided/configured/verified" (§3 precision note).
2. The test-failure cause was asserted without proof. Corrected to "failed during concurrent
   build; passed on isolated rerun; cause not reproduced/confirmed" (§2 Tests).

**Independent Claude reviewer added — accepted:**
- The verdict is **over-determined** (see §3 precision note): the missing E2E env vars +
  unconditional `spec:509` stop force `blocked` regardless of DB/fixture state.
- The migration **definitions already exist in-repo, unapplied** (§3.1) — corrected here.
- **Commit safety (one real operational risk):** with 65 untracked noise files present, use an
  **explicit-path** `git add <handoff>.md` — never `git add -A`/`.`/`-a` — or the commit would
  sweep noise and breach rules 2 and 8. Followed below.

**Honesty check:** the independent reviewer reproduced the flaky test (27/27 in 2.20s vs 2.13s
here) and found no honesty gap — the failure was reported, not hidden, with a falsifiable
isolated result.

## 5. Files changed by this pass
- Added: `docs/superpowers/handoffs/2026-07-28-task-16-persisted-canvas-still-blocked-handoff.md` (this file).
- No source, test, config, schema, env, or data files were changed.

## 6. Pending / risks
- **Blocked on human/owner + environment provisioning**, not on code. The remaining Task 16
  acceptance scenarios (real-board framing, unlink cancel/confirm, custom-control save/reload/
  reuse, fault presentation in canvas, snapshot restore, two-node isolation, gateway/token
  fuzzing, Admin/non-admin diagnostics, keyboard/focus/tooltip, visual comparisons) can only
  be validated against the persisted `/canvas` gate — the lab does not substitute (rule 5).
- **Risk — do not mistake a green lab or a green unit suite for Task 16 completion.** The
  exit gate is the persisted acceptance scenarios with saved evidence.
- **Risk — the product `DATABASE_URL` must never be migrated/seeded for this.** The fixture
  must be a disposable isolated DB. Migrating the product DB would violate rule 4 and the
  fixture contract.
- **Flaky integration test:** `lib/snapshot.test.js` (unrelated to Task 16) was observed to
  hook-timeout during a concurrent `next build`; it passes 27/27 in isolation and the failure
  did not reproduce (cause not confirmed). Run heavy Playwright integration tests without a
  concurrent build.

## 7. Next actions (owner decision required)
Provision the isolated fixture environment (items 1–6 in §3) — or explicitly authorize a
specific, bounded step — then re-run `npm run e2e:native-motion`. Do not start Task 17 from
this checkpoint.
