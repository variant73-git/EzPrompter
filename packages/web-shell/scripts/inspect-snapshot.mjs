/**
 * inspect-snapshot.mjs — runs the same Playwright flow as lib/snapshot.js
 * captureSnapshot and dumps diagnostics about what's actually in the captured
 * DOM. Use to debug "only-hero" / "frozen-frame" complaints.
 *
 * node scripts/inspect-snapshot.mjs <url>
 */
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'spike-out', 'snapshot-inspect');
const URL = process.argv[2] || 'https://www.farmminerals.com/promo';
const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

await import('node:fs/promises').then((m) => m.mkdir(OUT, { recursive: true }));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent: REAL_UA,
  locale: 'en-US'
});
const page = await ctx.newPage();
console.log('navigate', URL);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 25000 });
await page.waitForTimeout(2000);

// Diagnostic 1: before any scroll
const beforeScroll = await page.evaluate(() => {
  const counts = {
    sections: document.querySelectorAll('section').length,
    headings: document.querySelectorAll('h1,h2,h3').length,
    paragraphs: document.querySelectorAll('p').length,
    images: document.querySelectorAll('img').length,
    videos: document.querySelectorAll('video').length,
    canvases: document.querySelectorAll('canvas').length,
    iframes: document.querySelectorAll('iframe').length,
    dataWId: document.querySelectorAll('[data-w-id]').length,
    dataFramer: document.querySelectorAll('[data-framer-component-type]').length,
    dataAos: document.querySelectorAll('[data-aos]').length
  };
  const styleSample = [];
  for (const el of document.querySelectorAll('[data-w-id]')) {
    const cs = getComputedStyle(el);
    styleSample.push({
      tag: el.tagName,
      cls: el.className?.toString?.().slice(0, 100),
      opacity: cs.opacity,
      transform: cs.transform.slice(0, 80),
      visibility: cs.visibility,
      display: cs.display
    });
    if (styleSample.length >= 8) break;
  }
  return {
    counts,
    docHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    viewportHeight: window.innerHeight,
    styleSample
  };
});
console.log('BEFORE scroll:', JSON.stringify(beforeScroll, null, 2));

// Scroll to bottom in steps
await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const max = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight;
  let y = 0;
  for (let i = 0; i < 40; i++) {
    const t = Math.min(y + 800, max());
    window.scrollTo(0, t);
    await sleep(350);
    if (t >= max()) break;
    y = t;
  }
  await sleep(1000);
});

const afterScroll = await page.evaluate(() => {
  const styleSample = [];
  for (const el of document.querySelectorAll('[data-w-id]')) {
    const cs = getComputedStyle(el);
    styleSample.push({
      tag: el.tagName,
      cls: el.className?.toString?.().slice(0, 100),
      opacity: cs.opacity,
      transform: cs.transform.slice(0, 80)
    });
    if (styleSample.length >= 8) break;
  }
  return { scrollY: window.scrollY, styleSample };
});
console.log('AFTER scroll-to-bottom:', JSON.stringify(afterScroll, null, 2));

// Inject force-show CSS
await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = `
    [data-w-id], [data-aos], [data-anim], [data-scroll], [data-framer-component-type],
    .reveal, .fade-in, .fade-up, .slide-up, .gsap-fade, .gsap-reveal {
      opacity: 1 !important;
      transform: none !important;
      visibility: visible !important;
    }
  `;
  document.head.appendChild(style);
});
await page.waitForTimeout(120);

const afterForceShow = await page.evaluate(() => {
  const styleSample = [];
  for (const el of document.querySelectorAll('[data-w-id]')) {
    const cs = getComputedStyle(el);
    styleSample.push({
      tag: el.tagName,
      opacity: cs.opacity,
      transform: cs.transform.slice(0, 60),
      visibility: cs.visibility
    });
    if (styleSample.length >= 8) break;
  }
  return { styleSample };
});
console.log('AFTER force-show CSS:', JSON.stringify(afterForceShow, null, 2));

// Capture content + screenshot
const html = await page.content();
await writeFile(join(OUT, 'captured.html'), html, 'utf8');
console.log(`Wrote ${html.length} chars to captured.html`);

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, 'top.png'), fullPage: false });
await page.screenshot({ path: join(OUT, 'fullpage.png'), fullPage: true });
console.log('Wrote top.png + fullpage.png');

await ctx.close();
await browser.close();
console.log('Open:', join(OUT, 'captured.html'));
