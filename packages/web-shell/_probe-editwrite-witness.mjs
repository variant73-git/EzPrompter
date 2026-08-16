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
// HISTÓRICO: em 2026-08-05 este witness congelou 6 RED — repeat2 (totalTime
// teleportava 1.5→0.5, iteração inteira perdida) e repeat-∞ (2.5→1.5, a
// batida perdida da classe da inspeção). O fix fase-0 Task 7 (park/restore
// por totalTime nos dois seams) virou tudo VERDE e o baseline atual congela
// o comportamento CORRETO — qualquer RED daqui pra frente é regressão.
// Notas de medição que ficam: yoyo simples nunca reproduziu (forma anotada
// no caso); yoyoEase: o retarget absoluto APLICA (lock unsampleable é
// end-only na UI, não no bridge) e o temporal fica intacto.
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
    esperadoHoje: 'verde (pós-fix; era RED)',
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
    esperadoHoje: 'verde (pós-fix; era RED)',
    criar: `gsap.to([E('a'), E('b')], { x: 100, duration: 1, repeat: -1, paused: true })`,
    posicionar: `tw.totalTime(2.5, true)`,
  },
  {
    // Bloqueador do Sol (audit P6b, 2026-08-05), REPRODUZIDO: o writeModel
    // PUBLICADO pra loop é 'additive-base', e o start desse modelo era lido
    // com progress(0) — que numa iteração posterior renderiza o FIM da
    // iteração anterior (probado: totalTime 2.5 → progress(0) dá x=100, não
    // 0). Num loop 0→100 com frame visível 50 editado pra 160, o modelo
    // gravava startAt=210/vars.x=210 e renderizava 210. Este caso DERIVA o
    // writeModel da publicação (nunca força absolute) e checa frame visível,
    // endpoints (startAt/vars) e rollback.
    id: 'repeat-infinito-additive-base',
    esperadoHoje: 'verde (pós-fix; era RED)',
    additive: true,
    criar: `gsap.to([E('a'), E('b')], { x: 100, duration: 1, ease: 'none', repeat: -1, paused: true })`,
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
  const out = await page.evaluate(([bridge, criar, posicionar, doEdit, additive]) => {
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

    // O writeModel vem da PUBLICAÇÃO (nunca forçado) no caso additive — o
    // bloqueador do Sol era exatamente o modelo publicado não exercitado.
    const trackX = (sel?.payload?.element?.motion?.[0]?.tracks || []).find((tr) => tr.property === 'x');
    const writeModel = additive ? trackX?.ownership?.writeModel : 'absolute';
    const enviarPatch = (valor) => {
      const marca = messages.length;
      window.dispatchEvent(new MessageEvent('message', {
        source: window,
        data: {
          protocol: 'uncraft-motion-editor/v1', source: 'host', type: 'apply-patch',
          payload: { patch: {
            elementId, kind: 'motion', motionId,
            property: 'retarget.final', before: null,
            value: { schemaVersion: 2, runtimeProperty: 'x', value: valor, writeModel, affectedTargetCount: 2 },
          } },
        },
      }));
      const err = messages.slice(marca)
        .filter((m) => m.type === 'patch-rejected' || m.type === 'error').pop();
      return { aplicou: !err, erro: err ? (err.payload?.message || err.type) : null };
    };

    let edicao = null;
    let loopBase = null;
    if (doEdit) {
      edicao = enviarPatch(160);
      edicao.writeModelUsado = writeModel;
      if (additive && edicao.aplicou) {
        const frameVisivel = X(E('a'));
        const varsX = tw.vars.x;
        const startAtX = tw.vars.startAt ? tw.vars.startAt.x : null;
        const rollback = enviarPatch(50);
        loopBase = {
          frameVisivel, varsX, startAtX,
          rollback: {
            aplicou: rollback.aplicou, erro: rollback.erro,
            frameVisivel: X(E('a')), varsX: tw.vars.x,
            startAtX: tw.vars.startAt ? tw.vars.startAt.x : null,
          },
        };
      }
    }
    const depois = { ...temporal(tw), alvoX: X(E('a')) };

    // O dano aparece no TICK SEGUINTE.
    tw.totalTime(tw.totalTime() + 0.1, true);
    const tick1 = { ...temporal(tw), alvoX: X(E('a')) };
    tw.totalTime(tw.totalTime() + 0.1, true);
    const tick2 = { ...temporal(tw), alvoX: X(E('a')) };

    // A edição tem que TER acontecido: end novo renderizando do início.
    // (No caso additive o rollback já rodou — o end é checado via loopBase.)
    let endRenderizado = null;
    if (doEdit && edicao?.aplicou && !additive) {
      const parked = tw.totalTime();
      tw.totalTime(0, true);
      tw.totalTime(tw.duration(), true);   // fim da 1ª ida
      endRenderizado = X(E('a'));
      tw.totalTime(parked, true);
    }

    return { antes, edicao, depois, tick1, tick2, endRenderizado, loopBase };
  }, [bridgeSrc, kase.criar, kase.posicionar, editar, Boolean(kase.additive)]);
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
  if (kase.additive) {
    const lb = editado.loopBase || {};
    check('writeModel derivado da publicação = additive-base', editado.edicao?.writeModelUsado === 'additive-base',
      `writeModel=${editado.edicao?.writeModelUsado}`);
    check('frame visível editado = 160', lb.frameVisivel === 160, `frame=${lb.frameVisivel}`);
    check('endpoints do loop deslocados (vars.x=210, startAt.x=110)',
      String(lb.varsX) === '210' && String(lb.startAtX) === '110',
      `vars.x=${lb.varsX} startAt.x=${lb.startAtX}`);
    check('rollback: frame visível volta a 50', lb.rollback?.frameVisivel === 50, `frame=${lb.rollback?.frameVisivel}`);
    check('rollback: endpoints restaurados (vars.x=100, startAt.x=0)',
      String(lb.rollback?.varsX) === '100' && String(lb.rollback?.startAtX) === '0',
      `vars.x=${lb.rollback?.varsX} startAt.x=${lb.rollback?.startAtX}`);
    check('estado temporal intacto no instante', igual(editado.depois, referencia.depois),
      `${JSON.stringify(t(editado.depois))} vs ref ${JSON.stringify(t(referencia.depois))}`);
    check('estado temporal intacto no tick 1', igual(editado.tick1, referencia.tick1),
      `${JSON.stringify(t(editado.tick1))} vs ref ${JSON.stringify(t(referencia.tick1))}`);
    check('estado temporal intacto no tick 2', igual(editado.tick2, referencia.tick2),
      `${JSON.stringify(t(editado.tick2))} vs ref ${JSON.stringify(t(referencia.tick2))}`);
    continue;
  }
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
