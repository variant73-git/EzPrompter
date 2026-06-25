# Layer B — Style Extraction from Images (Uncraft)

> Status: **draft / study** (2026-06-25). Not wired into the product yet. This is the
> rules document we will later turn into the vision-extraction prompt used on image/asset nodes.
> Pairs with `2026-06-25-layer-A-design-quality-house-style.md`.

## What this is

A sequenced set of rules the AI follows **whenever the input is an image or screenshot**
(an asset node), to turn that image into structured *design information* that the
transplant/generation engine can consume — without dragging in the parts of the image that
are not design (presentation backdrops, device frames, the room behind a laptop, etc.).

This is the **image-only layer**. It is conditional: it runs only on image input. The
general always-on quality layer is Layer A.

Output is a DESIGN.md-style brief, so the generation engine consumes it the same way
whether the source was a live URL, a screenshot, or a non-UI image.

## The one principle that makes it reliable: crop first, extract second

Telling a vision model to "ignore the background" is unreliable — it leaks anyway (that is
exactly why the green Dribbble backdrop got read as a brand color). So we do **two passes**:

1. **Pass 1 — locate.** The model only answers "where is the real layout?" and returns
   bounding boxes of the actual screen(s). We crop those regions physically and throw the
   rest away.
2. **Pass 2 — extract.** The model analyzes color/spacing/shape looking **only at the
   crops**. It never sees the backdrop, frame, or gutters.

Same lesson as the rasterization spike (iter-9): isolate the region, then analyze it.

---

## Stage 0 — Classify the image

Decide which of two modes applies. Never reject an image; everything is extractable.

- **LAYOUT mode** — the image contains a real UI screen (site / mobile app / tablet).
- **INSPIRATION mode** — the image is *not* a layout (photo, illustration, texture, object,
  3D render, game art). We still extract style, by abstracting patterns and inventing a UI.

### Cues that something IS a layout
- A bounded rectangular region whose aspect ratio reads as a screen:
  - ~16:9 / 16:10 / 4:3 wide → **desktop**
  - ~9:16 / 9:19.5 / tall → **mobile**
  - ~4:3 / 3:4 → **tablet**
- Consistent rounded corners on that region → it is a device screen.
- A **device frame** around it (phone bezel, notebook body, browser chrome) → the **screen
  inside** is the layout; the frame itself is not design info.
- Internal UI signals: status bar, nav bar, buttons, cards, text blocks, form fields.

### Cues that it is NOT a layout (→ INSPIRATION mode)
- No screen-like bounded region; the subject is an object, scene, texture, or artwork.
- It reads as a photograph or illustration rather than an interface.

Also record **platform** (desktop / mobile / tablet) from aspect ratio + chrome.

---

## Stage 1 — Isolate the layout(s) [LAYOUT mode only]

Run the two-pass crop. Discrimination signals that a region is **presentation, not design**
(discard it):

- Content **floating with a drop shadow** over a backdrop.
- **More than one screen** in the image (it is a presentation board).
- A **device frame** (keep only the inner screen).
- **Perspective / tilt / 3D rotation** on the screens.
- Large **uniform regions touching the image edges** with no content.

Special cases:
- **Multiple screens of the same product** → keep them all as a *set* and merge their
  tokens. More screens that agree = higher confidence (if the lime accent shows up on 9
  screens, it is definitely THE accent, not an accident).
- **Device photo (laptop/phone with a screen visible)** → the layout is the image *inside*
  the screen. The device body and the environment behind it are discarded.

---

## Stage 2 — Extract tokens

Both modes emit the same token list; what differs is the source and the confidence.

### LAYOUT mode (read from the cropped pixels)
- **Tone sentence first** (one line): the vibe before the details. *(Aura's "Overview" trick.)*
- **Color — by ROLE, not by pixel area.** A surface can be small in visible pixels if
  elements cover most of it, so do not equate "largest flat area" with "surface". Identify by
  function:
  - **surface** = the plane the content sits *on top of* (the UI canvas), even when little of
    it is visible.
  - **neutrals** = text, hairlines, muted fills.
  - **accent** = small, saturated, repeated across screens.
  - separate **brand** colors from **neutral** colors.
  - sample from UI pixels only (never the discarded backdrop).
- **Typography** — family class (serif vs sans, geometric vs humanist), weight contrast,
  scale/hierarchy, case. Approximate is fine.
- **Shape / radius** — the radius *scale* (cards vs buttons vs pills/chips often differ), and
  the character (soft / large-radius vs sharp).
- **Spacing** — express as **density** (airy / balanced / dense) plus approximate rhythm. No
  false-precision px from an image.
- **Elevation** — shadows and borders; note that shadows are tinted to the surface hue.
- **Inner UI background** — the canvas color of the *screen* (explicitly NOT the image
  backdrop discarded in Stage 1; name them separately to avoid confusion).

#### Worked example — the Dribbble shot (Test 1), corrected by the user
Role mapping (note how this is by *role*, not by visible area):
- **background** = greige / grayish-green
- **primary surface** = white (the containers/cards)
- **secondary** = dark grayish-green
- **accent** = lime green
- **type** = black

This is the extracted *core*. The generator is **not limited to these** — it may creatively
expand to a few adjacent colors in small measure where they make sense (Layer A's color
strategy governs how far). The point of Layer B is to nail the core roles; Layer A decides the
tasteful expansion.

### INSPIRATION mode (image is not a layout — abstract, then invent)
Read the *vibe*, then translate it into UI decisions and clearly flag it as invented
(creative, lower fidelity):
- **Style family** (skeuomorphic / flat / brutalist / editorial / glassy / claymorphic / …).
- **Materials & textures** (brushed metal, glass, paint, grain, wear, bevels).
- **Mood / tone** (industrial, post-apocalyptic, playful, luxury, clinical).
- **Palette** sampled from the image.
- **Illustration style** (painterly, line, 3D render, pixel).

Then map vibe → interface. Example (the sci-fi panel test below):
*"skeuomorphic industrial metal + glowing cyan controls + worn gold trim + a red lens"* →
a dark metallic UI, beveled/inset tactile controls, a cyan accent on near-black steel
surfaces, sharp/chamfered corners, a condensed industrial sans, weighty buttons with inner
shadow, an alert/status red used sparingly.

---

## Stage 3 — Chat guardrails (when to ask before delivering)

Honor the user's prompt first. Only ask when intent is genuinely missing or ambiguous.

- **Non-layout image + null/poor prompt** → ask before delivering:
  > "This doesn't look like a screen layout, but I can invent a UI inspired by its style
  > (skeuomorphic, industrial, cyan accent on dark metal). Want to guide me, or should I go
  > ahead?"
- **Ambiguity — a device photo could be either a layout-source or a photo to place** → ask:
  > "Do you want me to (a) extract the design inside it and apply it to the site, or
  > (b) place this photo somewhere in the page?"
- **Prompt already states intent** → skip the question and proceed (momentum).

---

## Stage 4 — Output shape

Emit the DESIGN.md-style brief plus two meta fields so the generation knows how much to trust it:
- `mode: layout | inspiration`
- `confidence: high | medium | low` (layout-single-clean = high; merged-multi = high;
  inspiration-invented = low)

---

## How Layer B relates to Layer A

- **Layer B** answers *"what design to reproduce"* — the facts of this specific image.
- **Layer A** answers *"how to render it with taste"* — the always-on house style.
- In the node graph: Layer B's brief becomes a **source node** feeding the chain; Layer A is
  a **fixed directive** on the generation step. One is content, the other is judgment.

## Open questions (for later)
- Pass-1 cropping: do it in-product (canvas crop, like the rasterization path) or ask the
  vision model for boxes and crop server-side?
- Merge strategy for multi-screen sets: simple union of tokens vs weighted by frequency.
- Where Layer B runs: at asset-node ingest, or lazily when an edge from the asset is run.
