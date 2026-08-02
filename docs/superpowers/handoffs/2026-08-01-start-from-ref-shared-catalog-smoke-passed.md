# Start from a Ref: shared catalog product smoke passed

**Date:** 2026-08-01

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Pre-smoke HEAD:** `9625fb29` (`docs(handoff): record shared reviewed delta apply`)

**Predecessor handoff:** `docs/superpowers/handoffs/2026-08-01-start-from-ref-shared-reviewed-delta-applied.md`

## Outcome

The authorized authenticated, read-only product smoke of the shared `Start from a Ref` catalog passed on desktop and mobile.

The shared catalog rendered 1,919 canonical references, exposed all six source filters with the expected canonical-site totals, returned successful search and incremental-pagination results, loaded representative thumbnails, and exposed safe outbound-link attributes without visiting destination sites. Browser console evidence was clean and every catalog request recorded by the local application returned HTTP 200.

No review, preference, Cohort, shadow-plan, board, node, credit, generation, or aggregator-rating mutation was performed by the smoke. No destination site was fetched, no source was expanded, no Demarcelizer path was called, and no push or deployment occurred.

The only finding is a non-blocking presentation issue: the new source-filter buttons render the raw IDs `landbook`, `minimalgallery`, and `siteofsites` instead of humanized names. Functional filtering and source provenance were correct.

## Authorization boundary

The user authorized only the next gate named by the predecessor handoff: an authenticated, read-only smoke of the shared catalog.

That authorization covered:

1. Starting a temporary local application process against the existing trusted shared configuration.
2. Reading the authenticated catalog and billing balance.
3. Exercising browse-only filters, search, pagination, and responsive layouts.
4. Inspecting DOM link attributes, rendered thumbnail state, browser console output, and local server request logs.
5. Stopping the temporary server and leaving tracked repository state unchanged.

It did not authorize manual taste calibration, review/preference writes, shadow-plan creation or approval, destination-site capture, generation, node creation, credit spend, Demarcelizer execution, shared apply/rollback, source expansion, push, or deployment. None occurred.

The successful `POST /api/auth/login` in the server log was the user's explicit sign-in action in the visible browser. The automated smoke itself used read-only route and API requests.

## Environment and identity proof

Before browser work:

- No Uncraft web server owned port 3035.
- A temporary Next.js 15.5.15 process was started from this worktree on `http://localhost:3035`.
- Environment values were loaded from the existing trusted primary-checkout configuration without copying or printing secrets.
- Listener ownership was confirmed as the newly started Node process.
- `GET /` returned HTTP 200 with `<title>Uncraft</title>`.
- An unauthenticated request to `/canvas/library/references` returned the expected 307 redirect to `/`.
- After the user signed in, `/canvas/library/references` returned HTTP 200 and rendered the authenticated catalog.

The temporary process was stopped after the smoke. Port 3035 was confirmed free.

## Desktop evidence

Desktop viewport: `1440 × 1000`.

```text
document client width:       1,440
document scroll width:       1,440
body client width:           1,440
body scroll width:           1,440
catalog cards initially:        48
catalog total:               1,919
```

There was no page-level horizontal overflow. The catalog occupied a bounded 1,109 px content region inside the viewport.

### Source filters

All six source buttons were unique, clickable, selected correctly, and returned these canonical-site totals:

```text
Codrops:              847
Pafolios:             763
Landbook:             152
Minimal Gallery:       92
Site of Sites:         71
SiteInspire:           40
```

Each result set returned at most the requested first 48 cards and exposed `Show more` only when more records remained. SiteInspire correctly returned all 40 records without a pagination control.

Cross-source canonical references can display another source as their primary badge while a source filter is active. This is consistent with preserved multi-source provenance; source filtering itself returned the expected totals.

### Search

Searching all sources for `Estudio Niksen` returned exactly one result:

```text
title:       Estudio Niksen
source:      Landbook
URL:         https://estudioniksen.com
thumbnail:   loaded, natural width 960 px
```

Clearing the search restored all 1,919 references.

Automation note: once a query is present, the textbox accessible name includes the adjacent clear button. A future browser runner should use the unique `Clear search` button rather than reuse an exact pre-query textbox-name locator.

### Pagination

The first `Show more` action produced:

```text
cards before:                   48
cards after:                    96
unique card IDs after:          96
duplicate card IDs:              0
remaining label:             1,823
catalog total retained:      1,919
first appended card:         CÉNÉE
first appended URL:          https://cenee-paris.com
```

The first twelve appended thumbnails inspected after pagination were loaded with non-zero natural widths and no fallback state.

### Outbound-link safety

Representative catalog cards exposed:

```text
target="_blank"
rel="noopener noreferrer"
```

The smoke inspected stored `href` values only. It did not click those links or fetch destination sites.

## Representative new-source evidence

The following reviewed-delta records were present, consultable, and rendered with loaded thumbnails and safe outbound attributes:

| Source | Reference | Canonical URL | Thumbnail evidence |
| --- | --- | --- | --- |
| Landbook | Estudio Niksen | `https://estudioniksen.com` | loaded, natural width 960 px |
| Minimal Gallery | Robert Feasley | `https://rfeasley.io` | loaded, natural width 960 px |
| Site of Sites | The List | `https://thelist.design` | loaded, natural width 1,783 px |

## Mobile evidence

Mobile viewport: `390 × 844`.

```text
document client width:         390
document scroll width:         390
body client width:             390
body scroll width:             390
catalog width:                 358
grid columns:                  358 px, one column
source-row client width:       390
source-row scroll width:       716
source-row overflow-x:         auto
```

There was no page-level horizontal overflow. The source row intentionally used contained horizontal scrolling while the toolbar and catalog grid stayed within the viewport.

Landbook, Minimal Gallery, and Site of Sites were exercised again at mobile width. Estudio Niksen, Robert Feasley, and The List returned the same titles, source badges, canonical URLs, loaded thumbnails, and outbound-link safety attributes recorded above.

## Console and request evidence

Browser console inspection returned zero error or warning entries.

At the final all-sources mobile state:

```text
visible/lazy image elements:    48
loaded visible images:           8
failed loaded images:            0
pending lazy images:            40
catalog UI error:             none
review queue:                  0/24
credits balance:                350
```

The 40 pending images were below the current mobile viewport with native lazy loading. Representative visible and paginated samples loaded successfully; this was not reported as a full 1,919-thumbnail availability audit.

Local server logs recorded HTTP 200 for:

- The authenticated catalog route.
- Billing-balance reads.
- All six source-filter queries.
- The all-sources restore queries.
- `Estudio Niksen` and `The List` search queries.
- The `offset=48&limit=48` pagination query.

No catalog request returned an error status.

## Repository state

Before the smoke, the tracked worktree was clean at `9625fb29`.

After the smoke and server shutdown:

- `git diff --check` passed.
- No tracked implementation or product file had changed.
- The temporary Next build cache remained only under ignored `packages/web-shell/.next-smoke-3035/`.
- Port 3035 was free.

This handoff is a documentation-only successor. It does not change application behavior or shared database state.

## Non-blocking finding

`packages/web-shell/components/ReferenceLibrary.jsx` humanizes only the pre-existing `codrops`, `pafolios`, and `siteinspire` IDs in `SOURCE_LABELS`. The fallback therefore renders the three new IDs literally.

Expected display labels:

```text
landbook       -> Landbook
minimalgallery -> Minimal Gallery
siteofsites    -> Site of Sites
```

This did not block the smoke. Fixing it is a small UI-only gate and must not be bundled with review or generation mutations.

## Recommended sequence

Each numbered item is a separate approval gate. Completing or approving one item does not authorize the next.

### Gate 1 — Humanize the three new source labels

Scope:

1. Add the three display labels to `SOURCE_LABELS`.
2. Add or update focused UI coverage for the six-source filter row.
3. Re-run the focused reference tests and a bounded desktop/mobile browser check.

Exit condition:

- All six source names render consistently while counts and filtering remain unchanged.
- No database write, collection, capture, generation, push, or deployment.

### Gate 2 — Manually calibrate taste on frozen Cohort v1

This is the next product-data mutation gate and requires explicit approval.

Scope:

1. Review exactly the frozen 24-member `Cohort v1` in the authenticated review queue.
2. Record the required 1–5 overall taste rating and an independent `keep` / `maybe` / `pass` decision.
3. Use `keep` sparingly.
4. Record the strongest applicable chassis/donor role plus bounded business, visual, and motion tags.
5. For ratings 4–5, complete the progressive strength dimensions: visual craft, structure, motion, originality, transferability, commercial clarity, chassis potential, and donor potential.
6. Capture before/after review totals and stop without opening or creating a plan.

Exit condition:

- All intended Cohort v1 decisions are saved for the signed-in user and can be reloaded.
- Cohort membership remains immutable.
- No source rating, board, node, credit, generation, destination-capture, or Demarcelizer mutation.

### Gate 3 — Evaluate shadow planner v2 on real briefs

This is a separate plan-record mutation gate.

Scope:

1. Use only manually reviewed `keep` / `maybe` evidence.
2. Run materially different real briefs through planner schema v2.
3. Inspect the 35/25/15/10/10/5 score breakdown.
4. Enforce exactly one dominant chassis and one to three bounded donors.
5. Record human approval/rejection and reasons.
6. Keep every plan at `generationTriggered: false`.

Recommended evidence target:

- Compare human approval across at least ten materially different businesses before changing retrieval semantics or adding model-assisted retrieval.

Exit condition:

- Approved/rejected shadow plans are auditable and reproducible.
- No node creation, model call, credit spend, generation, or Demarcelizer execution.

### Gate 4 — Enrich only the approved `keep` subset

This is the first destination-site capture gate and requires explicit source-by-source authorization.

Scope:

1. Freeze the exact `keep` IDs selected for enrichment.
2. Capture matched desktop/mobile visual evidence.
3. Produce bounded DOM geometry, section, runtime-dependency, asset, and motion manifests.
4. Record access failures, broken links, and unsupported runtime behavior without inventing substitutes.
5. Preserve provenance and replayable evidence.

Exit condition:

- Only the approved `keep` subset has been captured and enriched.
- No generation, node creation, credit spend, shared-source expansion, or silent fallback to unrelated sites.

### Gate 5 — Integrate approved plans with Demarcelizer in isolation

This is an implementation-and-acceptance gate, not permission to enable shared generation.

Scope:

1. Start from a clean, owned Demarcelizer integration commit; do not depend on unrelated dirty files.
2. Map one approved chassis plus bounded donors into explicit `PRESERVE / ADAPT / REPLACE` directives.
3. Preserve the chassis section order, layout rhythm, scroll model, primary motion system, and layering.
4. Restrict each donor to a compatible bounded dimension.
5. Run against isolated fixtures with credit spending disabled.
6. Prove desktop/mobile visual and motion behavior, provenance, novelty, failure handling, and deterministic handoff state.

Exit condition:

- The isolated path materializes an approved plan without silently spending credits or mutating shared product state.
- Shared generation remains disabled.

### Gate 6 — Persisted acceptance, then separate shared enablement

Scope:

1. Run end-to-end acceptance in an explicitly owned migrated fixture environment.
2. Verify plan-to-node provenance, credit policy, cancellation, failure recovery, accessibility, performance, and visual/motion gates.
3. Review actual generated outputs and rework signals.
4. Only after acceptance, propose a separately authorized shared enablement with rollback and monitoring.

Exit condition:

- Local/isolated acceptance is distinguished from shared or production evidence.
- No push, deployment, shared credit spend, or production enablement without its own explicit authorization.

## Parallel track, not implied by this sequence

Further source expansion and creation of `Cohort v2` remain a separately approved ingestion track. If resumed:

1. Run read-only source discovery first.
2. Use neutral source priors.
3. Preserve canonical deduplication and every source appearance.
4. Prove bounded collection, deterministic builds, isolated idempotency, and review counts before proposing another shared delta.
5. Create a diverse `Cohort v2` only after the expanded pool is deduplicated and audited; never rewrite Cohort v1.

Source expansion does not authorize destination capture, taste inference, review mutation, generation, or Demarcelizer execution.

## Hard stops

- Do not rerun the completed shared apply.
- Do not execute rollback without a separately authorized incident response.
- Do not infer taste from source rank, taxonomy, popularity, or awards.
- Do not mutate Cohort v1 membership.
- Do not deep-capture catalog entries unless they are in an explicitly approved `keep` subset.
- Do not open the planner during Gate 2 or set `generationTriggered: true` during Gate 3.
- Do not connect or call Demarcelizer before Gate 5.
- Do not create nodes, spend credits, enable shared generation, push, or deploy without their own explicit gates.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -5 --oneline --decorate
```

Read this handoff first. The shared reviewed delta and authenticated read-only catalog smoke are complete. Resume at Gate 1 if the source-label polish is approved, or Gate 2 only if the user explicitly authorizes shared Cohort v1 taste-calibration writes.
