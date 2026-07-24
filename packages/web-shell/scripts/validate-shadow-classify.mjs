// validate-shadow-classify.mjs — exercises the free-vs-paid shadow classifier
// path END TO END against a local fixture (no network capture). Guards against
// the exact failure that killed it once: the shadow block calling a nonexistent
// Playwright method (page.setJavaScriptEnabled) and dying silently in a catch.
//
// Run: node packages/web-shell/scripts/validate-shadow-classify.mjs
// Requires a local Chromium (bunx playwright install chromium). Exit 0 = pass.
//
// This mirrors snapshot.js's shadow block: source text via a JS-enabled context,
// artifact text via a JS-DISABLED context (the fix), then classify().
import { chromium } from 'playwright-core';
import { extractVisibleText, classify, toMeta } from '../lib/classify-site.js';

// A reveal the static copy's force-show CSS did NOT recover — stuck at opacity:0
// in the artifact (present + visible in the JS-alive source). The exact break
// the classifier exists to catch.
const SOURCE = '<body><h1>Hero Headline</h1><section>pricing plans enterprise features</section><section>testimonials from happy customers everywhere</section><footer>contact about team</footer></body>';
const ARTIFACT = '<body><h1>Hero Headline</h1><section style="opacity:0">pricing plans enterprise features</section><section style="opacity:0">testimonials from happy customers everywhere</section><footer>contact about team</footer></body>';

const browser = await chromium.launch({ headless: true });
try {
  const srcCtx = await browser.newContext();
  const srcPage = await srcCtx.newPage();
  await srcPage.setContent(SOURCE, { waitUntil: 'load' });
  const sourceText = await srcPage.evaluate(extractVisibleText);
  await srcCtx.close();

  // The fix: JS-disabled is a CONTEXT option (there is no page.setJavaScriptEnabled).
  const probeCtx = await browser.newContext({ javaScriptEnabled: false });
  const probe = await probeCtx.newPage();
  await probe.setContent(ARTIFACT, { waitUntil: 'load' });
  const artifactText = await probe.evaluate(extractVisibleText);
  await probeCtx.close();

  const result = classify({ sourceText, artifactText, motion: {} });
  // eslint-disable-next-line no-console
  console.log('source  :', JSON.stringify(sourceText));
  // eslint-disable-next-line no-console
  console.log('artifact:', JSON.stringify(artifactText));
  // eslint-disable-next-line no-console
  console.log('verdict :', JSON.stringify({ category: result.category, photocopyOk: result.photocopyOk, coverage: +result.coverage.toFixed(3) }));
  // eslint-disable-next-line no-console
  console.log('toMeta  :', JSON.stringify(toMeta(result)));

  const pass = artifactText.indexOf('pricing') === -1 // the stuck reveal is excluded
    && result.category === 'heavy' && result.photocopyOk === false;
  if (!pass) {
    // eslint-disable-next-line no-console
    console.error('FAIL — shadow ran but did not catch the stuck reveal as expected');
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('PASS — shadow classifier runs and catches the broken static copy');
} finally {
  await browser.close();
}
