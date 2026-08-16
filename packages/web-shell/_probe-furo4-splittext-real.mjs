// FURO #4 — pré-requisito 1 do handoff: SplitText REAL, não spans à mão.
//
// A fixture anterior usava spans que eu escrevi, e a "contiguidade" dos
// fragmentos de uma linha era consequência da minha marcação — não prova nada
// sobre o que a biblioteca faz. O Sol pegou isso.
//
// A pergunta que decide o ENDEREÇAMENTO do furo #4:
//   Q1 que DOM o SplitText produz, e os fragmentos de uma linha são contíguos
//      em targets()?
//   Q2 ⭐ re-split (o que acontece no resize, com type:"lines") SUBSTITUI os
//      elementos? Referências capturadas antes ficam obsoletas?
//   Q3 um tween construído sobre os fragmentos ANTIGOS sobrevive ao re-split,
//      ou passa a animar nós fora do documento?
//   Q4 existe alguma identidade ESTÁVEL pra endereçar através do re-split
//      (atributo, ordem, texto)? É isso que decide se dá pra endereçar por
//      elemento, por índice, ou se nenhum dos dois serve.
//   Q5 revert() devolve o DOM original de verdade?
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const root = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0';
const gsapSrc = readFileSync(`${root}/gsap.min.js`, 'utf8');
const splitSrc = readFileSync(`${root}/SplitText.min.js`, 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`<div id="wrap" style="width:300px"><h1 id="h">Design without borders today</h1></div>`);
await page.addScriptTag({ content: gsapSrc });
await page.addScriptTag({ content: splitSrc });

const out = await page.evaluate(() => {
  /* eslint-disable no-undef */
  gsap.registerPlugin(SplitText);
  const report = {};
  const h = () => document.getElementById('h');

  // Q1 — DOM produzido e contiguidade
  {
    const split = new SplitText(h(), { type: 'lines,words,chars' });
    const tween = gsap.to(split.chars, { x: 20, duration: 0.5, paused: true });
    const targets = tween.targets();
    const line0 = split.lines[0];
    const idx = targets.map((t, i) => (line0.contains(t) ? i : null)).filter((i) => i !== null);
    report.q1 = {
      chars: split.chars.length,
      words: split.words.length,
      lines: split.lines.length,
      tagDoChar: split.chars[0]?.tagName,
      classeDoChar: split.chars[0]?.className,
      indicesDaLinha0: idx,
      contiguos: idx.every((v, k) => k === 0 || v === idx[k - 1] + 1),
    };
    tween.kill();
    split.revert();
  }

  // Q2/Q3/Q4 — re-split substitui elementos?
  {
    const split = new SplitText(h(), { type: 'lines,words,chars' });
    const antes = split.chars.slice();
    const antesRef = antes[3];
    const antesTexto = antesRef?.textContent;
    const tween = gsap.to(split.chars, { x: 20, duration: 0.5, paused: true });
    tween.progress(1, true);

    // CONTROLE DE SENSIBILIDADE (antes do re-split): o instrumento tem que
    // saber reportar "vivo" — senão "órfão" não significa nada.
    report.q3Controle = {
      alvosVivosAntesDoResplit: tween.targets().filter((el) => document.contains(el)).length,
      totalAlvos: tween.targets().length,
    };

    // Re-split REAL: o container muda de largura ANTES (é o que o resize faz
    // com type:"lines" — as linhas recompõem de verdade, não é só re-rodar o
    // mesmo split).
    const linhasAntes = split.lines.length;
    document.getElementById('wrap').style.width = '150px';
    split.split({ type: 'lines,words,chars' });
    report.q2Resize = { linhasAntes, linhasDepois: split.lines.length, larguraMudou: true };
    const depois = split.chars.slice();
    const depoisRef = depois[3];

    report.q2 = {
      mesmaQuantidade: antes.length === depois.length,
      mesmaReferenciaNoIndice3: antesRef === depoisRef,
      // quantos dos elementos antigos continuam no documento?
      antigosAindaNoDoc: antes.filter((el) => document.contains(el)).length,
      totalAntigos: antes.length,
      textoAntes: antesTexto,
      textoDepois: depoisRef?.textContent,
    };

    // Q3 — o tween antigo agora aponta pra quê?
    const alvosDoTween = tween.targets();
    report.q3 = {
      alvosAindaNoDoc: alvosDoTween.filter((el) => document.contains(el)).length,
      totalAlvos: alvosDoTween.length,
      tweenFicouOrfao: alvosDoTween.every((el) => !document.contains(el)),
    };

    // CONTROLE pós-re-split: um tween nos fragmentos NOVOS tem que reportar
    // "vivo" pelo MESMO instrumento que carimbou o antigo de órfão.
    const tweenNovo = gsap.to(split.chars, { x: 20, duration: 0.5, paused: true });
    report.q3ControlePos = {
      alvosVivos: tweenNovo.targets().filter((el) => document.contains(el)).length,
      totalAlvos: tweenNovo.targets().length,
    };
    tweenNovo.kill();

    // Q4 — existe identidade estável?
    report.q4 = {
      temIdProprio: Boolean(depoisRef?.id),
      temDataAttrs: depoisRef ? Array.from(depoisRef.attributes).map((a) => a.name) : [],
      classe: depoisRef?.className,
      // a ordem/texto é estável?
      textoNaMesmaOrdem: antes.map((e) => e.textContent).join('') === depois.map((e) => e.textContent).join(''),
    };

    tween.kill();
    split.revert();
  }

  // Q5 — revert devolve o DOM original?
  {
    const htmlOriginal = h().innerHTML;
    const split = new SplitText(h(), { type: 'chars' });
    const htmlDividido = h().innerHTML;
    split.revert();
    report.q5 = {
      originalIgualAoRevertido: htmlOriginal === h().innerHTML,
      divididoMudou: htmlOriginal !== htmlDividido,
    };
  }

  return report;
});

await browser.close();
console.log(JSON.stringify(out, null, 2));
