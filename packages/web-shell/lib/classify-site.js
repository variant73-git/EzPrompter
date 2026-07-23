/**
 * classify-site.js — decide whether the FREE static photocopy faithfully renders
 * a captured site, or whether it's a heavy/animated site that needs the paid iter9
 * reconstruct. Supersedes the coarse binary `detectAnimatedBuilder` in snapshot.js.
 *
 * DESIGN (from the 2026-07-23 Claude + Codex/Sol adversarial review — both models
 * converged on these points, so they are load-bearing):
 *
 *  1. Measure the ARTIFACT, not the live DOM. The old idea — probe the live page
 *     for opacity:0 content — is biased: the live page has JS running (reveals
 *     already fired), but the shipped photocopy has scripts STRIPPED. So the honest
 *     signal is a DIFF: the visible text of the JS-dead stripped artifact vs the
 *     visible text of the source. Content the source shows but the artifact hides
 *     (a reveal stuck at opacity:0 that force-show CSS didn't recover) is the exact
 *     failure this exists to catch.
 *
 *  2. The diff is robust to conditional UI. A carousel slide / inactive tab / modal
 *     hidden in BOTH source and artifact is in NEITHER visible-text set, so it does
 *     not move the coverage ratio. That is why an absolute "count hidden elements"
 *     probe (which flags all conditional UI) was wrong and a source-vs-artifact
 *     diff is right.
 *
 *  3. Motion introspection is POSITIVE-ONLY. `window.gsap` misses bundled/module-
 *     scoped GSAP, so its ABSENCE proves nothing (never a negative test). Presence
 *     of a pinned/scrubbed ScrollTrigger or a sticky-stack is strong corroboration
 *     of "heavy"; presence of GSAP alone just distinguishes light from static.
 *
 *  4. Fail-safe = `unknown`, not "coerce to heavy". The free artifact already
 *     exists and is inspectable, so low confidence should ship the free preview
 *     WITH a hedge, not assert "you must pay". Only the Ditto export gate fails
 *     closed on `unknown`.
 *
 * This module is PURE decision logic + two browser-side extractors. The browser
 * I/O (render the stripped artifact in a throwaway JS-disabled page, run the
 * extractors) lives in snapshot.js, which calls classify() with the two texts.
 *
 * Thresholds are constants here; calibrate against real captures — langchain
 * (light, photocopy passes), sanity.io (light + live-service, photocopy passes),
 * farmminerals (heavy, photocopy fails) — via scripts/, then report false-paid vs
 * broken-free rates. The three fixtures are smoke regressions, NOT the calibration
 * set (that needs diverse conditional-UI + bundled-GSAP cases).
 */

// Coverage = fraction of the source's visible words that also appear visible in
// the artifact. >= OK → faithful; < BROKEN → broken; between → unknown.
export const COVERAGE_OK = 0.90;
export const COVERAGE_BROKEN = 0.70;

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
}

// Asymmetric: how much of the SOURCE's visible vocabulary survived into the
// artifact. Missing source words (content the copy failed to show) drop coverage.
export function textCoverage(sourceText, artifactText) {
  const src = tokenize(sourceText);
  if (src.size === 0) return 1; // nothing to lose → treat as faithful
  const art = tokenize(artifactText);
  let hit = 0;
  for (const w of src) if (art.has(w)) hit += 1;
  return hit / src.size;
}

/**
 * @param {object} in
 * @param {string} in.sourceText   visible text of the live source (JS alive)
 * @param {string} in.artifactText visible text of the stripped photocopy (JS dead)
 * @param {object} [in.motion]     { gsap, scrollTriggerCount, pinOrScrub, stickyStack, hasMotion }
 * @returns {{
 *   photocopyOk: boolean|null,   // true=free ok, false=needs paid, null=unknown
 *   category: 'static'|'light'|'heavy'|'unknown',
 *   confidence: number,          // 0..1
 *   coverage: number,
 *   signals: object
 * }}
 */
export function classify({ sourceText, artifactText, motion = {} } = {}) {
  const coverage = textCoverage(sourceText, artifactText);
  const heavyMotion = !!(motion.pinOrScrub || motion.stickyStack);
  const signals = { coverage, ...motion };

  // Heavy: measured breakage OR a scroll-driven pin/scrub the static copy can't run.
  if (heavyMotion || coverage < COVERAGE_BROKEN) {
    const covConf = coverage < COVERAGE_BROKEN ? (COVERAGE_BROKEN - coverage) / COVERAGE_BROKEN : 0;
    const confidence = Math.max(heavyMotion ? 0.85 : 0, Math.min(1, covConf));
    return { photocopyOk: false, category: 'heavy', confidence, coverage, signals };
  }

  // Faithful: the artifact shows essentially all the source's visible text.
  if (coverage >= COVERAGE_OK) {
    const category = motion.hasMotion ? 'light' : 'static';
    const confidence = Math.min(1, (coverage - COVERAGE_OK) / (1 - COVERAGE_OK) * 0.5 + 0.5);
    return { photocopyOk: true, category, confidence, coverage, signals };
  }

  // Uncertain: ship the free copy with a hedge, do not assert paid. Ditto gate
  // reads this as fail-closed separately.
  const confidence = 1 - (coverage - COVERAGE_BROKEN) / (COVERAGE_OK - COVERAGE_BROKEN);
  return { photocopyOk: null, category: 'unknown', confidence: Math.max(0, Math.min(1, confidence)), coverage, signals };
}

// Legacy bridge: the existing reconstruction-policy.js reads node.meta.animatedDetected
// as the paid-upgrade trigger. Only a CONFIRMED heavy site flags it — `unknown`
// ships free (with the hedge flag) so we never re-create the false paywall.
export function toMeta(result) {
  return {
    animatedDetected: result.photocopyOk === false,
    photocopyUncertain: result.photocopyOk === null,
    classification: {
      category: result.category,
      photocopyOk: result.photocopyOk,
      confidence: result.confidence,
      coverage: result.coverage,
      signals: result.signals,
    },
  };
}

// ── Browser-side extractors (run via page.evaluate on source AND artifact) ──

// Visible text: skip any element hidden by its own display/visibility/opacity, so
// a reveal wrapper stuck at opacity:0 in the JS-dead artifact contributes nothing
// (while the JS-alive source, at opacity:1, does). Same fn on both sides → diff.
export function extractVisibleText() {
  const out = [];
  const walk = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) return;
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const t = node.textContent.trim();
        if (t) out.push(t);
      } else if (node.nodeType === 1) {
        walk(node);
      }
    }
  };
  if (document.body) walk(document.body);
  return out.join(' ');
}

// Motion introspection — POSITIVE-ONLY (absence proves nothing; bundled GSAP is
// invisible on window). Reads real ScrollTrigger instances for pin/scrub.
export function extractMotion() {
  const g = typeof window !== 'undefined' ? window.gsap : undefined;
  const ST = (typeof window !== 'undefined' && window.ScrollTrigger) || (g && g.ScrollTrigger);
  let scrollTriggerCount = 0;
  let pinOrScrub = false;
  try {
    if (ST && typeof ST.getAll === 'function') {
      const all = ST.getAll();
      scrollTriggerCount = all.length;
      pinOrScrub = all.some((t) => t.pin || (t.vars && (t.vars.pin || t.vars.scrub)));
    }
  } catch { /* introspection best-effort */ }
  const stickyStack =
    document.querySelectorAll('[style*="position: sticky"], [style*="position:sticky"]').length >= 3;
  return {
    gsap: !!g,
    scrollTriggerCount,
    pinOrScrub,
    stickyStack,
    hasMotion: !!g || scrollTriggerCount > 0 || stickyStack,
  };
}
