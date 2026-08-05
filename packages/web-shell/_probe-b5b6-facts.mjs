// PROBE DE FATOS pro design B5/B6 (per-target override sob repeat/yoyo).
// Motor cru (GSAP 3.15 real, sem bridge): mede o que o writer/atestação
// precisam saber ANTES de qualquer arquitetura. Não é witness — é insumo
// do brief pro Sol. Cada fato tem controle de sensibilidade onde aplicável.
//
// F1  repeat:2 parado em iteração posterior + wrapper per-target + invalidatePreservingStart
// F2  repeat:3 yoyo:true parado numa perna de VOLTA + wrapper + invalidate
// F3  semântica de progress(1,true) parado em perna de volta (atestação)
// F4  additive-base: trajetória completa não excede endpoints (classe P6b)
//
// Uso: node _probe-b5b6-facts.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');

const PAGE = `<!DOCTYPE html><html><head></head><body>
<div id="a" style="width:20px;height:20px"></div>
<div id="b" style="width:20px;height:20px"></div>
</body></html>`;

// invalidatePreservingStart — cópia fiel da produção (park/restore por totalTime).
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
window.traj = function (tw, points) {
  const parked = tw.totalTime();
  const out = points.map((t) => { tw.totalTime(t, true); return { t, ...window.xs() }; });
  tw.totalTime(parked, true);
  return out;
};
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(PAGE);
await page.addScriptTag({ content: gsapSrc });
await page.addScriptTag({ content: HELPERS });

const results = {};

// ---- F1: repeat:2, parado em iteração posterior (totalTime 1.5), wrapper per-target
results.F1 = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  gsap.set([a, b], { clearProps: 'all' });
  const tw = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true });
  tw.totalTime(1.5, true); // 2ª iteração, meio
  const before = { parked: tw.totalTime(), ...window.xs() };
  // wrapper per-target: a → 160, b → herda 100
  const wrapper = (i, t) => (t === a ? 160 : 100);
  tw.vars.x = wrapper;
  window.invalidatePreservingStart(tw);
  const after = { parked: tw.totalTime(), progress: tw.progress(), ...window.xs() };
  const trajectory = window.traj(tw, [0, 0.5, 1, 1.5, 2, 2.5, 3]);
  const restored = { parked: tw.totalTime(), ...window.xs() };
  return { before, after, trajectory, restored };
});

// ---- F1-ref: página de referência SEM edit (o irmão b deve ser byte-igual)
results.F1ref = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  gsap.set([a, b], { clearProps: 'all' });
  const tw = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true });
  tw.totalTime(1.5, true);
  const trajectory = window.traj(tw, [0, 0.5, 1, 1.5, 2, 2.5, 3]);
  tw.kill();
  return { trajectory };
});

// ---- F2: repeat:3 yoyo:true, parado numa perna de VOLTA (totalTime 1.5 = iteração 2, yoyo)
results.F2 = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  gsap.set([a, b], { clearProps: 'all' });
  const tw = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 3, yoyo: true, paused: true });
  tw.totalTime(1.5, true); // perna de volta: 100 → 0, meio = 50
  const before = { parked: tw.totalTime(), yoyoLeg: true, ...window.xs() };
  const wrapper = (i, t) => (t === a ? 160 : 100);
  tw.vars.x = wrapper;
  window.invalidatePreservingStart(tw);
  const after = { parked: tw.totalTime(), ...window.xs() };
  const trajectory = window.traj(tw, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
  const restored = { parked: tw.totalTime(), ...window.xs() };
  return { before, after, trajectory, restored };
});

results.F2ref = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  gsap.set([a, b], { clearProps: 'all' });
  const tw = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 3, yoyo: true, paused: true });
  tw.totalTime(1.5, true);
  const trajectory = window.traj(tw, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
  tw.kill();
  return { trajectory };
});

// ---- F3: semântica de progress(1,true) — a base da atestação de endpoints.
// Parado em perna de volta: progress(1) renderiza o quê? E o round-trip restaura?
results.F3 = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  gsap.set([a, b], { clearProps: 'all' });
  const tw = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 3, yoyo: true, paused: true });
  tw.totalTime(1.5, true);
  const parked = tw.totalTime();
  tw.progress(1, true);
  const atProgress1 = { totalTime: tw.totalTime(), progress: tw.progress(), ...window.xs() };
  tw.totalTime(parked, true);
  const roundTrip = { totalTime: tw.totalTime(), ...window.xs() };
  // controle: mesmo probe num repeat SEM yoyo, perna de "ida"
  const tw2 = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true });
  tw.kill(); gsap.set([a, b], { clearProps: 'all' });
  const tw3 = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true });
  tw2.kill();
  tw3.totalTime(1.5, true);
  tw3.progress(1, true);
  const noYoyoAtProgress1 = { totalTime: tw3.totalTime(), progress: tw3.progress(), ...window.xs() };
  tw3.totalTime(1.5, true);
  const noYoyoRoundTrip = { totalTime: tw3.totalTime(), ...window.xs() };
  tw3.kill();
  return { parkedReturnLeg: parked, atProgress1, roundTrip, noYoyoAtProgress1, noYoyoRoundTrip };
});

// ---- F4: sensibilidade additive-base (classe P6b): com wrapper instalado e
// invalidate SEM preservar início (cru), o loop corrompe? (controle positivo)
results.F4control = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  gsap.set([a, b], { clearProps: 'all' });
  const tw = gsap.to([a, b], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true });
  tw.totalTime(1.5, true);
  const wrapper = (i, t) => (t === a ? 160 : 100);
  tw.vars.x = wrapper;
  tw.invalidate(); // CRU — sem park/restore
  tw.totalTime(1.5, true);
  const afterRawInvalidate = { ...window.xs() };
  const trajectory = window.traj(tw, [0, 1.5, 3]);
  tw.kill();
  return { afterRawInvalidate, trajectory };
});

console.log(JSON.stringify(results, null, 2));
await browser.close();
