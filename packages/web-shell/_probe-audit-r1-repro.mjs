// Repro dos achados r1 do Sol (B5): #1 revert de timing não restaura o clock;
// #4 duration Infinity passa o gate de duração.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<div id="a"></div><div id="b"></div>');
await page.addScriptTag({ content: gsapSrc });
const r = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  // #1a: repeatDelay set+revert a partir de totalTime 1.5
  const t1 = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true });
  t1.totalTime(1.5, true);
  const before1 = { totalTime: t1.totalTime(), iteration: t1.iteration() };
  t1.repeatDelay(0.4);
  const mid1 = { totalTime: t1.totalTime(), iteration: t1.iteration() };
  t1.repeatDelay(0);
  const after1 = { totalTime: t1.totalTime(), iteration: t1.iteration(), x: gsap.getProperty(a, 'x') };
  t1.kill();
  // #1b: duration 0 set+revert
  const t2 = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true });
  t2.totalTime(1.5, true);
  t2.duration(0);
  const mid2 = { totalTime: t2.totalTime(), iteration: t2.iteration() };
  t2.duration(1);
  const after2 = { totalTime: t2.totalTime(), iteration: t2.iteration() };
  t2.kill();
  // #1c: o fix proposto — capturar totalTime antes, restaurar DEPOIS dos setters
  const t3 = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true });
  t3.totalTime(1.5, true);
  const parked = t3.totalTime();
  t3.repeatDelay(0.4);
  t3.repeatDelay(0);
  t3.totalTime(parked, true);
  const fixed = { totalTime: t3.totalTime(), iteration: t3.iteration(), x: gsap.getProperty(a, 'x') };
  t3.kill();
  // #4: duration Infinity — o que os getters devolvem?
  const t4 = gsap.to([a, b], { x: 100, duration: Infinity, ease: 'none', repeat: 2, paused: true });
  const inf = { duration: t4.duration(), totalDuration: t4.totalDuration(), repeat: t4.repeat() };
  t4.kill();
  return { before1, mid1, after1, mid2, after2, fixed, inf };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
