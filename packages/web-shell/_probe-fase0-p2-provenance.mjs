// FASE 0 / P2 — conversão escalar→função vs malha de proveniência da fase-2.
//
// A malha congela shape/source/props de vars pra detectar mutação LATENTE da
// página (edição própria do bridge captura-antes/refresca-depois). Converter
// um var irmão escalar→função MUDA o shape de vars — e cria um var de FUNÇÃO,
// classe que o hazard de funções dinâmicas (item 170e, sibling-aware) vigia.
//
// O que se MEDE (2 e 3 registram, não assumem; 1 e 4 são controles e assertam):
//   1. controle-vivo: o detector estava vivo (step edit funciona; mutação da
//      página no keyframe → edit seguinte com token antigo é recusado).
//   2. conversao-propria: converter y (top-level irmão) escalar→função com a
//      mecânica do writer candidato → step edit de x com token PRÉ-conversão
//      ainda aplica? (shape de vars mudou — a malha considera isso latente?)
//   3. conversao-retarget-irmao: após a conversão de y, retarget.final de x
//      pelo caminho REAL aplica? (função em y dispara hazard animation-level
//      pro irmão x?)
//   4. adversarial-pos-conversao: a conversão NÃO pode cegar o detector — a
//      página mutando keyframes[1].x depois dela TEM que continuar recusada.
//
// Setup segue o template do _probe-phase2-witness.mjs (tracked): keyframes de
// x + top-level y, duration 300.
import { openCase, closeBrowser } from './_probe-fase0-harness.mjs';

const SETUP = `
  window.__tw = gsap.to('#a', { keyframes: [{ x: 100 }, { x: 200 }, { x: 300 }], y: 40, duration: 300 });
`;

const CONVERT_Y = `
  const tw = window.__tw;
  window.__originalY = tw.vars.y;
  tw.vars.y = (index, target) => 80;
  let parked = null;
  const current = tw.progress();
  if (Number.isFinite(current) && current > 0) { parked = current; tw.progress(0, true); }
  tw.invalidate();
  if (parked != null) tw.progress(parked, true);
  return true;
`;

const ENTRIES_X = `return window.__tw.vars.keyframes.map((k) => (k.css ? k.css.x : k.x))`;

function stepPatch(sel, motionId, token, entryIndex, value) {
  return {
    elementId: sel.elementId, kind: 'motion', motionId,
    property: 'keyframeStep.x',
    before: { entryIndex, token, value: '', exists: true },
    value: { entryIndex, token, value, exists: true },
  };
}

function tokenFor(sel, motionId, entryIndex) {
  const clip = (sel.motion || []).find((m) => m.id === motionId);
  const track = clip?.tracks?.find((t) => t.property === 'x');
  return track?.steps?.find((s) => s.entryIndex === entryIndex)?.token ?? null;
}

const falhas = [];
const assert = (cond, msg) => { if (!cond) falhas.push(msg); };
const registro = {};

// --- 1. controle-vivo -------------------------------------------------------
{
  const kase = await openCase({ setup: SETUP });
  let sel = await kase.select('a');
  const motionId = sel.motionIds[0];
  const t1 = tokenFor(sel, motionId, 1);
  assert(t1, 'controle: token do step x@1 não exposto');
  const r1 = await kase.applyPatch(stepPatch(sel, motionId, t1, 1, '500'));
  const e1 = await kase.evalInPage(ENTRIES_X);
  assert(r1.ok && JSON.stringify(e1) === '[100,500,300]',
    `controle: step edit não aplicou (${JSON.stringify({ r1, e1 })})`);
  // token fresco da exposição corrente, DEPOIS mutação da página, DEPOIS edit
  sel = await kase.select('a');
  const t2 = tokenFor(sel, motionId, 1);
  await kase.evalInPage(`window.__tw.vars.keyframes[1].x = 999; return true`);
  const r2 = await kase.applyPatch(stepPatch(sel, motionId, t2, 1, '600'));
  const e2 = await kase.evalInPage(ENTRIES_X);
  assert(!r2.ok || String(e2[1]) === '999',
    `controle: mutação da página NÃO foi detectada (${JSON.stringify({ r2, e2 })}) — detector morto`);
  registro.controle = { editAplicou: r1.ok, mutacaoRecusada: !r2.ok, entradaFinal: e2[1], erro: r2.erro };
  await kase.close();
}

// --- 2. conversao-propria ---------------------------------------------------
{
  const kase = await openCase({ setup: SETUP });
  const sel = await kase.select('a');
  const motionId = sel.motionIds[0];
  const t1 = tokenFor(sel, motionId, 1);
  await kase.evalInPage(CONVERT_Y);
  const r = await kase.applyPatch(stepPatch(sel, motionId, t1, 1, '500'));
  const e = await kase.evalInPage(ENTRIES_X);
  registro.conversaoPropria = { stepAplicouComTokenPre: r.ok, erro: r.erro, entradas: e };
  await kase.close();
}

// --- 3. conversao-retarget-irmao (caminho REAL) ------------------------------
{
  const kase = await openCase({ setup: `window.__tw = gsap.to('#a', { x: 100, y: 40, duration: 300 });` });
  const sel = await kase.select('a');
  const motionId = sel.motionIds[0];
  await kase.evalInPage(CONVERT_Y);
  const r = await kase.applyPatch({
    elementId: sel.elementId, kind: 'motion', motionId,
    property: 'retarget.final', before: null,
    value: { schemaVersion: 2, runtimeProperty: 'x', value: 350, writeModel: 'absolute', affectedTargetCount: 1 },
  });
  const fim = await kase.evalInPage(`
    const tw = window.__tw; tw.progress(0, true); tw.progress(1, true);
    return Number(gsap.getProperty(document.getElementById('a'), 'x'));
  `);
  registro.retargetIrmao = { aplicou: r.ok, erro: r.erro, endDeX: fim };
  await kase.close();
}

// --- 3b. controle de sobre-determinação: pós-conversão, exposição fresca,
// SEM mutação da página — se isto TAMBÉM recusa, o caso 4 não isola o
// detector (a recusa seria da conversão, não da mutação).
{
  const kase = await openCase({ setup: SETUP });
  let sel = await kase.select('a');
  const motionId = sel.motionIds[0];
  await kase.evalInPage(CONVERT_Y);
  sel = await kase.select('a');
  const t = tokenFor(sel, motionId, 1);
  const r = await kase.applyPatch(stepPatch(sel, motionId, t, 1, '500'));
  const e = await kase.evalInPage(ENTRIES_X);
  registro.posConversaoSemMutacao = { tokenExposto: Boolean(t), aplicou: r.ok, erro: r.erro, entradas: e };
  await kase.close();
}

// --- 4. adversarial-pos-conversao -------------------------------------------
{
  const kase = await openCase({ setup: SETUP });
  let sel = await kase.select('a');
  const motionId = sel.motionIds[0];
  await kase.evalInPage(CONVERT_Y);
  // exposição fresca PÓS-conversão (a UI re-expõe depois de qualquer edição)
  sel = await kase.select('a');
  const t = tokenFor(sel, motionId, 1);
  await kase.evalInPage(`window.__tw.vars.keyframes[1].x = 999; return true`);
  const r = await kase.applyPatch(stepPatch(sel, motionId, t, 1, '600'));
  const e = await kase.evalInPage(ENTRIES_X);
  assert(!r.ok || String(e[1]) === '999',
    `adversarial: conversão CEGOU o detector (${JSON.stringify({ r, e })})`);
  registro.adversarialPosConversao = { mutacaoRecusada: !r.ok, erro: r.erro, entradaFinal: e[1] };
  await kase.close();
}

await closeBrowser();
console.log(JSON.stringify(registro, null, 2));
if (falhas.length) {
  console.error(`\nP2 CONTROLES FALHARAM:\n${falhas.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nP2 controles OK — vereditos dos casos 2/3 acima (registrados, não assumidos)');
