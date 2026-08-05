import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!DOCTYPE html><html><body><div id="a"></div><div id="b"></div></body></html>');
await page.addScriptTag({ content: gsapSrc });
const r = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  const plain = gsap.to([a, b], { x: 100, duration: 1, paused: true });
  const tl = gsap.timeline({ paused: true });
  const nested = gsap.to([a, b], { y: 50, duration: 1 });
  tl.add(nested);
  return {
    plainParentIsGlobal: plain.parent === gsap.globalTimeline,
    nestedParentIsGlobal: nested.parent === gsap.globalTimeline,
    nestedParentIsTl: nested.parent === tl,
    plainScrollTrigger: 'scrollTrigger' in plain ? String(plain.scrollTrigger) : 'absent',
    globalTimelineExists: Boolean(gsap.globalTimeline),
  };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
