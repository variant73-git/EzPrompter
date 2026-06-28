/**
 * house-style.js — Uncraft's canonical "good taste" directive (Layer A).
 *
 * Single source of truth for the anti-AI-slop design rules injected into every
 * generation / reskin / edit path. Distilled from three UI/UX skills
 * (emil-design-eng = motion craft, taste-skill = bias correction, impeccable =
 * principles + bans), validated by the 2026-06-25 side-by-side test
 * (docs/superpowers/specs/2026-06-25-anti-slop-test/).
 *
 * Two exports:
 *   HOUSE_STYLE_GUARDRAILS — apply ALWAYS (invent, reskin, edit). Never degrade.
 *   HOUSE_STYLE            — guardrails + invention directives, for generating
 *                            design from scratch (gated by "no design source").
 *
 * Pairs with the specs:
 *   docs/superpowers/specs/2026-06-25-layer-A-design-quality-house-style.md
 *   docs/superpowers/specs/2026-06-25-layer-B-style-extraction-from-images.md
 *
 * Reskin/restyle paths already tell the model to use the reference's exact
 * fonts/hex tokens; the INVENT block below is explicitly gated to "no design
 * source provided" so it never fights those preserve rules.
 */

export const HOUSE_STYLE_GUARDRAILS = `DESIGN GUARDRAILS (apply to every visual decision)

Content authenticity
- Use the source's exact words. Never paraphrase into AI cliches ("Elevate", "Seamless", "Unleash", "Next-Gen", "Empower", "Transform", "Discover", "Revolutionize").
- Keep real numbers, prices, percentages, dates, and proper nouns literal. No fake "99%", "50%", "10x", "John Doe", "Sarah Chan", "Acme", "Nexus", "SmartFlow".
- No emojis. No em dashes in copy (use commas, colons, semicolons, periods, or parentheses).

Typography
- Never introduce a monospace font. If a provided source already uses mono, preserve it; otherwise set numbers with the body sans + tabular figures (font-variant-numeric: tabular-nums).
- Avoid AI-tell typefaces: Inter, Bricolage Grotesque, and the rest of the AI-default set. Never a JetBrains-family font.
- Control hierarchy with weight and color, not just oversized H1s.
- Eyebrows (small all-caps labels above headings) sparingly, and NEVER with wider-than-default letter-spacing.
- No italic by default (a common AI tell — do not set names, labels, headings, numbers, or body in italic decoratively). Use italic ONLY for genuine emphasis / highlights, or when a provided source clearly uses it as a system. When in doubt, upright.

Color
- Avoid pure #000000 (use #0a0a0a) and pure #ffffff (tint it slightly toward the palette). One accent color max, saturation below 80%.
- No "AI purple/blue" gradients, no oversaturated accents, no neon / outer glows. Shadows soft and tinted to the background hue.

Layout & materiality
- Do NOT add a border/outline OR a drop-shadow behind cards/containers by reflex (both are common AI tells). Use a container border or shadow ONLY when a provided source actually has one; otherwise separate with background fill and spacing alone. Source has none → output has none. STRONG BIAS: a thin 1px card outline is the single most common thing you hallucinate — most modern UIs separate cards with fill/shadow/spacing, NOT a border. When you are not CERTAIN the source shows a distinct outline, assume there is NONE and emit no border.
- Respect the source's proportions: the size of text relative to its buttons, pills, and containers, and especially the internal padding (the gap between content and the container's edges). When a source is provided, reproduce these; never tighten or inflate them.
- Cards are the lazy answer: group with whitespace or hairlines first; nested cards never. Avoid identical 3-equal-card rows (prefer asymmetric grids, 2-column zig-zag, or bento).
- Resist the centered hero-over-image default; prefer an asymmetric or split composition.
- Constrain outer containers (max-w-7xl mx-auto / max-w-[1400px]). Hero sections use min-h-[100dvh], never h-screen.

Banned details (rewrite the element if you reach for one)
- Default / decorative italic. Do NOT italicize titles, names, labels, numbers, or body. font-style is upright unless the change is true emphasis or a provided source already uses italic for that exact element.
- Side-stripe accent borders (a colored border-left/right > 1px on cards, list items, callouts, alerts).
- Gradient text (background-clip:text + a gradient) on headings.
- Glassmorphism as a default decoration.
- The hero-metric template (big number / small label / supporting stats / gradient accent).
- A thin decorative metallic or contrasting keyline tracing a container's rounded corners (ornamental double-outline / corner frame).
- Modal as the first thought; custom mouse cursors.

Motion & states
- Animate only transform and opacity (never top, left, width, height). Strong ease-out curves, under 300ms for UI, never ease-in. Never animate from scale(0) (start ~0.95 + opacity).
- Pressable elements get tactile :active feedback (scale ~0.97 or translate-y 1px). Provide loading (skeletons, not spinners), empty, and error states.

The slop test (final filter)
- If someone could look at the result and say "AI made that" with no doubt, it failed. If theme + palette are guessable from the category alone (finance -> navy/gold, crypto -> neon-on-black, healthcare -> white/teal), rework until the answer is not obvious.`;

export const HOUSE_STYLE_INVENT = `WHEN INVENTING DESIGN FROM A PROMPT (only when NO HTML or design.md source is provided)
- Decide register first: brand (design IS the product: landing, campaign, portfolio) vs product (design SERVES it: app, dashboard, tool).
- Theme is never a default: write one sentence of physical scene (who uses it, where, what light, what mood) and let it force light vs dark.
- Pick a color strategy before colors: restrained (tinted neutrals + one accent <=10%), committed (one color carries 30-60% of the surface), full palette (3-4 named roles), or drenched (the surface IS the color). Do not collapse everything to restrained by reflex.
- Reach for a deliberate, characterful typeface outside the AI-default set. Serif only for editorial, never on clean dashboards.
- Vary spacing for rhythm; lead with an asymmetric or split composition over a centered one.`;

export const HOUSE_STYLE_ABSORB = `STYLE ABSORPTION — when a style source is provided (an HTML reference, a design.md, or an extracted image brief), IT is the SOLE authority for how the result looks. Absorb EVERY visual characteristic from it and take NOTHING from your own defaults:
- font family, font-STYLE (upright vs italic — match it exactly), weight, case, letter-spacing
- color: surface, text, and every accent/role — exact values, not approximations
- corner radius (per element type: cards vs buttons vs pills), and border presence/width/color
- shadow presence + softness + tint (none if the source has none), and overall elevation
- spacing rhythm AND internal padding (the gap between content and each container's edges)
- the OUTER spacing between sibling containers vs the INNER padding — reproduce the source's exact density; if it packs containers TIGHT, keep them tight (never loosen)
- WHERE each fill/gradient lives — a background gradient stays on the BACKGROUND, never relocated onto a card/container; flat container fills stay flat
- the distinct container VARIANTS/STATES (opaque vs translucent "glass" vs tinted) — reproduce EACH, do not flatten them to one surface
- the heading↔subheading relationship (size ratio, weight, colour, margin to the container's edges)
- the size of text RELATIVE to buttons, pills, and containers
- overall proportions and density
These STRUCTURAL relationships ARE part of the style — the source's brief carries them like a "DOM", and you reproduce them on the target's CONTENT. Do NOT re-derive spacing, layering, or treatment placement from the target's own structure or your defaults. The CONTENT keeps its own words and numbers; EVERYTHING visual — tokens AND structure — comes from the style source. If the style source does not pin a property, derive it from the style source's own system — NEVER from a generic AI default. A characteristic the style source has must appear in the output; one it lacks must NOT be invented.`;

export const HOUSE_STYLE = `${HOUSE_STYLE_GUARDRAILS}\n\n${HOUSE_STYLE_ABSORB}\n\n${HOUSE_STYLE_INVENT}`;
