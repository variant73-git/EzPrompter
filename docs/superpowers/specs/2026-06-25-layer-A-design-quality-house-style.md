# Layer A — Design Quality House Style (Uncraft)

> Status: **draft / study** (2026-06-25). Not wired into the product yet. This is the distilled
> "good taste" directive we will later inject into the generation prompt (run-flow / reconstruct),
> so every site Uncraft produces is rendered with craft. Pairs with
> `2026-06-25-layer-B-style-extraction-from-images.md`.

## What this is

A compact, framework-agnostic set of design directives, distilled from three UI/UX skills:
- **emil-design-eng** — motion & micro-interaction craft (easing, timing, perceived performance).
- **taste-skill** — anti-slop bias correction (typography, color, layout reflexes).
- **impeccable** — high-altitude principles + absolute bans + the AI-slop test.

It is the **always-on, general layer**: it applies to every generation regardless of input
(prompt, URL, or image). It says *how to render well*; Layer B says *what to render*.

Written as design rules (not React/Tailwind code) because Uncraft emits HTML/CSS. Keep it
tight — it rides in the prompt on every generation, so signal density matters.

> Note on Uncraft's own editor features: gradient-text and glassmorphism exist as *user-facing
> tools* in the editor. The bans below govern what the *generator* produces **by default** —
> they are not a contradiction.

---

## 1. Register & tone (decide before generating)
- Classify the job: **brand** (landing, marketing, campaign, portfolio — design IS the product)
  or **product** (app UI, dashboard, tool — design SERVES the product). First cue in the
  request wins.
- **Theme is never a default.** Don't go dark "because tools look cool dark," or light "to be
  safe." Write one sentence of physical scene (who uses this, where, what light, what mood). If
  the sentence doesn't force light-vs-dark, it isn't concrete enough yet.
- Lead the output with a one-line **tone statement** — gives the rest of the work a center.

## 2. Color
- **Never `#000` or `#fff`.** Tint every neutral slightly toward the brand hue.
- **Pick a color strategy before colors** (commitment axis):
  - *Restrained* — tinted neutrals + one accent ≤10% (product default).
  - *Committed* — one saturated color carries 30–60% of the surface (identity-driven brand).
  - *Full palette* — 3–4 named roles, each used deliberately (campaigns, data viz).
  - *Drenched* — the surface IS the color (heroes, campaign pages).
  - Don't collapse everything to Restrained by reflex.
- **No "AI purple/blue."** No neon gradients, no purple button glows. Neutral bases (zinc/slate)
  + a single high-contrast accent; keep accent saturation moderate (≲80%).
- **One palette per project.** Don't drift between warm and cool grays mid-design.

## 3. Typography
- Hierarchy through **scale + weight contrast** (≥1.25 ratio between steps); avoid flat scales.
  Control hierarchy with weight and color, not just enormous size.
- Body line length **65–75ch**; relaxed leading.
- **Avoid AI-tell typefaces.** Inter, Bricolage Grotesque, and the rest of the AI-default set
  read as "made by a model." Reach for less-saturated character faces; **serif only for
  editorial/creative**, never on clean dashboards. *(Never a JetBrains-family font unless the
  user names it.)*
- **Avoid monospace fonts** — even for dense numbers. Use the body sans with tabular figures
  (`font-variant-numeric: tabular-nums`) and weight instead of a mono. *(User override of the
  source skill, which recommended mono for data.)*
- **Eyebrows sparingly.** Small all-caps labels above headings are overused. When used, keep
  **default tracking** — never wider-than-default letter-spacing on an eyebrow.

## 4. Layout
- **Anti-center reflex.** Centered hero/H1 over a dark image is the default trap. Prefer split
  (50/50), left-content/right-asset, or asymmetric whitespace.
- **Vary spacing for rhythm** — identical padding everywhere is monotony.
- **Cards are the lazy answer.** Use one only when elevation genuinely communicates hierarchy.
  **Nested cards are always wrong.** Don't wrap everything in a container.
- Group with negative space, hairlines (`border-t`, `divide-y`) before reaching for boxes.
- Use CSS **Grid** for structure over fragile flex percentage math.
- Full-height sections: `min-h-[100dvh]`, never `h-screen` (mobile jump bug).

## 5. Motion (Emil's craft)
- **Animate only `transform` and `opacity`** (GPU; skips layout/paint). Never animate width,
  height, top, left, margin, padding.
- **Custom easing curves** — built-in CSS easings are too weak. Use strong ease-out for
  enter/exit (`cubic-bezier(0.23, 1, 0.32, 1)`). **Never `ease-in`** on UI (feels sluggish).
- **Keep UI animations under 300ms** (150–250ms typical). Faster *feels* faster.
- **Never animate from `scale(0)`** — nothing appears from nothing. Start `scale(0.95)` + opacity.
- **Pressable elements** get `transform: scale(0.97)` on `:active` for tactile feedback.
- **Don't animate high-frequency actions** (keyboard shortcuts, command palette). No animation.
- Popovers scale from their **trigger** (origin-aware); modals stay centered.
- **Springs** for drag/alive/interruptible interactions; keep bounce subtle (0.1–0.3) or none.
- Gate hover effects behind `@media (hover: hover) and (pointer: fine)`.
- Respect `prefers-reduced-motion` (keep opacity/color, drop movement).
- Stagger list/grid entrances 30–80ms; stagger is decorative, never blocks interaction.

## 6. Materiality & depth
- Shadows **tinted to the background hue**, soft and wide, not hard black.
- **No neon / outer glows.** Use inner borders or subtle tinted shadows for elevation.
- Glassmorphism only when rare and purposeful — if used, add a 1px inner border +
  subtle inner shadow for real edge refraction (not bare `backdrop-blur`).

## 7. Absolute bans (match-and-refuse — rewrite the element)
- **Side-stripe borders** (>1px colored `border-left/right` accents on cards/alerts).
- **Gradient text** (`background-clip:text` + gradient) for headers.
- **Glassmorphism as default.**
- **The hero-metric template** (big number / small label / supporting stats / gradient accent).
- **Identical card grids** (3 equal icon+heading+text cards). Use zig-zag, asymmetric, or scroll.
- **Modal as first thought** — exhaust inline / progressive alternatives.
- **Em dashes** in copy. Use commas, colons, semicolons, periods, parentheses. Also not `--`.
- **Custom mouse cursors.**
- **Decorative hairline keylines.** A thin contrasting/metallic line tracing a container's
  rounded corners (inset double-outline / ornamental corner frame) — the detail in the user's
  attached reference. *(Naming/scope to confirm with user.)*

## 8. Interactive states (LLMs ship only the happy path — don't)
- **Loading:** skeletal loaders matching the real layout, not generic spinners.
- **Empty states:** composed, showing how to populate.
- **Error states:** inline, clear (forms: label above, error below).
- **Tactile feedback:** `:active` press response on every actionable element.

## 9. Content realism (the "Jane Doe" effect)
- No "John Doe / Sarah Chan." Use believable, specific names.
- No egg/Lucide-user avatars. Use believable photo placeholders (`picsum.photos/seed/...`),
  never bare Unsplash links.
- No round fake numbers (`99.99%`, `50%`). Use organic data (`47.2%`).
- No "Acme/Nexus/SmartFlow" brand names; no "Elevate/Seamless/Unleash/Next-Gen" filler copy.
- **No emojis** in product UI — use clean icons or SVG primitives.

## 10. The AI-slop test (final filter — run at two altitudes)
- **First-order:** if someone could guess theme + palette from the *category* alone
  ("observability → dark blue", "finance → navy + gold", "crypto → neon on black"), it's the
  first training reflex. Rework the scene sentence + color strategy until it isn't obvious.
- **Second-order:** if someone could guess the aesthetic from category + anti-reference
  ("fintech that's not navy/gold → terminal dark mode"), it's the trap one tier deeper. Rework
  until *both* are non-obvious.
- Blunt version: if anyone could look at it and say "AI made that" with no doubt, it failed.

---

## Hook: user's own anti-slop recipe (refinement layer)
The user has a personal anti-slop recipe (fonts to always avoid, typography patterns, etc.).
Layer A already absorbs strong anti-slop rules from taste-skill + impeccable. Treat the user's
recipe as a **thin override layer on top** — applied only where the distilled rules don't
already cover it, so we don't duplicate or contradict. To be captured when we operationalize this.

## Cost / wiring notes (for later)
- This rides in the generation prompt on every run → keep it lean; consider a short "core"
  version (sections 1–4 + 7 + 10) for cheap models and the full version for premium tiers.
- Inject at the run-flow / reconstruct system-prompt seam, not per-tool.
- Validate before embedding: generate the same site with and without Layer A, compare side by
  side (the step-3 test from our plan), and only then lock it in.
