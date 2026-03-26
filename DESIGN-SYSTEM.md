# RepixBridge — Design System

## Brand
- **Name:** RepixBridge (Remix + Pic + Bridge)
- **Slogan:** "Design without borders"
- **Logo font:** Instrument Serif (Repix, 10% larger) + Instrument Sans (Bridge)
- **Slogan style:** 40% of logo size, 80% opacity, below logo

## Dual-Mode Color System

### Mode: HTML → Design Tool (Dark)
| Token | Value | Usage |
|-------|-------|-------|
| --bg | #000000 | Background |
| --fg | #E0E2EB | Primary text |
| --fg-muted | rgba(224,226,235,0.5) | Secondary text |
| --accent | #E0E2EB | Buttons, outlines |
| --surface | rgba(224,226,235,0.06) | Cards, elevated surfaces |
| --border | rgba(224,226,235,0.12) | Borders |

### Mode: Image Remix (Light)
| Token | Value | Usage |
|-------|-------|-------|
| --bg | #E0E2EB | Background |
| --fg | #000000 | Primary text |
| --fg-muted | rgba(0,0,0,0.5) | Secondary text |
| --accent | #000000 | Buttons, outlines |
| --surface | rgba(0,0,0,0.04) | Cards, elevated surfaces |
| --border | rgba(0,0,0,0.10) | Borders |

## Typography
- **Display:** Instrument Serif 400 (logo, section titles)
- **Body/UI:** Instrument Sans 400/500/600/700
- **Scale:** 10 / 11 / 12 / 14 / 16 / 20 / 24
- **Import:** `https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif&display=swap`

## Spacing
- Base unit: 4px
- Content padding: 16px
- Section gap: 20px
- Element gap: 8px / 12px

## Radii
- Widget (popup): 60px
- Cards: 20px
- Buttons: 12px
- Pills/tags: 999px
- Inputs: 10px

## Elevation
- Cards: no shadow (border only)
- Modals: 0 24px 48px rgba(0,0,0,0.3)

## Interaction
- Transitions: 150ms ease-out
- Press feedback: scale(0.97) + 100ms
- Mode switch: 300ms crossfade

## Layout (340px popup)
- Header: logo (left) + cog icon (right)
- Mode switch: centered toggle
- Content: scrollable, max-height ~440px
- No footer
