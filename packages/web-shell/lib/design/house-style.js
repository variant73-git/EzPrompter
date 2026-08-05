/**
 * house-style.js — Uncraft's canonical "good taste" directive (Layer A).
 *
 * TOGGLEABLE CRITERIA REGISTRY. Every anti-slop rule is an isolated entry in
 * CRITERIA with its own on/off switch, so any single criterion can be taken
 * "offline" without touching the others. The legacy exports
 * (HOUSE_STYLE_GUARDRAILS / _ABSORB / _INVENT / HOUSE_STYLE) are now ASSEMBLED
 * from the enabled criteria at module load — same names, same shape, so the
 * three importers (demarcelize.js, run-flow.js, agent/prompts.js) keep working.
 *
 * HOW TO TOGGLE
 *   - Per-item default: flip `on` on the entry below (hot-reloads in dev).
 *   - Without editing code: env `UNCRAFT_HOUSESTYLE_OFF="id1,id2"` (and/or
 *     `UNCRAFT_HOUSESTYLE_ON="id3"`) — comma-separated criterion ids.
 *   - Programmatic / future settings UI: `listCriteria()` to see the switchboard,
 *     `setCriterion(id, on)` to flip, then `buildHouseStyle({ off:[...] })` /
 *     `buildGuardrails()` to render a custom-toggled directive on demand.
 *
 * DECISION LOG (2026-07-22 conflict resolutions, item numbers from the skills
 * cross-analysis) is recorded per-criterion in `note`. Distilled from three
 * UI/UX skills (emil-design-eng, taste-skill, impeccable) + the 6-skill anti-slop
 * cross-read, validated by the 2026-06-25 side-by-side test
 * (docs/superpowers/specs/2026-06-25-anti-slop-test/).
 *
 * A criterion's `text` is the exact prompt fragment; `group` places it under a
 * header in the rendered directive. Reskin/restyle paths already pin the
 * reference's exact fonts/hex tokens; the INVENT block is gated to "no design
 * source provided" so it never fights those preserve rules.
 */

// mode: 'guardrails' entries compose HOUSE_STYLE_GUARDRAILS (applied ALWAYS).
// mode: 'absorb' / 'invent' are the two source-conditional blocks.
export const CRITERIA = [
  // ── Content authenticity ─────────────────────────────────────────────────
  { id: 'content-exact-words', group: 'content', mode: 'guardrails', on: true,
    text: `- Use the source's exact words. Never paraphrase into AI cliches ("Elevate", "Seamless", "Unleash", "Next-Gen", "Empower", "Transform", "Discover", "Revolutionize").` },
  { id: 'content-real-numbers', group: 'content', mode: 'guardrails', on: true,
    note: 'decision 53: literal from source; invent only where there is NO source (INVENT block).',
    text: `- Keep real numbers, prices, percentages, dates, and proper nouns literal when they come from a source. No fake "99%", "50%", "10x", "John Doe", "Sarah Chan", "Acme", "Nexus", "SmartFlow". Only invent plausible content where no source supplies it.` },
  { id: 'content-no-emoji-emdash', group: 'content', mode: 'guardrails', on: true,
    text: `- No emojis. No em dashes in copy (use commas, colons, semicolons, periods, or parentheses).` },

  // ── Typography ───────────────────────────────────────────────────────────
  { id: 'type-no-mono', group: 'typography', mode: 'guardrails', on: true,
    note: 'decision 38/39: monospace stays banned; numbers use tabular figures.',
    text: `- Never introduce a monospace font. If a provided source already uses mono, preserve it; otherwise set numbers with the body sans + tabular figures (font-variant-numeric: tabular-nums).` },
  { id: 'type-no-ai-fonts', group: 'typography', mode: 'guardrails', on: true,
    note: 'decision 37/38: Inter/Bricolage/JetBrains stay out; Fraunces + Instrument Serif are NOT banned (edit mode covers them; Instrument Serif is Uncraft branding).',
    text: `- Avoid AI-tell typefaces: Inter, Bricolage Grotesque, and the rest of the AI-default set. Never a JetBrains-family font. (Fraunces and Instrument Serif are allowed.)` },
  { id: 'type-hierarchy', group: 'typography', mode: 'guardrails', on: true,
    text: `- Typography may be the protagonist. Oversized display type is valid when its line breaks, measure, tracking, and relationship to supporting copy are deliberate; do not use size as a substitute for hierarchy.` },
  { id: 'type-eyebrows', group: 'typography', mode: 'guardrails', on: true,
    text: `- Eyebrows (small labels above headings) are a block-level choice, not a reflex. When a reference uses one, preserve its exact case, measured letter-spacing, and offset, including deliberately wide tracking.` },
  { id: 'type-tracking', group: 'typography', mode: 'guardrails', on: true,
    note: 'updated 2026-08-05: reference measurements override generic tracking priors; no automatic tightening.',
    text: `- Treat letter-spacing and line-height as measured source data. Copy computed values from the reference when available; never automatically tighten a display or widen a label because of a generic typography rule.` },
  { id: 'type-no-italic', group: 'typography', mode: 'guardrails', on: true,
    text: `- No italic by default (a common AI tell — do not set names, labels, headings, numbers, or body in italic decoratively). Use italic ONLY for genuine emphasis / highlights, or when a provided source clearly uses it as a system. When in doubt, upright.` },
  { id: 'type-serif-default', group: 'typography', mode: 'guardrails', on: true,
    note: 'decision 49: serif+sans contrast is fine; discouraged as a reflexive default unless the brief personality warrants it.',
    text: `- Serif pairing (serif display + sans body) is allowed as deliberate contrast, but do not reach for serif as a reflexive default; use it when the brief's personality genuinely calls for it (editorial, luxury, heritage) or when asked.` },

  // ── Color ────────────────────────────────────────────────────────────────
  { id: 'color-no-pure-bw', group: 'color', mode: 'guardrails', on: true,
    text: `- Avoid pure #000000 (use #0a0a0a) and pure #ffffff (tint it slightly toward the palette). Saturation on accents below 80%.` },
  { id: 'color-accent-count', group: 'color', mode: 'guardrails', on: true,
    note: 'decision 47: 1–3 accents (was "one max"); each accent must carry meaning, not decoration.',
    text: `- Use 1 to 3 accent colors, no more. Every accent must earn its place (status, action, identity) — gray builds structure, color communicates. Do not scatter unmotivated color.` },
  { id: 'color-no-ai-gradients', group: 'color', mode: 'guardrails', on: true,
    text: `- No "AI purple/blue" gradients, no oversaturated accents, no neon / outer glows. Shadows soft and tinted to the background hue.` },
  { id: 'color-gradients-brand', group: 'color', mode: 'guardrails', on: true,
    note: 'decision 46: gradients allowed when brand-appropriate, not encouraged, prefer on explicit request.',
    text: `- Gradients (beyond the banned AI ones above) are permitted when brand-appropriate, but not encouraged: prefer them when the source or the request calls for one, not by reflex.` },

  // ── Layout & materiality ─────────────────────────────────────────────────
  { id: 'layout-border-shadow-conditional', group: 'layout', mode: 'guardrails', on: true,
    note: 'decision 41: neither border NOR shadow unless the source has it OR the user specifies.',
    text: `- Do NOT add a border/outline OR a drop-shadow behind cards/containers by reflex (both are common AI tells). Use a container border or shadow ONLY when a provided source actually has one, or when the user explicitly asks; otherwise separate with background fill and spacing alone. Source has none and no request → output has none. STRONG BIAS: a thin 1px card outline is the single most common thing you hallucinate — most modern UIs separate cards with fill/shadow/spacing, NOT a border. When you are not CERTAIN the source shows a distinct outline, assume there is NONE and emit no border.` },
  { id: 'layout-no-thick-border-hardshadow', group: 'layout', mode: 'guardrails', on: true,
    note: 'decision 45: thick decorative borders and hard/harsh drop shadows banned.',
    text: `- Never use thick decorative borders or hard, harsh drop shadows. When a border or shadow is warranted, keep it hairline / soft and tinted to the surface.` },
  { id: 'layout-atmosphere-ok', group: 'layout', mode: 'guardrails', on: true,
    note: 'decision 45: grain/noise textures and gradient meshes are allowed (not treated as tells).',
    text: `- Atmospheric grain/noise textures and gradient meshes are allowed when they serve the composition (kept subtle, on fixed non-interactive layers).` },
  { id: 'layout-proportions', group: 'layout', mode: 'guardrails', on: true,
    text: `- Respect the source's proportions: the size of text relative to its buttons, pills, and containers, and especially the internal padding (the gap between content and the container's edges). When a source is provided, reproduce these; never tighten or inflate them.` },
  { id: 'layout-mobile-stable', group: 'layout', mode: 'guardrails', on: true,
    text: `- Mobile quality is a hard gate. Preserve the structure's reading order, hierarchy, and anchoring logic on narrow screens; when independent viewport anchors no longer fit, convert them into a deliberate vertical flow instead of shrinking desktop geometry until it breaks.` },
  { id: 'layout-cards-lazy', group: 'layout', mode: 'guardrails', on: true,
    text: `- Cards are the lazy answer: group with whitespace or hairlines first; nested cards never. Do not invent identical 3-column rows by reflex, but preserve a clean equal-column structure when the reference or content system genuinely calls for one.` },
  { id: 'layout-asymmetric-hero', group: 'layout', mode: 'guardrails', on: true,
    text: `- Prefer controlled asymmetry when inventing, but treat centered, split, and offset heroes as equally valid structural patterns when selected deliberately or measured from a reference.` },
  { id: 'layout-constrain-containers', group: 'layout', mode: 'guardrails', on: true,
    text: `- Constrain outer containers (max-w-7xl mx-auto / max-w-[1400px]). Hero sections use min-h-[100dvh], never h-screen.` },

  // ── Banned details (rewrite the element if you reach for one) ─────────────
  { id: 'banned-decorative-italic', group: 'banned', mode: 'guardrails', on: true,
    text: `- Default / decorative italic. Do NOT italicize titles, names, labels, numbers, or body. font-style is upright unless the change is true emphasis or a provided source already uses italic for that exact element.` },
  { id: 'banned-side-stripe', group: 'banned', mode: 'guardrails', on: true,
    text: `- Side-stripe accent borders (a colored border-left/right > 1px on cards, list items, callouts, alerts).` },
  { id: 'banned-gradient-text', group: 'banned', mode: 'guardrails', on: true,
    text: `- Gradient text (background-clip:text + a gradient) on headings.` },
  { id: 'banned-glassmorphism-default', group: 'banned', mode: 'guardrails', on: true,
    note: 'decision 43: glassmorphism kept possible — only barred as a reflexive default, allowed with craft.',
    text: `- Glassmorphism as a reflexive default decoration. It is allowed when the aesthetic genuinely calls for it and it is executed with craft, but never as an automatic surface treatment.` },
  { id: 'banned-hero-metric', group: 'banned', mode: 'guardrails', on: true,
    text: `- The hero-metric template (big number / small label / supporting stats / gradient accent).` },
  { id: 'banned-keyline', group: 'banned', mode: 'guardrails', on: true,
    text: `- A thin decorative metallic or contrasting keyline tracing a container's rounded corners (ornamental double-outline / corner frame).` },
  { id: 'banned-modal-first', group: 'banned', mode: 'guardrails', on: true,
    text: `- Modal as the first thought.` },
  { id: 'cursor-user-gated', group: 'banned', mode: 'guardrails', on: true,
    note: 'decision 44: custom cursors only when the user asks.',
    text: `- Custom mouse cursors only when the user explicitly requests them; never by default.` },

  // ── Motion & states ──────────────────────────────────────────────────────
  { id: 'motion-transform-opacity', group: 'motion', mode: 'guardrails', on: true,
    text: `- Animate only transform and opacity (never top, left, width, height). Strong ease-out curves, under 300ms for UI, never ease-in. Never animate from scale(0) (start ~0.95 + opacity).` },
  { id: 'motion-feedback-always', group: 'motion', mode: 'guardrails', on: true,
    note: 'decision 48: interaction feedback ALWAYS.',
    text: `- Pressable elements always get tactile :active feedback (scale ~0.97 or translate-y 1px). Provide loading (skeletons, not spinners), empty, and error states.` },
  { id: 'motion-entrance-contextual', group: 'motion', mode: 'guardrails', on: true,
    note: 'decision 48 (revised): motion intensity by register — landing/brand (and sparse prompts) get committed motion; apps/systems get subtle motion; no-motion/minimal is opt-in by the user.',
    text: `- Motion intensity by register: landing and brand pages get committed, real motion at intensity — especially when the prompt is sparse (motion has to carry the page). Apps, systems, and tools get subtle motion only. Never claim movement and ship a static page. Minimal or no motion is opt-in: apply it only when the user asks for it.` },
  { id: 'motion-stagger', group: 'motion', mode: 'guardrails', on: true,
    note: 'decision 50: stagger 30–80ms, context-dependent.',
    text: `- Stagger grouped entrances by roughly 30 to 80ms per item, tuned to the context; exits faster and subtler than enters.` },
  { id: 'states-hitarea', group: 'motion', mode: 'guardrails', on: true,
    note: 'item 38 (blind-spot adopt): min hit area.',
    text: `- Interactive elements get at least a 44x44px hit area (40x40px in dense desktop UI); extend a smaller visible control with a pseudo-element rather than shrinking the target.` },

  // ── Theme & modes ────────────────────────────────────────────────────────
  { id: 'darkmode-conditional', group: 'mode', mode: 'guardrails', on: true,
    note: 'decision 51: only handle dark mode when it exists; full dual-mode discipline only for system/SaaS/app work, not marketing/brand.',
    text: `- Dark mode: only implement it when the source or brief actually has it. Reserve full dual-mode discipline (both themes designed from the start) for system/SaaS/app generations; marketing and brand pages ship the single intended theme.` },

  // ── The slop test (final filter) ─────────────────────────────────────────
  { id: 'slop-test', group: 'meta', mode: 'guardrails', on: true,
    text: `- If someone could look at the result and say "AI made that" with no doubt, it failed. If theme + palette are guessable from the category alone (finance -> navy/gold, crypto -> neon-on-black, healthcare -> white/teal), rework until the answer is not obvious.` },

  // ── ABSORB (source provided) ─────────────────────────────────────────────
  { id: 'absorb-block', group: 'absorb', mode: 'absorb', on: true,
    text: `REFERENCE USE — first decide whether the user requested faithful transfer or inspiration.
- Faithful transfer: the named source is the visual authority; reproduce its measured tokens, proportions, and responsive behavior while preserving the target's semantic truth.
- Inspiration / Start from a Ref: decompose every chosen section into (A) reusable structure and (B) replaceable treatment. Preserve section topology, alignment and anchoring logic, media-to-copy proportions, scroll axis/pinning, and density rhythm. Treat colors, decorative overlays, background blocks, imagery, logos, copy, item count, and brand-specific motion as variables unless the user explicitly preserves them.
- Typography is ground truth, not a guess: capture computed font-size, line-height, letter-spacing, weight, max-width, and offsets. With one reference, keep type and media scale within 15% of it. With two or three references, choose one scale owner that best fits the brief and use it consistently across the page.
- Identity does not come from copying the bank. Apply a coherent identity layer derived from the brief and your independent art direction after the structural choices are sound.
- Componentize the art direction into independently chosen ingredients: structure/wireframe, text-block composition and alignment, palette strategy, typography character, and motion register. A reference may inform one ingredient without controlling the others.
- Never transplant a semantically specific animation merely because it is impressive. Preserve its structure only when the interaction story remains meaningful for the new content.
- Mobile behavior is part of the source structure. A pattern that cannot remain coherent on mobile is ineligible.` },

  // ── INVENT (no source provided) ──────────────────────────────────────────
  { id: 'invent-block', group: 'invent', mode: 'invent', on: true,
    text: `WHEN INVENTING DESIGN FROM A PROMPT (only when NO HTML or design.md source is provided)
- Decide register first: brand (design IS the product: landing, campaign, portfolio) vs product (design SERVES it: app, dashboard, tool).
- Identify brand personality separately from business category: playful, extroverted, sober, neutral, corporate, authoritative, approachable, bold, technical, premium, rebellious, or warm. Do not infer personality from industry alone.
- Theme is never a default: write one sentence of physical scene (who uses it, where, what light, what mood) and let it force light vs dark.
- Pick a color strategy before colors: restrained (tinted neutrals + one accent <=10%), committed (one color carries 30-60% of the surface), full palette (3-4 named roles), or drenched (the surface IS the color). Do not collapse everything to restrained by reflex.
- Reach for a deliberate, characterful typeface outside the AI-default set. Serif only for editorial, never on clean dashboards.
- For sparse brand/landing prompts, default to large media with anchored text, controlled asymmetry, alternating density and breathing room, and protagonist typography that does not depend on effects.
- Build the direction as a five-ingredient combination: structure + text composition/alignment + palette + typography + motion. Choose each ingredient from the brand attributes and audience rather than applying one monolithic style preset.
- Vary spacing for rhythm; use centered, split, or asymmetric compositions according to the content, and make the result remain strong on mobile.` },
];

// ── Group headers, in render order ─────────────────────────────────────────
const GROUP_HEADERS = {
  content: 'Content authenticity',
  typography: 'Typography',
  color: 'Color',
  layout: 'Layout & materiality',
  banned: 'Banned details (rewrite the element if you reach for one)',
  motion: 'Motion & states',
  mode: 'Theme & modes',
  meta: 'The slop test (final filter)',
};
const GUARDRAIL_GROUP_ORDER = ['content', 'typography', 'color', 'layout', 'banned', 'motion', 'mode', 'meta'];

// ── Env overrides (applied once at load) ────────────────────────────────────
function applyEnvOverrides() {
  const parse = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const off = new Set(parse(process.env.UNCRAFT_HOUSESTYLE_OFF));
  const on = new Set(parse(process.env.UNCRAFT_HOUSESTYLE_ON));
  for (const c of CRITERIA) {
    if (off.has(c.id)) c.on = false;
    if (on.has(c.id)) c.on = true;
  }
}
applyEnvOverrides();

// ── Public switchboard API ──────────────────────────────────────────────────
/** Inspect the switchboard: [{ id, group, mode, on, note }]. */
export function listCriteria() {
  return CRITERIA.map(({ id, group, mode, on, note }) => ({ id, group, mode, on, note }));
}

/** Flip one criterion on/off. Later build*() calls reflect it. Returns success. */
export function setCriterion(id, on) {
  const c = CRITERIA.find((x) => x.id === id);
  if (!c) return false;
  c.on = !!on;
  return true;
}

// opts.off / opts.on: transient id lists overriding the stored `on` for this render only.
function isEnabled(c, opts) {
  if (opts?.on?.includes(c.id)) return true;
  if (opts?.off?.includes(c.id)) return false;
  return c.on;
}

/** HOUSE_STYLE_GUARDRAILS, rendered from currently-enabled guardrail criteria. */
export function buildGuardrails(opts) {
  const enabled = CRITERIA.filter((c) => c.mode === 'guardrails' && isEnabled(c, opts));
  const blocks = [];
  for (const group of GUARDRAIL_GROUP_ORDER) {
    const items = enabled.filter((c) => c.group === group);
    if (!items.length) continue;
    blocks.push(`${GROUP_HEADERS[group]}\n${items.map((c) => c.text).join('\n')}`);
  }
  return `DESIGN GUARDRAILS (apply to every visual decision)\n\n${blocks.join('\n\n')}`;
}

/** HOUSE_STYLE_ABSORB, rendered from the enabled absorb block(s). */
export function buildAbsorb(opts) {
  return CRITERIA.filter((c) => c.mode === 'absorb' && isEnabled(c, opts)).map((c) => c.text).join('\n\n');
}

/** HOUSE_STYLE_INVENT, rendered from the enabled invent block(s). */
export function buildInvent(opts) {
  return CRITERIA.filter((c) => c.mode === 'invent' && isEnabled(c, opts)).map((c) => c.text).join('\n\n');
}

/** Full HOUSE_STYLE = guardrails + absorb + invent. */
export function buildHouseStyle(opts) {
  return `${buildGuardrails(opts)}\n\n${buildAbsorb(opts)}\n\n${buildInvent(opts)}`;
}

// ── Backward-compatible exports (assembled from default state at load) ───────
// These freeze at import time. Toggle via `on` / env before boot (dev hot-reload
// re-evaluates), or call the build*() functions for a live custom-toggled render.
export const HOUSE_STYLE_GUARDRAILS = buildGuardrails();
export const HOUSE_STYLE_ABSORB = buildAbsorb();
export const HOUSE_STYLE_INVENT = buildInvent();
export const HOUSE_STYLE = buildHouseStyle();
