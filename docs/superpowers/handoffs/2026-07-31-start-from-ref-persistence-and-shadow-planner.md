# Start from a Ref: persistent curation and shadow planner handoff

**Date:** 2026-07-31

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Base:** `main` at `ec297fff`
**Previous catalog commit:** `2e0a09c5`

## Delivered

- Added the persistent reference-bank schema and an additive, idempotent migration.
- Imported the versioned catalog into the shared database: 1,636 canonical sites, 1,704 unique provenance appearances, and 24 high-priority review candidates.
- Added repeatable shared and isolated migration/import commands under `packages/web-shell/scripts/reference-bank` and package scripts under `refs:*`.
- Replaced the authenticated catalog's seed-only read path with database-backed query, search, facets, pagination, user-scoped reviews, and seed fallback when no database is configured.
- Added a Working Table review queue for verdict (`keep`, `maybe`, `pass`), taste score, chassis/donor role, bounded business/visual/motion tags, and notes.
- Added deterministic shadow planning from the signed-in user's reviewed references. It produces one dominant chassis and one to three bounded donors, with explicit `preserve`, `adapt`, and `replace` decisions.
- Added plan approval/rejection records. Shadow planning explicitly sets `generationTriggered: false`; it does not call a model, create a node, invoke Demarcelizer, or spend credits.

## Database evidence

The migration and seed import were run first against `E2E_ISOLATED_DATABASE_URL`, including a second import to prove idempotency, and then against the shared `DATABASE_URL`.

Shared database immediately after import:

```text
reference_sites: 1,636
reference_appearances: 1,704
review candidates: 24
reference_preferences: 0
generation_reference_uses: 0
```

The difference between the 1,720 raw source appearances and 1,704 persisted appearances is intentional: 16 rows had the same canonical-reference, source, and source-record identity. Cross-aggregator provenance remains separate.

The migration does not add or change `users.role`. Reviews are private per user, and the catalog is imported only by server-side tooling. Global moderation/admin authority remains a separate product and security decision.

## Verification completed

- Targeted reference tests: 5 files, 9 tests passed.
- Full web-shell suite: 134 files passed, 1 skipped; 938 tests passed, 4 skipped.
- Production build: Next.js 15.5.15 compiled successfully with 43 pages, including the new reference APIs.
- Authenticated catalog browser smoke: shared layout, real thumbnails, 1,636 results, and correct source facets rendered at `/canvas/library/references`.
- Isolated end-to-end persistence smoke: saved two `keep` reviews, selected Bureau Rouge as chassis and The Red as donor, created a two-reference shadow recipe, and approved it. The stored recipe retained `generationTriggered: false`.

## Deliberately not claimed

- The 24 candidates are an initial high-priority review queue, not an approved or enriched gold set.
- No review or shadow plan was written to the shared user's account during delivery.
- There is no deep DOM/runtime capture, section manifest, motion trace, embedding, availability monitor, or scheduled crawler yet.
- The v1 planner is deterministic structured/lexical scoring; it is not yet model-assisted retrieval.
- No landing page is generated and no Demarcelizer workflow is connected.
- Codrops pagination/source coverage remains bounded by the current collected snapshot.

## Incoming aggregator queue (registered, not collected)

Adilson supplied the next source wave on 2026-07-31. The raw list contained 10 entries and 9 unique aggregators; `https://maxibestof.one` appeared twice and is intentionally registered only once.

| Priority lane | Aggregator | Expected emphasis to verify during discovery |
| --- | --- | --- |
| Broad visual references | `https://www.awwwards.com/directory/` | Large directory; determine filters, pagination depth, thumbnail access, destination-link depth, and access/rate constraints before collection. |
| Broad visual references | `https://land-book.com` | Landing-page-oriented catalog; map categories, pagination, and destination links. |
| Broad visual references | `https://minimal.gallery` | Minimal/high-curation visual lane; map browsing and pagination behavior. |
| Broad visual references | `https://craftwork.design/curated/websites` | Curated website lane; verify collection boundaries and direct-site links. |
| Additional discovery | `https://maxibestof.one` | Curated website lane; deduplicated from two submitted entries. |
| Additional discovery | `https://recent.design/websites` | Recent website lane; verify freshness metadata and pagination. |
| Additional discovery | `https://www.siteofsites.co/` | Curated directory; verify category structure and click depth. |
| Vertical: portfolios | `https://www.killerportfolio.com` | Portfolio-only source; keep source taxonomy as a hint, not the final Uncraft classification. |
| Vertical: apps/product UI | `https://nicelydone.club/apps` | App/product-interface source; keep separate from landing-page references unless a reference genuinely serves both roles. |

These descriptions are routing hypotheses derived from the submitted URLs, not evidence from a completed crawl. The next executor must run a read-only discovery pass before implementing or running collectors.

### Collection contract for this wave

1. Preserve each aggregator as provenance while deduplicating references by canonical destination identity. A duplicate source URL must not create a second source record; the same destination found in different aggregators must retain all distinct appearances.
2. Do not derive the Uncraft 1–5 taste rating from an aggregator's rank, award, or ordering. Ratings remain manual/user-scoped evidence; aggregator metadata is only a retrieval signal.
3. Inventory categories, pagination/infinite-scroll behavior, thumbnail source, final destination-link depth, freshness fields, access constraints, and resumability for all nine sources before mass collection.
4. Respect source terms, robots/rate limits, and authentication boundaries. Do not bypass challenges or protected access.
5. Prove the importer contract on two structurally different sources first, with dry-run counts, canonicalization samples, duplicate reports, and idempotent rerun evidence. Then add the remaining adapters incrementally.
6. Keep raw source snapshots/versioned manifests separate from the normalized database import so parser changes remain replayable and auditable.
7. Deep capture and motion enrichment remain limited to references manually marked `keep`; catalog ingestion alone must not trigger expensive capture or generation.

### Sequencing decision

Read-only discovery and adapter design for this nine-source wave may proceed in parallel with manual review of the existing 24 candidates because they do not mutate the same user-review records. Mass import should begin only after the two-source importer proof is reviewed. Connecting recipes to Demarcelizer remains a later, independent gate.

## Recommended next gate

1. Manually review the 24 candidates in `Start from a Ref`, using `keep` sparingly and recording the strongest possible chassis/donor role and motion tags.
2. Run the read-only nine-source discovery inventory above and propose two structurally different sources for the importer proof; do not write to the shared database at this step.
3. Capture and deeply enrich only the existing `keep` subset: desktop/mobile screenshots, DOM geometry, section manifest, runtime dependencies, and motion trace.
4. After approval of the importer proof, ingest the new sources incrementally with canonicalization, provenance, and idempotency evidence.
5. Re-run shadow planning on real briefs and compare human approval across at least 10 materially different businesses.
6. Add multimodal/semantic retrieval only after those approvals reveal where deterministic tags are insufficient.
7. Connect approved recipes to Demarcelizer as an independently reviewable slice, preserving the one-chassis rule and keeping generation behind an explicit approval gate.

## Integration

This worktree does not edit motion-editor or motion-control modules. After the parallel motion branch lands, rebase this branch onto updated `main`, resolve only genuine shell/CSS overlap, and rerun the full suite, build, shared-database read smoke, and authenticated browser smoke before merge.
