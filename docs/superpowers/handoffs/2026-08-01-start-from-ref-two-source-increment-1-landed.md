# Start from a Ref: bounded two-source increment 1 landed

**Date:** 2026-08-01

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Implementation commit:** `46babe08 feat(refs): add bounded two-source increment`

**Predecessor handoff:** `docs/superpowers/handoffs/2026-07-31-start-from-ref-two-source-proof-landed.md`

## Session outcome

After the user explicitly selected option 1, the first bounded incremental collection for Minimal Gallery and Site of Sites was implemented, collected, dry-run twice, imported twice into the isolated database, validated, and committed.

The collector is restart-safe for valid snapshots and tolerates a partial JSON output after power loss. A battery interruption occurred after 46 Minimal Gallery details and 11 Site of Sites details had been persisted. On resume, all 57 files were valid, no collection process remained active, and the collector fetched only the 25 missing Site of Sites details.

No shared-database import, collection from another aggregator, deep destination capture, generation, Demarcelizer call, node creation, Uncraft credit spend, review/cohort mutation, push, or deployment occurred.

## Implementation commit contents

The implementation commit contains exactly these six owned files:

```text
package.json
packages/web-shell/lib/reference-bank-ingest.js
packages/web-shell/lib/reference-bank-ingest.test.js
packages/web-shell/package.json
scripts/reference-bank/build-two-source-increment.mjs
scripts/reference-bank/collect-two-source-increment.mjs
```

The increment uses separate commands and ignored output paths, so it does not overwrite the landed proof evidence:

```text
npm run refs:incremental:collect
npm run refs:incremental:build
cd packages/web-shell && bun run refs:incremental:import:isolated
```

## Frozen collection scope

### Minimal Gallery

- Pages: `3` and `4` only.
- Maximum listing records: 46.
- Actual listing/detail records: 46.
- Destination sites were not deep-captured.

### Site of Sites

- Selection: the next 36 public sitemap detail URLs after excluding the 36 records in the prior proof listing.
- First selected detail: `https://www.siteofsites.co/websites/alan-xu`.
- Last selected detail: `https://www.siteofsites.co/websites/flamingo-estate`.
- Frozen sitemap SHA-256: `87ac243dec9e83ee170495e8bf29cec3cd2643a46a19efe04a340849f1da9a53`.
- The builder revalidates the sitemap hash, prior-proof detail count/hash, exact selection, and 36-record cap before accepting the increment.

### Recovery evidence

```text
requested details: 82
valid details present at resume: 57
details reused by resumed run: 57
details fetched by resumed run: 25
final Minimal Gallery details: 46
final Site of Sites details: 36
invalid JSON files after completion: 0
selected Site of Sites URLs missing: 0
unexpected Site of Sites URLs captured: 0
```

All fetched material remains under ignored `.firecrawl/reference-increment-1/` paths and is not part of either commit.

## Dry-run evidence

```text
Minimal Gallery listing records: 46
Site of Sites listing records: 36
Accepted Minimal Gallery appearances: 46
Accepted Site of Sites appearances: 36
Rejected records: 0
Incremental appearances: 82
Incremental canonical references: 80
Incremental duplicates merged: 2
Cross-source duplicate groups: 2
New canonical sites relative to the landed proof seed: 73
Existing canonical sites matched: 7
```

The two real cross-source duplicate groups are:

1. `agronomywork.shop`
2. `ref.digital`

The seven canonical matches to the prior proof seed are:

1. `aino.agency`
2. `and2es.com`
3. `instituteofhealth.com`
4. `jasminegunarto.com`
5. `obys.agency`
6. `ref.digital`
7. `rfeasley.io`

No rating was inferred from source order, taxonomy, award, or popularity. Meaningful URL paths continue to remain distinct.

## Deterministic outputs

Three builds after collection retained the same hashes, including the final build after fail-closed hardening:

```text
seed SHA-256:   b452a369ee2990cf7635b44e0d0ebee377167b4befab9f9bc1345e93fe0664af
report SHA-256: f9eac7b65aab01d1d86f1668edb15724960d244b8e3a46f21258608e0adadd51
```

Ignored outputs:

```text
.firecrawl/reference-increment-1/reference-bank.increment.seed.json
.firecrawl/reference-increment-1/reference-bank.increment.report.json
```

## Isolated database evidence

The environment was loaded with Next's environment loader rather than shell-sourcing `.env.local`. Both `E2E_ISOLATED_DATABASE_URL` and `DATABASE_URL` were present, and the loader check plus importer confirmed that their values differed without printing either value.

The inherited isolated proof state was:

```text
reference_sites: 1,704
reference_appearances: 1,785
proof source appearances: 81
proof canonical sites: 79
proof aggregators: 2
```

Both incremental imports returned exactly:

```text
reference_sites: 1,777
reference_appearances: 1,867
two-source appearances: 163
two-source canonical sites: 158
two-source aggregators: 2
```

The second import did not increase any count, proving idempotency. The deltas match the dry-run: 73 new sites and 82 new appearances. The shared database was not queried or mutated.

The importer was also rechecked with matching fake isolated/shared URLs and failed closed before reading the nonexistent seed or opening a connection.

## Verification

- Increment builder syntax check passed.
- Increment collector syntax check passed.
- Targeted reference suite: 5 files and 24 tests passed.
- Full web-shell suite: 134 files passed and 1 skipped; 949 tests passed and 4 skipped.
- Production build: Next.js 15.5.15 compiled successfully; 43 pages generated.
- Final seed/report hashes matched the prior deterministic runs.
- `git diff --check`, staged diff checks, and trailing-whitespace checks passed.
- The pre-existing non-blocking warning `--localstorage-file was provided without valid path` remained present.

No browser QA was run because this slice changes ingestion tooling and tests rather than product UI.

## Next gate requires a separate explicit choice

The bounded increment stops here. These actions remain independent and unapproved:

1. Build the separately reviewable Landbook adapter, restricted to its unfiltered public page progression with templates and ads handled separately.
2. Manually review the existing 24-member Cohort v1 without changing importer scope.
3. Review the final two-source evidence for a possible shared-database import and, only if approved separately, execute that import.

Approval for one option is not approval for either of the others. Choosing an option now only determines the next task; it does not cancel the remaining options.

## Hard stops

- Do not run `refs:import` or any command using `DATABASE_URL` without explicit shared-import authorization.
- Do not perform another incremental or mass collection without a new bounded approval.
- Do not collect from Landbook or another aggregator without approving that source-specific slice.
- Do not infer a user's 1–5 taste rating from aggregator order, rank, taxonomy, awards, or popularity.
- Do not deep-capture destination sites merely because they entered the reference catalog.
- Do not trigger generation, Demarcelizer, node creation, or Uncraft credit spend from ingestion.
- Do not mutate shared reviews, preferences, recipes, cohorts, nodes, credits, or generation state.
- Do not merge meaningful URL paths without a reviewed identity policy.
- Preserve every source appearance and its taxonomy when canonical destinations merge.
- Preserve unrelated or future worktree changes and stage only files owned by the approved slice.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -4 --oneline --decorate
```

For a read-only evidence check:

```bash
shasum -a 256 \
  .firecrawl/reference-increment-1/reference-bank.increment.seed.json \
  .firecrawl/reference-increment-1/reference-bank.increment.report.json
```

Do not rerun collection or isolated import merely to resume. Read this handoff first, then obtain the explicit next-gate choice.
