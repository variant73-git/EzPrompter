# Start from a Ref: reference intelligence architecture

**Status:** initial catalog slice implemented on `codex/start-from-ref`

**Base:** `main` at `ec297fff`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

## Product outcome

Uncraft should turn a short business brief into an original, animated landing page by selecting and combining strong decisions from a curated reference catalog. The catalog is not a template marketplace and the planner is not a random moodboard generator. It is a provenance-aware ingredient system for structure, visual language, media treatment, sections, interactions, and motion.

The first product surface is the authenticated `Start from a Ref` catalog. The eventual generation path begins at the same catalog, but runs through typed retrieval and a composition plan before Demarcelizer 4.0 materializes any HTML.

## What shipped in the initial slice

- A dedicated worktree and branch, isolated from `codex/live-animated-clone-editing`.
- Source adapters for Codrops Webzibition, Pafolios, and SiteInspire.
- URL canonicalization that removes referral parameters, normalizes protocol/host/path, and merges the same site across aggregators.
- Provenance-preserving records: one canonical reference can retain several source appearances and thumbnails.
- A reproducible seed builder. Raw crawler output remains ignored; only normalized records are versioned.
- An authenticated, paginated catalog route and UI with real thumbnails, external links, search, source/category filters, sorting, empty/loading/error states, reduced-motion handling, and mobile layout.
- Initial snapshot: 1,720 appearances normalized into 1,636 canonical references, with 84 duplicates merged. The source appearance counts are Codrops 863, Pafolios 816, SiteInspire 41.

This is a real discovery catalog, but not yet the final database, enrichment pipeline, or generation planner.

## The key composition rule

Use **one dominant chassis** and up to three donors.

- The chassis owns section order, layout rhythm, scroll model, primary motion system, and layering.
- A donor may own one bounded dimension: typography/component language, palette, content density, media treatment, or a compatible section.
- A second motion system is accepted only when it can be namespaced and composed without competing for the same scroll range, transform, canvas, or media timeline.
- If two references both need to own the page spine, they are incompatible. The planner must choose one instead of averaging them.

This produces the requested 2 to 4 reference mix while preventing a collage of unrelated sections.

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

## Proposed persistent model

The versioned seed is intentionally the first safe milestone. The production store should introduce:

- `reference_sites`: canonical URL, host, availability, manual weight, lifecycle state.
- `reference_appearances`: source, source record, listing/detail URL, source taxonomy, thumbnail, last seen.
- `reference_snapshots`: capture version, viewport, screenshot, measured DOM/runtime evidence.
- `reference_sections`: section geometry, semantic role, media slots, dependencies, transfer contract.
- `reference_analyses`: versioned business/visual/motion/runtime profiles and model provenance.
- `reference_embeddings`: separate vectors for business intent, visual system, section semantics, and motion.
- `reference_preferences`: user/admin ratings and exclusions, separate from global records.
- `generation_reference_uses`: immutable audit of chosen references, roles, plan, output, approval/rework.

Do not put every signal into a single JSON blob or single embedding. Version each analysis contract so records can be re-enriched without rewriting source identity.

## Asset and rights boundary

- Store target links, aggregator provenance, metadata, and source thumbnail URLs first.
- Do not silently redistribute third-party site assets as catalog assets.
- Capture or copy runtime assets only on demand and under the existing clone/transfer policy.
- Track availability, robots/terms review, credit requirements, and removal requests per source/site.
- Keep generated-site provenance internally even when the final page no longer visibly resembles a single reference.

## Delivery sequence

1. **Catalog slice (done):** real data, deduplication, browse/search/filter UI.
2. **Persistent catalog:** database tables, resumable scheduled ingestion, health checks, moderation/removal controls.
3. **Top-reference enrichment:** section/motion/runtime manifests for a deliberately small, high-value subset.
4. **Retrieval shadow mode:** given a brief, return ranked chassis/donor plans without generating a page; collect human approval.
5. **Demarcelizer integration:** execute approved plans with one chassis and bounded donors.
6. **Automated validation and learning:** visual/motion gates, provenance, novelty, approval/rework signals.

This order avoids spending model and capture cost on thousands of low-value references before the retrieval rubric is proven.

## Integration with main and motion controls

The catalog branch starts at `main` and owns new reference modules, one API route, the authenticated hub catalog surface, and narrow hub CSS additions. It does not change motion-editor modules.

After the motion-controls branch lands:

1. fetch/update `main`;
2. rebase `codex/start-from-ref` onto the updated `main`;
3. resolve only genuine overlap in `BoardsList.jsx` or `globals.css`;
4. rerun reference tests, the full web-shell suite, production build, and authenticated browser smoke;
5. merge the catalog as one independently reviewable feature.
