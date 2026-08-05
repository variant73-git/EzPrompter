// FASE 0 / P4 — conversão escalar→função por alvo num tween JÁ VIVO.
//
// O que o 172 provou: função por alvo funciona NA CRIAÇÃO. O que falta (e este
// probe mede): converter `vars.x` escalar→função num tween multi-target vivo,
// com a MECÂNICA do writer candidato — a semântica EXATA de
// `invalidatePreservingStart` (park progress→0 com render, invalidate, volta),
// que é o que o bridge usa em todo retarget (precedente do item 168).
//
// ⚠️ O canal per-target NÃO existe no bridge hoje (applyGsapRetarget recusa
// por scope_mismatch — ver finding P3). Este probe prova a mecânica que o
// writer da Fase 1 vai funnelar por applyGsapRetarget; o harness (P3) é usado
// pra montar a página com o bridge REAL vivo (mesmo ambiente), e a conversão
// roda na página via evalInPage.
//
// Método: referência INTOCADA em página própria; asserção de VIDA antes de
// medir; validação renderizando DO INÍCIO; sensibilidade (escalar cru TEM que
// contaminar o irmão e o probe TEM que ver).
import { openCase, closeBrowser } from './_probe-fase0-harness.mjs';

const SAMPLES = [0, 0.25, 0.5, 0.75, 1];

const SETUP = `
  window.__tw = gsap.to(['#a', '#b'], { x: 100, duration: 1, paused: true });
  window.__tw.progress(0.5, true);
`;

// Trajetória completa renderizando do início (restaura o park no fim).
const TRAJ = `
  const tw = window.__tw;
  const parked = tw.progress();
  const a = document.getElementById('a'), b = document.getElementById('b');
  const traj = { a: [], b: [] };
  for (const p of ${JSON.stringify(SAMPLES)}) {
    tw.progress(p, true);
    traj.a.push(Number(gsap.getProperty(a, 'x')));
    traj.b.push(Number(gsap.getProperty(b, 'x')));
  }
  tw.progress(parked, true);
  return traj;
`;

// A mecânica do writer candidato: muda vars.x e re-inicializa preservando o
// início — CÓPIA EXATA de invalidatePreservingStart (runtime-bridge-source).
const CONVERT_FN = `
  const tw = window.__tw;
  window.__originalX = tw.vars.x;
  tw.vars.x = (index, target) => (target === document.getElementById('a') ? arg : 100);
  let parked = null;
  const current = tw.progress();
  if (Number.isFinite(current) && current > 0) { parked = current; tw.progress(0, true); }
  tw.invalidate();
  if (parked != null) tw.progress(parked, true);
  return { vidaAntes: true };
`;

const ROLLBACK_FN = `
  const tw = window.__tw;
  tw.vars.x = window.__originalX;
  let parked = null;
  const current = tw.progress();
  if (Number.isFinite(current) && current > 0) { parked = current; tw.progress(0, true); }
  tw.invalidate();
  if (parked != null) tw.progress(parked, true);
  return { tipoDoVarsX: typeof tw.vars.x, valorDoVarsX: tw.vars.x };
`;

// Sensibilidade: o jeito ERRADO (escalar cru) tem que contaminar o irmão.
const CONVERT_WRONG_FN = `
  const tw = window.__tw;
  tw.vars.x = arg;   // escalar cru — sem função por alvo
  let parked = null;
  const current = tw.progress();
  if (Number.isFinite(current) && current > 0) { parked = current; tw.progress(0, true); }
  tw.invalidate();
  if (parked != null) tw.progress(parked, true);
  return true;
`;

const falhas = [];
const assert = (cond, msg) => { if (!cond) falhas.push(msg); };

// Referência: página idêntica, NUNCA editada.
const ref = await openCase({ setup: SETUP });
const refTraj = await ref.evalInPage(TRAJ);
await ref.close();
assert(refTraj.a[0] === 0 && refTraj.a[4] === 100, `referência inválida: ${JSON.stringify(refTraj)}`);

// --- caso-basico ------------------------------------------------------------
{
  const kase = await openCase({ setup: SETUP });
  // VIDA: o tween movia ANTES da conversão (X(a) em progress 0.5 ≠ 0; o valor
  // exato é 75 porque o ease default do gsap.to é power1.out, não linear).
  const vida = await kase.evalInPage(`return Number(gsap.getProperty(document.getElementById('a'), 'x'))`);
  assert(vida > 0, `caso-basico: tween não estava vivo antes (x=${vida}, esperado > 0)`);
  await kase.evalInPage(CONVERT_FN, 160);
  const traj = await kase.evalInPage(TRAJ);
  assert(traj.a[0] === refTraj.a[0], `caso-basico: início de a mudou (${traj.a[0]} vs ${refTraj.a[0]})`);
  assert(traj.a[4] === 160, `caso-basico: end de a esperado 160, veio ${traj.a[4]}`);
  assert(JSON.stringify(traj.b) === JSON.stringify(refTraj.b),
    `caso-basico: irmão b divergiu da referência: ${JSON.stringify(traj.b)} vs ${JSON.stringify(refTraj.b)}`);
  await kase.close();
  console.log(`caso-basico          a:${JSON.stringify(traj.a)} b=ref:${JSON.stringify(traj.b) === JSON.stringify(refTraj.b)}`);
}

// --- caso-rollback ----------------------------------------------------------
{
  const kase = await openCase({ setup: SETUP });
  await kase.evalInPage(CONVERT_FN, 160);
  const meio = await kase.evalInPage(TRAJ);
  assert(meio.a[4] === 160, `caso-rollback: conversão não aplicou (end=${meio.a[4]})`);
  const undo = await kase.evalInPage(ROLLBACK_FN);
  const traj = await kase.evalInPage(TRAJ);
  assert(undo.tipoDoVarsX === 'number' && undo.valorDoVarsX === 100,
    `caso-rollback: vars.x não voltou ao escalar original (${undo.tipoDoVarsX}=${undo.valorDoVarsX})`);
  assert(JSON.stringify(traj) === JSON.stringify(refTraj),
    `caso-rollback: trajetória não voltou byte-igual à referência: ${JSON.stringify(traj)} vs ${JSON.stringify(refTraj)}`);
  await kase.close();
  console.log(`caso-rollback        vars.x=${undo.valorDoVarsX} traj=ref:${JSON.stringify(traj) === JSON.stringify(refTraj)}`);
}

// --- caso-sensibilidade -----------------------------------------------------
{
  const kase = await openCase({ setup: SETUP });
  await kase.evalInPage(CONVERT_WRONG_FN, 160);
  const traj = await kase.evalInPage(TRAJ);
  assert(traj.b[4] === 160,
    `caso-sensibilidade: escalar cru DEVIA contaminar b (end=${traj.b[4]}, esperado 160) — instrumento cego`);
  await kase.close();
  console.log(`caso-sensibilidade   b contaminado (end=${traj.b[4]}) — instrumento enxerga contaminação`);
}

await closeBrowser();
if (falhas.length) {
  console.error(`\nP4 FALHOU:\n${falhas.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nP4 OK (3/3) — conversão escalar→função isola o alvo com rollback exato');
