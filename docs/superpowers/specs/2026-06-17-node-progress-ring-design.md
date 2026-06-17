# Node Progress Ring — design spec

**Date:** 2026-06-17
**Branch:** `feat/canvas`
**Status:** design approved, pending spec review

## Problem

Generation on the canvas (cloning a site, composing, generating an image) is
slow — a clone runs ~2–3 minutes. During that wait the user has no clear
signal that the tool is alive, and may assume it froze. The current feedback
is the multicolor Uiverse spin border (`cnode-gen-border`) plus a small
3-step text chip below the node — visually noisy and not reassuring.

## Goal

Replace the loading feedback on **every** generating node with a single,
calm, branded affordance:

1. The result node is created up front (already the case — placeholder node).
2. A **progress arc** fills the node's own border clockwise from 12 o'clock,
   in the node's category color, at the same thickness as the selected-state
   stroke (3px).
3. A **large percentage number** sits in the node center.

The percentage is **purely a reassurance estimate** — it does not report what
the pipeline is actually doing. It never needs labels or stage text.

## Key decisions

- **Estimate, not real progress.** The backend emits discrete stages
  (and image-gen emits nothing), so a true 0–100 does not exist. The number
  is an aesthetic, approximate climb. This is acceptable and intended.
- **No "100% / done" state.** The number climbs toward an asymptote of ~95%
  and is *replaced wholesale by the real result* the instant generation
  finishes — at whatever number it happened to be on. This eliminates the
  classic "stuck at 99%" failure and needs no completion animation.
- **No stage text.** Just the number. The function is "the tool is working,"
  not "here's what it's doing."
- **Unified across all paths.** One implementation replaces the Uiverse spin
  everywhere a node is generating. Category color distinguishes paths.
- **Arc must follow the rounded-rectangle perimeter** (uniform speed by
  perimeter length), not a conic-gradient angular sweep (which races the
  short sides on a 16:9 node). This requires inline SVG `stroke-dashoffset`.
  It is **not** a `.svg` asset file — it is ~5 lines of inline JSX SVG.
- **The selected-state ring cannot be reused** for a partial fill: it is a
  `box-shadow`, which is all-or-nothing. The SVG arc matches its look
  (same radius, 3px, category color) so it reads as "the selection stroke,
  filling."

## Architecture

Two isolated, independently testable units replace the body of the
`cnode-gen-border` block in `CanvasNode.jsx`:

### `useGenerationProgress(active, kind)` — hook (pure timing logic)

- Returns an integer `pct` in `[0, 95]`.
- Drives an eased exponential climb: `pct = 95 · (1 − e^(−t/τ))`.
  - Rises fast initially, decelerates, asymptotes at 95, never reaches 100.
- `τ` is chosen per `kind` so that `3τ ≈ typical duration`:

  | Path | `kind` | typical duration | notes |
  |---|---|---|---|
  | Site clone | `site` (with `origin_url`) | ~150s | patient climb |
  | Compose / run-flow | `site` (blank target) | ~45s | medium |
  | Image generation | `image` / `asset` | ~25s | fast |

  Durations live in one constant map, easy to retune with real data later.
- When `active` flips to `false` (unmount / result arrives), the hook resets;
  the node re-renders with content and the ring is gone.
- Animation via `requestAnimationFrame` (preferred) or interval; testable
  with fake timers.

### `<NodeProgressRing pct color />` — component (pure render)

- Inline SVG, `position:absolute; inset:0`, covering the node.
- **Arc**: a `<rect>` with `rx` = node radius, `pathLength="100"`,
  `stroke-dasharray="100"`, `stroke-dashoffset={100 - pct}`,
  `vector-effect="non-scaling-stroke"`, `stroke-width` matching the selected
  ring (3px on-screen), `stroke` = category `color`. Starts at top-center
  (12 o'clock), fills clockwise.
- **Track** (the unfilled remainder): same path, drawn behind, **solid dark
  grey** (not a faded category color).
- **Number**: `"90%"` — digits and `%` at the same size. Font Aeonik.
  Size proportional to node height (~28%) so it stays large and fits at any
  zoom. Color = **same solid dark grey as the track** (the arc carries the
  category color; the number is intentionally quiet).
- Light-mode variants for track + number (mirrors existing
  `body.rb-ed-light .cnode-gen-face`).

## Triggers (unchanged)

The ring renders under the same conditions as today's `cnode-gen-border`:
`(node._loading && !node._challenge) || node.meta?.status === 'generating' ||
!!runStatus`. Only the rendered content inside changes.

## Color source

Category color comes from the existing `--cnode-port-fill` CSS variable /
`ORIGIN_COLORS` in `lib/node-origin.js` (url `#38bdf8`, html `#f97316`,
md `#34d399`, screenshot/asset `#a78bfa`, prompt `#facc15`, skill `#f472b6`,
blank `#2dd4bf`). No new color definitions.

## Edge cases

- **Node resize**: SVG is `inset:0` and `rx` reads the node radius — follows
  dimensions automatically, no manual recompute.
- **Zoom / pan**: stroke stays constant on-screen via `non-scaling-stroke`;
  number scales with the node (proportional to its height).
- **Light mode**: track + number get light variants.
- **Error**: untouched. The ring disappears; the existing
  `cnode-loading-error` state shows.
- **Challenge (Cloudflare)**: still excluded — "waiting for a human," not
  "working." No ring (current behavior).
- **Low contrast risk**: dark-grey number over the near-black loading face
  (`#111215`) may read faint. If so, lighten the grey one step during
  implementation — a visual tuning call, not a structural one.

## Testing

- **Hook** (`useGenerationProgress`): `vi.useFakeTimers()` — pct climbs,
  saturates at 95 and never exceeds it, resets to 0 when `active` goes false,
  faster τ for `image` than `site`.
- **Ring** (`NodeProgressRing`): render assertions — `pct=47` →
  `stroke-dashoffset ≈ 53`; correct category color per kind; number renders
  `"47%"`.
- Vitest, consistent with the existing suite (247 tests).

## Out of scope

- Real per-stage progress wiring (explicitly rejected — estimate is enough).
- Removing the SSE stage events from the clone pipeline (they stay; we just
  stop surfacing them as text).

## Decided

- **The 3-step `runStatus` text chip (`cnode-run-status`, "1/3 Reading
  inputs…") is removed.** The ring is the sole generation feedback. The
  `runStatus` *signal* still drives whether the ring shows; only its text
  rendering goes away.
