---
# ============================================================
# DESIGN.md — Sanity.io
# Source: https://www.sanity.io  (captured 2026-04-30, 1440×900)
# Full page: 1440×11680 px
# ============================================================

colors:
  background:
    base: "#0b0b0b"
    surface: "#212121"
    light: "#ffffff"

  text:
    on-dark: "#ffffff"
    on-light: "#0b0b0b"
    muted: "#797979"
    subtle: "#b9b9b9"

  brand:
    orange: "color(display-p3 1 0.3333 0)"
    orange-srgb-fallback: "#ff5500"
    blue: "#0052ef"

  status:
    keyword: "color(display-p3 0.960784 0 1)"
    keyword-srgb-fallback: "#f500ff"
    diff-add: "color(display-p3 0.270588 1 0)"
    diff-add-srgb-fallback: "#45ff00"
    link-code: "#0053ef"
    draft-badge: "color(display-p3 1 1 0)"
    draft-badge-srgb-fallback: "#ffff00"
    success: "#19d600"
    muted-ui: "#b9b9b9"

typography:
  fonts:
    display: "waldenburgNormal, \"waldenburgNormal Fallback\", ui-sans-serif, system-ui, sans-serif"
    mono: "ibmPlexMono, \"ibmPlexMono Fallback\", ui-monospace, monospace"

  base:
    font: display
    size: "16px"
    weight: "400"
    line-height: "24px"
    color: "#0b0b0b"

  scale:
    display-hero:
      font: display
      size: "112px"
      line-height: "112px"
      letter-spacing: "-4.48px"
      weight: "400"
      color: "#ffffff"

    display-section:
      font: display
      size: "72px"
      line-height: "75.6px"
      letter-spacing: "-2.88px"
      weight: "400"
      color: "#ffffff"

    display-cta:
      font: display
      size: "60px"
      line-height: "48px"
      letter-spacing: "normal"
      weight: "400"
      transform: capitalize
      color: "#0b0b0b"

    display-sm:
      font: display
      size: "48px"
      line-height: "51.84px"
      letter-spacing: "-1.68px"
      weight: "400"
      color: "#ffffff"

    h2:
      font: display
      size: "38px"
      line-height: "41.8px"
      letter-spacing: "-1.14px"
      weight: "400"
      color: "#0b0b0b"

    h2-hero-sub:
      font: display
      size: "32px"
      line-height: "36.16px"
      letter-spacing: "-0.32px"
      weight: "425"
      color: "#ffffff"

    h3:
      font: display
      size: "24px"
      line-height: "26.4px"
      letter-spacing: "-0.24px"
      weight: "400"
      color: "#0b0b0b"

    h3-book:
      font: display
      size: "24px"
      line-height: "29.76px"
      letter-spacing: "-0.24px"
      weight: "425"
      color: "#ffffff"

    body-lg:
      font: display
      size: "18px"
      line-height: "27px"
      letter-spacing: "-0.18px"
      weight: "400"
      color: "#0b0b0b"

    body-md:
      font: display
      size: "15px"
      line-height: "22.5px"
      letter-spacing: "-0.15px"
      weight: "400"
      color: "#ffffff"

    body-sm:
      font: display
      size: "13px"
      line-height: "19.5px"
      letter-spacing: "normal"
      weight: "400"
      color: "#0b0b0b"

    label-ui:
      font: display
      size: "13px"
      line-height: "16.9px"
      letter-spacing: "-0.13px"
      weight: "400"
      color: "#797979"

    label-medium:
      font: display
      size: "13px"
      line-height: "19.5px"
      letter-spacing: "normal"
      weight: "500"
      color: "#b9b9b9"

    caption:
      font: display
      size: "12px"
      line-height: "18px"
      letter-spacing: "normal"
      weight: "400"
      color: "#797979"

    tab-label:
      font: display
      size: "11px"
      line-height: "16.5px"
      letter-spacing: "normal"
      weight: "600"
      transform: uppercase
      color: "#b9b9b9"

    avatar-initials:
      font: display
      size: "11px"
      line-height: "11px"
      letter-spacing: "normal"
      weight: "500"
      color: "#0b0b0b"

    eyebrow-nav:
      font: mono
      size: "13px"
      line-height: "16.9px"
      letter-spacing: "normal"
      weight: "400"
      transform: uppercase
      color: "#ffffff"

    eyebrow-button:
      font: mono
      size: "13px"
      line-height: "19.5px"
      letter-spacing: "normal"
      weight: "400"
      transform: uppercase
      color: "#0b0b0b"

    announcement:
      font: mono
      size: "13px"
      line-height: "19.5px"
      letter-spacing: "normal"
      weight: "500"
      color: "#ffffff"

    code-inline:
      font: mono
      size: "13px"
      line-height: "19.5px"
      letter-spacing: "normal"
      weight: "400"

    code-sm:
      font: mono
      size: "12px"
      line-height: "18px"
      letter-spacing: "normal"
      weight: "400"

    query-chip:
      font: mono
      size: "10px"
      line-height: "14px"
      letter-spacing: "normal"
      weight: "400"
      transform: uppercase
      color: "#ffffff"

spacing:
  unit: "8px"
  scale:
    "1": "4px"
    "2": "8px"
    "3": "12px"
    "4": "16px"
    "6": "24px"
    "8": "32px"
    "10": "40px"
    "12": "48px"
    "16": "64px"
    "20": "80px"
    "24": "96px"
    "32": "128px"

radii:
  none: "0px"
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "999px"

elevation:
  panel: "0 0 0 1px rgba(255,255,255,0.08)"
  card: "0 2px 8px rgba(0,0,0,0.48)"
  modal: "0 12px 40px rgba(0,0,0,0.72)"

motion:
  duration:
    instant: "80ms"
    fast: "150ms"
    base: "250ms"
    slow: "400ms"
  easing:
    standard: "cubic-bezier(0.4, 0, 0.2, 1)"
    enter: "cubic-bezier(0, 0, 0.2, 1)"
    exit: "cubic-bezier(0.4, 0, 1, 1)"

layout:
  viewport: "1440px"
  content-max: "1200px"
  gutter: "24px"
  columns: 12
---

# Sanity.io — Design System

## Visual Identity

Sanity's aesthetic is **editorial-dark**: developer-native, deliberately understated, and built for reading density without fatigue. The canvas is `#0b0b0b` — a near-black that reads as deep charcoal rather than pure void, preserving warmth on OLED screens. This is not a toggleable dark mode; it is the default state of the brand.

White sections appear as intentional interruptions: islands of light used exclusively for product UI mockups, social proof, and enterprise feature grids. The contrast is structural — dark means marketing narrative, light means product truth.

The single most important color is the brand **orange** (`color(display-p3 1 0.3333 0)`). This is a wide-gamut P3 value that physically cannot be reproduced in standard sRGB — on capable displays it reads as liquid fire, saturated past what printing or older screens can show. It appears in exactly two contexts: primary CTA buttons and editorial photography backdrops. That scarcity is load-bearing. Dilute it and it becomes decoration.

## Typography

Type does all the work. Two typefaces carry the entire system.

**Waldenburg Normal** is Sanity's custom geometric sans-serif — used from 112px hero headlines down to 12px captions. At scale its letter-spacing is extreme: `−4.48px` at 112px, `−2.88px` at 72px. This crushes glyphs into a dense horizontal mass, turning a single sentence into a texture rather than a string of words. Line-height at the top of the scale is 1:1 (`112px / 112px`), compounding the compressed, monolithic feel.

Weight usage is unusually restrained. Nearly everything is `400`. A `425` weight variant — barely heavier than regular, just enough to separate a paragraph anchor from running copy — appears in subheadlines without triggering the visual event of bold. True medium (`500`) and semi-bold (`600`) appear only in tiny UI labels and avatar initials.

**IBM Plex Mono** handles all functional chrome: navigation links, eyebrows, status badges, announcement bars, code fragments, and query chips. It is `uppercase` in navigation and button contexts without exception. Its presence signals system/terminal language, reinforcing developer identity without stating it. It never appears in editorial copy — only in functional UI.

The scale spans 13 stops from 112px to 10px. The top end fills 1440px canvases with one or two words. The bottom end (`10px` mono uppercase) renders GROQ query chips inside product demos. Nothing is decorative type.

## Color Philosophy

**Backgrounds alternate on two poles:**

1. **Dark** (`#0b0b0b` base, `#212121` elevated surface): all editorial, hero, and feature narrative sections.
2. **Light** (`#ffffff`): product Studio UI, data tables, social proof, and pricing.

Text always follows the surface — white on dark, near-black on light — with muted tiers at `#797979` (secondary labels, breadcrumbs, filenames) and `#b9b9b9` (inactive tabs, timestamps, tertiary metadata).

**Accent colors are scoped to single semantic functions:**

- **Orange** → primary CTAs only. One job: action. Never used as background wash, hover tint, or icon fill.
- **Blue `#0052ef`** → links and interactive focus states.
- **Magenta** (`display-p3 0.960784 0 1`) → code syntax keywords (import, defineField, from). Appears only inside Studio simulation panels.
- **Lime** (`display-p3 0.270588 1 0`) → diff additions, live-update event feeds inside the Studio demo.
- **Yellow** (`display-p3 1 1 0`) → DRAFT status badge, one element only.
- **Green `#19d600`** → publish/success states.

All four vivid accents are wide-gamut P3 values confined to product simulation UI. They never appear in marketing chrome. This preserves the restrained dark palette at the brand layer while letting the product UI look technically alive.

## Layout & Composition

The page is 1440px wide with 24px edge gutters on a 12-column grid. Section boundaries are marked by background color changes — no horizontal rules, no decorative separators, no border-bottom lines.

**Split-panel** is the dominant content pattern: a text column (~5 cols) on the left anchors the narrative; a product screenshot or animated demo panel (~7 cols) on the right shows rather than describes. Product screenshots are rendered at near-actual scale inside `#212121`-bordered frames — a faithful simulation of the Studio, not an abstraction of it.

**Section rhythm** alternates between full-bleed dark narrative and inset-white product sections, with generous vertical space (80–128px) between content groups. Within a section, internal spacing is compact (24–32px between elements), creating controlled density: the page breathes at the macro level but reads information-rich at the micro level.

## Component Patterns

### Buttons

- **Primary:** orange fill (`color(display-p3 1 0.3333 0)`), `#0b0b0b` text, IBM Plex Mono uppercase label, pill or high-radius form.
- **Secondary:** transparent fill, white or dark border, IBM Plex Mono uppercase label.
- **Text link:** blue `#0052ef`, underline on hover.

### Navigation

- Full-bleed dark bar; mono uppercase labels at 13px / 16.9px line-height.
- Logo: `S/ Sanity` wordmark in white, top-left.
- Announcement strip: centered mono text on the darkest background, used for editorial promotions.

### Code & Studio Panels

- Background `#212121`; syntax coloring uses the P3 accent palette (magenta keywords, lime diffs, white identifiers).
- Tab labels: 11px Waldenburg uppercase, color `#b9b9b9`.
- File and path labels: 13px Waldenburg, color `#797979`.
- All code body text: IBM Plex Mono at 12–13px.

### Status Badges

- **DRAFT:** yellow (`display-p3 1 1 0`), 12px mono uppercase.
- **Published / Add / Change:** lime/green variants, 13px Waldenburg capitalize.
- **Timestamps and metadata:** `#b9b9b9` on dark surfaces.

### Avatars

- 27px circle, colored fill per user, `#0b0b0b` text, 11px/500 Waldenburg initials, no border.

## Surfaces & Depth

Sanity's marketing shell is flat. No drop shadows on navigation, hero sections, or feature cards — surfaces are separated purely by background color contrast. The only shadows (`card`, `modal`) appear inside product UI simulations, where they accurately represent the Studio's own layering system.

Where panel borders exist, they use `rgba(255,255,255,0.08)` — a barely-visible stroke that separates dark surfaces without introducing visual noise. There is no bevel, no gradient edge, no material metaphor in the marketing layer.

## Tone & Aesthetic

**Controlled density. Typographic authority. Zero decoration.**

The page is information-rich without feeling busy. Macro spacing creates breathing room; micro spacing keeps content compact. There is no illustration, no gradient wash, no decorative iconography. Visual interest comes from the product itself (Studio UI), editorial photography with orange-fire tones, and the sheer scale contrast between a 112px headline and a 10px query chip two sections below it.

The consistent signal: infrastructure for serious teams, rendered with the restraint of a technical manual and the confidence of a brand that doesn't need to explain itself.
