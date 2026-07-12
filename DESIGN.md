# Uncraft — Design System: "The Working Table"

> Single source of truth for Uncraft's visual language. Imported wholesale
> from the Unspirit design study on 2026-07-12 (branch `unspirit`) — a
> flagship-model reinterpretation of the product seeded by
> `docs/superpowers/handoffs/2026-07-11-uncraft-recreation-prompt-fable-sol.md`.
> Supersedes the frosted-glass system documented here before that date.
>
> The live system is defined in code at
> [`packages/web-shell/app/globals.css`](packages/web-shell/app/globals.css)
> (`@theme` + `:root`) and the extension's `panel/panel.css` (not yet ported —
> see "Surface status"). When code and this doc disagree, code wins — update
> this doc to match.

## Creative North Star — "The Working Table"

The interface is a calm, warm-charcoal surface covered with real work. Fixed
chrome is compact and nearly neutral; **the graph carries the color and the
meaning**. Familiar Figma-like controls reduce learning cost; distinctiveness
comes from exceptionally legible spatial chains and tactile motion.

Principles (from PRODUCT/DESIGN of the study, adopted):
1. The canvas disappears behind the work.
2. **Color is grammar** — provenance colors communicate what flows where.
3. Every gesture responds immediately and physically.
4. Familiar designer affordances beat novelty.
5. Honest states, readable chains, deterministic evidence build trust.

Anti-references (do NOT build): generic AI-workflow dashboards, neon-on-black
node editors, decorative glassmorphism, gradient text, excessive cards,
developer-first terminology, theatrical motion, any interaction that stutters
or lies about its state.

## Brand
- **Name:** Uncraft. **Slogan:** "Design without borders."
- Sidebar mark: 26px rounded square, ink-inverted "U".
- **Internal namespace stays `rb-*` / `__rb*`** (RepixBridge legacy) on purpose.

## Surface status
1. **Web-shell (canvas SaaS)** — FULLY on the Working Table system (this doc).
2. **Extension (in-page widget + editor panels)** — still on the previous
   Instrument-based solid design; port pending user validation of the canvas.
   Canvas modals already read the new `--popup-*` tokens.

## The solid-surface signature (replaces the frosted-glass signature)
**No `backdrop-filter` anywhere, product-wide.** Chrome is solid or
near-opaque warm charcoal:

```
background: rgba(34,34,32,0.97);        /* fixed chrome — --bg-frosted */
background: #292926;                    /* menus/cards — --bg-frosted-solid */
border: 1px solid var(--border-frosted);/* #3A3935 warm hairline */
box-shadow: var(--shadow-frost);        /* 0 8px 28px rgba(0,0,0,0.28) — ambient, small */
border-radius: 7–16px;                  /* per element, see Radii */
```

**The Flat Canvas Rule:** surfaces are flat by default. Small ambient shadows
appear only on viewport-fixed chrome, selected floating controls, and menus.
In-world depth comes from outlines and overlap, never blur.

## Web-shell tokens (globals.css `:root` — DARK ONLY)

The canvas light mode was retired 2026-07-12 (its ~195 CSS overrides deleted).
The editor keeps its own light mode for its panels while editing.

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#191917` | Page / canvas background (warm charcoal) |
| `--bg-frosted` | `rgba(34,34,32,0.97)` | Fixed chrome surfaces (near-opaque, NO blur) |
| `--bg-frosted-solid` | `#292926` | Menus, dropdowns, solid cards |
| `--text-primary` | `#F1F0EB` | Ink |
| `--text-secondary` | `#B5B3AC` | Secondary text |
| `--text-muted` | `#96948D` | Muted labels |
| `--text-faint` | `rgba(241,240,235,0.30)` | Placeholders, fine print |
| `--border-frosted` | `#3A3935` | Hairline borders (warm) |
| `--border-frosted-strong` | `#45443F` | Stronger borders |
| `--hover-bg` | `rgba(241,240,235,0.07)` | Hover wash |
| `--hover-bg-strong` | `rgba(241,240,235,0.12)` | Stronger hover |
| `--shadow-frost` | `0 8px 28px rgba(0,0,0,0.28)` | Ambient elevation |
| `--canvas-dot` | `#393833` | Dot-grid on canvas |
| `--ink-invert-bg` / `--ink-invert-fg` | `#EFEEE8` / `#20201E` | PRIMARY ACTIONS (ink-inverted buttons) |
| `--accent` | `#2966EA` | Focus rings, live selection — the site blue |
| `--accent-hover` | `#2258C9` | Accent hover |
| `--accent-weak` | `rgba(41,102,234,0.20)` | Tinted accent backgrounds |

**Primary buttons are ink-inverted (`--ink-invert-*`), never accent-filled.**
Accent = the site blue, anchoring the color grammar; it marks focus and
selection, not calls-to-action.

### Origin colors (node-graph semantics, `lib/node-origin.js`)
Fixed product semantics — frames, ports, kind pills, and cord gradients all
read these. **Color is grammar; do not repurpose.**
| Kind | Hex | Ink on it |
|---|---|---|
| site (URL / blank / clone) | `#2966EA` | white |
| .html upload | `#F97316` | dark |
| .md / design-system | `#C2B44A` | dark (kept over Unspirit's `#EEA665` — too close to .html orange) |
| image / asset | `#7951C2` | white |
| prompt | `#ECEBF1` | dark |
| skill | `#F472B6` | dark |

## Node chrome (unspirit 2026-07-12)
- **Rest border:** 2px `color-mix(in oklab, <origin> 72%, #4A4944)` — softened
  category. Full saturation is reserved for selection.
- **Selection:** DOUBLE ring — `0 0 0 3px var(--bg-base)` gap +
  `0 0 0 5px <origin>` + ambient shadow (floored inverse-scale, 0.62).
  Editing steps up to 5px gap / 8px ring.
- **Kind pill (float tag):** filled origin color, uppercase 9–11px 700,
  ink by luminance (`--cnode-port-ink`); title beside it. The tag IS the
  move handle.
- **Edit cluster:** ink-inverted primary Edit + dark secondary (`#292926` +
  `#4B4A44` border) for the second action.
- **Ports:** idle = SOLID origin dot with `--bg-base` ring + origin hairline;
  connected emitter keeps a white core, connected receiver keeps the
  dual-identity read (own-color ring + sender-color core) — informative,
  don't flatten. Geometry lives in THREE places (CSS + EdgeLayer +
  findSnapTarget) — always change together.
- **Prompt nodes are paper notes:** body `#ECEBF1`, dark ink `#25231F`,
  dark-tinted inner field.
- **Cords:** gradient (source-origin → target-origin, world-anchored),
  3px solid underlay + 2px round marching dots (`stroke-dasharray: 1 10`,
  1.1s), screen-constant via `vector-effect: non-scaling-stroke`.

## Fixed chrome layout (unspirit 2026-07-12)
- **Sidebar** 224px left (collapsible to 52px, exposes `--sidebar-w`):
  brand, New board, BOARDS, LIBRARY (placeholders), user pill.
- **Topbar** 46px (`--topbar-h`): board-name crumb left; credits +
  Preview/Share (placeholders) right.
- **Tool rail** top-center: select/hand/frame/text/draw placeholders + live "+".
- **Zoom dock** bottom-left (clears the sidebar). **Minimap** top-right,
  steps left of the inspector via `--inspector-w`.
- **Inspector** right 248px: Design/Prototype tabs, selection title with
  origin dot, Frame (LIVE X/Y/W/H), Appearance/Fill/Export placeholders;
  collapses to a detached 42px control.
- ALL of it **overlays** the full-viewport canvas world (never insets it —
  client↔world math assumes origin 0,0) and **hides in edit mode** (the
  editor brings its own panels). Framing math centers in the free region
  via `chromeInsets()`.
- Placeholder rule: features that don't exist render DISABLED with honest
  tooltips — never fake-interactive.

## Popup tokens (canvas modals/menus)
Solid warm charcoal, Inter, no serif accent.
| Token | Value |
|---|---|
| `--popup-bg` | `#292926` |
| `--popup-fg` | `#F1F0EB` |
| `--popup-fg-muted` | `rgba(241,240,235,0.55)` |
| `--popup-surface` | `rgba(241,240,235,0.06)` |
| `--popup-border` | `#494842` |
| `--popup-accent` | `#EFEEE8` |
| `--popup-radius-card` / `-mid` | `14px` / `10px` |
| `--popup-font-sans` / `-serif` | both → Inter (serif accent retired) |

## Typography
- **Single UI face: Inter (variable)**, loaded via `next/font`
  (`--font-inter`). No display serif. `font-synthesis: none`.
- **Rhythm:** 13px/450 body (1.4), 11px/550 labels (1.2). Section headings in
  chrome: 9px/700, `0.1em` tracking, uppercase.
- **Hierarchy comes from weight and contrast, not display typography.**
- Tracking: `-0.02em` on titles; near-zero on body.
- **Mono:** `ui-monospace, SFMono-Regular, Menlo` — data only; never JetBrains.
- Note: Inter is banned in GENERATED sites (anti-slop house style); the tool's
  own UI uses it by explicit user decision (2026-07-12).

## Spacing
- Base unit 4px. Control rhythm **30px** (buttons/fields in chrome), 34px
  sidebar rows, toolbar padding 4px, panel padding 10–12px.

## Radii
| Token | Value | Usage |
|---|---|---|
| `--radius-pill` | `999px` | Pills, tags, avatars |
| `--radius-2xs` | `5px` | Tiny fields |
| `--radius-xs` | `7px` | Buttons, sidebar rows |
| `--radius-sm` | `10px` | Toolbars, menus, collapsed inspector |
| `--radius-md` | `14px` | Cards, dock, popup cards |
| `--radius-lg` | `16px` | Large cards |
- Node frame radii are WORLD-LOCKED px (17.25 outer / 11.25 body, below-30 ×0.8)
  — part of the hybrid chrome scaling decision (2026-07-06), untouched.

## Elevation
- Flat by default. `--shadow-frost` (ambient, small) only on viewport-fixed
  chrome, menus, and selected floating controls. NO backdrop-filter anywhere.
- In-world depth = outlines + overlap.

## Interaction patterns (standard — apply to every new widget)
- **Toolbar widget hover (STANDARD, 2026-07-03):** chips inside a chrome bar
  fill the bar's full content height with a uniform 2px gap: stretch wrapper +
  `height:100%` + concentric radius + `--hover-bg` only (no outline change).
- **Inline icons next to text (STANDARD, 2026-07-03):** `width/height: 1em`
  (never fixed px), gap `0.25em`.
- **Click-opened widget dropdowns (STANDARD, 2026-07-03, extended 2026-07-12):**
  SOLID background — `var(--bg-frosted-solid)` — no transparency, no blur.
  Canvas content must never bleed through a data menu. (Now true of ALL
  chrome: the translucent-frosted large-chrome exception is retired.)
- **Counter-scale floor at 40% (STANDARD, 2026-07-03):** every screen-constant
  canvas chrome value divides by `max(0.4, var(--canvas-scale, 1))` — never the
  raw var. JS mirrors with `chromeScale()`.
- **Hybrid chrome scaling (DECIDED 2026-07-06):** node BODY world-locked
  (fixed px, scales with world); labels/pills/tooltips/handles screen-constant
  via `--chrome-scale`. ⌥W world-lock toggle remains a debug lever.
- **Counter-scale via transform, not layout (STANDARD, 2026-07-03):** new
  screen-constant chrome uses `transform: scale(1/zoom)`, never layout-prop
  division.
- **No backdrop-filter (STANDARD, extended 2026-07-12):** banned product-wide
  (was: only inside the zoomed world).
- **Wrap/truncate rule (standing):** never horizontal scroll, never clipped
  text; a pill that must wrap becomes a rounded rectangle (~14px).
- **Focus:** visible focus rings (`2px solid var(--accent)`, offset 2px) on
  every keyboard-reachable control. Target WCAG 2.2 AA.

## Motion
- **Transitions:** 120–200ms, `ease` / `ease-out`; chrome position shifts
  (sidebar collapse, minimap follow) 180ms `cubic-bezier(0.16,1,0.3,1)`.
- **Press feedback:** `translateY(1px)` buttons; `scale(0.95–0.97)` icon toggles.
- **Canvas micro-animations (STANDARD, 2026-07-03):** in-world entrances =
  transform + opacity ONLY; menus 140ms, nodes 200ms, cords 220ms, ease-out;
  keyframes omit `to`; `prefers-reduced-motion` gated; paused during gestures
  via `html.canvas-interacting`.
- **Gesture hot path is sacred:** nothing re-renders React, reads layout, or
  toggles `will-change` during an active zoom/pan gesture. Deferred work lands
  in the 180ms settle callback.
- **Cord retract on sever:** ~300ms ease-in into the source port, fade held to ~70%.

## Decisions Log
| Date | Decision | Rationale |
|---|---|---|
| 2026-06-09 | Consolidated design docs into this DESIGN.md | Previous copies were stale RepixBridge-era popup docs. |
| 2026-07-03 | Toolbar hover standard; solid click-dropdowns | Hover fills the slot; data menus must not bleed canvas. |
| 2026-07-03→06 | Perf doctrine: 40% floor, hybrid chrome scaling, no in-world blur, gesture hot path | Canvas fluidity arc (CLAUDE.md 148–150). |
| 2026-07-12 | **"Working Table" system imported from the Unspirit study** — warm charcoal palette, Inter single-face, solid surfaces (blur retired product-wide), ink-inverted primaries, accent = site blue `#2966EA`, double selection ring, solid category ports, paper prompt nodes, quiet dotted cords, sidebar+topbar+tool-rail+inspector chrome, canvas DARK-ONLY | User decisions: Inter literal; import everything (placeholders disabled where no feature); `.md` keeps `#C2B44A`; light mode removed. Extension port pending canvas validation. |
