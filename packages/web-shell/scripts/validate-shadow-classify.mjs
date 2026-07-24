// validate-shadow-classify.mjs — exercises the free-vs-paid shadow classifier
// path END TO END against a local fixture (no network capture). Guards against
// the exact failure that killed it once (the shadow block calling a nonexistent
// Playwright method and dying silently), AND checks the second instrument — the
// visual diff wired in for the §3 signals→verify gate.
//
// Run: node packages/web-shell/scripts/validate-shadow-classify.mjs
// Requires a local Chromium (bunx playwright install chromium). Exit 0 = pass.
//
// Mirrors snapshot.js's shadow block: source text+shot via a JS-enabled context,
// artifact text+shot via a JS-DISABLED context, then classify() + visualDiff().
import { chromium } from 'playwright-core';
import { extractVisibleText, classify, toMeta, visualDiff } from '../lib/classify-site.js';

// A reveal the static copy's force-show CSS did NOT recover — a big block stuck
// at opacity:0 in the artifact (present + visible in the JS-alive source). The
// exact break the classifier exists to catch, made visually substantial so both
// the text AND the visual instrument register it.
const BLOCK = 'height:360px;background:#2b56ff;color:#fff;font-size:28px;padding:24px';
const SOURCE = `<body style="margin:0"><h1>Hero Headline</h1><section style="${BLOCK}">pricing plans enterprise features testimonials from happy customers</section><footer>contact about team</footer></body>`;
const ARTIFACT = `<body style="margin:0"><h1>Hero Headline</h1><section style="${BLOCK};opacity:0">pricing plans enterprise features testimonials from happy customers</section><footer>contact about team</footer></body>`;

const browser = await chromium.launch({ headless: true });
try {
  const srcCtx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const srcPage = await srcCtx.newPage();
  await srcPage.setContent(SOURCE, { waitUntil: 'load' });
  const sourceText = await srcPage.evaluate(extractVisibleText);
  const sourceShot = await srcPage.screenshot({ type: 'png', fullPage: true });

  // The fix: JS-disabled is a CONTEXT option (there is no page.setJavaScriptEnabled).
  const probeCtx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 800, height: 600 } });
  const probe = await probeCtx.newPage();
  await probe.setContent(ARTIFACT, { waitUntil: 'load' });
  const artifactText = await probe.evaluate(extractVisibleText);
  const artifactShot = await probe.screenshot({ type: 'png', fullPage: true });
  await probeCtx.close();

  const result = classify({ sourceText, artifactText, motion: {} });
  // Visual instrument runs in the JS-enabled source page (decodes the PNGs).
  const visual = await srcPage.evaluate(visualDiff, {
    srcUrl: `data:image/png;base64,${sourceShot.toString('base64')}`,
    artUrl: `data:image/png;base64,${artifactShot.toString('base64')}`,
  });
  await srcCtx.close();

  const log = (...a) => console.log(...a); // eslint-disable-line no-console
  log('source  :', JSON.stringify(sourceText));
  log('artifact:', JSON.stringify(artifactText));
  log('TEXT    :', JSON.stringify({ category: result.category, photocopyOk: result.photocopyOk, coverage: +result.coverage.toFixed(3) }));
  log('VISUAL  :', JSON.stringify({ similarity: +visual.similarity.toFixed(3), diffFraction: +visual.diffFraction.toFixed(3), heightRatio: +visual.heightRatio.toFixed(3) }));
  log('toMeta  :', JSON.stringify(toMeta(result)));

  const textOk = artifactText.indexOf('pricing') === -1 && result.category === 'heavy' && result.photocopyOk === false;
  const visualOk = visual.similarity < 0.98; // the hidden block moves the number
  if (!textOk) { console.error('FAIL — text instrument did not catch the stuck reveal'); process.exit(1); }
  if (!visualOk) { console.error(`FAIL — visual instrument did not register the difference (similarity ${visual.similarity})`); process.exit(1); }
  log('PASS — both instruments (text + visual) run and register the broken static copy');
} finally {
  await browser.close();
}
