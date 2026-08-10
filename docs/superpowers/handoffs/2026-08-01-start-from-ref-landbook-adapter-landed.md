# Start from a Ref: bounded Landbook adapter landed

**Date:** 2026-08-01

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Implementation commit:** `1f206437 feat(refs): add bounded Landbook adapter`

**Predecessor handoff:** `docs/superpowers/handoffs/2026-08-01-start-from-ref-two-source-increment-1-landed.md`

## Session outcome

After the user explicitly selected option 1, the separately reviewable Landbook adapter was implemented, validated against the prior ignored discovery snapshots, tested, built, and committed.

The adapter accepts only Landbook's unfiltered public page progression, partitions ordinary websites, templates, sponsored campaign placements, and rejected records into distinct lanes, and enriches only a detail whose numeric Landbook identity matches the listing record. It never treats a sponsored platform link as a website destination.

No new Landbook page or detail was fetched. No collector or builder command was added or run. No database was queried or mutated, and no import, deep destination capture, generation, Demarcelizer call, node creation, Uncraft credit spend, cohort mutation, push, or deployment occurred.

## Implementation commit contents

The implementation commit contains exactly these two owned files:

```text
packages/web-shell/lib/reference-bank-landbook.js
packages/web-shell/lib/reference-bank-landbook.test.js
```

The adapter remains isolated from the existing two-source proof and incremental scripts. A later collection slice can import it without reopening the identity and lane-separation contract.

## Frozen adapter contract

### Listing boundary

- Accept only `https://land-book.com/` and `https://land-book.com/?page=N`.
- `N` must be a positive safe integer.
- Page 1 canonicalizes to the root URL.
- Reject HTTP, credentials, custom ports, fragments, duplicate page parameters, and every filter/sort/query parameter other than `page`.
- Do not use `/api/`, search, sort, filter, tracking, or other routes disallowed by the observed `robots.txt`.

### Lane separation

- `appearances`: ordinary website cards with a valid numeric Landbook record ID, matching `/websites/{id}-{slug}` detail URL, and explicit external `Visit website` destination.
- `templates`: cards carrying Landbook's explicit `Template` marker. They retain source detail, thumbnail, categories, and visible price label but never enter the website-appearance lane.
- `advertisements`: explicit `.campaign-ad-link[rel~="sponsored"]` placements. They retain placement metadata separately and never become website references.
- `rejections`: malformed or mismatched detail identities and ordinary website cards without an explicit target.

The adapter does not classify templates from title keywords or visual appearance. It relies on Landbook's explicit template marker and fails closed when a non-template card lacks a target.

### Detail enrichment

- Match the detail payload's numeric ID to the fallback listing record.
- Select only the outbound visit link whose Landbook analytics ID matches that record; related-site links cannot replace it.
- Preserve Landbook's signed desktop and mobile screenshot URLs as remote source metadata; copy no assets.
- Parse structured category, style, industry, typography, type, and platform labels only from explicit filter labels on the current detail.
- Preserve the visible `Verified ...` label as source taxonomy.
- Keep `publishedAt: null`; the verification label has no reliable year and is not treated as publication evidence.
- Infer no rating from listing order, taxonomy, template status, ad status, views, saves, or verification.

## Validation against existing ignored evidence

The prior discovery snapshots were reused read-only:

```text
.firecrawl/discovery-land-book.json
.firecrawl/discovery-page-land-book-6.json
.firecrawl/discovery-detail-land-book-taste-labs.json
.firecrawl/discovery-robots-land-book.txt
```

The real rendered root snapshot produced:

```text
ordinary website appearances: 75
templates: 25
sponsored campaign placements: 5
rejections: 0
```

The representative Taste Labs detail retained:

```text
Landbook record ID: 98186
target: https://tastelabs.com/?ref=land-book.com
publishedAt: null
verified label: Verified Jul 31
desktop remote thumbnail: present
mobile remote thumbnail: present
```

The existing page-6 discovery snapshot contains markdown but not rendered HTML. It was sufficient to confirm the approved URL checkpoint but was deliberately not parsed into appearances. Any future collector must request HTML for every bounded listing checkpoint and must not infer card associations from loose link order.

## Verification

- Adapter syntax checks passed.
- Landbook adapter suite: 1 file and 5 tests passed.
- Targeted reference suite: 6 files and 29 tests passed.
- Full web-shell suite: 135 files passed and 1 skipped; 954 tests passed and 4 skipped.
- Production build: Next.js 15.5.15 compiled successfully; 43 pages generated.
- `git diff --check` and staged diff checks passed.
- The pre-existing non-blocking warning `--localstorage-file was provided without valid path` remained present.

No browser QA was run because this slice adds pure ingestion parsing and tests rather than product UI.

## Next gate requires a separate explicit choice

The adapter slice stops here. These actions remain independent and unapproved:

1. Define and approve a bounded Landbook collection pilot with an exact page range or record cap, HTML snapshots for each checkpoint, site-detail fetches only for the ordinary website lane, and a dry-run report that keeps templates and ads out of importable appearances.
2. Manually review the existing 24-member Cohort v1 without changing importer scope.
3. Review the final Minimal Gallery + Site of Sites evidence for a possible shared-database import and, only if approved separately, execute that import.

Approval for one option is not approval for either of the others. A future Landbook collection approval is not shared-import approval.

## Hard stops

- Do not run `refs:import` or any command using `DATABASE_URL` without explicit shared-import authorization.
- Do not collect Landbook pages or details without a newly approved exact bound.
- Do not use Landbook filtered, sorted, search, API, tracking, or authenticated routes.
- Do not import templates or sponsored placements as ordinary website appearances.
- Do not parse loose markdown link order as a card-to-target identity contract.
- Do not infer a user's 1–5 taste rating from source order, taxonomy, template status, ads, views, saves, or verification.
- Do not deep-capture destination sites merely because they appear in Landbook.
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

Do not fetch Landbook or run any import merely to resume. Read this handoff first, then obtain the explicit next-gate choice.
