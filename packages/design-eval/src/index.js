/**
 * @uncraft/design-eval — THE public surface. Import this, never the files behind it.
 *
 * WHY IT EXISTS: on 2026-08-12 the internals were replaced (a string reader became
 * an in-browser observer) and a consumer in another project broke mid-session with
 * ERR_MODULE_NOT_FOUND. Nothing about its USE had changed — it had reached past the
 * front door, because there wasn't one. This is the front door.
 *
 * WHAT THIS IS: a DETECTOR for the house-style build instructions
 * (packages/web-shell/lib/design/house-style.js). It reports instructions the page
 * did not follow. It is not a grader: there is no score, no threshold, no weights.
 *
 * TYPICAL USE — the checks read a RENDERED page, so they need a Playwright page:
 *
 *   import { chromium } from 'playwright-core';
 *   import { observeHtml, judgeObservations, checkArtifactIntegrity } from '@uncraft/design-eval';
 *
 *   const browser = await chromium.launch();
 *   const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
 *   const observations = await observeHtml(page, html);   // string artifact
 *   // …or, for an EXTERNAL stylesheet, navigate for real and skip setContent:
 *   //   await page.goto(url); const out = await runDesignEvalOnPage(page, ground, { source });
 *   const verdict = judgeObservations(observations, {
 *     palette: ['#c8ff3d'],   // measured from the source (optional)
 *     italicCount: 0,         // elements rendered italic in the source
 *     monoInSource: false,
 *     explicitFonts: [],      // faces the user explicitly asked for
 *   });
 *   const integrity = checkArtifactIntegrity(html); // source-level, no browser
 *
 * WHAT COMES BACK — read these three, and note that none of them says "passed":
 *   verdict.violations  — found something. Strong evidence; act on it.
 *   verdict.notDetected — this reader found nothing. NOT a clean bill of health.
 *   verdict.unjudged    — the input it needed was missing (no ground truth, or CSS
 *                         it could not read). Never counted as either.
 *   Each entry in verdict.results carries the same thing as `status`.
 *
 * Each result may carry `remedy`: 'substitute' (a mechanical fix exists — swap the
 * face) or 'forbidden' (absolute rule, no substitution offered). An explicit user
 * request beats both: an instruction the user overrode was never a violation.
 */

export { runDesignEval, runDesignEvalOnPage } from './run.js';
// ⚠️ `observeInPage` runs INSIDE the page. Call it through `page.evaluate(observeInPage)`,
// never directly in Node — doing so fails with `document is not defined`, which does
// not point at the cause. `observeHtml(page, html)` and the run* helpers do it for you.
export { observeInPage, observeHtml } from './slop-observe.js';
export {
  judgeObservations,
  splitFamilies,
  coveredCriterionIds,
  partiallyCoveredCriterionIds,
  CHECKS,
  COVERAGE,
} from './slop-verdicts.js';
export { checkArtifactIntegrity, INTEGRITY_CHECKS } from './artifact-integrity.js';

/**
 * Bumped whenever the SHAPE of what these functions return changes.
 * 2 — each result carries `status: 'violation' | 'notDetected' | 'unjudged'`.
 *     The boolean `pass` is GONE: `pass: true` read as approval, and this layer
 *     never grants approval (audit r4).
 */
export const EVAL_API_VERSION = 2;
