---
name: Sanity
description: Content Operating System for the AI era — a developer-first, dark-mode-native platform for structured content management and AI-powered publishing workflows.

colors:
  # ── Neutrals ──────────────────────────────────────────────────────────────
  black:         "#0b0b0b"   # page canvas, dominant background
  surface:       "#212121"   # elevated cards, panels, modals
  white:         "#ffffff"   # light-section backgrounds; primary text on dark

  # ── Text ──────────────────────────────────────────────────────────────────
  text-on-dark:  "#ffffff"
  text-on-light: "#0b0b0b"
  text-muted:    "#797979"   # secondary labels, breadcrumbs
  text-subtle:   "#b9b9b9"   # inactive tabs, timestamps, history labels

  # ── Brand Accents (wide-gamut) ────────────────────────────────────────────
  accent-orange:   "color(display-p3 1 0.3333 0)"       # primary CTA; brand signature
  accent-blue:     "#0052ef"                             # rgb(0, 82, 239) interactive blue
  accent-magenta:  "color(display-p3 0.960784 0 1)"     # vivid magenta; background accent
  accent-yellow:   "#fff500"                             # rgb(255, 245, 0) highlight band
  accent-green:    "#19d600"                             # rgb(25, 214, 0) success / live status

  # ── Syntax / Code Highlighting ───────────────────────────────────────────
  syntax-keyword:  "#f500ff"                             # rgb(245, 0, 255) keywords (import, etc.)
  syntax-string:   "#0053ef"                             # rgb(0, 83, 239) string literals
  syntax-status:   "color(display-p3 0.270588 1 0)"     # neon green for publish/change labels
  syntax-draft:    "color(display-p3 1 1 0)"            # neon yellow for DRAFT badges

typography:
  fonts:
    display: "waldenburgNormal, \"waldenburgNormal Fallback\", ui-sans-serif, system-ui, sans-serif"
    mono:    "ibmPlexMono, \"ibmPlexMono Fallback\", ui-monospace, monospace"

  scale:
    hero-xl:
      family:         display
      size:           "112px"
      line-height:    "112px"
      letter-spacing: "-4.48px"
      weight:         400

    hero-lg:
      family:         display
      size:           "72px"
      line-height:    "75.6px"
      letter-spacing: "-2.88px"
      weight:         400

    display-cta:
      family:         display
      size:           "60px"
      line-height:    "48px"
      letter-spacing: "normal"
      weight:         400
      transform:      capitalize

    heading-xl:
      family:         display
      size:           "48px"
      line-height:    "51.84px"
      letter-spacing: "-1.68px"
      weight:         400

    heading-lg:
      family:         display
      size:           "38px"
      line-height:    "41.8px"
      letter-spacing: "-1.14px"
      weight:         400

    heading-md:
      family:         display
      size:           "32px"
      line-height:    "36.16px"
      letter-spacing: "-0.32px"
      weight:         425

    heading-sm:
      family:         display
      size:           "24px"
      line-height:    "26.4px"
      letter-spacing: "-0.24px"
      weight:         400

    subheading:
      family:         display
      size:           "24px"
      line-height:    "29.76px"
      letter-spacing: "-0.24px"
      weight:         425

    body-lg:
      family:         display
      size:           "18px"
      line-height:    "27px"
      letter-spacing: "-0.18px"
      weight:         400

    body-md:
      family:         display
      size:           "15px"
      line-height:    "22.5px"
      letter-spacing: "-0.15px"
      weight:         400

    body-sm:
      family:         display
      size:           "13px"
      line-height:    "19.5px"
      letter-spacing: "-0.13px"
      weight:         400

    caption:
      family:         display
      size:           "12px"
      line-height:    "18px"
      letter-spacing: "normal"
      weight:         400

    avatar-label:
      family:         display
      size:           "11px"
      line-height:    "11px"
      letter-spacing: "normal"
      weight:         500

    eyebrow-md:
      family:         mono
      size:           "13px"
      line-height:    "16.9px"
      letter-spacing: "normal"
      weight:         400
      transform:      uppercase

    eyebrow-sm:
      family:         mono
      size:           "12px"
      line-height:    "18px"
      letter-spacing: "normal"
      weight:         400
      transform:      uppercase

    eyebrow-xs:
      family:         mono
      size:           "10px"
      line-height:    "14px"
      letter-spacing: "normal"
      weight:         400
      transform:      uppercase

    tab-label:
      family:         display
      size:           "11px"
      line-height:    "16.5px"
      letter-spacing: "normal"
      weight:         600
      transform:      uppercase

    code-md:
      family:         mono
      size:           "13px"
      line-height:    "19.5px"
      letter-spacing: "normal"
      weight:         400

    code-sm:
      family:         mono
      size:           "12px"
      line-height:    "18px"
      letter-spacing: "normal"
      weight:         400

    announcement:
      family:         mono
      size:           "13px"
      line-height:    "19.5px"
      letter-spacing: "normal"
      weight:         500

spacing:
  0:   "0px"
  1:   "4px"
  2:   "8px"
  3:   "12px"
  4:   "16px"
  5:   "20px"
  6:   "24px"
  8:   "32px"
  10:  "40px"
  12:  "48px"
  16:  "64px"
  20:  "80px"
  24:  "96px"
  page-margin: "24px"

radii:
  none:   "0px"
  sm:     "4px"
  md:     "8px"
  lg:     "12px"
  xl:     "16px"
  pill:   "9999px"

borders:
  subtle-dark:  "1px solid rgba(255, 255, 255, 0.08)"
  subtle-light: "1px solid rgba(11, 11, 11, 0.12)"
  focus:        "1px solid #0052ef"

elevation:
  # Sanity's dark theme relies on background lightness, not drop shadows
  0:   "none"
  1:   "0 1px 3px rgba(0,0,0,0.4)"
  2:   "0 4px 16px rgba(0,0,0,0.5)"
  3:   "0 8px 32px rgba(0,0,0,0.6)"

motion:
  duration-fast:   "120ms"
  duration-base:   "200ms"
  duration-slow:   "350ms"
  easing-standard: "cubic-bezier(0.4, 0, 0.2, 1)"
  easing-enter:    "cubic-bezier(0, 0, 0.2, 1)"
  easing-exit:     "cubic-bezier(0.4, 0, 1, 1)"

viewport:
  design-width: "1440px"
  page-max-width: "1440px"
---

# Sanity Design System

## Visual Identity

Sanity's visual identity is **dark, technical, and boldly editorial**. The default canvas is a near-black (`#0b0b0b`) that reads warmer than pure black, giving the interface a studio-print quality rather than a terminal aesthetic. Against this foundation, a small set of wide-gamut accent colors — most notably a display-P3 orange — land with deliberate punch. The result feels simultaneously developer-native and design-considered.

The brand personality can be summarised in three axes:

- **Structured but not rigid** — generous white space, orderly grids, but never sterile.
- **Technical but human** — monospace type coexists with a warm editorial serif-adjacent display face.
- **Confident, not loud** — accents are used sparingly; when orange appears it means *act here*.

---

## Color

### Canvas & Surfaces

The page background is `#0b0b0b` — just off true black, which prevents harshness under OLED panels. Elevated surfaces (cards, modals, the Studio sidebar, code panels) step to `#212121`, creating a clear depth layer without resorting to shadows. White (`#ffffff`) is reserved for light-mode sections that appear mid-page, creating a deliberate rhythm of dark → light → dark as the user scrolls.

### Brand Accents

The accent palette is intentionally wide-gamut:

- **Orange** (`color(display-p3 1 0.3333 0)`) is the primary call-to-action color and the closest thing to a brand signature. It saturates past what sRGB can render, appearing on dark backgrounds as a molten citrus. Used exclusively for primary CTAs and interactive highlights; never decorative.
- **Electric Blue** (`#0052ef`) anchors interactive states — links, focus rings, and inline code string literals.
- **Vivid Magenta** (`color(display-p3 0.960784 0 1)`) appears as a section-background accent and for Studio's document-event highlights.
- **Neon Yellow** (`#fff500`) and **Electric Green** (`#19d600`) serve as status and badge colors — yellow for draft states, green for published/live.

The combined effect is a neon-tinged dark palette that evokes both developer tooling and a gallery installation.

### Text

Text hierarchy is handled through three lightness values on dark backgrounds:
1. `#ffffff` — primary, headings and body.
2. `#b9b9b9` — secondary, inactive tab labels and timestamps.
3. `#797979` — tertiary, breadcrumbs, helper text.

On light backgrounds, `#0b0b0b` is used throughout for maximum contrast.

---

## Typography

### Typefaces

Two typefaces do all the work:

**waldenburgNormal** is the display and body face. It sits in the grotesque-sans tradition but carries subtle humanist details that soften the technical context. At large sizes its weight sits at a distinctive 400 that feels lighter than most grotesques, letting negative letter-spacing do the optical tightening. At small sizes (13–15px) it reads cleanly as UI copy.

**IBM Plex Mono** handles all code, navigation labels, eyebrows, and CLI snippets. Its geometry and even stroke width complement waldenburgNormal without competing. Every navigational label and product category name is set in uppercase Plex Mono, reinforcing the developer-tool mental model.

### Scale & Rhythm

The type scale is expressive at the top and utilitarian at the bottom:

| Role | Size | Weight | Notes |
|---|---|---|---|
| hero-xl | 112px | 400 | Letter-spacing −4.48px; 1:1 line-height |
| hero-lg | 72px | 400 | Letter-spacing −2.88px |
| display-cta | 60px | 400 | `capitalize` transform; used in full-width CTA banners |
| heading-xl | 48px | 400 | Section intros, feature names |
| heading-lg | 38px | 400 | h2-level section titles |
| heading-md | 32px | 425 | Sub-section body intros; uses the 425 weight axis |
| heading-sm / subheading | 24px | 400 / 425 | Feature cards; button-label-scale headers |
| body-lg | 18px | 400 | Primary body copy |
| body-md | 15px | 400 | Dense UI lists, Studio activity feed |
| body-sm / label | 13px | 400 | Labels, nav items, code prose |
| caption | 12px | 400 | Timestamps, helper micro-copy |

A distinctive weight stop, **425**, appears in the OpenType axis of waldenburgNormal. It is used specifically for longer body-width headings and subheadings — fractionally denser than Regular (400), lighter than Medium (500) — creating a tier between "headline" and "body" that is unique to this scale.

Negative letter-spacing scales proportionally with size: the largest headline carries −4.48px (4% of its size), the smallest display text uses 0px or minimal tracking. This keeps optical word spacing even across the scale.

---

## Layout

### Grid & Page Width

The design is authored at **1440px** viewport width. The page does not appear to enforce a narrow max-width; most content stretches edge-to-edge in full-bleed dark sections, with an internal 24px horizontal margin providing a modest gutter at the canvas edges.

### Section Rhythm

The page is composed as a vertical stack of full-bleed horizontal bands, each with its own background treatment. The alternation between dark, near-black bands and occasional white bands creates a strong editorial scroll rhythm that doubles as navigation cues — the user always knows which product area they are in by the background color.

### Announcement Bar

A single-line announcement bar sits above the primary navigation, set in IBM Plex Mono 13px/500 weight, centered, in white on the same near-black canvas. It uses no background colour of its own — it is simply the topmost type layer.

---

## Components

### Primary CTA Buttons

The "Get Started" and "Contact Sales" buttons are the only place the orange accent appears at full saturation. They are set in waldenburgNormal 60px with `capitalize` text-transform, giving them an outsized, poster-like presence in the full-width bottom CTA band. No border-radius detail was resolved, but the design aesthetic suggests a pill or large-radius treatment.

### Navigation

The global navigation uses uppercase IBM Plex Mono 13px for all product and section links, rendered in white on dark. This mono-uppercase treatment makes every nav label feel like a command or file path, reinforcing the developer-tool metaphor.

### Cards / Feature Panels

Feature cards use the `#212121` surface with subtle `rgba(255, 255, 255, 0.08)` borders. Content inside mixes waldenburgNormal headings with body copy and — notably — live code editor or Studio UI mockups rendered as dark-surface panels within panels.

### Code Editor Mockups

Code blocks use IBM Plex Mono 13px with a two-color syntax scheme: `#f500ff` (vivid magenta) for keywords and reserved words, `#0053ef` (electric blue) for string literals. The low token count keeps the syntax readable without visual noise.

### Studio UI Mockups

Studio interface elements depicted on the page use lowercase waldenburgNormal 13px labels in `#797979` and `#b9b9b9` for muted hierarchy. Status badges use neon yellow for `DRAFT` and a display-P3 neon green for `Published` / `Change`. User avatar chips are 27×27px rounded squares with initials in waldenburgNormal 11px/500.

### Tab Bars

Code panel tabs use waldenburgNormal 11px/600/uppercase in `#b9b9b9` for inactive states. The active tab is implied by context but would use `#ffffff`.

---

## Motion

No explicit animation values were captured from the DOM, but the design language implies:

- **Fast micro-interactions** (hover states, focus rings): ~120ms, standard easing.
- **Panel transitions** (Studio view swaps, accordion opens): ~200ms, standard easing.
- **Scroll-triggered reveals** (section entrances, the hero headline cascade): ~350ms, ease-in-out.

Motion should feel mechanical and precise, not bouncy. Spring physics are inappropriate for this aesthetic; cubic-bezier curves that ease out crisply are preferred.

---

## Voice in Visual Design

The design speaks with the confidence of a technical authority who doesn't over-explain. Large, sparse headlines land as declarative statements ("Structure powers intelligence"), not marketing copy. White space is used to let ideas breathe, not to pad. Colour is used to direct — not to decorate.

When in doubt: more negative space, less colour, fewer words, tighter tracking.