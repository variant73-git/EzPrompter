# Start from a Ref: three-strategy real-output experiment

**Date:** 2026-08-02

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Current HEAD:** `bfb4be68` (`docs(handoff): record shared catalog smoke`)

**Predecessor:** `docs/superpowers/handoffs/2026-08-02-start-from-ref-gate-1-passed-gate-2-ready.md`

## Outcome of this planning session

The obsolete per-reference `chassis` / `donor` / `either` review contract remains superseded. No preference, assessment, plan, capture, generation, board, node, credit, shared-database, push, deployment, or production mutation was performed.

The approved direction for the next experiment is to compare real, runnable outputs rather than abstract plans. One frozen business brief will produce three independent websites under comparable conditions:

1. A single-reference transformation control.
2. A contextual chassis/donor multi-reference variant.
3. A static-first, motion-aware section/scene synthesis variant.

The experiment must preserve the simpler path that is already close to useful while testing the more ambitious synthesis path without making it a product dependency.

This document authorizes no execution by itself. Each mutation or credit-spending gate below still requires explicit approval.

## Who “the user” means

Two roles must not be conflated:

- **Product user:** a future Uncraft customer who supplies a business brief and wants a high-quality generated site. The product user should not need to understand or select an internal composition strategy during the initial product stage.
- **Experiment reviewer / product owner:** Adilson, who must see all three outputs, their exact references, provenance, transformation decisions, evidence, cost, limitations, and copycat risk before choosing a product direction.

“Do not expose the complexity to the user yet” applies only to the future product user. It does not hide any experiment detail from the product owner. The comparison must be fully inspectable.

## Product thesis

The near-term product does not depend on producing wholly original, award-level systems from multiple references. A valuable first release can:

1. Understand a real brief.
2. Curate one strong reference from the bank.
3. Preserve its useful interaction and composition logic.
4. Adapt it materially to new semantics, content, identity, assets, proportions, and responsive constraints.
5. Deliver a real, editable website that is recognizably transformed rather than a relabeled clone.

The multi-reference experiment is a separate R&D track with greater upside. It must earn its complexity by producing visibly better or more original results.

## Shared experiment fixture

Before any reference capture or generation, freeze one experiment manifest containing:

- Exact business brief, audience, offer, goals, required content, proof, CTA, and constraints.
- Target identity, copy, assets, content authority, and prohibited inventions.
- Required routes and interactions.
- Desktop and mobile viewports.
- Reduced-motion and fallback expectations.
- Model, reasoning level, maximum calls, time limit, and cost ceiling.
- Allowed libraries and runtime dependencies.
- Offline/local-asset policy.
- Quality floor and comparison rubric.
- Exact plan hash and confirmation token for the later isolated build gate.

The same frozen input must be used for all three strategies. Shared utilities may be reused, but generated layout, motion, and composition artifacts must not leak from one strategy into another. Any reused artifact must be disclosed.

## Reference selection policy

Reference selection belongs to the agent, with full provenance.

- Business category or site type is a weak hint only. It must never filter, exclude, fix a role, or determine suitability.
- Retrieve by required capability: image density, editorial rhythm, content capacity, interaction model, media treatment, grid behavior, narrative pacing, motion, and responsive behavior.
- A photography site may serve a portfolio, commerce, technology, or any other brief that benefits from its composition or media system.
- Every selected reference must be frozen before generation with catalog ID, canonical URL, exact page(s), capture time, evidence type, observed technologies, confidence, and known gaps.
- Multi-reference strategies may use at most three sites.
- Do not infer motion or responsive behavior from scraped text or a single thumbnail.

## Strategy S: single-reference transformation control

### Goal

Test the most grounded product path: the agent curates one site that corresponds to the brief and transforms it enough to create a distinct target website.

### Required process

1. Select one reference from the bank based on observed composition, motion, content capacity, and brief fit.
2. Capture matched desktop/mobile visual states, full-scroll behavior, major interactions, runtime dependencies, and fallbacks.
3. Build an authority map: target owns semantics, identity, content, claims, assets, and business behavior; the reference supplies only explicitly documented visual and interaction logic.
4. Record `PRESERVE / ADAPT / REPLACE` decisions before implementation.
5. Preserve the useful interaction system and animation logic where compatible.
6. Adapt section growth, copy geometry, media slots, navigation, responsive behavior, and art direction to the target.
7. Replace source branding, semantics, copy, identifying assets, and any incompatible or overly derivative decision.
8. Generate and validate a real local website.

### Success condition

The result reaches the agreed quality floor, preserves the target truth, and feels substantially transformed while retaining the reference’s strongest functional and motion qualities.

## Strategy C: contextual chassis/donor

### Goal

Test a constrained multi-reference system with one dominant structural and interaction spine plus bounded contributions.

### Required process

1. Select up to three references for the current brief.
2. Choose one contextual chassis for this plan only. Do not persist a permanent role on the reference.
3. Declare what the chassis owns: global section/scene order, hierarchy, grid/proportions, density and rhythm, scroll authority, primary motion/layering, and responsive structure.
4. Assign each donor one or more bounded, compatible contributions such as media treatment, typography, palette/materiality, a local interaction, or one localized scene pattern.
5. Reject any donor contribution that competes with the chassis for the global grid, scroll authority, primary timeline, or page spine.
6. Produce a real local website using the same frozen target fixture.

### Success condition

The result reads as one directed site, not a chassis with visibly pasted decorations. Every donor contribution is localized, justified, and traceable.

## Strategy W: static-first, motion-aware section/scene synthesis

### Goal

Test the ambitious designer-like path: solve the website first as a coherent visual composition, then realize its motion, while accounting for temporal dependencies from the beginning.

### Why “static-first” is not “static-only”

A single bitmap is insufficient for exotic grids, pinned narratives, scrubbed video, ScrollTrigger, GSAP timelines, WebGL, layered transforms, or sections without conventional boundaries. The static design pass must therefore include a temporal storyboard.

The agent must design:

- The resting visual composition at representative desktop and mobile states.
- A sequence of key scroll frames for each dynamic scene.
- Entry, active, pinned/scrubbed, transition, and exit states.
- Scroll allocation and scene duration.
- Element ownership for every animated property.
- Mobile compensation, reduced motion, and non-WebGL/video fallback.

### Required process

1. Select two or three references by scene capability, not business category.
2. Extract visual and motion evidence for the exact scenes under consideration.
3. Create a scene map describing content purpose, composition, geometry, motion, dependencies, capacity, and responsive behavior.
4. Privately generate multiple composition hypotheses. Do not expose raw model reasoning; expose only the selected construction, alternatives rejected for concrete conflicts, evidence, and confidence.
5. Establish one shared grammar before implementation: grid and alignment axes, type scale, spacing rhythm, media proportions, palette/materiality, motion tempo, scroll authority, and layering rules.
6. Create static desktop/mobile composition boards for the full page.
7. Create a motion storyboard with matched scroll checkpoints.
8. For video-led or scrubbed scenes, map text and UI states to explicit video timecodes or scroll-progress ranges before coding. Reserve the required negative space, contrast, timing, and responsive fallback in the static composition.
9. Run deterministic compatibility checks for nested pins, competing transforms, multiple scroll owners, timeline collisions, WebGL/canvas layering, performance budget, and unsupported mobile behavior.
10. Re-author the selected patterns into one implementation. Do not paste independent source sections or run multiple uncoordinated animation systems.
11. Produce and validate a real local website.

### Video and ScrollTrigger decision

Designing the static page first is helpful when it establishes composition, alignment, hierarchy, and art direction. It becomes harmful if motion is retrofitted after those decisions are frozen.

For a background video whose moments must align with copy, the video timeline is a first-class layout constraint. The agent must plan the visual frames and the temporal map together, then implement them after the static composition boards are coherent.

### Success condition

The result appears art-directed and original, maintains visual and temporal coherence, and does not reveal which source supplied each scene without consulting the provenance report.

## Mandatory provenance and copycat audit

Every strategy must produce a `Reference Influence Ledger` containing:

- Exact reference IDs, URLs, pages, and evidence timestamps.
- Which reference influenced each global or local decision.
- Whether the influence was structural, visual, motion, media, interaction, or technical.
- Exact `PRESERVE / ADAPT / REPLACE` decisions.
- Assets, libraries, code, or captured artifacts reused or localized.
- Source behaviors intentionally rejected and why.
- Known uncertainty and unverified behavior.

Every output must also receive a transformation-distance audit across:

- Section/scene order and total page rhythm.
- Grid topology, alignment axes, proportions, and whitespace.
- Typography, palette, materiality, and media treatment.
- Navigation and interaction structure.
- Motion timing, triggers, sequencing, and layering.
- Assets, copy, branding, semantics, and code provenance.
- Desktop/mobile composition and fallback behavior.

The audit must distinguish inspiration, compatible adaptation, localized subsystem reuse, and direct copying. It must not hide reused local material.

If two outputs both pass the maximum-quality floor, the less copycat and more consciously transformed output wins the tie. Originality does not rescue a visibly weaker result; the quality floor is evaluated first.

## Real-output comparison protocol

All three sites must be independently runnable and preserved in distinct directories or isolated routes. Never overwrite one variant with another.

Validate each output with:

- Production build and local HTTP status/title.
- Desktop `1440 × 1000` and mobile `390 × 844`.
- Full-page screenshots and matched scroll-stage screenshots.
- Full-scroll recordings at both viewports when motion is material.
- Interaction checks for navigation, hover, pinning, scrub, video/WebGL, and fallbacks.
- No broken images, unexpected external runtime requests, console errors, or page-level horizontal overflow.
- Reduced-motion and unsupported-runtime behavior.
- Performance observations under equal conditions.
- Source/target identity and provenance audit.

The product owner receives the three live previews, recordings, screenshots, ledger, audit, cost, elapsed time, and limitations side by side.

## Evaluation order

1. **Hard validity:** builds, runs, preserves target truth, and has no critical functional or responsive failure.
2. **Maximum-quality floor:** visual craft, composition, typography, art direction, interaction, and motion feel intentionally designed rather than generic AI output.
3. **Brief fit:** communicates the requested business and accommodates the actual content.
4. **System coherence:** layout, alignment, motion, media, and responsive behavior form one system.
5. **Originality and transformation distance:** avoids source imitation while retaining useful learned patterns.
6. **Cost and repeatability:** time, model calls, implementation complexity, and failure rate.

## Sequenced gates

### Gate 0: source-control closeout

Gate 1 source-label work remains uncommitted. Staging or committing it requires separate explicit direction. Preserve the two implementation/test changes and both handoffs; do not use `git add -A`.

### Gate A: freeze the experiment specification

Create and review the exact target fixture, comparison rubric, budgets, output paths, reference-selection constraints, and failure/rollback policy. This is document/test-fixture work only.

**Exit:** one reviewed manifest with a stable hash. No reference capture, model call, credit spend, or generated output.

### Gate B: select references and collect bounded evidence

Run read-only retrieval, choose exact references for S, C, and W, then capture only the pages/scenes required for the frozen experiment. Record visual, responsive, motion, runtime, and provenance evidence.

**Exit:** frozen Reference Bundles for all three strategies with exact IDs/URLs and no generated site.

### Gate C: isolated three-output build

After explicit approval of the manifest, references, cost ceiling, and confirmation token, generate S, C, and W in isolated destinations under equal conditions.

**Exit:** three independent runnable sites; no shared plan, product record, board, node, deployment, or production enablement.

### Gate D: visual, motion, provenance, and originality QA

Capture matched desktop/mobile evidence, run the hard gates, complete the Influence Ledgers and transformation-distance audits, and compare the outputs side by side.

**Exit:** evidence-backed ranking or an explicit inconclusive result. Do not tune one variant after seeing another without recording a new comparison round.

### Gate E: product decision

Choose among:

1. Improve and ship the single-reference path first.
2. Add contextual chassis/donor as a bounded internal strategy.
3. Continue scene synthesis as an R&D track.
4. Run another frozen brief because the first comparison was inconclusive.

This decision does not authorize shared generation, deployment, or production enablement.

## Hard stops

- Do not rerun the completed shared reviewed-delta apply.
- Do not mutate Cohort v1 membership.
- Do not restore fixed per-site `preferredRole` review.
- Do not use business category as a hard filter or role proxy.
- Do not infer motion or responsive behavior from text/thumbnail-only evidence.
- Do not deep-capture the full catalog; capture only frozen experiment references/scenes after approval.
- Do not spend credits or call generation models before the frozen manifest and cost ceiling are approved.
- Do not create shared plans, boards, nodes, preferences, or assessments during the isolated experiment.
- Do not push, deploy, or enable production behavior without separate approval.
- Do not report a static board, plan, build, or local lab as a completed real-output comparison.
- Do not hide reference reuse, asset reuse, source code reuse, failed evidence, or copycat risk.

## Repository state at handoff creation

Expected owned uncommitted files:

```text
M  packages/web-shell/components/ReferenceLibrary.jsx
M  packages/web-shell/components/ReferenceLibrary.test.jsx
?? docs/superpowers/handoffs/2026-08-02-start-from-ref-gate-1-passed-gate-2-ready.md
?? docs/superpowers/handoffs/2026-08-02-start-from-ref-three-strategy-real-output-experiment.md
```

No experiment implementation, capture, generation, or shared write was performed while creating this handoff.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -5 --oneline --decorate
git diff --check
git diff -- packages/web-shell/components/ReferenceLibrary.jsx packages/web-shell/components/ReferenceLibrary.test.jsx
lsof -nP -iTCP:3035 -sTCP:LISTEN
```

Read this handoff and its predecessor first. Preserve Gate 1 changes. The next executable step is Gate A only after explicit approval; later gates remain separately bounded.
