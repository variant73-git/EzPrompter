# Start from a Ref: shared-safe delta importer landed

**Date:** 2026-08-01

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Implementation commit:** `8e799769` (`feat(refs): add shared-safe reviewed delta importer`)

**Predecessor handoff:** `docs/superpowers/handoffs/2026-08-01-start-from-ref-shared-import-review-landed.md`

## Outcome

The bounded shared-safe delta importer and its isolated proof are complete.

The importer accepts only the eight exact reviewed seed/report hashes, produces a deterministic plan from a supplied target snapshot, preserves existing canonical site fields and ranks, adds append-only ranks to new sites, upserts only reviewed source-appearance fields, preserves existing aggregator ratings, and executes the complete promotion inside one serializable transaction with pre-write and post-write guards.

The shared preflight and shared apply modes exist but were **not executed**. No command queried or mutated `DATABASE_URL`. Actual shared preflight and shared import remain separate authorization gates.

## Landed files

- `packages/web-shell/lib/reference-bank-promotion.js`
  - verifies all four seed hashes and all four report hashes;
  - reconstructs the exact 305-site / 315-appearance reviewed union;
  - creates deterministic insert/update/no-op plans from a supplied target snapshot;
  - rejects canonical identity conflicts;
  - assigns new ranks strictly after the target maximum;
  - includes an exact reverse-order rollback plan in the plan artifact.
- `packages/web-shell/scripts/reference-bank/promotion-db.mjs`
  - fingerprints protected tables without exposing row contents;
  - reads a target snapshot;
  - restricts writes to `reference_aggregators`, `reference_sites`, and `reference_appearances`;
  - takes an advisory transaction lock and uses serializable isolation;
  - rejects target drift before writes and reconciles the result before commit.
- `packages/web-shell/scripts/reference-bank/promote-reviewed-delta.mjs`
  - provides offline plan, isolated/shared preflight, and isolated/shared apply modes;
  - requires a durable snapshot for preflight;
  - requires the approved plan hash for apply;
  - requires the additional `reviewed-delta-v1` confirmation for shared apply;
  - validates static apply authorization before loading a database target.
- `packages/web-shell/scripts/reference-bank/prove-reviewed-delta.mjs`
  - creates a fresh ephemeral schema only in the isolated database;
  - loads the exact committed 1,636-site / 1,704-appearance baseline;
  - runs the promotion twice;
  - verifies preservation, global rank uniqueness, idempotency, and source totals;
  - drops the proof schema in `finally`.
- `packages/web-shell/lib/reference-bank-promotion.test.js`
  - covers artifact bounds, exact baseline plan, canonical preservation, idempotency, appearance repair, URL conflict rejection, plan-hash stability, write allowlist, rollback contents, and target-equality rejection.
- `packages/web-shell/scripts/reference-bank/isolated-env.mjs`
  - retains the equality guard and now exposes it as a tested pure assertion;
  - uses a Node-compatible `@next/env` import.
- `packages/web-shell/package.json`
  - adds explicit promotion plan, preflight, apply, and isolated-proof scripts.

## Exact reviewed artifact contract

```text
proof seed:               c30074562c6226ef251052f8a8d42ded52b78c7c1d1577322c4225b508b93778
proof report:             b367adb074b83d022eb315a9e7db8947f7917b107cddfaa6a185e58468761f75
increment seed:           b452a369ee2990cf7635b44e0d0ebee377167b4befab9f9bc1345e93fe0664af
increment report:         f9eac7b65aab01d1d86f1668edb15724960d244b8e3a46f21258608e0adadd51
Landbook pilot seed:      c638c7a9714e825261a154ff557c7808987100ab19de4c85c5a0341641b27859
Landbook pilot report:    e3d975304665dac9f0734b0b5df4750ae38eb79a6b6b0760b68906507ce11a70
Landbook pages seed:      418c041a1f5da4b4161ad88b86859b99fe0873531d4e316e38bacee81b888928
Landbook pages report:    be3f68773b52fed0a8cd1432a185dcea6d91f2635b38deb6fdbbab61a1c703c3
```

Reviewed catalog hash:

```text
cc534f118b5c15030df1425e37531a826e2ccefe3939f454fc023b77b3624b11
```

## Fresh isolated proof

The proof used the committed baseline seed hash:

```text
e496fcdf309e341aaea097e1df32c9857a7d344b04ed05be264212eb8d389d3c
```

First-run plan:

```text
plan hash:                 d1e1e7869a32f85e51e9b30c3c7f24f7c6733ba9855bb804b65f7b9c74a925fe
target before:             1,636 sites / 1,704 appearances / max rank 1,636
candidate sites:           305
site inserts:              283
existing sites preserved:  22
appearance inserts:        315
appearance updates/no-ops:   0 / 0
target after:              1,919 sites / 2,019 appearances / max rank 1,919
```

Second-run plan:

```text
plan hash:                 15ef49f7b9e8acd61cbcef6a3bde526e313aaa06d93f5b208cdc469c21a039c6
site inserts:                0
appearance inserts:          0
appearance updates:          0
appearance no-ops:         315
target after:              1,919 sites / 2,019 appearances / max rank 1,919
```

Reconciliation:

```text
distinct ranks:             1,919
append-only new ranks:        283
baseline rank mismatches:       0
protected fingerprints changed: no
Landbook rating after rerun:    5
Landbook editorial quality:     4
leftover proof schemas:          0
```

Final source counts matched the consolidated review exactly:

```text
source            appearances  canonical sites
codrops                   847              847
landbook                  152              152
minimalgallery             92               92
pafolios                   816              763
siteinspire                 41               40
siteofsites                 71               71
```

## Read-only CLI proof

The current public isolated catalog was read through the new preflight mode. It reported 1,919 sites and 2,019 appearances, with all 305 candidate sites preserved and all 315 reviewed appearances as no-ops. Its existing non-global rank maximum remained 1,777 because this preflight was read-only and the older isolated imports intentionally were not rewritten.

The preflight plan and a second offline plan from its saved snapshot produced the same hash:

```text
d0281221113c2614a293b16506ffb599309b707c12e304f6a63197300b627dd6
```

An incomplete shared apply invocation was also verified to fail before loading shared environment configuration.

## Verification

- New promotion tests: 9/9 passed.
- Focused reference-bank suite: 6 files / 33 tests passed.
- Full web-shell suite: 136 files / 964 tests passed; 1 file / 4 tests skipped by the existing suite.
- One intervening full-suite run had only a Chromium `afterAll` close timeout; `lib/snapshot.test.js` then passed 27/27 in isolation and the complete suite passed on rerun.
- Production build passed: 43/43 static pages generated.
- `git diff --check` passed before commit.
- Secret scan in the commit hook passed.
- Raw `.firecrawl/` artifacts remained ignored and were not staged.

The existing Node module-type warning remains non-blocking and was not broadened into a package-wide module-mode change.

## Safety behavior

- Existing site canonical metadata, lifecycle, availability, analysis state, curation weight, and rank are never updated.
- Only genuinely new sites are inserted, with deterministic append-only ranks after the target maximum.
- Only the exact 315 reviewed appearance identities are upserted.
- Existing aggregator rows are never updated, so manual ratings and status are preserved.
- Protected rows are fingerprinted before and after: preferences, cohorts/members, shadow plans, boards, nodes, and credit ledger.
- A supplied snapshot and matching plan hash are mandatory for apply.
- Target drift, canonical identity conflict, protected-row drift, or post-write reconciliation mismatch aborts the serializable transaction.
- Isolated and shared target equality fails closed.
- Shared apply additionally requires `--confirm-shared-import reviewed-delta-v1`.

## Not done

- No shared preflight.
- No shared import.
- No shared database query or mutation.
- No rollback execution.
- No collection, source expansion, destination-site fetch, generation, Demarcelizer call, Cohort review, plan/node/credit mutation, push, or deployment.

## Next approval gate

The next bounded task is a **read-only live shared preflight only**:

1. Reconfirm the branch, commit, clean worktree, and this handoff.
2. Run the shared preflight mode and save both snapshot and plan artifacts.
3. Present the live shared baseline, exact site/appearance/aggregator insert-update-no-op counts, target drift findings, plan hash, protected fingerprints, and generated rollback plan.
4. Stop and request a separate authorization for shared apply.

Approval of shared preflight is not approval of shared import.

## Hard stops

- Do not run shared preflight without explicit authorization for that gate.
- Do not run shared apply without a later, separate explicit authorization.
- Do not substitute the isolated URL for the shared URL or vice versa.
- Do not bypass snapshot, plan-hash, target-equality, or shared-confirmation guards.
- Do not reuse the older full-snapshot importer as a promotion path.
- Do not alter existing canonical metadata/ranks or protected product state.
- Do not expand source scope, generate, call Demarcelizer, push, or deploy.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -5 --oneline --decorate
```

Read this handoff first. Stop before any shared preflight or shared apply until the user explicitly authorizes that exact gate.
