// PROBE — verifica as afirmações GSAP do advise do Sol (2026-08-05) antes de
// virarem gate (veto assimétrico nas duas direções):
//  C1  repeat:0.5 é aceito? o que repeat()/totalDuration() devolvem?
//  C2  repeat:Infinity → tratado como infinito?
//  C3  repeat:-2 → tratado como infinito?
//  C4  animation.repeatDelay(0.4) muda comportamento com vars.repeatDelay ausente?
//  C5  tween.iteration() existe (pro witness congelar)?
// Uso: node _probe-b5b6-gsap-claims.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!DOCTYPE html><html><body><div id="a"></div><div id="b"></div></body></html>');
await page.addScriptTag({ content: gsapSrc });

const results = await page.evaluate(() => {
  const a = document.getElementById('a'); const b = document.getElementById('b');
  const mk = (opts) => gsap.to([a, b], { x: 100, duration: 1, ease: 'none', paused: true, ...opts });

  const c1 = (() => {
    const tw = mk({ repeat: 0.5 });
    const out = { repeat: tw.repeat(), totalDuration: tw.totalDuration(), varsRepeat: tw.vars.repeat };
    // parka em 1.2 (dentro da "meia" iteração?) e lê
    tw.totalTime(1.2, true);
    out.parked = tw.totalTime();
    out.x = gsap.getProperty(a, 'x');
    tw.kill();
    return out;
  })();

  const c2 = (() => {
    const tw = mk({ repeat: Infinity });
    const out = { repeat: tw.repeat(), totalDuration: tw.totalDuration() };
    tw.kill();
    return out;
  })();

  const c3 = (() => {
    const tw = mk({ repeat: -2 });
    const out = { repeat: tw.repeat(), totalDuration: tw.totalDuration() };
    tw.kill();
    return out;
  })();

  const c3b = (() => {
    const tw = mk({ repeat: -1 });
    const out = { repeat: tw.repeat(), totalDuration: tw.totalDuration() };
    tw.kill();
    return out;
  })();

  const c4 = (() => {
    gsap.set([a, b], { clearProps: 'all' });
    const tw = mk({ repeat: 2 });
    tw.repeatDelay(0.4); // setter vivo — vars fica sem repeatDelay?
    const out = {
      varsRepeatDelay: tw.vars.repeatDelay,
      getterRepeatDelay: tw.repeatDelay(),
      totalDuration: tw.totalDuration(), // 3 sem delay; 3.8 com 2 delays de 0.4
    };
    // efeito real: parka em 1.2 (dentro do 1º repeatDelay se ele existir)
    tw.totalTime(1.2, true);
    out.xInsideDelay = gsap.getProperty(a, 'x');
    tw.kill();
    return out;
  })();

  const c5 = (() => {
    const tw = mk({ repeat: 2 });
    tw.totalTime(1.5, true);
    const out = { hasIteration: typeof tw.iteration === 'function' };
    if (out.hasIteration) out.iteration = tw.iteration();
    tw.kill();
    return out;
  })();

  return { c1, c2, c3, c3b, c4, c5 };
});

console.log(JSON.stringify(results, null, 2));
await browser.close();
