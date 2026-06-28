# Anti-Slop Site Generation — Training Path

**Date:** 2026-06-28 · **Branch:** feat/canvas · **Status:** plan

## Thesis (the moat)

The frontier tools ship generic AI slop because they optimize for *"works"*, not for *taste*. The defensible asset is **owning two things**:

1. **The criteria** of good taste — codified, machine-checkable (bans + positive style signatures).
2. **A dataset** that encodes those criteria.

Whoever curates for taste wins, because everyone has access to the same base models and the same raw web data — almost nobody filters it for taste.

## The "two birds" spine

Clone-from-image, style-transfer, and from-scratch generation **all bottleneck on the same stage**: turning a visual/brief intent into a *tasteful, structured* design (what's a pill, what's the palette, what's the layout rhythm, what's slop). Improve that one stage and all three lift together.

So the whole path hangs on ONE artifact — a **design-criteria rubric** — reused by every lever:

| Lever | How it uses the rubric |
|---|---|
| Few-shot (1) | rubric + gold exemplars go into the prompt |
| Eval (2) | rubric becomes the LLM-judge assertions |
| Ground-truth (3) | the deterministic checks (sample real colour, crop real images, measure proportions) |
| LoRA (4) | rubric defines the **labels / curation standard** for the dataset; the eval is the **reward signal** |

Existing foundations we build on: `lib/design/house-style.js` (criteria seed), `evals/promptfooconfig.yaml` + `.github/workflows/agent-evals.yml` (eval infra), `reconstruct.js`/`snapshot.js` (playwright clip rasterization).

---

## Stage 1 — inference-time levers (NOW, no GPU)

### 0. The rubric spine (do first)
Extend `house-style.js` into a structured rubric with two halves:
- **Bans (anti-slop):** the failure modes already named — invented enclosing frame, pill↔circle confusion, white vs off-white collapse, wrong nav type (loose vs encapsulated), plus the existing slop tells (generic gradients, Inter/Bricolage, decorative keylines, etc.).
- **Positive signatures:** the *distinctive* look the user wants nobody else to deliver. **(Needs the user's input — they said they know exactly what.)**

This file is the single source of truth feeding everything below.

### 1. Few-shot exemplars
- Curate 3–6 **gold** `(brief|screenshot → HTML)` pairs that embody the signature style. Store in `lib/design/exemplars/`.
- Inject the 1–2 most relevant into the clone + generation prompts.
- **Needs:** the user's hand-picked gold references (3–5 sites/screenshots they consider the bar).

### 2. Eval harness (extend the existing promptfoo)
- New design-quality eval set: inputs = briefs/screenshots; assertions = LLM-judge each output against the rubric (no spurious frame, pill-vs-circle correct, exact whites, right nav type, signature present, no slop tells).
- Becomes the **regression gate** + the day-to-day **iteration signal**. Every new failure the user spots becomes a new assertion.

### 3. Ground-truth for clones (kill error classes deterministically)
- **Image crop-and-embed** (the hero airplane): the clone emits region bboxes (`%` coords); the server loads the source screenshot in playwright and `screenshot({clip})`s each region → embeds the **real pixels** as `<img>`. Pixel-identical heroes/logos/photos.
- **Colour sampling**: sample median hex per region from the screenshot pixels instead of letting the model guess (`snapshot.js` already has a zlib PNG decoder to reuse).

---

## Stage 2 — the dataset flywheel

Every clone/generation + its eval score + (optionally) the user's edits = a **labeled example**. Capture them:

```
{ input: brief|screenshotDataUrl, output: html, criteriaScores: {...}, accepted: bool, edits?: diff }
```

This compounds into a proprietary, taste-filtered dataset — the thing the LoRA trains on. The eval rubric is what turns raw outputs into *labeled* ones.

---

## Stage 3 — open VLM + LoRA (the real training)

**Why not fine-tune Claude/GPT:** frontier vision models are closed to this kind of fine-tuning. The "add more images like a face LoRA" idea only applies to **open** models.

**Base model candidates** (open, fine-tunable, strong vision→code):
- **Qwen2.5-VL (7B / 72B)** — current sweet spot: strong OCR + layout + code generation. Start here.
- Llama-3.2-Vision (11B / 90B), Pixtral-12B, InternVL2.5 — alternates to A/B.

**Task framing:** one or two LoRAs — (a) `screenshot → HTML` (clone), (b) `brief → HTML` (generation). Likely multi-task on one adapter to share the taste.

**Tooling:** QLoRA via **unsloth** (fast, single-GPU) or **axolotl** (config-driven) on HF PEFT. QLoRA fits a 7–12B model on a single 24–48 GB GPU.

**Data:** the Stage-2 flywheel **+** public sets (WebSight, Design2Code) **filtered through the rubric** (drop the slop). *The filtering is the edge.*

**Compute/cost:** rented A100/H100 (RunPod / Lambda / Modal). A 7B QLoRA run ≈ $50–300 depending on data size. Iterative, cheap to experiment.

**Reward:** the Stage-1 eval rubric is the offline metric. Optional later: DPO/RLAIF on paired (tasteful vs slop) outputs judged by the rubric.

**Serving:** the tuned open model runs on our infra (vLLM) — also collapses the per-call frontier cost at scale (ties to the cost memos).

---

## Sequencing

1. **Now:** rubric spine → image-crop ground-truth → eval scaffold.
2. **Weeks:** few-shot exemplars (needs the gold set) + dataset capture wiring.
3. **Month+:** LoRA experiments once the dataset has volume.

## What we need from the user to seed it

1. **Gold references** — 3–5 sites/screenshots that ARE the taste bar.
2. **The signature** — the explicit bans + positive rules they "know exactly" (we codify into the rubric).
3. A first LoRA budget/compute decision when we reach Stage 3.
