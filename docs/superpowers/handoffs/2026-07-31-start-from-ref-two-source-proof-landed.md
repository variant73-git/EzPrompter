# Start from a Ref: landed two-source importer proof handoff

**Date:** 2026-07-31

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Implementation commit:** `dc0c008e feat(refs): prove two-source importer`

**Predecessor handoff:** `docs/superpowers/handoffs/2026-07-31-start-from-ref-two-source-importer-proof.md`

**Detailed discovery evidence:** `docs/superpowers/audits/2026-07-31-start-from-ref-aggregator-discovery.md`

## Session outcome

The bounded Minimal Gallery + Site of Sites importer proof was reviewed, hardened, revalidated, and committed.

The implementation commit contains exactly the nine files owned by the proof slice. The review added an explicit unit regression for a record with no destination in either listing or detail, corrected the targeted-suite filenames in the predecessor handoff, and made the isolated importer fail closed when `E2E_ISOLATED_DATABASE_URL` exactly matches `DATABASE_URL`.

No network collection, database connection, shared import, generation, Demarcelizer call, node creation, credit spend, push, or deployment occurred during the review-and-commit session.

This document is a documentation-only successor to the implementation commit. No product or importer code changed after the validation recorded below.

## Repository state at handoff creation

Immediately before adding this handoff, the worktree was clean at:

```text
dc0c008e feat(refs): prove two-source importer
```

The commit includes:

```text
docs/superpowers/audits/2026-07-31-start-from-ref-aggregator-discovery.md
docs/superpowers/handoffs/2026-07-31-start-from-ref-two-source-importer-proof.md
package.json
packages/web-shell/lib/reference-bank-ingest.js
packages/web-shell/lib/reference-bank-ingest.test.js
packages/web-shell/package.json
packages/web-shell/scripts/reference-bank/import-proof.mjs
scripts/reference-bank/build-two-source-proof.mjs
scripts/reference-bank/collect-two-source-proof.mjs
```

The raw captures and generated proof outputs remain intentionally ignored under `.firecrawl/` and were not committed.

## Final proof evidence

### Collection and canonicalization

```text
Minimal Gallery listing records: 46
Site of Sites listing records: 36
Total requested records: 82
Accepted appearances: 81
Rejected records: 1
Canonical proof references: 79
Cross-source duplicate groups: 2
New canonical sites relative to baseline: 68
Existing canonical sites matched: 11
```

The rejected record remains Site of Sites `verenika-perla`, whose listing and public detail snapshot contain no usable external destination. The adapter returns no appearance instead of inventing an identity.

The real cross-source merges remain:

1. `celticseasalt.com`
2. `kommakomma.is`

`serotoninn.com` and `serotoninn.com/terms` remain separate pending a reviewed identity policy for meaningful paths.

### Deterministic outputs

The proof was rebuilt from the existing local snapshots during the review session and retained the exact hashes:

```text
seed SHA-256:   c30074562c6226ef251052f8a8d42ded52b78c7c1d1577322c4225b508b93778
report SHA-256: b367adb074b83d022eb315a9e7db8947f7917b107cddfaa6a185e58468761f75
```

### Verification rerun

- Targeted reference suite: 5 files passed, 22 tests passed.
- Full web-shell suite: 134 files passed and 1 skipped; 947 tests passed and 4 skipped.
- Production build: Next.js 15.5.15 compiled successfully; 43 pages generated.
- Syntax checks passed for the collector, builder, and isolated importer.
- The isolated importer rejected matching isolated/shared URLs before reading the seed or opening a database connection.
- `git diff --check` and the untracked-file whitespace checks passed.
- The pre-existing non-blocking warning `--localstorage-file was provided without valid path` remained present.

No browser QA was run because this slice changes ingestion tooling and tests rather than product UI.

## Persisted isolated proof state inherited from the predecessor session

The isolated database already contains the proof rows from the predecessor session:

```text
reference_sites: 1,704
reference_appearances: 1,785
proof source appearances: 81
proof canonical sites: 79
proof aggregators: 2
```

Those counts were not queried or mutated during the review-and-commit session. Treat them as inherited evidence unless a future explicitly approved isolated rerun refreshes them. The shared database was not touched by this proof.

## Next gate requires an explicit choice

These actions remain independent and unapproved:

1. Bounded incremental collection for additional Minimal Gallery and Site of Sites inventory, followed by a new dry-run and isolated idempotency check.
2. A separately reviewable Landbook adapter restricted to its unfiltered public page progression, with templates and ads handled separately.
3. Manual review of the existing 24-member Cohort v1 without changing importer scope.

Approval for one option is not approval for either of the others. Approval to inspect or extend an adapter is not approval for a shared-database import.

## Hard stops

- Do not run `refs:import` or any command using `DATABASE_URL` without explicit shared-import authorization.
- Do not perform mass collection based only on this bounded proof.
- Do not collect from the remaining aggregators without a separately approved source-specific slice.
- Do not infer a user's 1–5 taste rating from aggregator order, rank, taxonomy, awards, or popularity.
- Do not deep-capture destination sites merely because they entered the reference catalog.
- Do not trigger generation, Demarcelizer, node creation, or credit spend from ingestion.
- Do not mutate shared reviews, preferences, recipes, cohorts, nodes, credits, or generation state.
- Do not merge meaningful URL paths without a reviewed identity policy.
- Preserve every source appearance and its taxonomy when canonical destinations merge.
- Preserve unrelated or future worktree changes and stage only files owned by the approved slice.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -3 --oneline --decorate
```

For a read-only local evidence check without rebuilding or touching a database:

```bash
shasum -a 256 \
  .firecrawl/reference-proof/reference-bank.proof.seed.json \
  .firecrawl/reference-proof/reference-bank.proof.report.json
```

Do not rerun collection or isolated import merely to resume the task. Read this handoff and the detailed discovery audit first, then obtain the explicit next-gate choice.
