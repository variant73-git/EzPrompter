// WITNESS do caminho de ESCRITA: editar um valor não pode danificar o estado
// temporal da animação. Residual documentado (handoff 2026-08-03, fila §1;
// mesma classe do defeito da inspeção consertado em 1ada4a7b):
// `sampleGsapValue` e `invalidatePreservingStart` estacionam/restauram por
// `progress` — posição DENTRO da iteração. Num tween repeat/yoyo parado numa
// iteração posterior, a EDIÇÃO devolve a animação à iteração/direção errada.
//
// Método (template: _probe-inspect-witness.mjs):
//   - página nova por caso; caminho REAL (clique + apply-patch retarget.final);
//   - referência = página SELECIONADA mas NÃO editada (a seleção é inócua pelo
//     fix da inspeção — isso isola o dano da edição);
//   - dano temporal no TICK SEGUINTE, comparando SÓ estado temporal
//     (totalTime/progress/reversed) — o x muda legitimamente com o edit;
//   - a edição tem que TER acontecido (end novo renderizando do início) — um
//     edit que não aplica não prova inocuidade;
//   - controle positivo: tween simples (progress descreve o estado inteiro →
//     restauração exata → verde JÁ HOJE);
//   - forma adaptativa: o edit é RECUSADO (unsampleable lock) → inócuo por
//     construção, registrado.
//
// Estado MEDIDO HOJE (baseline congelado, 2026-08-05): 6 RED — repeat2 (3:
// totalTime teleporta 1.5→0.5, iteração inteira perdida) e repeat-∞ (3:
// 2.5→1.5, a batida perdida da classe da inspeção). yoyo simples NÃO
// reproduziu nesta forma (verde; registrado, não refutado). yoyoEase: o
// retarget absoluto APLICA (lock unsampleable é end-only na UI, não no
// bridge) e o temporal fica intacto. O fix do plano fase-0 Task 7 vira os 6
// RED verdes e re-grava o baseline.
//
// Uso:
//   node _probe-editwrite-witness.mjs            # assertivo (baseline + contagem RED)
//   node _probe-editwrite-witness.mjs --record   # imprime JSON pra congelar
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const bridgeSrc = getRuntimeBridgeSource();
const RECORD = process.argv.includes('--record');
const BASELINE_PATH = new URL('./_probe-editwrite-witness.baseline.json', import.meta.url);

const CASES = [
  {
    id: 'controle-tween-simples',
    esperadoHoje: 'verde',
    criar: `gsap.to([E('a'), E('b')], { x: 100, duration: 1, paused: true })`,
    posicionar: `tw.progress(0.5, true)`,
  },
  {
    id: 'repeat2-na-2a-iteracao',
    esperadoHoje: 'RED',
    criar: `gsap.to([E('a'), E('b')], { x: 100, duration: 1, repeat: 2, paused: true })`,
    posicionar: `tw.totalTime(1.5, true)`,
  },
  {
    // MEDIDO 2026-08-05: NÃO reproduzido nesta forma (yoyo repeat:1 na volta
    // ficou intacto). "Não reproduzido" ≠ refutado — a forma fica registrada;
    // se o auditor produzir outra forma de yoyo que dana, adicionar caso.
    id: 'yoyo-na-perna-de-volta',
    esperadoHoje: 'verde (não reproduzido nesta forma)',
    criar: `gsap.to([E('a'), E('b')], { x: 100, duration: 1, yoyo: true, repeat: 1, paused: true })`,
    posicionar: `tw.totalTime(1.5, true)`,
  },
  {
    id: 'repeat-infinito-3a-volta',
    esperadoHoje: 'RED',
    criar: `gsap.to([E('a'), E('b')], { x: 100, duration: 1, repeat: -1, paused: true })`,
    posicionar: `tw.totalTime(2.5, true)`,
  },
  {
    // MEDIDO 2026-08-05 (contra minha previsão de recusa): o retarget ABSOLUTO
    // aplica nesta forma — assignGsapAbsolute com número não amostra nada, e o
    // lock unsampleable é end-only na UI, não no bridge. O check desejado aqui
    // é só inocuidade temporal; o desfecho do apply é REGISTRO.
    id: 'adaptativa-yoyoEase',
    esperadoHoje: 'verde',
    soTemporal: true,
    criar: `gsap.to([E('a'), E('b')], { x: 100, duration: 1, yoyo: true, repeat: 1, yoyoEase: 'power2.in', paused: true })`,
    posicionar: `tw.totalTime(1.5, true)`,
  },
];

const browser = await chromium.launch({ headless: true });

async function runPage(kase, editar) {
  const page = await browser.newPage();
  await page.setContent(['a', 'b'].map((id) => `<div id="${id}" style="width:40px;height:40px"></div>`).join(''));
  await page.addScriptTag({ content: gsapSrc });
  const out = await page.evaluate(([bridge, criar, posicionar, doEdit]) => {
    /* eslint-disable no-undef */
    const messages = [];
    window.postMessage = (m) => messages.push(m);
    window.eval(bridge);
    const E = (id) => document.getElementById(id);
    const X = (el) => Number(gsap.getProperty(el, 'x'));
    const temporal = (tw) => ({
      totalTime: Number(tw.totalTime().toFixed(6)),
      progress: Number(tw.progress().toFixed(6)),
      reversed: tw.reversed(),
    });

    const tw = new Function('E', 'gsap', `return ${criar}`)(E, gsap);
    new Function('tw', posicionar)(tw);
    const antes = { ...temporal(tw), alvoX: X(E('a')) };

    // seleção nas DUAS páginas (inócua pelo fix da inspeção; isola a edição)
    E('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const sel = messages.filter((m) => m.type === 'selection-changed').pop();
    const elementId = sel?.payload?.element?.id;
    const motionId = (sel?.payload?.element?.motion || [])[0]?.id;

    let edicao = null;
    if (doEdit) {
      const marca = messages.length;
      window.dispatchEvent(new MessageEvent('message', {
        source: window,
        data: {
          protocol: 'uncraft-motion-editor/v1', source: 'host', type: 'apply-patch',
          payload: { patch: {
            elementId, kind: 'motion', motionId,
            property: 'retarget.final', before: null,
            value: { schemaVersion: 2, runtimeProperty: 'x', value: 160, writeModel: 'absolute', affectedTargetCount: 2 },
          } },
        },
      }));
      const err = messages.slice(marca)
        .filter((m) => m.type === 'patch-rejected' || m.type === 'error').pop();
      edicao = { aplicou: !err, erro: err ? (err.payload?.message || err.type) : null };
    }
    const depois = { ...temporal(tw), alvoX: X(E('a')) };

    // O dano aparece no TICK SEGUINTE.
    tw.totalTime(tw.totalTime() + 0.1, true);
    const tick1 = { ...temporal(tw), alvoX: X(E('a')) };
    tw.totalTime(tw.totalTime() + 0.1, true);
    const tick2 = { ...temporal(tw), alvoX: X(E('a')) };

    // A edição tem que TER acontecido: end novo renderizando do início.
    let endRenderizado = null;
    if (doEdit && edicao?.aplicou) {
      const parked = tw.totalTime();
      tw.totalTime(0, true);
      tw.totalTime(tw.duration(), true);   // fim da 1ª ida
      endRenderizado = X(E('a'));
      tw.totalTime(parked, true);
    }

    return { antes, edicao, depois, tick1, tick2, endRenderizado };
  }, [bridgeSrc, kase.criar, kase.posicionar, editar]);
  await page.close();
  return out;
}

const observado = {};
for (const kase of CASES) {
  const [editado, referencia] = [await runPage(kase, true), await runPage(kase, false)];
  observado[kase.id] = { editado, referencia };
}
await browser.close();

if (RECORD) {
  console.log(JSON.stringify(observado, null, 2));
  process.exit(0);
}

// --- checks do comportamento DESEJADO (hoje: 3 RED esperados) ----------------
let red = 0;
const check = (rotulo, ok, detalhe) => {
  if (!ok) red += 1;
  console.log(`  ${ok ? 'OK  ' : 'RED '} ${rotulo}${!ok && detalhe ? ` — ${detalhe}` : ''}`);
};
const t = ({ totalTime, progress, reversed }) => ({ totalTime, progress, reversed });
const igual = (a, b) => JSON.stringify(t(a)) === JSON.stringify(t(b));

for (const kase of CASES) {
  const { editado, referencia } = observado[kase.id];
  console.log(`${kase.id} (esperado hoje: ${kase.esperadoHoje})`);
  if (kase.soTemporal) {
    console.log(`  (registro: apply=${editado.edicao?.aplicou}, erro=${editado.edicao?.erro})`);
    check('estado temporal intacto no tick', igual(editado.tick1, referencia.tick1) && igual(editado.tick2, referencia.tick2),
      `tick1 ${JSON.stringify(t(editado.tick1))} vs ref ${JSON.stringify(t(referencia.tick1))}`);
    continue;
  }
  check('edição aplicou', editado.edicao?.aplicou === true, JSON.stringify(editado.edicao));
  check('end novo renderiza (160)', editado.endRenderizado === 160, `end=${editado.endRenderizado}`);
  check('estado temporal intacto no instante', igual(editado.depois, referencia.depois),
    `${JSON.stringify(t(editado.depois))} vs ref ${JSON.stringify(t(referencia.depois))}`);
  check('estado temporal intacto no tick 1', igual(editado.tick1, referencia.tick1),
    `${JSON.stringify(t(editado.tick1))} vs ref ${JSON.stringify(t(referencia.tick1))}`);
  check('estado temporal intacto no tick 2', igual(editado.tick2, referencia.tick2),
    `${JSON.stringify(t(editado.tick2))} vs ref ${JSON.stringify(t(referencia.tick2))}`);
}

// --- contrato: o observado tem que bater com o baseline congelado ------------
let baseline = null;
try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch (_) {}
if (!baseline) {
  console.error('\nSem baseline — rode com --record e congele o JSON em _probe-editwrite-witness.baseline.json');
  process.exit(1);
}
const contrato = JSON.stringify(observado) === JSON.stringify(baseline);
console.log(`\n${red} RED · contrato-vs-baseline: ${contrato ? 'BATE' : 'DIVERGIU'}`);
process.exit(contrato ? 0 : 1);
