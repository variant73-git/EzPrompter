import { observeInPage, observeHtml } from './slop-observe.js';
import { judgeObservations } from './slop-verdicts.js';
import { checkArtifactIntegrity } from './artifact-integrity.js';

const NO_SOURCE = 'no source bytes supplied; the rendered DOM cannot answer this';

/**
 * A FRESH object per call. A shared constant would be handed to every consumer,
 * and one of them mutating `failed` or a `detail` would silently poison every
 * later call in the process.
 */
const unjudgedIntegrity = () => ({
  results: [
    { id: 'no-truncation', status: 'unjudged', detail: NO_SOURCE },
  ],
  failed: [],
  passed: [],
});

/**
 * The whole check in one call, for an artifact you have as an HTML STRING.
 * Renders it with setContent, observes, judges, and runs the source-level
 * integrity pass.
 *
 * ⚠️ setContent lands the document on `about:blank`. A stylesheet served over HTTP
 * then counts as cross-origin, `cssRules` throws, and every CSS-dependent check
 * comes back `unjudged`. If your artifact links an EXTERNAL stylesheet, navigate
 * to a real URL yourself and use `runDesignEvalOnPage` instead.
 *
 * @param page   a Playwright Page (the caller owns the browser lifecycle)
 * @param html   the generated artifact
 * @param ground { palette, italicCount, monoInSource, explicitFonts }
 * @returns { violations, notDetected, unjudged, results, integrity, observations }
 */
export async function runDesignEval(page, html, ground, opts) {
  const observations = await observeHtml(page, html);
  const verdict = judgeObservations(observations, ground, opts);
  return { ...verdict, integrity: checkArtifactIntegrity(html), observations };
}

/**
 * The same check for a page the caller ALREADY loaded — `page.goto(url)`, a local
 * server, a live site. Nothing here navigates.
 *
 * WHY THIS EXISTS: a project whose design system lives in an external
 * `system.css` cannot use the string path at all — setContent would blind every
 * CSS check. Working around that on the consumer's side meant inlining
 * stylesheets by hand before checking, which is measurement-shaped work that
 * belongs here.
 *
 * INTEGRITY NEEDS THE ORIGINAL BYTES. It is deliberately NOT taken from
 * `page.content()`: that returns the serialised DOM after the parser has repaired
 * whatever the model truncated, so asking the page destroys the evidence the
 * check exists to find. Pass `opts.source` with the bytes you fetched, or accept
 * `unjudged` — never a fabricated pass.
 *
 * @param page   a Playwright Page, already at the document under test
 * @param ground { palette, italicCount, monoInSource, explicitFonts }
 * @param opts   { off: [criterionId], source: '<!doctype html>…' }
 */
export async function runDesignEvalOnPage(page, ground, opts = {}) {
  const observations = await page.evaluate(observeInPage);
  const verdict = judgeObservations(observations, ground, opts);
  const integrity = typeof opts.source === 'string'
    ? checkArtifactIntegrity(opts.source)
    : unjudgedIntegrity();
  return { ...verdict, integrity, observations };
}
