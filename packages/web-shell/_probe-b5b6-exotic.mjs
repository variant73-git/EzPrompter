// PROBE Q7 — posições EXÓTICAS de park pro B5/B6: fronteira exata de iteração
// (totalTime = múltiplo da duração), totalTime 0, última perna, fim absoluto.
// Mede: (a) invalidatePreservingStart preserva park+valores nessas posições?
// (b) a atestação (progress(1,true) + restore por totalTime) round-tripa exato?
// Uso: node _probe-b5b6-exotic.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');

const PAGE = `<!DOCTYPE html><html><head></head><body>
<div id="a" style="width:20px;height:20px"></div>
<div id="b" style="width:20px;height:20px"></div>
</body></html>`;

const HELPERS = `
window.invalidatePreservingStart = function (animation) {
  let parked = null; let hasTotal = false;
  try {
    hasTotal = typeof animation.totalTime === 'function';
    const current = hasTotal ? animation.totalTime() : animation.progress?.();
    if (Number.isFinite(current) && current > 0) {
      parked = current;
      if (hasTotal) animation.totalTime(0, true); else animation.progress(0, true);
    }
  } catch (_) {}
  animation.invalidate?.();
  if (parked != null) {
    try { if (hasTotal) animation.totalTime(parked, true); else animation.progress(parked, true); } catch (_) {}
  }
};
window.xs = function () {
  return {
    a: Math.round(gsap.getProperty(document.getElementById('a'), 'x') * 1000) / 1000,
    b: Math.round(gsap.getProperty(document.getElementById('b'), 'x') * 1000) / 1000,
  };
};
// um caso: cria tween (repeat/yoyo dados), parka em T, instala wrapper per-target,
// invalidatePreservingStart, depois simula a atestação (progress(1,true) + restore).
window.runCase = function (opts, parkAt) {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  gsap.set([a, b], { clearProps: 'all' });
  const tw = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', paused: true, ...opts });
  tw.totalTime(parkAt, true);
  const before = { parked: tw.totalTime(), ...window.xs() };
  tw.vars.x = (i, t) => (t === a ? 160 : 100);
  window.invalidatePreservingStart(tw);
  const afterInvalidate = { parked: tw.totalTime(), ...window.xs() };
  // atestação: sample no endpoint (progress 1) com park/restore por totalTime
  const parked = tw.totalTime();
  tw.progress(1, true);
  const attest = { totalTime: tw.totalTime(), ...window.xs() };
  tw.totalTime(parked, true);
  const afterAttest = { parked: tw.totalTime(), ...window.xs() };
  tw.kill();
  return { before, afterInvalidate, attest, afterAttest };
};
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(PAGE);
await page.addScriptTag({ content: gsapSrc });
await page.addScriptTag({ content: HELPERS });

const results = await page.evaluate(() => ({
  // B5 (repeat:2): fronteira EXATA de iteração — totalTime 2.0 (fim da 2ª perna /
  // início da 3ª; GSAP renderiza a fronteira como FIM da anterior — lição 173)
  B5_boundary_t2: window.runCase({ repeat: 2 }, 2.0),
  // B5: totalTime 0 (park nulo — o guard `current > 0` pula o park)
  B5_t0: window.runCase({ repeat: 2 }, 0),
  // B5: última perna, meio (totalTime 2.5)
  B5_last_leg: window.runCase({ repeat: 2 }, 2.5),
  // B5: fim ABSOLUTO (totalTime 3.0 = totalDuration)
  B5_end: window.runCase({ repeat: 2 }, 3.0),
  // B6 (repeat:3+yoyo): fronteira ida→volta (totalTime 1.0 — pico)
  B6_peak_t1: window.runCase({ repeat: 3, yoyo: true }, 1.0),
  // B6: fronteira volta→ida (totalTime 2.0 — vale)
  B6_valley_t2: window.runCase({ repeat: 3, yoyo: true }, 2.0),
  // B6: última perna (volta), meio (totalTime 3.5)
  B6_last_return: window.runCase({ repeat: 3, yoyo: true }, 3.5),
  // B6: fim ABSOLUTO (totalTime 4.0 — descanso no início)
  B6_end: window.runCase({ repeat: 3, yoyo: true }, 4.0),
}));

console.log(JSON.stringify(results, null, 2));
await browser.close();
