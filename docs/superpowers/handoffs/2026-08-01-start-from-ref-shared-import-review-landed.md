# Start from a Ref: consolidated shared-import review landed

**Date:** 2026-08-01

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Predecessor handoff:** `docs/superpowers/handoffs/2026-08-01-start-from-ref-landbook-pages-6-10-landed.md`

## Review outcome

The consolidated isolated evidence is complete, deterministic, internally consistent, and suitable as the input to a production-safe promotion design.

It is **not safe to import into the shared database with either existing importer**. The correct next task is a bounded implementation-and-isolated-proof slice for a shared-safe delta importer. That task must stop before any command targets `DATABASE_URL`. An actual shared preflight and import remain a later, separate authorization gate.

No shared database query or mutation was run during this review. No collection, destination-site fetch, generation, Demarcelizer call, cohort/review/plan/node/credit mutation, push, or deployment occurred.

## Authorized review boundary

This session reviewed only the four landed evidence sets and the live isolated catalog:

1. Bounded Minimal Gallery + Site of Sites proof.
2. Bounded Minimal Gallery + Site of Sites increment 1.
3. Bounded Landbook thumbnail-link pilot.
4. Bounded Landbook pages 6-10 slice.

The ignored crawler evidence was reused. No network collection was restarted.

## Consolidated evidence

```text
slice                              appearances  slice references  rejected
two-source proof                            81                79         1
two-source increment 1                      82                80         0
Landbook thumbnail-link pilot               75                75         0
Landbook pages 6-10                         77                77         0
--------------------------------------------------------------------------
new source appearances                     315
```

The single proof rejection remains the record without a usable external destination. It was not converted into an invented identity. Meaningful URL paths remain distinct, including the previously reported manual non-merge case.

Against the last landed shared baseline of 1,636 sites and 1,704 unique importer appearances, the consolidated isolated catalog contains:

```text
reference sites:       1,919  (+283)
reference appearances: 2,019  (+315)
```

The delta contains 141 new canonical sites from the two-source proof and increment, plus 142 new canonical sites from 152 Landbook appearances. Ten Landbook appearances resolve to canonical sites already present in the cumulative two-source catalog, so provenance grows without manufacturing duplicate sites.

Final isolated source counts:

```text
source            appearances  canonical sites
codrops                   847              847
landbook                  152              152
minimalgallery             92               92
pafolios                   816              763
siteinspire                 41               40
siteofsites                 71               71
```

These deltas use the last landed shared count as their baseline. The shared database was deliberately not queried during this review, so current shared drift remains unknown until a separately authorized preflight.

## Current isolated reconciliation

The environment was loaded with Next's environment loader from the trusted local configuration directory. Both database variables were present and distinct without printing their values.

A read-only reconciliation compared the expected union of the cumulative two-source seed, the Landbook pilot seed, and the Landbook pages-6-10 seed with every current isolated catalog row and appearance identity.

```text
expected sites:                 1,919
database sites:                 1,919
missing sites:                      0
unexpected sites:                   0
site field mismatches:               0

expected appearances:          2,019
database appearances:          2,019
missing appearances:                0
unexpected appearances:             0
appearance field mismatches:         0
non-listed sites:                    0
```

The isolated fixture still contains four preferences, three shadow plans, one review cohort, and all 24 frozen Cohort v1 members. This review used only `SELECT` queries and did not mutate those fixtures.

## Replay and integrity evidence

All 334 ignored JSON artifacts parsed successfully:

```text
.firecrawl/reference-proof/                    83 JSON, 0 invalid
.firecrawl/reference-increment-1/              88 JSON, 0 invalid
.firecrawl/reference-landbook-pilot/           81 JSON, 0 invalid
.firecrawl/reference-landbook-pages-6-10/      82 JSON, 0 invalid
```

All four builders were run twice without collection. Both rounds retained the landed hashes exactly:

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

The existing module-type warning remained non-blocking. Raw evidence stayed ignored.

## Promotion blockers found by the review

### 1. There is no suitable shared delta importer

`packages/web-shell/scripts/reference-bank/import-proof.mjs` correctly refuses every shared target. `packages/web-shell/scripts/reference-bank/import-seed.mjs` can target the shared database, but it imports only the old baseline seed and also owns Cohort v1 initialization. It is not a promotion path for the four reviewed slices.

### 2. The cumulative two-source seed is a full snapshot, not a shared-safe delta

The increment seed contains all 1,777 cumulative sites. Applying its current upsert semantics to the shared baseline would rewrite `curation_rank` for all 1,636 existing sites. It would also update top-level taxonomy or weighting fields on 17 existing canonical sites where new provenance was merged.

Those results are deterministic in the isolated proof, but the mutation breadth has not been authorized for the shared catalog and would overwrite any shared drift that occurred after the last landed baseline.

### 3. Ten Landbook references collide with existing canonical sites

The Landbook pilot overlaps six cumulative sites. The pages-6-10 slice overlaps four more. All ten have at least one different top-level metadata field. The current importer overwrites existing site title, description, thumbnail, tags, categories, weights, publication metadata, analysis status, and rank whenever those fields differ.

For a safe promotion, an existing canonical site should retain its shared site metadata and rank. The new Landbook row should add only the source appearance and source-specific thumbnail/detail/taxonomy. Any canonical metadata backfill should be a separate, reviewable policy.

### 4. Current multi-seed ranks are not globally unique

The isolated final state has 1,919 ranked sites but only 1,773 distinct rank values. There are 77 duplicated rank groups containing 223 sites, with up to three sites sharing a rank. This comes from assigning ranks independently inside each Landbook seed and from overwriting ranks on canonical overlaps.

The shared promotion should preserve every existing rank and assign deterministic append-only ranks after the current shared maximum only to genuinely new canonical sites.

### 5. The current importer is not atomic across the consolidated promotion

Site and appearance batches are written sequentially without one transaction spanning the full promotion. A shared execution needs an all-or-nothing transaction or a staging-and-commit design, plus a post-write reconciliation before success is reported.

### Known non-blocking baseline invariant

The old baseline contains 17 raw Codrops appearances for the same `readymag.com` appearance identity with different listing checkpoints. The importer deterministically collapses them to one unique appearance, explaining the stable 16-row difference between raw seed appearances and database identities. This predates the new source waves and does not change the 315-appearance promotion delta.

## Recommended next bounded slice

Implement and prove a shared-safe delta importer without running it against the shared database:

1. Accept only the exact reviewed seed hashes above and fail closed on drift.
2. Produce a dry-run plan from a supplied target snapshot before any write.
3. Preserve every existing site's canonical metadata, lifecycle, availability, analysis state, curation weight, and rank.
4. Insert new canonical sites only; assign them stable ranks after the target's current maximum.
5. Upsert the 315 reviewed appearance identities and preserve source taxonomy/provenance.
6. Preserve aggregator ratings and every preference, cohort, plan, board, node, and credit row.
7. Wrap the promotion in one transaction and provide an equality rejection for isolated/shared targets.
8. Prove the importer twice against a fresh isolated fixture that mirrors the expected shared baseline; the second run must report zero new rows and identical totals.
9. Add a shared preflight mode, but do not execute it or load `DATABASE_URL` until separately authorized.

Only after that slice passes should a new gate present the live shared preflight, exact insert/update/no-op counts, rollback plan, and final authorization question for the actual shared import.

## Verification performed

- Worktree and branch ownership confirmed before review.
- All 334 JSON artifacts parsed with zero invalid files.
- Four builders replayed twice with eight identical landed hashes.
- Live isolated environment target distinction confirmed without exposing values.
- All 1,919 sites and 2,019 appearance identities reconciled field by field.
- Source counts and fixture counts queried in read-only mode.
- Existing importer paths, upsert fields, transaction boundaries, rank behavior, and shared-target guards reviewed.
- No product code changed, so the unit suite and production build were not rerun for this documentation-only review.

## Next approval gate

The review is complete. The recommended next task is the bounded shared-safe importer implementation and isolated proof described above.

Approval of that implementation is **not** approval to query or mutate the shared database. Shared preflight and shared import remain separately gated after the implementation proof.

## Hard stops

- Do not run any command targeting `DATABASE_URL` without explicit authorization for the shared preflight/import gate.
- Do not reuse the existing full-snapshot upsert as the shared promotion path.
- Do not overwrite existing canonical metadata or ranks merely because another source resolves to the same site.
- Do not change cohorts, reviews, preferences, plans, nodes, credits, generation state, or Demarcelizer state.
- Do not collect another source wave or expand Landbook beyond the approved slices.
- Keep `.firecrawl/` evidence ignored and stage only owned repository files explicitly.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -5 --oneline --decorate
```

Read this review first. Do not begin shared-safe importer implementation, shared preflight, shared import, or generation integration merely to resume.
