// Re-probe r2#3: serialização EXPLÍCITA (typeof/finitude/String) — JSON.stringify
// mascara Infinity como null (o erro de evidência que o Sol pegou).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<div id="a"></div><div id="b"></div>');
await page.addScriptTag({ content: gsapSrc });
const r = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  const desc = (v) => ({ type: typeof v, str: String(v), finite: Number.isFinite(v) });
  const mk = (opts) => gsap.to([a, b], { x: 100, duration: 1, ease: 'none', paused: true, ...opts });
  const out = {};
  let t = mk({ repeat: Infinity }); out.repeatInfinity = desc(t.repeat()); t.kill();
  t = mk({ repeat: -2 }); out.repeatMinus2 = desc(t.repeat()); t.kill();
  t = mk({ repeat: -1 }); out.repeatMinus1 = desc(t.repeat()); t.kill();
  t = mk({ duration: Infinity, repeat: 2 }); out.durationInfinity = desc(t.duration()); out.durInfTotal = desc(t.totalDuration()); t.kill();
  t = mk({ duration: 1e308, repeat: 2 }); out.duration1e308 = desc(t.duration()); out.dur308Total = desc(t.totalDuration()); t.kill();
  t = mk({ duration: 1e300, repeat: 1e8 }); out.duration1e300 = desc(t.duration()); out.overflowTotal = desc(t.totalDuration()); out.overflowRepeat = desc(t.repeat()); t.kill();
  // r2#1: repeatDelay negativo é aceito? e o sampler em totalTime(1)?
  t = mk({ repeat: 3, yoyo: true }); t.totalTime(1.5, true); t.repeatDelay(-0.5);
  out.negDelay = { accepted: desc(t.repeatDelay()), totalDur: desc(t.totalDuration()) };
  t.totalTime(1, true);
  out.negDelayAtT1 = { iteration: t.iteration(), time: t.time(), x: gsap.getProperty(a, 'x') };
  t.kill();
  return out;
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
