// RISCO INVERSO do fix do seek (achado do Sol, r1): suprimir eventos congela
// render DERIVADO — animação cujo único output visível é escrito DENTRO do
// onUpdate (sequência de frames em canvas, Lottie, DOM secundário).
// Padrão REAL no repo: Clone/index.html:1159 anima frameObj.frame e desenha
// em onUpdate. Aqui: mesma forma, medida no GSAP 3.15 real.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<div id="a"></div>');
await page.addScriptTag({ content: gsapSrc });
const r = await page.evaluate(() => {
  const caso = (suppress) => {
    const obj = { frame: 0 };
    let desenhado = -1;                        // o "canvas"
    const tw = gsap.to(obj, {
      frame: 100, duration: 1, ease: 'none', paused: true,
      onUpdate: () => { desenhado = Math.round(obj.frame); },
    });
    tw.pause();
    // scrub do editor: usuário arrasta até 60%
    tw.time(0.6, suppress);
    return { propriedadeAnimada: Math.round(obj.frame), renderDerivado: desenhado };
  };
  return { comEventos: caso(false), suprimido: caso(true) };
});
await browser.close();
console.log(JSON.stringify(r, null, 2));
const quebrou = r.suprimido.renderDerivado !== r.suprimido.propriedadeAnimada;
console.log(quebrou
  ? `\nCONFIRMADO: com supressão o valor avança para ${r.suprimido.propriedadeAnimada} mas o render derivado fica em ${r.suprimido.renderDerivado} (congelado). Sem supressão: ${r.comEventos.renderDerivado}.`
  : '\nNÃO reproduzido: o render derivado acompanhou mesmo com supressão.');
