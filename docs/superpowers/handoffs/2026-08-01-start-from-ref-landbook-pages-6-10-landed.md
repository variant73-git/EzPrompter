# Start from a Ref: bounded Landbook pages 6-10 landed

**Date:** 2026-08-01

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Implementation commit:** `8ff296a9 feat(refs): collect bounded Landbook pages 6-10`

**Predecessor handoff:** `docs/superpowers/handoffs/2026-08-01-start-from-ref-landbook-pagination-investigation-landed.md`

## Session outcome

After explicit approval of the exact pages-6-to-10 scope, the remaining Landbook option-3 work was implemented, collected, built deterministically, imported twice into the isolated database, queried twice through the source-specific consultation proof, tested, and committed.

The implementation keeps the original 75-record pilot profile and manifest unchanged. It adds a separate `pages-6-10` profile with its own ignored directory, frozen manifest, output seed/report, import command, and query command.

No destination website was fetched during ingestion. No template or sponsored placement was imported. No shared-database command, Cohort/review mutation, generation, Demarcelizer call, node creation, Uncraft credit spend, push, or deployment occurred.

## Frozen source scope

- Public, unfiltered Landbook listing checkpoints: exactly pages 6, 7, 8, 9, and 10.
- Logical listing boundary: exactly the first 20 `.website-item` cards at each checkpoint.
- Maximum ordinary records: 100, with no padding.
- Selected ordinary records: 77.
- Templates: 23, report-only.
- Sponsored placements: 4, report-only.
- Listing rejections: 0.
- Duplicate ordinary IDs within the slice: 0.
- Overlap with the existing 75-record pilot selection: 0.
- Detail depth: exactly one matching Landbook detail per selected ordinary record.
- Destination-site fetches: 0.
- Database target: isolated only.
- Generation: disabled.

Per-page envelope:

```text
checkpoint  ordinary  templates  sponsored  rejections
page 6          15          5          1           0
page 7          16          4          0           0
page 8          15          5          1           0
page 9          15          5          1           0
page 10         16          4          1           0
-------------------------------------------------------
pages 6-10      77         23          4           0
```

The collector now verifies the approved investigation hashes before copying the listing evidence into the new slice. It also preserves ordinary-card document order through `websiteRecords`, freezes the prior-pilot exclusion, and fails closed on count, identity, overlap, card-boundary, or evidence-hash drift.

Selection hashes:

```text
prior pilot selected IDs: 0a0b85c7a5552a0bf527f5466b268c20081e118cc1766c566745ad050d790f4e
pages 6-10 selected IDs:   7ec70797e12b83826dd5aa96213f280b95ead4f4ded739479f1cc3d06b8beaab
```

## Replayable ignored evidence

The new artifacts live under:

```text
.firecrawl/reference-landbook-pages-6-10/
```

The directory contains 77 valid detail JSON snapshots, five listing snapshots, the frozen manifest/result, and the deterministic seed/report. All 82 JSON files parsed successfully. The entire directory remains ignored by Git.

First collection:

```text
details requested: 77
details fetched:   77
details reused:     0
```

Immediate resumed collection:

```text
details requested: 77
details fetched:    0
details reused:    77
```

Artifact hashes:

```text
collection manifest sha256: ad343e0b7b63b1980d972c9dce89438d210ec05133ed71df74b41549bd70965e
collection result sha256:   f2dc6a5566f1cb7fbe75c9fcc922aa87c4f3cbb84474f10ae438d9397ff349cf
output seed sha256:         418c041a1f5da4b4161ad88b86859b99fe0873531d4e316e38bacee81b888928
output report sha256:       be3f68773b52fed0a8cd1432a185dcea6d91f2635b38deb6fdbbab61a1c703c3
```

Two consecutive builds returned the same seed and report hashes. Both builds reported:

```text
selected website records: 77
accepted appearances:     77
rejected records:          0
canonical references:     77
duplicates merged:         0
templates excluded:       23
advertisements excluded:   4
```

The original pilot builder was rerun after parameterization and retained its landed hashes exactly:

```text
pilot seed sha256:   c638c7a9714e825261a154ff557c7808987100ab19de4c85c5a0341641b27859
pilot report sha256: e3d975304665dac9f0734b0b5df4750ae38eb79a6b6b0760b68906507ce11a70
```

## Isolated import and consultation proof

The environment was loaded with Next's environment loader from the trusted local configuration directory. Both database variables were present and distinct without printing their values. A separate equality proof confirmed that matching shared/isolated targets are rejected before database contact.

The new seed was imported twice. Both imports returned the same overall isolated totals:

```text
reference sites:       1,919
reference appearances: 2,019
```

The Landbook source-specific consultation proof also ran twice and returned:

```text
expected references:    77
consultable references: 77
missing references:      0
mismatched references:   0
required fields: title, canonical URL, thumbnail URL, Landbook detail URL
```

This proves the isolated catalog can retrieve all 77 new records through the `landbook` source and return the destination URL a later creation handoff may consume. It does not claim that real generation is wired or enabled.

## Implementation contents

```text
package.json
packages/web-shell/package.json
packages/web-shell/lib/reference-bank-landbook.js
packages/web-shell/lib/reference-bank-landbook.test.js
packages/web-shell/scripts/reference-bank/query-landbook-pilot.mjs
scripts/reference-bank/collect-landbook-pilot.mjs
scripts/reference-bank/build-landbook-pilot.mjs
```

New commands:

```text
npm run refs:landbook:pages-6-10:freeze
npm run refs:landbook:pages-6-10:collect
npm run refs:landbook:pages-6-10:build

cd packages/web-shell
npm run refs:landbook:pages-6-10:import:isolated
npm run refs:landbook:pages-6-10:query:isolated
```

## Verification

- Collector, builder, and query script syntax checks passed.
- Landbook adapter suite: 1 file and 6 tests passed.
- Full web-shell suite: 135 files passed and 1 skipped; 955 tests passed and 4 skipped.
- Production build: Next.js 15.5.15 compiled successfully; 43 pages generated.
- `git diff --check` and staged diff checks passed.
- Changed-file and staged secret scans passed; the commit scanner reported no leaks.
- All 77 detail snapshots and all 82 JSON artifacts parsed successfully.
- Raw `.firecrawl/` evidence remained ignored and was not staged.
- The pre-existing non-blocking warning `--localstorage-file was provided without a valid path` remained present.

No browser QA was run because the owned slice changes ingestion, isolated import, and database consultation tooling rather than product UI.

## Next approval gate

The Landbook option-3 expansion is complete. The next ordered task is option 1: review the consolidated isolated evidence for a possible shared-database import.

That review may be started only with a new explicit approval. The shared import itself is a separate mutation gate and still requires its own explicit authorization after review. Option 2, real-generation integration, remains after the shared-catalog gate.

## Hard stops

- Do not run a shared import or any command targeting `DATABASE_URL` without explicit shared-import authorization.
- Do not treat isolated query success as evidence that real generation is integrated.
- Do not connect catalog lookup to generation, fetch destination sites, mutate cohorts/reviews/plans/nodes/credits, or start Demarcelizer work without the relevant approval.
- Do not expand Landbook beyond pages 6-10 without a new bounded investigation and scope.
- Preserve the ignored raw evidence and stage only owned repository files explicitly.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -5 --oneline --decorate
```

Read this handoff first. Do not begin shared-import review, shared import, or generation integration merely to resume.
