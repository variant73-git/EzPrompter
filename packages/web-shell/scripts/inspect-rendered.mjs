/**
 * inspect-rendered — replicates the exact iframe path: takes a fresh capture,
 * runs it through the same snapshot pipeline (strip scripts + absolutize +
 * pin vh + base tag), loads it in a real iframe at multiple heights, and
 * reports what's visible vs hidden.
 *
 * Tells us — empirically — whether the captured HTML is actually broken
 * or whether it's the canvas-node iframe sizing that's hiding content.
 */
import { chromium } from 'playwright-core';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureSnapshot } from '../lib/snapshot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'spike-out', 'iframe-test');
await mkdir(OUT, { recursive: true });

const URL = process.argv[2] || 'https://www.farmminerals.com/promo';

console.log('1. Running captureSnapshot...');
const cap = await captureSnapshot(URL);
console.log(`   captured ${cap.html.length} chars, title: ${cap.title}`);
await writeFile(join(OUT, 'served.html'), cap.html, 'utf8');

// Build the host page that wraps the captured HTML in an iframe — same
// shape as CanvasNode (srcdoc, sandbox allow-scripts allow-same-origin).
const HOST_TPL = (h) => `<!doctype html>
<html><head><style>
  html,body{margin:0;padding:0;background:#222;}
  .frame-wrap{position:relative;width:1280px;height:${h}px;border:2px solid #0f0;margin:8px;}
  iframe{width:100%;height:100%;border:none;display:block;}
  .label{position:absolute;top:-22px;left:0;color:#0f0;font:12px monospace;}
</style></head>
<body>
<div class="label">iframe @ ${h}px</div>
<div class="frame-wrap">
<iframe srcdoc="REPLACE_ME" sandbox="allow-same-origin"></iframe>
</div>
</body></html>`;

const escaped = cap.html.replace(/"/g, '&quot;');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1320, height: 1100 } });
const page = await ctx.newPage();

for (const h of [800, 2000, 5000, 15000]) {
  const host = HOST_TPL(h).replace('REPLACE_ME', escaped);
  const file = join(OUT, `host-${h}.html`);
  await writeFile(file, host, 'utf8');
  await page.setViewportSize({ width: 1320, height: h + 100 });
  await page.goto(`file://${file}`);
  await page.waitForTimeout(2000);
  // Check what's actually in the iframe at this height
  const probe = await page.evaluate(() => {
    const iframe = document.querySelector('iframe');
    const doc = iframe.contentDocument;
    if (!doc) return { error: 'no contentDocument' };
    const heroes = [];
    for (const sel of ['section', 'main > div', 'main > section', '.section']) {
      doc.querySelectorAll(sel).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (heroes.length < 12) heroes.push({
          sel, i,
          cls: (el.className?.toString?.() || '').slice(0, 50),
          tag: el.tagName,
          y: Math.round(r.top), h: Math.round(r.height),
          position: cs.position,
          zIndex: cs.zIndex,
          overflow: cs.overflow,
          display: cs.display
        });
      });
    }
    return {
      bodyScrollHeight: doc.body.scrollHeight,
      bodyOffsetHeight: doc.body.offsetHeight,
      docHeight: Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight),
      bodyOverflow: getComputedStyle(doc.body).overflow,
      htmlOverflow: getComputedStyle(doc.documentElement).overflow,
      heroes
    };
  });
  console.log(`\n=== iframe @ ${h}px ===`);
  console.log(JSON.stringify(probe, null, 2));
  await page.screenshot({ path: join(OUT, `screen-${h}.png`), fullPage: true });
}

await ctx.close();
await browser.close();
console.log('\nWrote host-*.html + screen-*.png to', OUT);
