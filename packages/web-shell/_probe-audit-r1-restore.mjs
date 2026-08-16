// Receita de restore pro guard de timing: qual sequência devolve clock E render exatos?
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<div id="a"></div><div id="b"></div>');
await page.addScriptTag({ content: gsapSrc });
const r = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  const mk = () => { gsap.set([a,b],{clearProps:'all'}); const t = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true }); t.totalTime(1.5, true); return t; };
  const read = (t) => ({ totalTime: t.totalTime(), iteration: t.iteration(), x: Number(Number(gsap.getProperty(a,'x')).toFixed(4)), x2: (t.totalTime(1.5,true), Number(Number(gsap.getProperty(a,'x')).toFixed(4))) });
  // V1: revert → totalTime(parked)
  const t1 = mk(); const p1 = t1.totalTime();
  t1.repeatDelay(0.4); t1.repeatDelay(0); t1.totalTime(p1, true);
  const v1 = read(t1); t1.kill();
  // V2: zerar clock antes de mexer: totalTime(0) → mutate → revert → totalTime(parked)
  const t2 = mk(); const p2 = t2.totalTime();
  t2.totalTime(0, true); t2.repeatDelay(0.4); t2.repeatDelay(0); t2.totalTime(p2, true);
  const v2 = read(t2); t2.kill();
  // V3: revert → totalTime(0) → totalTime(parked)
  const t3 = mk(); const p3 = t3.totalTime();
  t3.repeatDelay(0.4); t3.repeatDelay(0); t3.totalTime(0, true); t3.totalTime(p3, true);
  const v3 = read(t3); t3.kill();
  // V4: duration-case com V3
  const t4 = mk(); const p4 = t4.totalTime();
  t4.duration(0); t4.duration(1); t4.totalTime(0, true); t4.totalTime(p4, true);
  const v4 = read(t4); t4.kill();
  // V5: playbackMode-case (repeat -1 + yoyo true) com V3
  const t5 = mk(); const p5 = t5.totalTime();
  t5.repeat(-1); t5.yoyo(true); t5.repeat(2); t5.yoyo(false); t5.totalTime(0, true); t5.totalTime(p5, true);
  const v5 = read(t5); t5.kill();
  return { v1, v2, v3, v4, v5 };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
