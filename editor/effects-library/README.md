# Effects Library

Hand-curated catalog of effect modules used by **Uncraft** (Effects gallery in editor) and **Restyle** (rebuild engine consumes IDs from `design.md`'s `effects:` block). Future Canvas project also consumes from here.

**Sources:** Aceternity UI, Magic UI, ReactBits, motion-primitives.com, codrops, Framer Motion examples, codepen demos. Curated, edited, deduplicated.

**Single source of truth:** [`catalog.json`](./catalog.json) in this folder. All consumers read from this.

**Schema reference:** [`Design Prompt Extractor/DESIGN_MD_SCHEMA.md`](../../../Design%20Prompt%20Extractor/DESIGN_MD_SCHEMA.md) documents how the `effects:` block in `design.md` references catalog IDs.

## Inventory by category

| Category | Purpose | Count | IDs |
|---|---|---|---|
| `fill` | Animated gradients/patterns for backgrounds and text-fill | 12 | aurora, sunset, pulse, ocean, neon-grid, starfield, mesh, stripe, spotlight, noise, candy, matrix |
| `reveal` | Entrance animations triggered on scroll or load | 5 | blur-text-word, fade-up-stagger, scale-in-on-view, slide-from-side, scramble-letters |
| `surface` | Material treatments (glass, gradient borders, frosted overlays) | 5 | liquid-glass, liquid-glass-strong, gradient-border-shell, frosted-overlay, inner-glow |
| `background` | Section-level decorative canvas/SVG backgrounds | 5 | dot-matrix-canvas, gradient-mesh-animated, particles, video-loop-fade, aurora-canvas |
| `interaction` | Pointer/hover/cursor-driven micro-interactions | 5 | magnetic-cursor, hover-tilt, count-up-on-view, cursor-spotlight, button-shine |
| `layout` | Scroll-driven layout primitives | 5 | sticky-pinned-section, marquee-loop-x, parallax-image, scroll-pinned-headline, split-grid-reveal |

**Total: 37 effects** (catalog v0.2.0).

## How to use an effect

In a `design.md` file, reference effects by ID in the `effects:` block:

```yaml
effects:
  - id: blur-text-word
    appliedTo: ["hero-headline"]
    params: { stagger: 100, duration: 700, blurAmount: 10 }
  - id: count-up-on-view
    appliedTo: ["stat-number"]
    params: { duration: 2400, easing: "easeOutExpo" }
```

In **runtime HTML** (after rebuild), elements are tagged via `data-fx="<id>"` (some accept additional `data-` attributes for params):

```html
<h1 class="hero-headline" data-fx="blur-text-word">Welcome to ...</h1>
<div class="stat-number" data-fx="count-up" data-target="89" data-duration="2400">0</div>
<canvas data-fx="dot-matrix" data-color="rgba(255,255,255,0.3)"></canvas>
```

The effect's CSS + JS is included in the rebuilt page (Restyle pipeline reads catalog.json and inlines the relevant snippets). For Uncraft's editor, the gallery shows previews and applies effects by setting the `data-fx` attribute on the selected element.

## Migration plan (future, not now)

The 12 `fill` effects currently live inline in `Uncraft/editor/fill-popup.js`. When this library is fully formalized:

1. Each effect's CSS + keyframes moves into `fill/<id>.css`
2. `fill-popup.js` reads `catalog.json` instead of hardcoding the array
3. Restyle's rebuild call imports `catalog.json` directly (or via a copy)

For now, `catalog.json` is the canonical source. `fill-popup.js` is its current runtime consumer; the new categories (`reveal/surface/background/interaction/layout`) are catalog-only until consumers wire them in.

## How to add a new effect

1. Find a candidate in Aceternity / Magic UI / ReactBits / codrops / Framer Motion examples / codepen
2. Edit and standardize: extract params, remove framework deps if possible, document
3. Add an entry to `catalog.json` with: `id`, `name`, `category`, `description`, `params` schema, `code` (`css` and/or `js`), `source` credit, `appliesTo` array, optional `tags`
4. If contributing CSS animation, use the `rb-fx-<id>` keyframe-name convention to avoid collisions
5. Test in Uncraft (drop into Effects gallery) AND Restyle (write a small `design.md` referencing it, rebuild)
6. Bump catalog `version` if breaking; otherwise just append

## Effect ID conventions

- IDs are `kebab-case`
- Names should be human-readable (e.g., "Blur Text Word", "Liquid Glass")
- `appliesTo` array lists semantic component or section identifiers where the effect makes sense (`hero-headline`, `stat-number`, `card`, `primary-cta`, etc.) — used for autocomplete and validation
- `params` keys describe configurable values with `default`, `type`, optional `description` and `values` (for enums)

## Implementation guarantees

Each effect's `code` is **standalone**:
- Uses only vanilla CSS and JavaScript (no framework deps)
- Uses `data-fx="<id>"` to tag elements (so multiple effects can coexist on a page)
- CSS keyframes prefixed `rb-fx-` to avoid collisions
- JS uses `requestAnimationFrame`, `IntersectionObserver`, and standard DOM APIs
- Self-initializes — drop snippet into a page and it runs

This means the rebuild engine can concatenate multiple effects into a single output page without a build step or framework.

## Status

- **Created:** 2026-04-28
- **Maintainer:** Uncraft (canonical home)
- **Consumers:** Uncraft Effects gallery (Fill popup today; multi-category pending), Restyle rebuild engine (`/api/restyle-from-mdfile` endpoint reads `effects:` from input design.md), Canvas (future)
- **Catalog version:** 0.2.0 — fill (12) + reveal (5) + surface (5) + background (5) + interaction (5) + layout (5) = 37 total

## Cross-links

- Memory entry: [effects_library_unified.md](file:///Users/adilsonporto/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/memory/effects_library_unified.md) (Uncraft session memory) and same file mirrored to Restyle session memory
- Schema: `Design Prompt Extractor/DESIGN_MD_SCHEMA.md` (sections "effects" frontmatter + "## Effects" body)
- Sample design.md using effects: `Design Prompt Extractor/templates/cambrian-innovation.design.md` (uses `count-up-on-view`, `fade-up-stagger`, and a `rotating-headlines` placeholder pending catalog addition)
