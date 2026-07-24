// validate-shadow-classify.mjs — validates the free-vs-paid shadow classifier.
// Part A (unit): the text + visual instruments catch a broken static copy, and
//   an IDENTICAL-image control scores ~1 (so an always-zero regression fails).
// Part B (integration): captureSnapshot with the gate ENABLED actually attaches
//   classificationShadow.visual — the end-to-end witness the shadow lacked when
//   it silently died once (audit 2026-07-23, Sol #5).
//
// Run: node packages/web-shell/scripts/validate-shadow-classify.mjs
// Requires a local Chromium (bunx playwright install chromium). Exit 0 = pass.
import http from 'node:http';
import { chromium } from 'playwright-core';
import { extractVisibleText, classify, toMeta, visualDiff } from '../lib/classify-site.js';

const log = (...a) => console.log(...a); // eslint-disable-line no-console
const fail = (m) => { console.error('FAIL —', m); process.exit(1); }; // eslint-disable-line no-console

// A big block stuck at opacity:0 in the artifact (visible in the JS-alive source).
const BLOCK = 'height:360px;background:#2b56ff;color:#fff;font-size:28px;padding:24px';
const SOURCE = `<body style="margin:0"><h1>Hero Headline</h1><section style="${BLOCK}">pricing plans enterprise features testimonials from happy customers</section><footer>contact about team</footer></body>`;
const ARTIFACT = `<body style="margin:0"><h1>Hero Headline</h1><section style="${BLOCK};opacity:0">pricing plans enterprise features testimonials from happy customers</section><footer>contact about team</footer></body>`;

const browser = await chromium.launch({ headless: true });
try {
  // ── Part A: instruments + identical-image control ──
  const shoot = async (htmlStr, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 }, ...opts });
    const page = await ctx.newPage();
    await page.setContent(htmlStr, { waitUntil: 'load' });
    const text = await page.evaluate(extractVisibleText);
    const shot = await page.screenshot({ type: 'png', fullPage: true });
    await ctx.close();
    return { text, shot };
  };
  // The artifact renders JS-ENABLED (matches the shipped allow-scripts srcDoc).
  const src = await shoot(SOURCE);
  const art = await shoot(ARTIFACT);

  // Visual diff runs in a TRUSTED blank page (as the fix does).
  const blankCtx = await browser.newContext();
  const blank = await blankCtx.newPage();
  await blank.goto('about:blank');
  const runVisual = (aShot, bShot) => blank.evaluate(visualDiff, {
    srcUrl: `data:image/png;base64,${aShot.toString('base64')}`,
    artUrl: `data:image/png;base64,${bShot.toString('base64')}`,
  });
  const broken = await runVisual(src.shot, art.shot);
  const identical = await runVisual(src.shot, src.shot); // control
  await blankCtx.close();

  const result = classify({ sourceText: src.text, artifactText: art.text, motion: {} });
  log('A. TEXT    :', JSON.stringify({ category: result.category, coverage: +result.coverage.toFixed(3) }));
  log('A. VISUAL  :', JSON.stringify({ similarity: +broken.similarity.toFixed(3), heightRatio: +broken.heightRatio.toFixed(3) }));
  log('A. CONTROL :', JSON.stringify({ similarity: +identical.similarity.toFixed(3), heightRatio: +identical.heightRatio.toFixed(3) }));

  if (!(art.text.indexOf('pricing') === -1 && result.category === 'heavy' && result.photocopyOk === false)) fail('text instrument missed the stuck reveal');
  if (!(broken.similarity < 0.98)) fail(`visual instrument missed the difference (similarity ${broken.similarity})`);
  if (!(identical.similarity > 0.99 && identical.heightRatio === 1)) fail(`identical-image control not ~1 (similarity ${identical.similarity}) — an always-zero regression would slip through`);

  // ── Part B: end-to-end through captureSnapshot with the gate ON ──
  process.env.UNCRAFT_CLASSIFY_SHADOW = '1';
  const { captureSnapshot } = await import('../lib/snapshot.js');
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(SOURCE); });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const cap = await captureSnapshot(`http://127.0.0.1:${port}/`);
    const v = cap.classificationShadow?.classification;
    const vis = cap.classificationShadow?.visual;
    log('B. classificationShadow present:', !!cap.classificationShadow, '| visual present:', !!vis);
    if (!cap.classificationShadow) fail('captureSnapshot did not attach classificationShadow with the gate enabled');
    if (!vis || typeof vis.similarity !== 'number' || typeof vis.heightRatio !== 'number') fail('classificationShadow.visual is not a populated {similarity, heightRatio} — the visual wiring is not exercised end-to-end');
    log('B. e2e visual:', JSON.stringify({ similarity: +vis.similarity.toFixed(3), heightRatio: +vis.heightRatio.toFixed(3), category: v?.category }));
  } finally {
    await new Promise((r) => server.close(r));
  }

  log('PASS — text + visual instruments work, identical-image control holds, and captureSnapshot attaches visual end-to-end');
} finally {
  await browser.close();
}
