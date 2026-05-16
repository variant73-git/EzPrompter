/**
 * Render the spike output.html in headless Chromium and capture both
 * a full-page screenshot and a viewport-matched scroll screenshot of the
 * top of the page, so it can be compared with the original frames.
 */
import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'spike-out');
const HTML_PATH = join(OUT_DIR, 'output.html');
const VIEWPORT = { width: 1280, height: 720 };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
await page.goto(`file://${HTML_PATH}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);

// Full-page (the whole reconstruction stacked vertically)
await page.screenshot({ path: join(OUT_DIR, 'reconstruction-full.png'), fullPage: true });

// Same scroll positions as the original spike so we can compare frame-by-frame
const totalScroll = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
for (let i = 0; i < 7; i++) {
  const y = totalScroll * (i / 6);
  await page.evaluate((Y) => window.scrollTo(0, Y), y);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT_DIR, `reconstruction-${String(i).padStart(2, '0')}.png`) });
}

await ctx.close();
await browser.close();
console.log('Rendered reconstruction screenshots into', OUT_DIR);
