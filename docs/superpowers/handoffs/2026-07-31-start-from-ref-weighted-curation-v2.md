# Start from a Ref: weighted curation v2 handoff

**Date:** 2026-07-31

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Predecessor:** `05c6a386 feat(references): persist curation and shadow plans`

## Delivered

- Froze the existing 24 candidates as `Cohort v1`; new imports can no longer silently reorder this calibration set.
- Made the overall 1–5 rating mandatory for new reviews while preserving `keep`/`maybe`/`pass` as the independent eligibility decision.
- Added optional 4–5 strength dimensions: visual craft, structure, motion, originality, transferability, commercial clarity, chassis potential, and donor potential.
- Added `reference_aggregators` with neutral 3/5 defaults and bounded editorial, motion, metadata, and noise ratings. There is no public mutation endpoint; source ratings are changed only by the explicitly targeted server-side `refs:rate-source:isolated` or `refs:rate-source:shared` tools until admin authorization is designed.
- Upgraded the shadow planner to schema v2 with an inspectable 35/25/15/10/10/5 component formula and business-sensitive quality profiles.
- Kept source confidence at 5% of the final score and capped consensus inside that component.
- Updated the review UI progressively: the deep profile appears only after a 4 or 5, while ratings 1–3 remain a fast decision.

## Shared database evidence

The additive migration was applied first to the isolated database and then to the shared database. Immediately after the shared migration:

```text
reference_sites: 1,636
reference_appearances: 1,704
reference_aggregators: 3
reference_review_cohorts: 1
Cohort v1 members: 24
reference_preferences: 0
generation_reference_uses: 0
```

All three current aggregators begin at a neutral overall rating of 3/5. No subjective source rating was invented during migration. Shared user reviews and plans remain empty.

## Isolated end-to-end evidence

- Saved Bureau Rouge at 5/5 with all eight detailed dimensions.
- Loaded exactly 24 members from frozen `Cohort v1`, including review progress and average rating.
- Built a technical/industrial shadow plan using planner schema v2.
- Selected Bureau Rouge as chassis at 88.48/100 and The Red as donor at 52.86/100.
- Stored the component breakdown for brief fit, manual quality, composition compatibility, motion, transferability, and source confidence.
- Retained `generationTriggered: false`.

## Verification

- Targeted reference suite: 5 files, 13 tests passed.
- Full web-shell suite: 134 files passed, 1 skipped; 942 tests passed, 4 skipped.
- Production build: Next.js 15.5.15 compiled successfully with 43 pages.
- Authenticated desktop browser QA: the 304 px sticky review inspector rendered all eight selected dimensions and the frozen cohort label.
- Authenticated mobile browser QA at 390 px: document width remained 390 px, the inspector became static at 358 px, and no horizontal overflow was present.

## Deliberately not claimed

- No additional aggregator has been imported because the next source list has not yet been provided.
- `Cohort v2` has not been created; it should be generated only after the next batch is deduplicated and source quality is audited.
- Aggregator ratings are not crowd ratings and do not override brief fit or manual reference quality.
- No deep capture, embedding, generation, credit spend, or Demarcelizer execution was added.
- The shared database still contains no user review or shadow-plan fixtures.

## Next gate

1. Receive the next aggregator URLs and classify each adapter by direct links, detail pages, pagination/infinite scroll, and authentication requirements.
2. Import with neutral source priors, canonical URL deduplication, and provenance preservation.
3. Measure duplicate rate, usable metadata, motion density, and broken-link rate before changing source ratings.
4. Review a small calibration sample from Cohort v1 while ingestion runs.
5. Create a diverse `Cohort v2` from the expanded pool without altering Cohort v1 or existing user reviews.

## Integration boundary

This slice changes only reference-bank schema, persistence, planner, review UI, tests, scripts, and documentation. It does not edit motion-editor or motion-control modules.
