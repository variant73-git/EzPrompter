import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1320, height: 1200 } });
const page = await ctx.newPage();
await page.goto(`file:///Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell/scripts/spike-out/iframe-test/host-15000.html`);
await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const doc = document.querySelector('iframe').contentDocument;
  const promo = doc.querySelector('.promo-hero');
  const cs = getComputedStyle(promo);
  return {
    cls: promo.className,
    height: cs.height, minHeight: cs.minHeight, maxHeight: cs.maxHeight,
    cssText: promo.style.cssText.slice(0, 200),
    children: [...promo.children].map(c => {
      const ccs = getComputedStyle(c);
      const r = c.getBoundingClientRect();
      return {
        tag: c.tagName, cls: (c.className?.toString?.()||'').slice(0,60),
        h: Math.round(r.height), height: ccs.height, position: ccs.position
      };
    })
  };
});
console.log(JSON.stringify(r, null, 2));
await ctx.close(); await browser.close();
