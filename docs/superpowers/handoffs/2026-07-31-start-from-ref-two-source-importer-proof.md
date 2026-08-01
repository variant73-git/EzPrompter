# Start from a Ref: two-source importer proof handoff

**Date:** 2026-07-31

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**HEAD:** `448d23c6 docs(refs): register next aggregator wave`

**Predecessor handoff:** `docs/superpowers/handoffs/2026-07-31-start-from-ref-persistence-and-shadow-planner.md`

**Detailed evidence:** `docs/superpowers/audits/2026-07-31-start-from-ref-aggregator-discovery.md`

## Session outcome

The nine submitted aggregators received a read-only discovery pass. After explicit approval, a bounded importer proof was implemented and executed for **Minimal Gallery** and **Site of Sites**.

This pair was chosen only to exercise two different catalog structures and the importer contract. It is not a pair of visual references for generating a page.

The proof confirmed that the existing canonicalizer already consolidates the same destination across sources while preserving both provenance appearances. It also showed that this behavior was already present in the baseline catalog; the new cases are regression coverage, not a new deduplication capability.

The proof completed successfully against the isolated database. The shared database was not touched. Mass collection, shared import, Cohort v2, deep capture, and generation remain unapproved.

## Current repository state

Nothing from this session is staged or committed. Preserve the following exact working-tree slice:

```text
 M package.json
 M packages/web-shell/lib/reference-bank-ingest.js
 M packages/web-shell/lib/reference-bank-ingest.test.js
 M packages/web-shell/package.json
?? docs/superpowers/audits/2026-07-31-start-from-ref-aggregator-discovery.md
?? docs/superpowers/handoffs/2026-07-31-start-from-ref-two-source-importer-proof.md
?? packages/web-shell/scripts/reference-bank/import-proof.mjs
?? scripts/reference-bank/build-two-source-proof.mjs
?? scripts/reference-bank/collect-two-source-proof.mjs
```

Do not discard or overwrite these files. There were no known unrelated dirty files in this worktree when this handoff was written.

## Implemented files

### Adapter and normalization support

`packages/web-shell/lib/reference-bank-ingest.js`

- Adds `minimalgallery` and `siteofsites` source priorities.
- Parses Minimal Gallery listing and detail payloads.
- Parses Site of Sites listing and detail payloads.
- Retains explicit source taxonomy such as tags, published date, and source screenshots.
- Refuses to invent a destination when neither listing nor detail contains one.
- Preserves source taxonomy when appearances are merged into canonical references.

`packages/web-shell/lib/reference-bank-ingest.test.js`

- Covers Minimal Gallery listing/detail parsing.
- Covers Site of Sites listing/detail parsing.
- Covers the missing-destination rejection path.
- Covers real cross-source canonicalization for `celticseasalt.com`.

### Bounded proof commands

`scripts/reference-bank/collect-two-source-proof.mjs`

- Reuses the read-only discovery captures already under ignored `.firecrawl/`.
- Fetches only missing detail pages for two Minimal Gallery archive pages and the current Site of Sites sample.
- Uses concurrency 1, an 8-second interval, and bounded 45-second retry handling after the source rate limit was observed.

`scripts/reference-bank/build-two-source-proof.mjs`

- Builds a combined proof seed and JSON report from the existing versioned catalog plus the two bounded source samples.
- Reports rejected records, canonicalization samples, cross-source duplicates, manual non-merge review cases, and content hashes.
- Uses a fixed default proof timestamp so identical inputs produce byte-identical output.

`packages/web-shell/scripts/reference-bank/import-proof.mjs`

- Refuses to run without `--isolated`.
- Requires an explicit proof seed.
- Uses only `E2E_ISOLATED_DATABASE_URL`; it has no shared-target path.
- Refuses to run when `E2E_ISOLATED_DATABASE_URL` matches `DATABASE_URL`.
- Upserts reference sites, aggregators, and appearances including `source_taxonomy`.
- Does not touch user reviews, shadow plans, cohorts, nodes, credits, or generation state.

Package scripts added:

```text
npm run refs:proof:collect
npm run refs:proof:build
cd packages/web-shell && bun run refs:proof:import:isolated
```

## Existing duplicate behavior confirmed

The versioned baseline already contained:

```text
canonical references: 1,636
raw source appearances: 1,720
duplicates consolidated: 84
references backed by multiple aggregators: 14
appearances on those multi-source references: 29
```

Therefore, the answer to the user's question is yes: multiple duplicates were already being consolidated and retaining their provenance. `celticseasalt.com` was useful because it was a current, real duplicate across the two newly added adapters.

## Bounded proof evidence

### Collection and parsing

```text
Minimal Gallery listing records: 46
Site of Sites listing records: 36
Total requested records: 82
Existing detail snapshots reused: 10
New detail snapshots fetched: 72
Accepted Minimal Gallery appearances: 46
Accepted Site of Sites appearances: 35
Total accepted appearances: 81
Rejected records: 1
```

The rejected record was Site of Sites record `verenika-perla`. Its listing and public detail page contained no usable external destination. The adapter correctly emitted `detail_parse_failed` instead of inventing an identity.

### Canonicalization

The 81 accepted appearances became 79 canonical references, producing two real cross-source duplicate groups:

1. `celticseasalt.com`
   - Minimal Gallery record `27333`: `https://celticseasalt.com/?ref=minimal.gallery`
   - Site of Sites record `-celtic-sea-salt-`: `https://celticseasalt.com/`
2. `kommakomma.is`
   - Minimal Gallery record `27290`: `https://kommakomma.is/?ref=minimal.gallery`
   - Site of Sites record `-komma-komma`: `https://kommakomma.is/`

Relative to the existing catalog, the proof contained 68 new canonical sites and 11 matches to sites already present.

`https://serotoninn.com` and `https://serotoninn.com/terms` intentionally remain separate because meaningful paths are preserved. The proof reports this pair for manual review rather than silently merging it.

### Deterministic output

Two consecutive builds from the same snapshots produced identical output:

```text
seed SHA-256:   c30074562c6226ef251052f8a8d42ded52b78c7c1d1577322c4225b508b93778
report SHA-256: b367adb074b83d022eb315a9e7db8947f7917b107cddfaa6a185e58468761f75
```

Ignored outputs:

```text
.firecrawl/reference-proof/reference-bank.proof.seed.json
.firecrawl/reference-proof/reference-bank.proof.report.json
```

Raw captures and proof outputs are intentionally ignored by `.gitignore`. Do not add them to the commit unless a separate artifact/versioning policy is approved.

## Isolated database evidence

Before the bounded proof import, the isolated database contained:

```text
reference_sites: 1,636
reference_appearances: 1,704
reference_preferences: 4
generation plans: 3
review cohorts: 1
Cohort v1 members: 24
```

The four preferences, three plans, and Cohort v1 were pre-existing isolated-fixture data. They were not created by the proof importer.

After the first proof import:

```text
reference_sites: 1,704
reference_appearances: 1,785
proof source appearances: 81
proof canonical sites: 79
proof aggregators: 2
```

The second proof import returned exactly the same counts, proving idempotency. The isolated database now contains these proof rows. No shared-database command was run.

### Environment loading caveat

The relevant credential is configured in:

`/Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell/.env.local`

Do not load this file with a raw shell `source`: one URL contains an unquoted `&`, which caused a parse error before any database access. The successful isolated run loaded the environment through Next's environment loader and then launched the package script with that environment:

`/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref/node_modules/.bun/@next+env@15.5.15/node_modules/@next/env/dist/index.js`

Revalidate that dependency path before reusing it. Never substitute `DATABASE_URL` for the isolated URL.

## Verification completed

- Adapter ingest tests: 1 file, 10 tests passed.
- Targeted reference suite: 5 files, 22 tests passed.
- Full web-shell suite: 134 files passed and 1 skipped; 947 tests passed and 4 skipped.
- Production build: Next.js 15.5.15 compiled successfully; 43 pages generated.
- Syntax checks passed for the collector, builder, and isolated importer.
- The isolated importer rejected matching isolated/shared URLs before reading the seed or opening a database connection.
- `git diff --check` passed, including separate checks for the untracked files.
- The final proof rebuild retained the exact seed and report hashes above.

The test suite emitted the pre-existing non-blocking warning `--localstorage-file was provided without valid path`.

No browser QA was run because this slice changes ingestion tooling and tests, not the product UI.

## Deliberately not done

- No shared-database import.
- No mass collection of either source.
- No collection from the remaining seven submitted aggregators.
- No rating inferred from source rank, order, award, or popularity.
- No deep destination-site capture or motion enrichment.
- No generation, Demarcelizer call, node creation, or credit spend.
- No Cohort v2 creation or mutation of Cohort v1.
- No staging or commit.

## Nine-source routing decision

The detailed table and access evidence are in the discovery audit. The current sequence is:

1. The two-source proof is complete: Minimal Gallery + Site of Sites.
2. Landbook is the strongest next broad adapter, restricted to its unfiltered public page progression; templates and ads need separate handling.
3. Killer Portfolio is the strongest next vertical adapter after a manual terms/rate-policy check.
4. Awwwards Directory represents professionals/agencies, not ordinary site-reference appearances, and needs a separate entity decision.
5. Craftwork lacks a proven resumable public enumeration path.
6. MaxiBestOf exposes destination identity through disallowed routes; defer to an approved export or documented interface.
7. Recent has strong metadata but unresolved completeness and crawler-identity constraints.
8. NicelyDone is a separate product-UI lane with disallowed visit routes and paid/blurred material.

## Recommended next gate

Start by reviewing this uncommitted proof slice and the discovery audit. If the evidence is accepted, commit only the nine owned files listed under **Current repository state**.

Then ask for an explicit decision between these independent actions:

1. Approve bounded incremental collection for more Minimal Gallery and Site of Sites inventory, followed by another dry-run and isolated idempotency check.
2. Approve a Landbook adapter as the next separately reviewable slice.
3. Continue manual review of the existing 24-member Cohort v1 without changing importer scope.

Do not treat approval to commit this proof as approval for mass collection or shared import. If a future shared import is proposed, present final counts, rejected records, duplicate/non-merge reports, and isolated rerun evidence first, then request explicit authorization.

## Hard stop conditions for the next session

- Do not run `refs:import` or any command using `DATABASE_URL` without explicit shared-import approval.
- Do not mutate shared user reviews, recipes, cohorts, nodes, or credit state.
- Do not turn aggregator rank or taxonomy into a user's 1–5 taste rating.
- Do not deep-capture destination sites merely because they entered the catalog.
- Do not trigger generation or Demarcelizer from ingestion.
- Do not merge meaningful URL paths without a reviewed identity policy.
- Preserve source appearances independently when canonical destinations merge.
- Preserve the existing dirty slice and any unrelated future worktree changes.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
npm run refs:proof:build
cd packages/web-shell
bunx vitest run lib/reference-bank-ingest.test.js lib/reference-bank.test.js lib/reference-bank-store.test.js lib/reference-preferences.test.js lib/reference-planner.test.js
bun run test
bun run build
```

The build command regenerates the ignored proof output only when `npm run refs:proof:build` is run separately. Network collection and isolated database import are not part of this fast resume and should not be rerun merely to inspect the worktree.
