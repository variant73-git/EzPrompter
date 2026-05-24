/**
 * Inspect specifically why .promo-animation is 75000px tall in the iframe.
 */
import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1320, height: 1200 } });
const page = await ctx.newPage();
await page.goto(`file://${join(__dirname, 'spike-out/iframe-test/host-15000.html')}`);
await page.waitForTimeout(2000);

const r = await page.evaluate(() => {
  const iframe = document.querySelector('iframe');
  const doc = iframe.contentDocument;
  const promo = doc.querySelector('.promo-animation');
  if (!promo) return { error: 'no promo-animation' };
  const cs = getComputedStyle(promo);
  const rect = promo.getBoundingClientRect();
  // List children with their offsets
  const children = [];
  for (const child of promo.children) {
    const ccs = getComputedStyle(child);
    const cr = child.getBoundingClientRect();
    children.push({
      tag: child.tagName,
      cls: (child.className?.toString?.() || '').slice(0, 60),
      y: Math.round(cr.top), h: Math.round(cr.height),
      position: ccs.position, top: ccs.top, height: ccs.height,
      minHeight: ccs.minHeight,
      transform: ccs.transform.slice(0, 80)
    });
  }
  return {
    promo: {
      tag: promo.tagName,
      cls: promo.className,
      cs: {
        position: cs.position,
        height: cs.height,
        minHeight: cs.minHeight,
        maxHeight: cs.maxHeight,
        display: cs.display,
        overflow: cs.overflow,
        flex: cs.flex,
        flexDirection: cs.flexDirection
      },
      bbox: { y: rect.top, h: rect.height }
    },
    childCount: promo.children.length,
    children
  };
});
console.log(JSON.stringify(r, null, 2));
await ctx.close();
await browser.close();
