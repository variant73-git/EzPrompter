# Start from a Ref: Landbook pagination investigation landed

**Date:** 2026-08-01

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Predecessor handoff:** `docs/superpowers/handoffs/2026-08-01-start-from-ref-landbook-thumbnail-link-pilot-landed.md`

## Session outcome

After the user chose the order Landbook expansion investigation, shared-import review, then real-generation integration, only the read-only pagination investigation was executed. It identified a bounded, non-overlapping next listing slice and stopped before definitive collection.

The recommended next Landbook slice is the five explicit public listing checkpoints `?page=6` through `?page=10`. Across their first logical page of 20 cards each, the investigation observed 77 ordinary website records, 23 templates, 4 sponsored placements, 0 listing rejections, 0 duplicate ordinary IDs across the five pages, and 0 overlap with the existing 75-record pilot selection.

No Landbook detail was fetched. No destination website was visited. No collector, builder, importer, database query, cohort/review mutation, generation, Demarcelizer call, node creation, Uncraft credit spend, shared import, push, or deployment occurred.

## What caused the page-2 duplicate result

Landbook has logical listing pages of 20 `.website-item` cards, but the listing UI uses intersection-driven progressive loading with `data-pagination-limited-to="5"`. A Firecrawl listing snapshot can therefore contain a variable number of consecutive logical pages depending on how much loading completed before capture.

The previous pilot snapshots prove the concatenation behavior exactly:

```text
root snapshot:   100 cards = logical pages 1-5
?page=2 snapshot: 80 cards = logical pages 2-5
```

When split into ordered groups of 20 cards, groups 2-5 of the root snapshot match all four groups of the page-2 snapshot ID-for-ID and in the same order. Page 2 added no IDs because the root snapshot had already auto-loaded it and the next three pages.

A fresh root capture stopped after 40 cards while a fresh `?page=2` capture again contained 80. The snapshot depth is therefore not a safe collection boundary. The requested page and the first 20 cards are the stable logical boundary.

## Checkpoint discovery

Direct, unfiltered public checkpoints were inspected without search, sort, filter, API, authenticated, or destination-site routes:

```text
checkpoint  ordinary  templates  sponsored  rejections  overlap with pilot
page 6          15          5          1           0             0
page 7          16          4          0           0             0
page 8          15          5          1           0             0
page 9          15          5          1           0             0
page 10         16          4          1           0             0
--------------------------------------------------------------------------
pages 6-10      77         23          4           0             0
```

All 77 ordinary IDs are unique across pages 6-10. Page 11 was inspected only as the next-boundary proof: it contributed 18 additional ordinary IDs, with no overlap against the pilot or pages 6-10, but it is not part of the recommended next slice.

The page-6 card sequence also exactly matched the earlier independent page-6 discovery snapshot: 20 of 20 IDs in the same order. This gives a cross-session stability check for the proposed starting checkpoint.

## Ignored replayable evidence

The discovery artifacts live under:

```text
.firecrawl/reference-landbook-pagination-investigation/
```

Relevant snapshot hashes at investigation time:

```text
page 6:  63f20d4ed105def5dd03d0091cc249f71fef8c0fcbef44fcebc75d6b753a5811
page 7:  fc3418342c09cb2064722e9625e8fbf939d04f36feedbe961bc13798bfee7197
page 8:  222aa9014ffbbf55ab99199ef894dada6b1d3423db77863c9506ee2f766153c3
page 9:  02ff833cb379bc4eb2013f4c6460afc4a86b073e2efc9cb6dc42c92bd6cefe25
page 10: f05246402199046492c53b487181a241a0de33a78ed53aebb943348fa8067738
page 11: df8c5cad3efcdaf75b76f3faef59bd94a2bc54ef42a3a5bc04418277c1f7b396
```

These files remain ignored and must not be staged. They are discovery evidence, not an approved collection manifest or import seed.

## Recommended exact next scope

When the user later authorizes the remaining Landbook work, freeze a new manifest before fetching details with these bounds:

- Public, unfiltered listing pages: exactly 6, 7, 8, 9, and 10.
- Logical listing boundary: exactly the first 20 `.website-item` cards for each requested page; fail closed if card grouping or source URL is ambiguous.
- Prior-selection exclusion: the existing pilot selection hash `0a0b85c7a5552a0bf527f5466b268c20081e118cc1766c566745ad050d790f4e`.
- Expected discovery envelope: 77 ordinary website IDs, 23 templates, 4 sponsored placements, 0 rejections, 0 within-slice duplicates, and 0 pilot overlap. Revalidate rather than silently accepting drift.
- Maximum ordinary records: 100, with no padding if fewer valid unique records remain.
- Detail depth: exactly one matching Landbook detail for each selected ordinary website.
- Destination-site fetches: zero.
- Templates and sponsored placements: report-only lanes, never importable appearances.
- Database target: isolated only.
- Generation: disabled.

If Landbook changes before collection, rerun only the bounded listing check for pages 6-10. Any changed count, identity sequence, lane classification, or overlap must produce a new review rather than silently changing the frozen scope.

## When it is the right time to resume

The investigation gate is complete. The remaining option-3 work is ready only after the user explicitly approves the exact pages-6-to-10 scope above. At that point, and before any shared-import review, the correct sequence is:

1. Implement or parameterize a separate pages-6-to-10 collector without changing the landed pilot manifest.
2. Revalidate the five listing checkpoints and write the new frozen manifest before detail collection.
3. Fetch only the missing matching Landbook details for the approved ordinary lane.
4. Build twice and compare manifest, seed, and report hashes.
5. Import twice into the isolated database and run the source-specific consultation proof twice.
6. Run targeted/full tests and the production build, then land a new handoff.

Only after those six steps pass is it the right time to begin option 1: review the consolidated isolated evidence for a possible shared-database import. Shared import itself still requires its own explicit authorization. Option 2, real-generation integration, remains after the shared-catalog gate.

## Hard stops

- Do not treat these discovery snapshots as a definitive collection.
- Do not fetch Landbook details until the pages-6-to-10 scope is explicitly approved.
- Do not fetch destination sites during ingestion.
- Do not import templates, sponsored placements, or unresolved candidates as ordinary references.
- Do not run a shared import or any command targeting `DATABASE_URL` without explicit shared-import authorization.
- Do not mutate cohorts, reviews, plans, nodes, credits, or generation state.
- Do not connect catalog lookup to generation during the remaining option-3 work.
- Preserve ignored raw evidence and stage only owned repository files explicitly.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -5 --oneline --decorate
```

Read this handoff first. Do not recollect or import merely to resume; obtain explicit approval for the exact pages-6-to-10 scope.
