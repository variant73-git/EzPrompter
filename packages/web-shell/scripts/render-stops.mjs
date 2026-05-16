import { chromium } from 'playwright-core';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = '/Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell/scripts/spike-out';
const HTML_PATH = `${OUT_DIR}/output.html`;
const VIEWPORT = { width: 1280, height: 720 };
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
await page.goto(`file://${HTML_PATH}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
const totalScroll = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
const stops = (await readdir(`${OUT_DIR}/stops`)).filter(f => f.endsWith('.png')).sort();
const stride = stops.length > 1 ? totalScroll / (stops.length - 1) : 0;
for (let i = 0; i < stops.length; i++) {
  const y = stride * i;
  await page.evaluate((Y) => window.scrollTo(0, Y), y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/recon-${String(i).padStart(2, '0')}.png` });
}
await ctx.close();
await browser.close();
console.log(`Rendered ${stops.length} reconstruction stops to ${OUT_DIR}/recon-*.png`);
