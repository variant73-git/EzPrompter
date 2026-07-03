# Uncraft — Design System

> Single source of truth for Uncraft's visual language. Supersedes the old
> `DESIGN-SYSTEM.md` / `design-system.md` (both were stale "RepixBridge"-era
> copies describing only the extension popup). Renamed RepixBridge → Uncraft
> on 2026-04-27.
>
> The live system is defined in code at
> [`packages/web-shell/app/globals.css`](packages/web-shell/app/globals.css)
> (`@theme` + `:root` + `body.rb-ed-light`) and the extension's `panel/panel.css`.
> When code and this doc disagree, code wins — update this doc to match.

## Brand
- **Name:** Uncraft. **Slogan:** "Design without borders."
- **Wordmark:** "Un" Medium (500) + "craft" Light (300) at 0.62 opacity. Tight tracking (`-0.02em`).
- **Internal namespace stays `rb-*` / `__rb*`** (RepixBridge legacy) on purpose — renaming it would be invasive with no functional gain.

## Two surfaces, one language
Uncraft renders in two places that share the same dark, frosted, type-forward feel but use different primitives:

1. **Web-shell (canvas SaaS)** — the dominant surface. Dark frosted-glass chrome over a dot-grid canvas. Fonts: **Aeonik** (sans) + **Instrument Serif** (display). Tokens below under "Web-shell tokens".
2. **Extension (in-page widget + editor)** — injected over arbitrary sites. Higher-contrast solid surfaces, **Instrument Sans + Instrument Serif**, larger radii. Captured under "Popup tokens" (these are also reused by canvas modals so a modal on the canvas matches the widget).

## The frosted-glass signature
The recipe that makes a surface read as "Uncraft chrome." Every floater, card, menu, dock uses it:

```
background: var(--bg-frosted);                 /* rgba(10,10,10,0.72) dark */
backdrop-filter: blur(28px) saturate(140%);    /* 28px is the house blur */
border: 1px solid var(--border-frosted);       /* 1px hairline */
box-shadow: var(--shadow-frost);               /* 0 16px 60px rgba(0,0,0,0.55) */
border-radius: 12–22px;                         /* per element, see Radii */
```

## Web-shell tokens (globals.css `:root`)

### Color — dark (default)
| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0a0a0a` | Page / canvas background |
| `--bg-frosted` | `rgba(10,10,10,0.72)` | Frosted chrome surfaces |
| `--bg-frosted-solid` | `#0f0f0f` | Non-translucent fallback surface |
| `--text-primary` | `#f5f5f5` | Primary text, primary-button fill |
| `--text-secondary` | `rgba(245,245,245,0.62)` | Secondary text |
| `--text-muted` | `rgba(245,245,245,0.42)` | Muted labels |
| `--text-faint` | `rgba(245,245,245,0.28)` | Placeholders, fine print |
| `--border-frosted` | `rgba(255,255,255,0.08)` | Hairline borders |
| `--border-frosted-strong` | `rgba(255,255,255,0.12)` | Stronger borders |
| `--hover-bg` | `rgba(255,255,255,0.06)` | Hover wash |
| `--hover-bg-strong` | `rgba(255,255,255,0.10)` | Stronger hover |
| `--shadow-frost` | `0 16px 60px rgba(0,0,0,0.55)` | Frosted elevation |
| `--canvas-dot` | `rgba(255,255,255,0.20)` | Dot-grid on canvas |

### Color — light (`body.rb-ed-light`)
Cool light slate (slight blue undertone, ~`hsl(220,8%)`), NOT warm cream. One-line swap per element since all chrome reads the vars.
| Token | Value |
|---|---|
| `--bg-base` | `#DEE0E4` |
| `--bg-frosted` | `rgba(228,230,234,0.78)` |
| `--bg-frosted-solid` | `#D4D7DC` |
| `--text-primary` | `#1a1d24` |
| `--text-secondary` | `rgba(26,29,36,0.66)` |
| `--text-muted` | `rgba(26,29,36,0.46)` |
| `--border-frosted` | `rgba(15,23,42,0.12)` |
| `--shadow-frost` | `0 16px 48px rgba(15,23,42,0.14)` |
| `--canvas-dot` | `rgba(15,23,42,0.18)` |

### Accent (tokenized 2026-06-09)
| Token | Value | Usage |
|---|---|---|
| `--accent` | `#0095FF` | Primary buttons, selection ring, active states |
| `--accent-hover` | `#0086e6` | Accent hover |
| `--accent-weak` | `rgba(0,149,255,0.18)` | Tinted accent backgrounds |
- Accent stays blue in both themes (does not invert).
- `#38bdf8` ("sky") is still used directly in a few places AND is the URL node-origin color — overloaded, left as backlog item #6.

### Origin colors (node-graph semantics, `lib/node-origin.js`)
Edge/border color encodes a node's source kind:
| Kind | Hex |
|---|---|
| URL / website | `#38bdf8` |
| HTML | `#f97316` |
| Markdown / design | `#34d399` |
| Screenshot / asset | `#a78bfa` |

## Popup tokens (extension-derived; used by canvas modals too)
Solid (no blur), high contrast, large radii, Instrument type. Dark default, light via `body.rb-ed-light`.
| Token | Dark | Light |
|---|---|---|
| `--popup-bg` | `#000000` | `#EFEEEB` |
| `--popup-fg` | `#EFEEEB` | `#000000` |
| `--popup-fg-muted` | `rgba(239,238,235,0.50)` | `rgba(0,0,0,0.50)` |
| `--popup-surface` | `rgba(239,238,235,0.06)` | `rgba(0,0,0,0.04)` |
| `--popup-border` | `rgba(239,238,235,0.12)` | `rgba(0,0,0,0.10)` |
| `--popup-accent` | `#EFEEEB` | `#000000` |
| `--popup-radius-card` | `40px` | — |
| `--popup-radius-mid` | `14px` | — |
| `--popup-font-sans` | Instrument Sans → system | |
| `--popup-font-serif` | Instrument Serif → Georgia | |

## Typography
- **Web-shell display:** Instrument Serif 400 — wordmark, large titles (`--font-display`).
- **Web-shell body/UI:** Aeonik — Light 300 / Regular 400 / Medium 500 / Bold 700, local `.otf` at `public/fonts/aeonik/` (`--font-sans`). `font-feature-settings: 'ss01','ss02'`.
- **Extension:** Instrument Sans (body/UI) + Instrument Serif (display).
- **Mono:** `ui-monospace, SFMono-Regular, Menlo` (`--font-mono`).
- **Scale (extension reference):** 10 / 11 / 12 / 14 / 16 / 20 / 24. Web-shell uses `rem` + `clamp()` for fluid headings (e.g. wordmark `clamp(3.5rem, 8vw, 6.5rem)`).
- **Tracking:** tight on display (`-0.02em` to `-0.045em`); near-zero on body.

## Spacing
- **Base unit:** 4px. Toolbar padding 4px, content padding 16px, section gap 20px, element gap 8/12px.

## Radii
| Token | Value | Usage |
|---|---|---|
| `--radius-pill` | `999px` | Pills, tags, primary buttons, avatars |
| `--radius-sm` | `12px` | Inputs, small cards, toolbars |
| `--radius-md` | `18px` | Menus, dropdowns |
| `--radius-lg` | `22px` | Large cards (signin, board cards) |
| (popup) `--popup-radius-card` | `40px` | Extension/canvas modal cards |
- Small chrome (minimap, 36px buttons, count chips) uses ad-hoc `6/8/10px` — **not yet tokenized** (backlog).

## Elevation & blur
- **Cards:** border only, no shadow.
- **Floating chrome:** `--shadow-frost`.
- **House blur:** `blur(28px) saturate(140%)`. Heavier menus use `blur(36px)`. Backgrounds/board cards use `blur(24px)`. **9 blur values exist — not tokenized** (backlog).

## Interaction patterns (standard — apply to every new widget)
- **Toolbar widget hover (STANDARD, 2026-07-03):** any interactive chip living inside a chrome bar (`.canvas-toolbar-left/right`, zoom widget, etc.) must fill the bar's full content height with a uniform 2px gap on every side:
  1. Wrapper: `align-self: stretch; display: flex;` (the bar centers children at natural height by default — the wrapper must stretch so `height:100%` has something to fill).
  2. Chip: `height: 100%;` + `border-radius` concentric with the frame (frame radius − frame padding, e.g. `12 − 2 = 10px`).
  3. Hover: `background: var(--hover-bg)` ONLY — no outline/border change. The token remaps in light mode by itself.
  - References: `.user-pill.compact`, `.credits-pill`, zoom pill.
- **Click-opened widget dropdowns (STANDARD, 2026-07-03):** menus that open on click from a chrome widget use a SOLID background — `var(--bg-frosted-solid)` (`#0f0f0f` offblack dark / `#D4D7DC` light), **no transparency, no backdrop blur** — plus `--border-frosted` hairline + `--shadow-frost`. Canvas content must never bleed through a data menu. (The translucent frosted treatment stays for large passive chrome: bars, docks, modals.)
  - Reference: `.credits-pill-menu`.

## Motion
- **Transitions:** 120–200ms, `ease` / `ease-out`. Color/background hovers ~120–150ms; layout shifts (dock dodge) ~180ms; theme swap 200ms.
- **Press feedback:** `translateY(1px)` on buttons; `scale(0.95–0.97)` on icon toggles.
- **Icon flourish:** theme toggle rotates SVG `15deg` on hover.

## Cleanup status (token-hygiene pass 2026-06-09)
The token system is sound; adoption was partial. This pass fixed the highest-value, value-preserving items (look unchanged except the navy removal, which was an off-system bug):

**Done:**
1. ✅ **`--accent` / `--accent-hover` / `--accent-weak` added** and the ~38 hardcoded `#0095FF` / `#0086e6` swapped to the token.
2. ✅ **Navy removed** — the 9 `#2a2a4a` / `#0f0f23` leftovers in auth/billing/token-box now read `--border-frosted-strong` / `--bg-frosted-solid` (neutral, theme-aware).
3. ✅ **Blur tokenized** — `--blur-chrome:28px` / `--blur-menu:36px` / `--blur-soft:24px`; the 28/36/24 chrome blurs swapped.
4. ✅ **`--surface` / `--surface-strong` + `--radius-xs:8px` / `--radius-2xs:6px` added** (defined + ready to use).

**Remaining backlog (deferred — low value / regression risk for a "no visual change" pass):**
- **~142 `rgba(255,255,255,…)` one-off fills** — NOT blanket-swapped to `--surface` on purpose: 7 distinct alpha levels carry intentional elevation, and `--surface` flips in light mode, so a blind swap would change light-mode gradients. Migrate per-element when touched.
- **Small-radius literals** (`6/8/10px`) — tokens now exist (`--radius-xs/2xs`); swap usages opportunistically.
- **`#38bdf8` overloaded** — both "sky accent" and the URL origin color. Pick one meaning per token before reusing.

## Decisions Log
| Date | Decision | Rationale |
|---|---|---|
| 2026-06-09 | Consolidated design docs into this DESIGN.md; retired the two stale RepixBridge `*-SYSTEM.md` copies | Docs described the old extension popup under the old name; the real system is the frosted-glass web-shell. Captured both surfaces + an audit backlog. |
| 2026-07-03 | Toolbar widget hover standardized (stretch wrapper + full-height fill + 2px gap + `--hover-bg`); click-opened widget dropdowns are SOLID `--bg-frosted-solid`, no blur | User call during the credits pill build: hover must fill the whole slot like its neighbours, and data menus must not let canvas content bleed through. See "Interaction patterns". |
