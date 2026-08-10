# Start from a Ref: bounded Landbook thumbnail-and-link pilot landed

**Date:** 2026-08-01

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Implementation commit:** `e4017b03 feat(refs): add bounded Landbook pilot`

**Predecessor handoff:** `docs/superpowers/handoffs/2026-08-01-start-from-ref-landbook-adapter-landed.md`

## Session outcome

After the user approved the minimal requirement, the Landbook pilot was implemented, collected, built deterministically, imported twice into the isolated database, queried twice through a source-specific proof, tested, and committed.

The pilot stores only the fields needed for consultation and provenance: title, canonical destination URL, remote thumbnail URL, Landbook record ID, listing URL, and detail URL. It visits one Landbook detail per selected ordinary website to resolve the exact outbound target and thumbnail. It never visits the destination website during ingestion.

No shared database was queried or mutated. No shared import, destination-site capture, manual preference mutation, cohort mutation, generation, Demarcelizer call, node creation, Uncraft credit spend, push, or deployment occurred.

## Frozen scope

- Public, unfiltered Landbook listing pages: 1 and 2.
- Maximum ordinary website records: 100.
- Detail depth: exactly one Landbook detail page.
- Destination-site fetches: zero.
- Templates and sponsored placements: report-only lanes, never importable appearances.
- Database target: isolated only.
- Generation: disabled.

The manifest is written before detail collection. A rerun must match it byte-for-byte or fail closed.

## Collection result

The two listing checkpoints contained:

```text
page 1 ordinary websites: 75
page 2 ordinary websites: 60
ordinary website appearances across both pages: 135
unique ordinary website IDs: 75
selected ordinary website IDs: 75
templates excluded: 45
sponsored placements excluded: 9
listing rejections: 0
```

Page 2 was not a Firecrawl cache collision. Its `sourceURL`, HTML, and snapshot hash differ from page 1, but all 60 ordinary website IDs were already present among page 1's 75 IDs. The deterministic dedupe therefore retained 75 unique references rather than manufacturing records up to the cap.

All 75 selected records produced a valid matching detail, external destination URL, and HTTP(S) thumbnail:

```text
accepted appearances: 75
canonical references: 75
detail rejections: 0
duplicates merged: 0
```

The first run was interrupted after Firecrawl's per-minute limit was reached. Twenty valid detail snapshots were preserved. The collector interval was reduced below the observed limit, then the run resumed and fetched only missing details. The final replay performed zero fetches and reused all 75 details.

## Determinism evidence

The collector and builder were replayed after completion. The four artifacts remained byte-identical:

```text
collection manifest sha256: 4bd2a143fdda05d425591e640e09491186cd3e6ec8edd39b252a13bedc2837fb
collection result sha256:   db7960be42d726a0901c1fce6c0a7fe6139df24699cafd9105ed38ff378c7d8d
output seed sha256:         c638c7a9714e825261a154ff557c7808987100ab19de4c85c5a0341641b27859
output report sha256:       e3d975304665dac9f0734b0b5df4750ae38eb79a6b6b0760b68906507ce11a70
```

The ignored replayable evidence lives under:

```text
.firecrawl/reference-landbook-pilot/
```

It remains ignored by Git and was not staged.

## Isolated import and consultation proof

The isolated environment was loaded with Next's environment loader from a trusted local configuration directory. The importer fails closed when `E2E_ISOLATED_DATABASE_URL` matches `DATABASE_URL`; the equality rejection was tested without contacting a database.

The Landbook seed was imported twice. Both runs returned the same database totals. The source-specific consultation proof was also run twice and returned:

```text
expected Landbook references: 75
consultable Landbook references: 75
missing references: 0
mismatched references: 0
required fields present: title, canonical URL, thumbnail URL, Landbook detail URL
```

This proves that the isolated Uncraft reference catalog can retrieve every pilot record by the `landbook` source and return the URL that a later creation handoff would consume. It does not claim that real generation is wired or enabled.

## Implementation contents

```text
bun.lock
package.json
packages/web-shell/package.json
packages/web-shell/lib/reference-bank-landbook.js
packages/web-shell/lib/reference-bank-landbook.test.js
packages/web-shell/scripts/reference-bank/import-proof.mjs
packages/web-shell/scripts/reference-bank/isolated-env.mjs
packages/web-shell/scripts/reference-bank/query-landbook-pilot.mjs
scripts/reference-bank/collect-landbook-pilot.mjs
scripts/reference-bank/build-landbook-pilot.mjs
```

The adapter now keeps a valid ordinary listing card without an external target as a non-importable `website_candidate`. Only a matching Landbook detail with the same numeric record ID can resolve it into an appearance. Templates, ads, malformed identities, and details with mismatched IDs remain unable to enter the website lane.

## Verification

- Syntax checks passed for collector, builder, isolated environment loader, importer, and query proof.
- Landbook adapter suite: 1 file and 6 tests passed.
- Full web-shell suite: 135 files passed and 1 skipped; 955 tests passed and 4 skipped.
- Production build: Next.js 15.5.15 compiled successfully; 43 pages generated.
- `git diff --check` and staged diff checks passed.
- Secret scan passed before the implementation commit.
- The pre-existing non-blocking warning `--localstorage-file was provided without valid path` remained present.

No browser QA was run because the owned slice changes ingestion, isolated import, and database query tooling rather than product UI.

## Next gates require separate approval

1. Review this 75-reference Landbook evidence for a possible shared-database import and, only if approved separately, execute that import.
2. Connect reviewed reference plans to real creation so generation can inspect selected destination URLs on demand. This remains unimplemented and must not be inferred from the isolated query proof.
3. Investigate a different Landbook pagination/checkpoint strategy before expanding the source. Page 2 did not add unique IDs, so a larger wave must not blindly assume `?page=N` advances the collection.

Approval for one option is not approval for either of the others.

## Hard stops

- Do not run `refs:import` or any command that targets the shared `DATABASE_URL` without explicit shared-import authorization.
- Do not treat the isolated import as production availability.
- Do not trigger generation merely because the catalog can return a URL.
- Do not fetch destination sites during ingestion.
- Do not import templates, sponsored placements, or unresolved listing candidates as ordinary website references.
- Do not infer user ratings, preferences, roles, or taste from Landbook order or taxonomy.
- Do not mutate cohorts, reviews, plans, nodes, credits, or generation state without a separate approval gate.
- Do not expand Landbook collection bounds without a new exact scope.
- Preserve raw `.firecrawl/` outputs as ignored evidence and stage only owned files explicitly.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -5 --oneline --decorate
npm run refs:landbook:build
```

Do not recollect or import merely to resume. Read this handoff first, then obtain the explicit next-gate choice.
