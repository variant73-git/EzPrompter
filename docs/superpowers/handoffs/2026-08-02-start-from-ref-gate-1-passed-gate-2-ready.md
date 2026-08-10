# Start from a Ref: Gate 1 passed, agent-assessment redesign pending

**Date:** 2026-08-02

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Current HEAD:** `bfb4be68` (`docs(handoff): record shared catalog smoke`)

**Predecessor handoff:** `docs/superpowers/handoffs/2026-08-01-start-from-ref-shared-catalog-smoke-passed.md`

## Outcome

Gate 1 is locally complete and passed its focused automated and authenticated browser checks.

The three new catalog source IDs now render as humanized names:

```text
landbook       -> Landbook
minimalgallery -> Minimal Gallery
siteofsites    -> Site of Sites
```

The complete source-filter row renders consistent names and the existing shared totals remain unchanged. Filtering the three affected sources returned the expected catalog counts on desktop, and the mobile layout retained contained horizontal scrolling without page-level overflow.

No review, preference, Cohort, planner, board, node, credit, generation, source-rating, collection, destination capture, Demarcelizer, shared apply/rollback, push, or deployment mutation was performed.

Gate 1 is not committed. The two implementation/test files and this handoff are the only owned tracked changes expected after this document is created.

## Post-handoff correction: agent assessment, not per-site role selection

**Recorded:** 2026-08-02, after the original Gate 2 handoff.

The original Gate 2 manual-review contract is superseded. It incorrectly asks the user to assign a fixed `chassis`, `donor`, or `either` role to each reference. A reference can contribute as a chassis or as a donor depending on the business brief and the other selected references. That is a plan-time composition decision, not a durable user preference.

The replacement contract is:

1. The agent owns the initial reference assessment and records bounded capabilities, evidence, confidence, and known gaps. It must not present inferred capability as a user-supplied taste decision.
2. The planner evaluates every eligible reference for both chassis and donor suitability against the current brief, then selects one dominant chassis and one to three bounded donors. It must not exclude a reference from either role because of a global, per-site role flag.
3. A reference's business category or site type (for example, photography, culture, finance, or commerce) is a weak retrieval and interpretation clue only. It may receive a small supporting weight, but it must never act as a filter, hard eligibility rule, fixed role, or proxy for the requested outcome. A photography site can be a strong candidate for a portfolio, commerce, technology, or any other brief that benefits from its image-rich composition, media treatment, or interaction model.
4. Human feedback is optional calibration, not mandatory annotation. The catalog may offer quick signals or suggested tags, but missing feedback is never a rejection. Ask only where the agent has low confidence, the choice is high-impact, or feedback would materially distinguish credible alternatives.
5. The user supplies the business brief and can give high-level directional feedback. The system must preserve viable alternatives and uncertainty so a sparse set of manual signals cannot create blind spots.

No replacement assessment, preference, plan, capture, credit, generation, board, node, shared import, push, or deployment write has been performed. The original Gate 2 and Gate 3 text remains below only as a historical record and must not be executed without a reviewed replacement design and its own authorization.

## Authorization boundary

The user explicitly authorized Gate 1, then requested this handoff for Gate 2 onward.

That authorization covered:

1. Adding the three display labels to `SOURCE_LABELS`.
2. Adding focused coverage for the complete six-source row.
3. Running focused reference tests and `git diff --check`.
4. Starting a temporary local application against the existing trusted shared configuration.
5. Running authenticated, browse-only desktop/mobile checks of labels, counts, filtering, layout, console output, and local request logs.
6. Stopping the temporary server.
7. Creating this repository handoff.

It did not authorize:

- Staging or committing Gate 1.
- Manual taste ratings or `keep` / `maybe` / `pass` writes.
- Opening, creating, approving, or rejecting a shadow plan.
- Capturing destination sites.
- Creating boards or nodes.
- Spending credits or calling a generation model.
- Running Demarcelizer.
- Shared import, rollback, source expansion, push, deployment, or production enablement.

Approval to create this handoff is not approval for Gate 2. Gate 2 requires a new explicit authorization because it writes user-specific product data.

## Gate 1 implementation

### Product code

`packages/web-shell/components/ReferenceLibrary.jsx`

Added the three missing `SOURCE_LABELS` entries while preserving the existing fallback and component structure:

```js
landbook: 'Landbook',
minimalgallery: 'Minimal Gallery',
siteofsites: 'Site of Sites',
```

No filter IDs, API parameters, counts, sorting, pagination, review behavior, styles, or database code changed.

### Focused UI coverage

`packages/web-shell/components/ReferenceLibrary.test.jsx`

Added a six-source fixture using the proven shared catalog totals and a focused test that requires these visible labels:

```text
All sources
Codrops
Pafolios
Landbook
Minimal Gallery
Site of Sites
SiteInspire
```

The pre-existing filtered-request test remains intact.

## Automated evidence

The following focused suite passed from `packages/web-shell`:

```text
components/ReferenceLibrary.test.jsx
lib/reference-bank.test.js
lib/reference-bank-store.test.js
lib/reference-preferences.test.js
lib/reference-planner.test.js
lib/reference-bank-ingest.test.js
lib/reference-bank-landbook.test.js
lib/reference-bank-promotion.test.js
```

Result:

```text
Test Files:  8 passed
Tests:      42 passed
```

`git diff --check` also passed.

No importer, migration, database, review, planner, generation, or capture command was run.

## Authenticated browser evidence

A temporary Next.js 15.5.15 process was started from this worktree on `http://localhost:3035` with a separate ignored build cache:

```text
packages/web-shell/.next-smoke-3035/
```

Environment values were loaded from the existing trusted primary-checkout configuration with Next's environment loader. No secret or database URL was printed or copied.

Listener ownership, `GET /` status 200, `<title>Uncraft</title>`, and the expected unauthenticated 307 catalog redirect were confirmed before browser work. The existing in-app browser session was authenticated as the intended user when the product smoke ran.

### Desktop

Viewport: `1440 x 1000`.

```text
document client width:      1,440
document scroll width:      1,440
body client width:          1,440
body scroll width:          1,440
catalog region width:       1,109
source-row client width:    1,109
source-row scroll width:    1,109
raw source IDs visible:         0
```

Rendered filters and totals:

```text
All sources:          1,919
Codrops:                847
Pafolios:               763
Landbook:               152
Minimal Gallery:         92
Site of Sites:           71
SiteInspire:             40
```

The affected filters were clicked individually and each became the selected `aria-pressed="true"` control:

```text
Landbook          -> 152 references
Minimal Gallery   ->  92 references
Site of Sites     ->  71 references
All sources       -> 1,919 references restored
```

### Mobile

Viewport: `390 x 844`.

```text
document client width:        390
document scroll width:        390
body client width:            390
body scroll width:            390
catalog/grid width:           358
grid columns:              358px, one column
source-row client width:      390
source-row scroll width:      731
source-row overflow-x:       auto
raw source IDs visible:         0
```

All six humanized source names plus `All sources` were present at mobile width. `Minimal Gallery` returned 92 references and restoring `All sources` returned 1,919. There was no page-level horizontal overflow before or after filtering.

### Console and requests

Browser console warnings/errors:

```text
0
```

Local server logs recorded HTTP 200 for:

- The authenticated catalog route.
- Billing-balance read.
- Landbook filter.
- Minimal Gallery filter on desktop and mobile.
- Site of Sites filter.
- All-sources restores on desktop and mobile.

Every automated product interaction was browse-only. The browser did not open Review or Plan, click destination links, submit forms, or call a write endpoint.

The browser viewport was reset, automation tabs were finalized, the temporary server was stopped, and port 3035 was confirmed free.

## Repository state at handoff creation

Branch and HEAD:

```text
codex/start-from-ref
bfb4be68 docs(handoff): record shared catalog smoke
```

Owned uncommitted files:

```text
M  packages/web-shell/components/ReferenceLibrary.jsx
M  packages/web-shell/components/ReferenceLibrary.test.jsx
?? docs/superpowers/handoffs/2026-08-02-start-from-ref-gate-1-passed-gate-2-ready.md
```

The implementation diff before this handoff was:

```text
2 files changed, 30 insertions(+)
```

The ignored temporary cache remains at `packages/web-shell/.next-smoke-3035/`. It is not part of the tracked handoff and must not be added.

No unrelated tracked change was observed. Do not use `git add -A` because ignored/raw collection artifacts are intentionally outside the reviewable source slice.

## Source-control closeout before Gate 2

Gate 1 is technically complete but intentionally uncommitted because the user did not request a commit.

Before starting Gate 2:

1. Read this handoff.
2. Verify branch, HEAD, status, diff, and port ownership.
3. Confirm the two Gate 1 code/test diffs still match this document.
4. Ask for explicit direction before staging or committing.
5. If a commit is authorized, keep the Gate 1 code, focused test, and this handoff in one focused commit or in two clearly separated commits. Do not bundle any Gate 2 product-data mutation into that commit.

Do not discard or overwrite the owned Gate 1 changes if the next session begins while the worktree is still dirty.

## Superseded original Gate 2 - Manually calibrate taste on frozen Cohort v1

This is the next product-data mutation gate. It requires explicit authorization after the user reviews this handoff.

### Goal

Record the signed-in user's explicit taste decisions for exactly the frozen 24-member `Cohort v1`, without changing cohort membership or opening the planner.

### Critical taste boundary

Do not invent the user's taste. Approval to start Gate 2 does not itself supply ratings or decisions.

The user must explicitly provide or visibly confirm for each reviewed reference:

1. Overall taste rating from 1 to 5.
2. Independent `keep`, `maybe`, or `pass` decision.
3. Strongest applicable chassis/donor role.
4. Bounded business, visual, and motion tags.
5. For ratings 4-5, the required progressive strength dimensions:
   - Visual craft.
   - Structure.
   - Motion.
   - Originality.
   - Transferability.
   - Commercial clarity.
   - Chassis potential.
   - Donor potential.

Aggregator ranking, source identity, taxonomy, popularity, awards, or prior catalog order are retrieval evidence only. They must not be used as substitutes for the user's manual taste judgment.

### Gate 2 sequence

1. Confirm the intended signed-in user before any write.
2. Open only the authenticated Review queue, not Plan.
3. Capture the initial Cohort v1 identity, frozen status, membership count, and review totals.
4. Confirm there are exactly 24 immutable members.
5. Present references to the user without pre-filling or inferring taste.
6. Save only decisions the user explicitly provides or confirms.
7. Use `keep` sparingly and keep it independent from the 1-5 rating.
8. After the final intended decision, reload the queue and prove saved values are durable for the same user.
9. Capture final totals for reviewed, keep, maybe, pass, and 4+ ratings.
10. Stop without opening, creating, approving, or rejecting a plan.

### Gate 2 exit condition

- Every intended Cohort v1 decision was explicitly supplied or confirmed by the user.
- Saved decisions reload correctly for the signed-in user.
- Cohort v1 remains frozen with the same 24 members.
- Initial and final review totals reconcile with the performed writes.
- No source rating, board, node, credit, generation, destination capture, Demarcelizer, shared import, push, or deployment mutation occurred.

### Gate 2 hard stops

- Stop if the signed-in identity is unclear or different from the intended user.
- Stop if Cohort v1 is not frozen, does not contain exactly 24 members, or membership changes.
- Stop before saving any rating the user did not explicitly provide or confirm.
- Do not infer `keep` from a rating or infer a rating from `keep`.
- Do not rate sources/aggregators.
- Do not open Plan or create a shadow-plan record.
- Do not visit or capture destination sites.
- Do not create boards/nodes, call generation, or spend credits.

## Superseded original Gate 3 - Evaluate shadow planner v2 on real briefs

Gate 3 is a separate plan-record mutation gate and requires a new explicit approval after Gate 2 exits cleanly.

### Scope

1. Use only manually reviewed `keep` / `maybe` evidence.
2. Use materially different real business briefs supplied or approved by the user.
3. Inspect the planner v2 score breakdown:
   - 35% brief fit.
   - 25% manual quality.
   - 15% composition compatibility.
   - 10% motion fit.
   - 10% transferability.
   - 5% source confidence.
4. Enforce exactly one dominant chassis.
5. Limit each plan to one to three bounded donors.
6. Record the user's approval/rejection and reason for every evaluated plan.
7. Keep `generationTriggered: false` for every plan.

Recommended evidence target: at least ten materially different businesses before changing retrieval semantics or proposing model-assisted retrieval.

### Exit condition

- Approved/rejected shadow plans are auditable and reproducible.
- One dominant chassis and bounded donor roles are explicit.
- `generationTriggered` remains false everywhere.
- No node creation, model call, credit spend, generation, destination capture, or Demarcelizer execution occurred.

## Gate 4 - Enrich only the approved keep subset

Gate 4 is the first destination-site capture gate. It requires a new explicit source-by-source authorization after approved plans identify the exact references needed.

### Scope

1. Freeze the exact approved `keep` IDs and destination URLs.
2. Capture matched desktop/mobile visual evidence only for that frozen subset.
3. Produce bounded DOM geometry, section, runtime-dependency, asset, and motion manifests.
4. Record access failures, broken links, and unsupported runtime behavior without inventing substitutes.
5. Preserve provenance and replayable evidence.

### Exit condition

- Only the explicitly approved `keep` subset was captured and enriched.
- Evidence is matched across desktop/mobile where the source permits it.
- No generation, node creation, credit spend, shared-source expansion, or silent fallback to unrelated sites occurred.

## Gate 5 - Integrate approved plans with Demarcelizer in isolation

Gate 5 is an implementation-and-acceptance gate. It is not permission to enable shared generation.

### Scope

1. Start from a clean, owned Demarcelizer integration commit and isolated fixture environment.
2. Map one approved chassis plus bounded donors into explicit `PRESERVE / ADAPT / REPLACE` directives.
3. Preserve chassis section order, layout rhythm, scroll model, primary motion system, and layering.
4. Restrict each donor to its approved compatible dimension.
5. Keep credit spending disabled.
6. Prove desktop/mobile visual and motion behavior, provenance, novelty, failure handling, and deterministic handoff state.

### Exit condition

- The isolated path materializes an approved plan without silently spending credits or mutating shared product state.
- Shared generation remains disabled.

## Gate 6 - Persisted acceptance, then separate shared enablement

Gate 6 requires an explicitly owned migrated fixture environment.

### Scope

1. Run end-to-end acceptance in the owned fixture.
2. Verify plan-to-node provenance, credit policy, cancellation, failure recovery, accessibility, performance, and visual/motion gates.
3. Review actual generated outputs and rework signals.
4. Record local/isolated acceptance separately from shared or production evidence.
5. Only after acceptance, propose a separately authorized shared enablement with rollback and monitoring.

### Exit condition

- Persisted fixture acceptance is complete and auditable.
- Shared/production enablement remains a separate decision.
- No push, deployment, shared credit spend, or production enablement occurred without its own explicit approval.

## Parallel track, not implied by Gates 2-6

Further source expansion and creation of `Cohort v2` remain a separate ingestion track.

If separately approved:

1. Run read-only source discovery first.
2. Use neutral source priors.
3. Preserve canonical deduplication and every source appearance.
4. Prove bounded collection, deterministic builds, isolated idempotency, and review counts before proposing another shared delta.
5. Create a diverse Cohort v2 only after the expanded pool is deduplicated and audited.
6. Never rewrite Cohort v1.

Source expansion does not authorize destination capture, taste inference, review mutation, planning, generation, or Demarcelizer execution.

## Global hard stops

- Do not rerun the completed shared reviewed-delta apply.
- Do not execute rollback without a separately authorized incident response.
- Do not infer taste from source rank, taxonomy, popularity, or awards.
- Do not mutate Cohort v1 membership.
- Do not deep-capture catalog entries unless they are in an explicitly approved `keep` subset.
- Do not open the planner during Gate 2.
- Do not set `generationTriggered: true` during Gate 3.
- Do not connect or call Demarcelizer before Gate 5.
- Do not create nodes, spend credits, enable shared generation, push, or deploy without their own explicit approvals.
- Do not treat local or isolated evidence as shared or production proof.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -5 --oneline --decorate
git diff --check
git diff -- packages/web-shell/components/ReferenceLibrary.jsx packages/web-shell/components/ReferenceLibrary.test.jsx
lsof -nP -iTCP:3035 -sTCP:LISTEN
```

Read this handoff first. Gate 1 is locally complete, tested, and browser-validated, but remains uncommitted. Preserve its owned changes. Obtain separate user direction for source-control closeout, then begin Gate 2 only after explicit authorization for user-specific Cohort v1 preference writes and explicit user-supplied taste decisions.
