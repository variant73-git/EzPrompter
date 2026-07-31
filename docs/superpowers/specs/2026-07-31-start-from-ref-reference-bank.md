# Start from a Ref: reference intelligence architecture

**Status:** persistent catalog, frozen review cohorts, multidimensional weighting, and retrieval shadow mode implemented on `codex/start-from-ref`

**Base:** `main` at `ec297fff`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

## Product outcome

Uncraft should turn a short business brief into an original, animated landing page by selecting and combining strong decisions from a curated reference catalog. The catalog is not a template marketplace and the planner is not a random moodboard generator. It is a provenance-aware ingredient system for structure, visual language, media treatment, sections, interactions, and motion.

The first product surface is the authenticated `Start from a Ref` catalog. The eventual generation path begins at the same catalog, but runs through typed retrieval and a composition plan before Demarcelizer 4.0 materializes any HTML.

## What has shipped

- A dedicated worktree and branch, isolated from `codex/live-animated-clone-editing`.
- Source adapters for Codrops Webzibition, Pafolios, and SiteInspire.
- URL canonicalization that removes referral parameters, normalizes protocol/host/path, and merges the same site across aggregators.
- Provenance-preserving records: one canonical reference can retain several source appearances and thumbnails.
- A reproducible seed builder. Raw crawler output remains ignored; only normalized records are versioned.
- An authenticated, paginated catalog route and UI with real thumbnails, external links, search, source/category filters, sorting, empty/loading/error states, reduced-motion handling, and mobile layout.
- Initial snapshot: 1,720 raw appearances normalized into 1,636 canonical references, with 84 cross-reference duplicates merged. The source appearance counts are Codrops 863, Pafolios 816, SiteInspire 41.
- An additive, idempotent shared-database migration for canonical sites, provenance appearances, private user reviews, and shadow-plan audit records.
- A shared-database import with 1,636 canonical sites and 1,704 unique provenance appearances. Sixteen raw appearances shared the same canonical site, source, and source-record identity and are deliberately collapsed at the persistence boundary.
- A frozen 24-reference `Cohort v1` Working Table with private per-user verdict, required 1–5 taste score, intended role, business/visual/motion tags, and notes.
- Progressive 4–5 strength profiles for visual craft, structure, motion, originality, transferability, commercial clarity, chassis potential, and donor potential.
- A deterministic retrieval shadow planner that consumes only manually reviewed `keep`/`maybe` references, applies business-sensitive weights, chooses exactly one chassis and one to three bounded donors, and records approval or rejection without generating a site or spending model credits.

This is now a real persistent discovery and curation catalog with a safe planner rehearsal. The 24 entries are review candidates, not a pre-approved gold set. Deep capture/enrichment and Demarcelizer materialization remain gated on human review.

## The key composition rule

Use **one dominant chassis** and up to three donors.

- The chassis owns section order, layout rhythm, scroll model, primary motion system, and layering.
- A donor may own one bounded dimension: typography/component language, palette, content density, media treatment, or a compatible section.
- A second motion system is accepted only when it can be namespaced and composed without competing for the same scroll range, transform, canvas, or media timeline.
- If two references both need to own the page spine, they are incompatible. The planner must choose one instead of averaging them.

This produces the requested 2 to 4 reference mix while preventing a collage of unrelated sections.

## Rating, cohort, and weighting contract

Verdict, quality, and fit are separate signals:

- `keep`, `maybe`, and `pass` control eligibility. A high numerical score never revives a `pass`.
- The required overall rating uses stable anchors: 1 discardable, 2 one useful idea, 3 good but familiar, 4 very strong, 5 reference-defining.
- Detailed dimensions are optional and appear only for ratings 4–5. Below that threshold they are cleared rather than treated as negative evidence.
- Review cohorts are immutable membership snapshots. `Cohort v1` remains fixed while new aggregators enter the wider catalog, so calibration results do not drift.
- Aggregators have 1–5 operational/editorial profiles, but source confidence contributes at most 5% of a planner score. Cross-aggregator consensus is capped inside that small component.

Planner v2 scores each chassis/donor role independently:

```text
35% brief fit
25% manual quality
15% composition compatibility
10% motion fit
10% transferability
 5% source confidence
```

The manual-quality dimension vector changes with the inferred business. Finance emphasizes structure and commercial clarity; culture, portfolios, and agencies emphasize visual craft, motion, and originality; commerce emphasizes conversion and transferability; technology and industry emphasize structure, motion, transferability, and clarity. The vector and component breakdown are stored in every shadow recipe for inspection.

## End-to-end architecture

### 0. Ingestion and identity

Each aggregator has an adapter that emits a common appearance contract:

```text
source + source record id + listing/detail URL
target URL + title + description
thumbnail URL + source categories/tags + published date
```

Canonical identity is based on normalized target URL, not the aggregator record. The same target becomes one `reference_site` with several `reference_appearances`. Domain-level similarity is a review signal, not an automatic merge, because one domain can host distinct campaign paths.

Collection is resumable and idempotent. A failed page can be retried without re-fetching or duplicating completed pages. Source limits and respectful delays are part of the adapter configuration.

### 1. Enrichment

Only listed references that pass availability and policy checks enter enrichment. Enrichment produces separate, inspectable artifacts instead of one opaque model summary:

- **Business profile:** industry, offer type, audience, conversion goal, brand register, content volume.
- **Visual profile:** color roles, typography, density, alignment, grid, radii, surfaces, icon/image/video treatment.
- **Section manifest:** semantic section type, copy capacity, geometry, responsive behavior, media slots, dependencies.
- **Motion profile:** drivers, triggers, pinned/sticky ranges, scrub/snap, targets, start/end states, easing, stagger, layering, media synchronization, reduced-motion state.
- **Runtime profile:** GSAP/ScrollTrigger, Three.js/WebGL, Webflow, Framer, Lottie, native CSS/WAAPI, video and custom canvas dependencies.
- **Transfer contract:** `PRESERVE`, `ADAPT`, `REPLACE`, plus exact media slots and selectors/animation ids when available.

DOM measurements and captured runtime evidence are authoritative where available. Vision fills gaps; it does not override measured values.

### 2. Retrieval

Retrieval is hybrid, not embedding-only:

1. Hard filters remove unavailable, incompatible, or insufficiently analyzed references.
2. Structured match scores business, content capacity, page type, section needs, motion requirements, and runtime compatibility.
3. Semantic/visual embeddings generate candidates within those constraints.
4. Diversity selection prevents four near-identical references.
5. Manual taste weight and explicit user preferences rerank the candidates.

Weights remain multidimensional:

```text
brief fit
manual taste / visual quality
motion fit
composition compatibility
content capacity
novelty distance
freshness / availability
```

Aggregator consensus is only a weak editorial prior. It is not a quality verdict. The current `curationWeight` exists to order an unenriched catalog and must be replaced by this richer score for generation.

### 3. Creative director and composition plan

The planner receives a typed brief, not just the raw prompt:

```text
business + audience + offer + conversion goal
required sections + content volume
desired emotional register + avoidances
media on hand + media to generate
motion ambition + performance/accessibility constraints
```

It first selects the dominant chassis, then donors. Its output is a deterministic plan:

```text
selected references and roles
section-by-section source mapping
design tokens and typography owner
media slot assignments
motion owner and preserved sequences
conflict decisions and adaptations
novelty/provenance report
```

The model may ask at most one or two high-value questions when the answer would change the chassis or conversion strategy. It should not ask about choices it can safely infer and later expose for editing.

### 4. Demarcelizer 4.0 materialization

The Demarcelizer-4 worktree already explores the correct execution contracts:

- `design-md.js` adds choreography, media slots, and `PRESERVE / ADAPT / REPLACE` directives.
- `run-flow.js` treats HTML as structural/motion chassis, design.md as identity owner, and connected media as exact placeholders.
- The compose prompt preserves scripts, animation selectors, pinned scenes, scroll ranges, easing, stagger, media timing, and reduced-motion resolution.
- A workflow template makes structure/motion, identity, briefing, image, and video sources explicit nodes.

Those changes are useful shortcuts but currently live with unrelated uncommitted work in `/Users/adilsonporto/Desktop/IA/Uncraft-Demarcelizer-4`. They must be committed and integrated as an independently reviewable slice before the reference planner depends on them. This branch deliberately does not copy those dirty files.

### 5. Validation and learning

Every generated page must pass:

- deterministic HTML/media/console/network checks;
- matching desktop, tablet, and mobile layout states;
- scroll-stop screenshots and visual difference review;
- motion trace comparison for trigger ranges, pin/scrub behavior, intermediate states, and media timing;
- content completeness and semantic accessibility;
- provenance report showing which reference contributed each decision;
- novelty check to flag results that remain too close to one source.

Approval/rework outcomes update manual and compatibility weights. They do not silently retrain taste from every generated result.

## Persistent model: implemented foundation and next extensions

The shared database now includes:

- `reference_sites`: canonical URL, host, availability, manual weight, lifecycle state.
- `reference_appearances`: source, source record, listing/detail URL, source taxonomy, thumbnail, last seen.
- `reference_aggregators`: bounded 1–5 source-quality signals, lifecycle state, and neutral defaults for newly imported sources.
- `reference_review_cohorts` and `reference_review_cohort_members`: frozen calibration membership independent of global catalog rank.
- `reference_preferences`: private per-user ratings, roles, tags, notes, and exclusions, separate from global records.
- `generation_reference_uses`: audited shadow recipes and their approval/rejection state.

The next enrichment slice should add:

- `reference_snapshots`: capture version, viewport, screenshot, measured DOM/runtime evidence.
- `reference_sections`: section geometry, semantic role, media slots, dependencies, transfer contract.
- `reference_analyses`: versioned business/visual/motion/runtime profiles and model provenance.
- `reference_embeddings`: separate vectors for business intent, visual system, section semantics, and motion.

Do not put every signal into a single JSON blob or single embedding. Version each analysis contract so records can be re-enriched without rewriting source identity.

Manual decisions are intentionally private to the signed-in user in this slice. The migration does not add or infer an admin role, and the import path is server-side tooling rather than a public catalog mutation endpoint. A future global moderation surface must define admin identity and server-side authorization separately.

## Asset and rights boundary

- Store target links, aggregator provenance, metadata, and source thumbnail URLs first.
- Do not silently redistribute third-party site assets as catalog assets.
- Capture or copy runtime assets only on demand and under the existing clone/transfer policy.
- Track availability, robots/terms review, credit requirements, and removal requests per source/site.
- Keep generated-site provenance internally even when the final page no longer visibly resembles a single reference.

## Delivery sequence

1. **Catalog slice (done):** real data, deduplication, browse/search/filter UI.
2. **Persistent curation foundation (done):** additive shared tables, idempotent import, private manual review, plan audit.
3. **Weighted retrieval shadow mode v2 (done):** frozen cohort, progressive 1–5 rubric, business-sensitive scoring, inspectable chassis/donor breakdown, human approval, zero generation.
4. **Aggregator expansion and Cohort v2 (next):** import the next source batch with neutral priors, audit noise/metadata/motion density, then create a new diverse cohort without rewriting Cohort v1.
5. **Top-reference enrichment:** capture only the approved `keep` subset, then produce section/motion/runtime manifests and versioned visual evidence.
6. **Demarcelizer integration:** execute approved plans with one chassis and bounded donors.
7. **Automated validation and learning:** visual/motion gates, provenance, novelty, approval/rework signals.

This order avoids spending model and capture cost on thousands of low-value references before the retrieval rubric is proven.

## Integration with main and motion controls

The catalog branch starts at `main` and owns new reference modules, one API route, the authenticated hub catalog surface, and narrow hub CSS additions. It does not change motion-editor modules.

After the motion-controls branch lands:

1. fetch/update `main`;
2. rebase `codex/start-from-ref` onto the updated `main`;
3. resolve only genuine overlap in `BoardsList.jsx` or `globals.css`;
4. rerun reference tests, the full web-shell suite, production build, and authenticated browser smoke;
5. merge the catalog as one independently reviewable feature.
