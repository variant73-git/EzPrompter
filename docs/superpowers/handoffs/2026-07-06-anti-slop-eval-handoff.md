# Handoff: Real Eval for the Generation Pipeline (anti-slop)

> **For the next session.** Goal: turn the one-off visual validation of the anti-slop
> layers into a REPEATABLE, SCORED evaluation harness that runs the real generation
> pipeline against a fixed case set and tells us — per prompt/model change — what got
> better and what silently broke.
>
> **First action of the session: ask the user for (a) gold reference outputs and
> (b) their explicit anti-slop signature.** The rubric is built from those two things
> and nothing else can substitute for them. Do not invent the rubric from taste
> priors — the whole point (see the training-path doc) is that the MOAT is the user's
> criteria, not a generic "good design" checklist.

## Why this exists

- The anti-slop system was validated ONCE, visually, with a 3-way screenshot test
  (`docs/superpowers/specs/2026-06-25-anti-slop-test/`): bare → right-palette-but-slop
  → palette+craft. Proof of concept, not a regression net.
- Hard lesson already paid for (CLAUDE.md items 143/145, memo
  `checkpoint_2026-06-28_canvas-clone-transplant`): **prompt stacking has NEGATIVE
  returns** — the model ignores explicit instructions past a point, and a tweak that
  fixes one case silently regresses another. The wins that actually held came from
  (1) the right model per seam and (2) DETERMINISTIC ground truth (measured pixels,
  captured DOM values) — never from more prompt text. An eval is the only way to see
  those trade-offs instead of guessing.
- CI infra is already installed and DORMANT by design (memo
  `launch_signal_eval_merge_gate`): Promptfoo 0.121.x, `evals/` dir,
  `bun run evals` (= `node evals/gen-prompt.mjs && promptfoo eval -c
  evals/promptfooconfig.yaml`), `bun run evals:view`. At launch signal it becomes a
  merge blocker. This session populates it with GENERATION cases.

## What "the pipeline" means here (the seams to exercise)

All in `packages/web-shell/lib/`:

| Seam | Entry | What it does | Anti-slop pieces inside |
|---|---|---|---|
| Compose / transplant | `run-flow.js` `runCompose({target, sources})` | LLM composes target node from sources (prompt/md/image/site) | `COMPOSE_SYSTEM` + `HOUSE_STYLE` (from `lib/design/house-style.js`), Layer B brief via `lib/design/style-extract.js`, image kept alongside brief, deterministic palette from `lib/design/sample-palette.js` |
| Clone | right-click → clone website path (`lib/extract-llm.js` + `lib/clone-images.js`) | asset image → site | GPT-5.5 default (`UNCRAFT_CLONE_MODEL`), "ISOLATE THE REAL SITE" checklist, measured palette, crop-and-embed real images |
| Restyle/reskin | `lib/demarcelize.js` | style extract/inject/reskin | `HOUSE_STYLE_ABSORB`, ground truths (font-style, elevation) |
| Edit via agent | `EDIT_SITE_SYSTEM` in `lib/agent/prompts.js` | chat-driven site edits | `HOUSE_STYLE_GUARDRAILS` only |

Deterministic ground-truth helpers that double as ASSERTION material:
`lib/design/sample-palette.js` (real-pixel palette, role-labelled bg/accent, exact
per-cluster averages — `console.warn` on sampler failure distinguishes env-fail from
model-drift), typography/elevation probes in the style-extract path.

## What to build (proposed shape — validate with the user before executing)

1. **Case fixtures** (`evals/cases/`): 5–10 frozen inputs that represent real usage:
   - 2–3 image→site transplants (a Dribbble-style mockup, a photo-heavy brand shot,
     one NON-UI "inspiration" image — the adaptive path).
   - 2–3 clones (one with a presentation backdrop to test ISOLATE, one long page).
   - 1–2 pure composes (prompt→site, prompt+md→site).
   - Frozen = image files + input HTML/md committed to the repo (small ones) so every
     run sees identical inputs.
2. **Runner**: a script that calls the REAL seams (not mocked) with a chosen model,
   writes outputs (HTML + a rendered screenshot via `lib/site-screenshot.js`
   `renderHtmlScreenshot(html, { baseUrl })` — remember the `<base href>` lesson) into
   `evals/out/<run-id>/`.
3. **Deterministic assertions** (cheap, no LLM, run first):
   - Palette match: sampled palette hexes (sample-palette on the source image) appear
     in the output CSS within tolerance; accent used on interactive elements.
   - No hallucinated italic (`font-style: italic` count when source ground truth says 0).
   - Elevation respected (shadow/border counts vs ground truth report).
   - Banned faces: JetBrains anything, Inter, Bricolage, other AI-tell fonts
     (list lives in `lib/design/house-style.js` — assert none appear in font stacks).
   - No decorative keyline (thin metallic border tracing rounded corners) — hard to
     assert statically; candidate for the visual judge instead.
   - Valid HTML (parses, no truncation markers), all `<img src>` resolvable.
4. **Rubric judge** (LLM-as-judge, vision, on the rendered screenshot):
   - Rubric = the user's anti-slop signature, encoded as INDIVIDUALLY SCORED checks
     (not one holistic grade — per-check scores make regressions localizable).
   - Judge model: something cheap-capable with vision; run each check 2–3× and
     majority-vote (single-shot judges are noisy).
   - The SAME rubric later feeds few-shot exemplars and LoRA labels (training-path
     doc: `docs/superpowers/plans/2026-06-28-anti-slop-generation-training-path.md`) —
     write it as reusable data (YAML/JSON), not prose inside a prompt.
5. **Scoring + trend**: per-case, per-check scores into a JSON per run; a tiny
   comparison view (promptfoo's own UI covers most of this — prefer wiring into
   `evals/promptfooconfig.yaml` over building custom UI).
6. **Cost control**: each full run = real API spend (generation + judges). Print an
   estimated cost before running; support `--only <case>`; default the judge to the
   cheapest capable vision model. Gemini key was historically prepaid-depleted
   (memo `gemini_billing_failover_2026-06-08`) — check OpenAI/Anthropic balances
   before the session; generation model for clones/transplants is GPT-5.5 by default.

## Session-start checklist

1. Ask the user for **gold refs** (3–5 outputs they consider excellent — links,
   screenshots, or past node outputs) and the **anti-slop signature** (their explicit
   list; known entries so far: decorative keyline on rounded corners, gratuitous
   italic, monospace-for-numbers instead of tabular-nums, eyebrow-with-wide-tracking,
   Inter/Bricolage/JetBrains-family faces, fake trust badges — confirm and extend).
2. Confirm budget per run and which API keys are funded TODAY.
3. `cd packages/web-shell && bun run dev` (port 3030) + `.env.local` keys present.
4. Read: CLAUDE.md items 142, 143, 145, 146 · specs
   `2026-06-25-layer-A…/layer-B…` · the 3-way test dir · the training-path plan.

## Rules of the house (do not relearn these the hard way)

- Plain JavaScript, bun, vitest (suite must stay green; 561 baseline as of 2026-07-06).
- Prompts are server-side and hot-reload; CLIENT bundle in a long-open tab goes stale —
  hard-refresh before judging by eye.
- Do not "fix" a bad eval case by stacking prompt instructions — bring deterministic
  ground truth into the input instead (the 143/145 lesson).
- User-facing product text in English; conversation in PT.
- `.firecrawl/variant/` stays untracked (pseudo-secrets).
- Never stage with `git add -A`.
