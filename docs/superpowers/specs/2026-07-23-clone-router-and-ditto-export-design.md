# Design — Clone router (precision classifier) + Ditto export-to-code + extract hardening

> Branch `feat/native-motion-editor`. Session 2026-07-23. Approved design; feeds an implementation plan.
> Prior context: `docs/superpowers/handoffs/2026-07-22-ditto-clone-cost-handoff.md`, `2026-07-22-skills-audit-housestyle-switchboard-handoff.md`.

## 1. Goal & framing

Two deliverables sharing ONE classifier, plus a bundled bug-fix.

**The product never pushes a paid path.** Some clones cost more credits than others (a faithful clone of a web-builder / heavy-motion site needs the AI reconstruct, which is billed). The classifier's job on the cost side is to **inform accurately**: when a site genuinely needs the expensive path, tell the user *"this is a web-builder site; a faithful clone needs the AI rebuild, which costs X credits"* and gate on the existing credits system (402 + buy). The win is ACCURACY — stop telling users they need to pay for sites the free photocopy already handles, and stop MISSING sites (GSAP-only) that the free photocopy silently breaks on.

- **Deliverable 1 (now)** — precision free-vs-paid classifier driving the cost-information message. No Ditto. Immediate accuracy/cost win.
- **Deliverable 2 (right after)** — Ditto self-hosted "Export to code" action, gated by the same classifier.
- **Hardening (bundled)** — fix the design.md extraction hang (loader stuck ~90%).

## 2. Current state (verified)

- `lib/snapshot.js` always captures a free photocopy; `detectAnimatedBuilder(page)` (line 317) scores signals (webflowIx3, lenis, framer, stickyHeavy, ix3Scroll → score ≥ 2) and sets `node.meta.animatedDetected`. The client offers the paid `reconstruct`.
- **Blind spot**: it does NOT read `window.gsap` / `ScrollTrigger` directly — a GSAP-only site scores 0 → misclassified static → broken photocopy, no cost message.
- **Coarse/binary**: no light-vs-heavy distinction; can false-positive on static sticky-heavy sites.
- `snapshot.js` **absolutizes** asset URLs (line 199) keeping them pointing at the LIVE origin — so live-service assets (icon servers) keep working in our node. This is why our photocopy beats Ditto on sanity.io (Ditto self-contains → 404s).
- Extract path: `POST /api/nodes/[id]/extract` → `runExtract` → `generateDesignMd` (`lib/design-md.js`). Synchronous POST, no SSE. `generateDesignMd` caps html at `MAX_HTML_CHARS`, then `callLLM` awaits the provider SDK **with no timeout**. Model routing: `UNCRAFT_EXTRACT_MODEL || UNCRAFT_LLM_MODEL || 'gemini-2.5-flash'`; `isAnthropic()` routes claude* to Anthropic, EVERYTHING ELSE to the Gemini SDK.

## 3. The shared classifier (`classifySite`)

New unit: `lib/design/classify-site.js`, function `classifySite(page)` run inside the existing Playwright capture (`page.evaluate`, zero extra page load). It supersedes `detectAnimatedBuilder`.

**Approach: measure the breakage directly, don't infer from libraries.** What matters is the objective outcome — does the free photocopy render the content, or does it freeze at `opacity:0`?

Signals:
- **Brokenness probe (primary, decides free-vs-paid)** — after the scroll-to-bottom settle snapshot.js already does, compute `hiddenContentRatio`: of content-bearing elements (headings, paragraphs, images, sections with text, ≥ some box area), the fraction still effectively invisible (computed `opacity` ≈ 0, `visibility:hidden`, or transformed fully off-screen) WHILE occupying a layout box. Focus on elements within the scrolled-through range (exclude legit conditional UI like modals by requiring real content + layout area). High ratio → photocopy broken → `heavy`.
- **Motion introspection (corroborating, + closes the GSAP blind spot)** — read `window.gsap` and `(window.ScrollTrigger||gsap.ScrollTrigger).getAll()`; flag `heavy` when any trigger has `pin:true` or a truthy `scrub`, plus sticky-stack (≥3 pinned/sticky sections), canvas/video scrubbing. Reveal-only (from/to without pin/scrub) = `light`.
- **Live-service dependency (signal for Ditto gate, NOT for free-vs-paid)** — icons/images served from a distinct runtime service (e.g. many same-page fetches to an icon-server-like endpoint), `<source>`/`src` swapped by JS after load. Our photocopy survives this (live URLs); Ditto breaks. Recorded as `liveServiceDep`.
- **Interactivity (signal, warning)** — forms/inputs/auth. Breaks in ANY static clone. Recorded as `interactive`.

Output (stored on `node.meta.classification`):
```
{ photocopyOk: boolean,        // false → cost-message/paid path
  category: 'static'|'light'|'heavy',
  dittoSafe: boolean,          // !heavy && !liveServiceDep
  liveServiceDep: boolean,
  interactive: boolean,
  confidence: 0..1,
  signals: { gsap, scrollTrigger:{pin,scrub}, lenis, framer, stickyHeavy, hiddenContentRatio, iconServer, ... } }
```

**Fail-safe (asymmetric cost):** low confidence or ambiguous light/heavy → classify `heavy` / `dittoSafe:false`. A false-heavy costs the user a few credits they might not have needed (recoverable, transparent); a false-light ships a broken node or a broken export (bad, silent). So bias to the safe side.

**Calibration gate:** the `hiddenContentRatio` threshold and the `stickyHeavy` count are calibrated against REAL photocopies of the anchor cases — langchain (light, photocopy should pass), sanity.io (light + liveServiceDep, photocopy passes / Ditto-unsafe), farmminerals (heavy, photocopy fails). Thresholds are constants at the top of the module, tuned by running the classifier on these three and eyeballing the captured node. This is the first implementation step (no point wiring downstream until the classifier is calibrated).

## 4. Deliverable 1 — precision free-vs-paid (INTEGRATE with the existing policy layer)

**Branch reality (verified 2026-07-23):** work happens on `main` (the trunk; house-style switchboard already consolidated as item 158). `main` ALREADY has the "capture free, pay only when the action needs it" architecture — do NOT rebuild it:
- `lib/reconstruction-policy.js`: `needsDeferredReconstruction(node)` = captured-URL site + `meta.animatedDetected` + not-already-Iter9. `shouldReconstructForAction`/`reconstructionReason` approve the paid reconstruct ONLY when a downstream action (edit / transform-target / motion-or-structure-bound source) genuinely needs the editable runtime.
- `lib/deferred-reconstruction.js`: `reconstructSiteNode` = the single billed iter9 upgrade path, fired only after the policy approves.
- `components/CanvasClient.jsx` + the run/reconstruct routes consume it.

So the policy, billing (`runBilledOperation`/402/buy), and cost-communication ALREADY EXIST and already match "never push paid." **Deliverable 1 = make their INPUT accurate**, nothing more:

1. Add `lib/design/classify-site.js` and swap `detectAnimatedBuilder` → `classifySite` in `snapshot.js`.
2. Derive `animatedDetected = !photocopyOk` (heavy → needs deferred reconstruct; static/light where the photocopy renders → stays free, policy never triggers). This is the accuracy win: light sites (langchain) stop being flagged as needing the paid path, and GSAP-only sites (currently missed, score 0) start being flagged correctly.
3. Persist the richer `classification` (category, dittoSafe, liveServiceDep, interactive, signals) on `node.meta` — consumed by Deliverable 2 and available to sharpen `reconstructionReason` messaging later.

Only the MOTION axis drives `photocopyOk`/`animatedDetected` (live-service and interactivity do NOT — our photocopy keeps live asset URLs, and interactivity breaks in every static clone equally). No policy/billing/UI change; the whole downstream chain keeps working, now fed a signal that is accurate instead of coarse.

## 5. Deliverable 2 — Ditto "Export to code" (gated)

- **Infra**: self-hosted Ditto service (their docker-compose or inline mode; npm-based, runs as a separate service from our bun app). A thin client `lib/ditto/export.js` calls it (URL → job → bundle).
- **Action**: an "Export to code" action on a site node → if `node.meta.classification.dittoSafe` → run Ditto → return the componentized project (download / zip). If NOT dittoSafe → explain why (heavy motion or live-service dependency) and offer nothing broken.
- **Gate precisely**: `dittoSafe = !heavy && !liveServiceDep`. `interactive` is a WARNING on the export ("forms won't be wired"), not a blocker. sanity.io fails (liveServiceDep), langchain passes.
- **Value**: componentized, maintainable code (the same.new pain), $0 AI. It does NOT touch the clone-into-canvas path — that stays ours (photocopy / reconstruct).
- Ditto clones from the URL (its own capture) for v1. Feeding it our edited DOM is a later idea (`content.ts` delta), out of scope here.

## 6. Hardening — the design.md extraction hang

Symptom: extracting a .md from farmminerals hung at ~90% (loader stuck). Cause: `callLLM` in `design-md.js` awaits the provider SDK with **no timeout**, and a global `UNCRAFT_LLM_MODEL` set to a non-Gemini/non-Anthropic model misroutes into the Gemini SDK with an invalid model. A stall then hangs the synchronous POST forever; the client's estimated loader sticks near the end.

Fixes:
1. **Timeout/abort** on the extract LLM call (both Anthropic stream and Gemini paths) — e.g. `AbortController` + a bounded deadline; on timeout throw a clean error so the route returns 502 `extract_failed` (loader shows an error state instead of hanging). This is the load-bearing fix.
2. **Model↔provider guard**: if the resolved model is neither Anthropic nor a Gemini model id, fail fast with a clear message (or pin the extract seam to its Gemini default regardless of the global override). Prevents the silent Gemini-SDK-with-gpt-5.5 misroute.
3. (Consider) surface `truncated` more clearly, and verify farmminerals' snapshot html isn't empty/degenerate feeding the extract.

## 7. Testing

- Unit: `classifySite` against fixture DOM/evaluate-mocks for each category + the fail-safe (ambiguous → heavy). Vitest, class-based SDK mocks (lesson 142).
- Calibration: a script running the classifier on the three anchor URLs, asserting category (langchain=light, sanity=light+liveServiceDep, farmminerals=heavy) — used to tune thresholds, run manually (real network).
- Hardening: a test that a stalled/aborted extract call returns a clean error (fake a hanging provider) rather than hanging; a test that a mismatched model id fails fast.
- Suite stays green (747 baseline on this branch).

## 8. Sequencing

1. Branch-health audit clears (whole stack functional, incl. iter9 + pre-4 demarcelizer) — prerequisite.
2. `classifySite` + calibrate on the 3 anchors.
3. Deliverable 1 wiring (swap detector, cost-info message, meta).
4. Hardening (extract timeout + model guard) — independent, can land alongside.
5. Deliverable 2 (Ditto self-host + export action) — needs the service up.
6. Smoke tests.

Every step Sol-validated (adversarial-review), per the owner's instruction.
