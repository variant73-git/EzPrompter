# Handoff — Start from a Ref chassis roadmap, local implementation checkpoint (2026-08-07)

## Start here

- Repository worktree: `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`
- Branch: `codex/start-from-ref`
- HEAD at handoff: `60dd8ffb docs(refs): hand off private curation next steps`
- Worktree: intentionally dirty and **not committed**; see the owned file list below.
- Previous handoff: `docs/superpowers/handoffs/2026-08-05-start-from-ref-private-curation-next-steps.md`
- Product context: `PRODUCT.md` and `DESIGN.md`
- Local page: `http://localhost:3035/canvas/library/references`
- No process was listening on port 3035 when this handoff was written. The last browser-visible acceptance happened before the server stopped.

Read this file completely before editing code, querying or mutating a database, capturing an external site, generating, spending credits, committing, pushing, merging, changing Vercel, or deploying. This handoff records state and sequence; it does not authorize its next gate.

## Authorization boundary and standing user rules

- Work remains local for now.
- No shared migration, shared plan/preference write, external destination capture, model generation, credit spend, commit, push, merge, Vercel environment mutation, or deployment was authorized or performed in the final implementation slice.
- The only authorized curator email is `variant73@gmail.com`.
- The correct GitHub account is **always** `variant73-git`.
- The Vercel project is `uncraft`, team `variant73-gits-projects`, production URL `https://uncraft.vercel.app`.
- The repo root now contains `.vercel/project.json` for project `uncraft` and team `team_5HY5RzfVzWQshWxOZNcYY7qD`. Before any future deployment, verify that Vercel's project Root Directory is `packages/web-shell`; do not restore the obsolete `Clone/` folder as the deployment root.
- `.gitignore` has a one-line `.vercel` addition from the earlier Vercel-link work. Keep it distinct during review; do not stage everything indiscriminately.

## Product decisions now authoritative

### Curator signals

- `Maybe` is the default/undecided state. It never counts as reviewed and never enters planning.
- Only `Keep` references are planning candidates. `Pass` and `Maybe` are excluded.
- The curator UI is intentionally lightweight:
  - verdict: `Keep / Maybe / Pass`;
  - optional product/site type;
  - optional `Worth borrowing`;
  - optional `Avoid`.
- Taste score, style tags, motion tags, strength dimensions, and fixed `chassis / donor / either` roles are not shown and do not rank candidates. Legacy stored values remain preserved for backward compatibility only.
- `Worth borrowing / Avoid` are guidance applied **after** selection. They must never affect the score.

### Chassis strategy

- One chassis is the default and owns the page-wide structural spine:
  - section order and hierarchy;
  - grid, proportions, alignment, density, and breathing rhythm;
  - text composition and anchors;
  - media-slot roles;
  - animation logic and scroll authority;
  - responsive structure.
- Target content and identity are authoritative for brand, copy, typography, colors, imagery, and factual/commercial truth.
- Do not invent testimonials, prices, metrics, customers, capabilities, or proof to fill a chassis slot.
- Storage now permits **1–3** references, not 1–4. Current planner logic still selects exactly one. Logic for two or three simultaneous references does not exist yet.
- Preserve the distinction between:
  1. up to three **candidate options** shown to the user, with one chosen as chassis;
  2. up to three **references used** in construction, where one is the chassis and any others contribute only bounded capabilities.
- Recommended default: show up to three tied candidate options cheaply, but construct from one chassis. Add a second or third construction reference only as an explicit exception.

## Current catalog and curation snapshot

Browser-visible state during the last authenticated smoke:

- catalog: 1,949 ordinary-visible references in the current view;
- source facets: 49 decisive reviews across all sources;
- frozen Review Queue: 24/24 decisive;
- kept chassis available to the Planner: 13;
- Curate visible to the authenticated curator;
- browser console: no warnings or errors beyond the React development info message.

These values are a timestamped observation and can drift as Adilson continues curating.

`Review queue` and `Curate` use the same preference record and review panel:

- Review Queue is the frozen 24-reference calibration cohort.
- Curate is the full internal catalog and the correct surface for ongoing 100+ reference work.

## What was implemented in the dirty worktree

### Curation UX

- Source chips show `total/decided`; decisive means only `Keep` or `Pass`.
- Review heading uses decisive counts rather than ratings.
- Save becomes `Kept` (green) or `Passed` (yellow) after save and re-enables only after a form change.
- Every card has green-check and yellow-X quick actions.
- The whole card opens the review panel and selected state has a background highlight.
- Review fields are reduced to verdict, product/site type, `Worth borrowing`, and `Avoid`.
- `Worth borrowing / Avoid` are encoded into the existing `reference_preferences.notes` field through a versioned JSON prefix. No preference-schema migration is required.

### Candidate retrieval and selection

- `getReviewedPlanningCandidates()` queries only the current user's `Keep` rows, excludes removed/private rows according to curator access, and caps retrieval at 500 keeps.
- The Planner does **not** visually inspect 1,949 references and does not call an LLM during selection.
- Brief types are inferred deterministically in English and Portuguese.
- Candidate type comes from recognized human `businessTags`/site-type tags when present; otherwise it is inferred from catalog categories, title, description, and tags.
- Score is only site-type overlap.
- Current hidden tie-break after equal type score is:
  1. `curationWeight`, derived during ingestion from editorial consensus and `featured` status;
  2. title alphabetically.
- This hidden tie-break should be reconsidered before declaring retrieval quality accepted. Recommended alternative: return up to three equal-fit options for human choice instead of silently treating source consensus as taste.
- Direct URL mode creates a deterministic manual reference ID and bypasses curation candidates.

### Planner and persistence

- `ReferencePlanner` offers `Curated keeps / Direct URL`.
- Planning remains `generationTriggered: false` and does not spend credits.
- Plans use:
  - persisted `schemaVersion: 3` for shared constraint compatibility;
  - `plannerContractVersion: 4`;
  - `strategy: single-chassis`;
  - `selectionMode: curated-keeps | direct-url`;
  - `scoringBasis: site-type-only | direct-reference`.
- `Build chassis plan` currently POSTs and persists a `shadow` row immediately, before approval.
- Adilson agreed that a cleaner future behavior would be: build an ephemeral preview, persist only on `Approve recipe`. This has **not** been implemented.
- The schema and new additive migration now allow `cardinality(selected_reference_ids) BETWEEN 1 AND 3`.
- The shared database has **not** received this cardinality migration. Until it does, a real one-reference POST may fail against the existing shared check.
- Do not confuse the new cardinality migration with the older plan schema-version migration. Inspect both live constraints read-only before any apply.

### Chassis Manifest v1

- `lib/chassis-evidence.js` contains a dependency-free page-context collector for:
  - semantic section order and roles;
  - runtime geometry;
  - layout/display/position/grid/gap/padding;
  - heading/body anchors and measured typography;
  - visible character density;
  - semantic media slots, aspect ratios, object-fit, and layering roles;
  - motion drivers, pinned elements, transitions, animations, video/canvas signals;
  - CSS media-query breakpoints.
- `captureSnapshot()` accepts two opt-in flags:
  - `includeChassisEvidence`;
  - `publicNetworkOnly`.
- Normal capture behavior is unchanged unless those flags are supplied.
- `analyzeChassisReference()` captures desktop `1440×1000` and mobile `390×844` concurrently, retains compact evidence only, and builds a hashed manifest.
- Manifest includes evidence confidence/gaps, structural signature, anchors, density, media slots, motion portability, responsive persistence, guidance, and `PRESERVE / ADAPT / REPLACE` directives.
- The plan analysis route is `POST /api/references/plan/[id]/analyze`:
  - requires auth;
  - requires an approved shadow plan;
  - returns an existing manifest idempotently;
  - otherwise performs two public captures and persists the compact manifest into the plan JSON.
- No real external URL analysis was executed in this session.

### Public URL hardening

- `lib/public-reference-url.js` blocks non-HTTP schemes, localhost, `.local`, loopback, link-local, and private IPv4/IPv6 ranges.
- DNS answers are checked before analysis.
- `captureSnapshot(..., { publicNetworkOnly: true })` intercepts page and asset requests and aborts hosts that do not resolve publicly.
- This is unit-tested but still needs a real bounded public-site redirect/subresource acceptance before production use.

### Transplant and QA contracts

- `lib/chassis-transplant.js` converts a Manifest into a generation-locked section ledger and deterministic QA contract.
- `auditChassisTransfer()` checks:
  - section-role sequence;
  - reference-identity leakage;
  - media-slot coverage;
  - responsive evidence.
- `lib/chassis-generation-contract.js` prepares exact target/reference/contract inputs and refuses to expose an execution payload until the exact manifest and contract hashes are approved.
- Credit approval is a distinct field from generation approval.
- `demarcelize.js` now exports a separate `transplantChassis()` seam. Its prompt makes:
  - target HTML authoritative for brand, copy, typography, colors, imagery, and facts;
  - reference HTML authoritative for chassis geometry, composition, media roles, motion logic, and responsive structure.
- This new generation seam is **not connected** to an API route, billing hold/refund, board/node creation, or UI action. No LLM call was made.

## Cost behavior at this checkpoint

- Candidate retrieval and ranking: $0 variable API cost.
- Shadow recipe creation/persistence: $0 and 0 credits.
- Local Chromium structural capture/Manifest: $0 external API cost and `capture` is priced at 0 credits.
- Production Browserbase, if enabled later, may create infrastructure cost not currently represented in the user credit estimate. Measure before enabling.
- Existing product preflight estimate for `transplant` is 75 credits. The product defines 1 credit = $0.01, so the placeholder estimate is approximately $0.75 per generation.
- That is not a quote and is not wired to the new chassis execution seam. Multi-reference token/context growth is not calibrated.
- Never send three full sites to the model when only one localized contribution is needed; isolate the necessary section/evidence.

## Database migration proof

New migration:

`packages/web-shell/migrations/2026-08-07-single-chassis-plan.sql`

It only drops/recreates `generation_reference_uses_selected_reference_ids_check` as 1–3.

An ephemeral local `postgres:16-alpine` container was used twice and removed automatically:

- first proof of the earlier 1–4 draft: 1 accepted, 0/5 rejected;
- final 1–3 proof: arrays of cardinality 1 and 3 inserted; cardinality 4 raised `check_violation`; row count remained 2.

No shared database was contacted or mutated for these proofs.

## Validation completed

- New/changed focused suite before the final upper-bound adjustment: 12 files, 56 tests passed.
- Full web-shell suite at the same implementation checkpoint: 153 files passed, 1 skipped; 1,021 tests passed, 4 skipped.
- After changing the upper bound from 4 to 3: focused planner/migration/route suite, 3 files and 11 tests passed.
- `git diff --check`: passed after the final 1–3 change.
- Production build: passed; 43 static pages generated and the new analyze route was included.
- Build used `NEXT_DIST_DIR=.next-chassis-roadmap`; artifact was moved to `/tmp/uncraft-next-chassis-roadmap-20260807` to avoid disturbing dev artifacts.
- Authenticated browser QA:
  - Plan tab rendered;
  - `Curated keeps / Direct URL` state worked;
  - Direct URL showed URL field and `No curation required`;
  - Build action remained disabled with empty fields;
  - no plan, capture, or shared write was triggered;
  - no console error was present.

## Current worktree ownership

Modified tracked files:

- `.gitignore` — earlier Vercel link ignore; review separately.
- `packages/web-shell/app/api/references/plan/route.js`
- `packages/web-shell/app/globals.css`
- `packages/web-shell/components/BoardsList.jsx`
- `packages/web-shell/components/ReferenceLibrary.jsx`
- `packages/web-shell/components/ReferenceLibrary.test.jsx`
- `packages/web-shell/components/ReferencePlanner.jsx`
- `packages/web-shell/components/ReferencePlanner.test.jsx`
- `packages/web-shell/components/ReferenceReviewPanel.jsx`
- `packages/web-shell/components/ReferenceReviewPanel.test.jsx`
- `packages/web-shell/lib/demarcelize.js`
- `packages/web-shell/lib/reference-bank-store.js`
- `packages/web-shell/lib/reference-bank-store.test.js`
- `packages/web-shell/lib/reference-planner.js`
- `packages/web-shell/lib/reference-planner.test.js`
- `packages/web-shell/lib/reference-preferences.js`
- `packages/web-shell/lib/reference-preferences.test.js`
- `packages/web-shell/lib/snapshot.js`
- `packages/web-shell/schema.sql`

New untracked implementation files:

- `packages/web-shell/app/api/references/plan/[id]/analyze/route.js`
- `packages/web-shell/app/api/references/plan/[id]/analyze/route.test.js`
- `packages/web-shell/app/api/references/plan/route.test.js`
- `packages/web-shell/lib/chassis-analyzer.js`
- `packages/web-shell/lib/chassis-analyzer.test.js`
- `packages/web-shell/lib/chassis-evidence.js`
- `packages/web-shell/lib/chassis-generation-contract.js`
- `packages/web-shell/lib/chassis-generation-contract.test.js`
- `packages/web-shell/lib/chassis-manifest.js`
- `packages/web-shell/lib/chassis-manifest.test.js`
- `packages/web-shell/lib/chassis-transplant.js`
- `packages/web-shell/lib/chassis-transplant.test.js`
- `packages/web-shell/lib/demarcelize.chassis.test.js`
- `packages/web-shell/lib/public-reference-url.js`
- `packages/web-shell/lib/public-reference-url.test.js`
- `packages/web-shell/lib/reference-guidance.js`
- `packages/web-shell/lib/reference-guidance.test.js`
- `packages/web-shell/lib/single-chassis-migration.test.js`
- `packages/web-shell/migrations/2026-08-07-single-chassis-plan.sql`

This handoff file is also new and untracked until explicitly committed.

Do not use `git add -A`. Inspect and stage explicit paths only after review.

## Ordered next gates

### Gate 0 — Recover and verify without mutation

1. Confirm branch, HEAD, status, and the exact dirty file list.
2. Read this handoff and the 2026-08-05 predecessor completely.
3. Confirm no process owns port 3035 before starting one.
4. If needed, start local dev from `packages/web-shell` with an isolated dist directory, for example:

   `NEXT_DIST_DIR=.next-chassis-dev npx next dev --port 3035`

5. Re-run the focused chassis/planner tests and `git diff --check` before editing.
6. Do not rerun imports or touch shared data.

Exit: state matches this handoff or drift is documented.

### Gate 1 — Decide the Planner preview and tie behavior

Recommended product decisions before shared migration:

1. Replace immediate shadow persistence with ephemeral preview and persist only on `Approve recipe`.
2. Decide whether equal type-fit candidates should:
   - show up to three options for human selection (recommended), or
   - keep the hidden editorial-consensus tie-break.
3. Keep construction at one chassis by default regardless of how many options are shown.
4. If two/three construction references are desired, specify their bounded contribution contract before implementation. Never let them compete for global grid, scroll authority, or responsive spine.

Exit: one explicit, tested planner UX/selection contract.

### Gate 2 — Full isolated end-to-end acceptance

Use a disposable full-schema database or a separately configured `E2E_ISOLATED_DATABASE_URL` distinct from `DATABASE_URL`.

Prove:

1. curated `Keep` plan with one selected ID persists;
2. direct URL plan persists without loading curation candidates;
3. `Maybe` and `Pass` never enter candidates;
4. approval unlocks analysis and rejection does not;
5. analyzer captures desktop/mobile fixtures or one approved public fixture;
6. Manifest persists and a repeat analyze returns it without recapture;
7. unauthorized/private-network targets fail closed;
8. no board, node, generation, billing, or credit row changes;
9. all disposable writes are removed with the disposable database.

Exit: actual route/store behavior, not only mocked route tests, passes end to end.

### Gate 3 — Shared cardinality migration preflight and apply

This gate requires separate explicit authorization.

1. Inspect live shared constraints read-only:
   - schema-version check;
   - selected-reference cardinality check.
2. Verify the migration changes only the cardinality constraint to 1–3.
3. Record before row counts and constraint definitions.
4. Obtain exact shared-migration approval.
5. Apply `2026-08-07-single-chassis-plan.sql` once.
6. Verify the resulting check and unchanged table/data counts.
7. Do not insert a plan during the migration gate.

Exit: shared storage accepts 1–3 with no data changes.

### Gate 4 — One bounded real plan and Manifest acceptance

This is a shared plan write plus public-site capture and requires separate approval after Gate 3.

1. Choose either one kept reference or one explicit direct URL.
2. Record the exact expected plan/reference before the write.
3. Create one recipe, approve it, and analyze once.
4. Verify desktop/mobile evidence, Manifest hash, section roles, media roles, motion signals, confidence, gaps, and cached repeat behavior.
5. Confirm generation remains locked and credits unchanged.
6. Decide whether to retain or delete/reject the bounded plan record.

Exit: one real plan and Manifest are accepted with no generation.

### Gate 5 — Build the target/content approval surface

Still independent of paid generation:

1. Add target authority selection: existing project/site node, URL, or supplied copy/design system.
2. Render the transplant blueprint/section ledger from `createTransplantBlueprint()`.
3. Show exact `PRESERVE / ADAPT / REPLACE`, media bindings, text capacities, motion portability, `Worth borrowing`, and `Avoid`.
4. Require explicit contract approval keyed to both manifest and contract hashes.
5. Keep missing assets/content honest and blocking; never invent proof.

Exit: exact generation inputs and ledger can be reviewed without calling a model.

### Gate 6 — Connect paid generation safely

Requires explicit generation and credit-spend authorization.

1. Add an execution API around `transplantChassis()`.
2. Route through billing hold/settle/refund with a preflight dollar/credit quote.
3. Measure actual tokens and provider cost; recalibrate the placeholder 75-credit estimate.
4. Keep generation approval distinct from credit approval.
5. Create output in an isolated board/node or output directory with provenance.
6. On failure, refund and leave no ambiguous partial output.
7. Never send multiple full references when bounded section evidence is sufficient.

Exit: one authorized generation produces a traceable output or cleanly refunds.

### Gate 7 — Real-output QA and Farm Minerals → Flux benchmark

1. Capture matched desktop/mobile evidence for target, chassis, and output.
2. Run `auditChassisTransfer()` plus browser-visible QA.
3. Verify target identity and copy truth, no reference identity leakage, chassis structural fidelity, media replacement, responsive persistence, motion semantics, accessibility, console health, and originality distance.
4. Formalize Farm Minerals → Flux as a golden benchmark for “wireframe transplanted, design system replaced.”
5. Record a `Reference Influence Ledger` and exact `PRESERVE / ADAPT / REPLACE` decisions.

Exit: one real output passes human and deterministic QA.

### Gate 8 — Calibrate retrieval after more curation

After approximately 100 reviewed references:

1. Measure agreement between suggested candidates and Adilson's choice.
2. Inspect failures by site-type inference, missing metadata, hidden tie-break, and structural mismatch.
3. Decide whether cheap metadata is sufficient or whether a small top-N structural pre-analysis is worth the latency.
4. Keep style, motion, taste score, and `Worth/Avoid` out of ranking unless Adilson explicitly changes the product rule.

Exit: evidence-backed retrieval policy, not a speculative scoring system.

### Gate 9 — Source-control closeout

Only after explicit authorization:

1. Review `.gitignore`/Vercel-link ownership separately.
2. Stage explicit owned paths only.
3. Commit on `codex/start-from-ref`.
4. Integrate into `main` only through the user-approved method.
5. Verify GitHub auth is `variant73-git` before push.
6. Push only after explicit approval.

No commit, merge, or push is authorized by this handoff.

### Gate 10 — Optional Vercel deployment

Keep local until separately approved.

Before deployment:

1. verify project/team/account and `packages/web-shell` root;
2. configure `REFERENCE_CURATOR_EMAILS` to only `variant73@gmail.com` without exposing it in logs;
3. verify production database migrations and environment separation;
4. review cron compatibility and cost;
5. deploy the exact reviewed commit;
6. run authorized/non-authorized curator acceptance and private-reference boundary checks.

No deployment is authorized by this handoff.

## Global hard stops

- Do not apply the shared 1–3 migration without separate explicit approval.
- Do not create a shared plan merely to test the button.
- Do not analyze/capture an external reference without a bounded approved fixture and acceptance gate.
- Do not trigger `transplantChassis()`, generation, billing, credits, board/node creation, or Demarcelizer execution without explicit approval.
- Do not make private references public or expose private template provenance to ordinary users.
- Do not reintroduce taste/style/motion scoring or fixed donor roles silently.
- Do not treat the current tie-break as validated taste intelligence.
- Do not use `git add -A`, discard unrelated dirty files, or clean ignored evidence broadly.
- Do not commit, push, merge, mutate Vercel, or deploy from this handoff alone.

## Recommended first prompt for the next session

```text
Leia completamente docs/superpowers/handoffs/2026-08-07-start-from-ref-chassis-roadmap-local-handoff.md. Comece pelo Gate 0 e me apresente, sem mutações, a recomendação concreta para o Gate 1: prévia efêmera + até três opções empatadas versus o tie-break editorial atual. Não aplique migração compartilhada, não crie plano real, não capture URL externa, não gere, não use créditos, não faça commit/push/merge e não altere a Vercel sem autorização separada.
```
