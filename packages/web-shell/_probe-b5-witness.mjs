// WITNESS do GATE B5 (Fase 1): per-target override sob repeat FINITO (sem
// yoyo), pelo caminho de protocolo v2 real, GSAP 3.15 real, writeModel/
// perTarget derivados da PUBLICAÇÃO. É a PROVA que promove a chave B5
// (multi-target plano · repeat inteiro positivo finito, yoyo:false, sem outros
// modificadores temporais · per-target · patch real) pro degrau 3 na Tabela B.
//
// Predicado QUANTIFICADO (advise Sol 2026-08-05): a prova é por MATRIZ, não
// por exemplar — n=1 (mínimo), n=2 (parado em iteração posterior, canônico) e
// n=5 (n>2), cada um com trajetória pelo clock TOTAL e irmão byte-igual à
// referência. Obrigações extras do advise: fronteiras exatas + ticks ±ε,
// iteration()/progress() congelados, contagem de callbacks vs referência,
// tween RODANDO, boundaries recusados POR MENSAGEM (infinito/nulo/fração/
// repeatDelay-via-SETTER/repeatRefresh/yoyoEase/easeReverse/yoyo-sem-repeat/
// duração-zero/timeline-pai), lane de timing guardada, split available/
// writable sob drift. Controles de sensibilidade: escalar cru contamina o
// irmão E invalidate cru corrompe o loop (classe P6b) — o instrumento TEM que
// enxergar o positivo (lição 172).
//
// Uso:
//   node _probe-b5-witness.mjs            # assertivo (baseline + contagem RED)
//   node _probe-b5-witness.mjs --record   # imprime JSON pra congelar
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const bridgeSrc = getRuntimeBridgeSource();
const RECORD = process.argv.includes('--record');
const BASELINE_PATH = new URL('./_probe-b5-witness.baseline.json', import.meta.url);

const HARNESS = `
window.__H = (() => {
  const V1 = 'uncraft-motion-editor/v1';
  const V2 = 'uncraft-motion-editor/v2';
  const NONCE = 'nonce-b5-witness-123456';
  const BUNDLE = 'bundle-b5';
  const SESSION = 'session-b5';
  const ORIGIN = 'https://app.uncraft.test';
  const messages = [];
  let generation = null;
  let seq = 0;

  function boot() {
    const config = document.createElement('script');
    config.type = 'application/json';
    config.dataset.uncraftRuntimeConfig = 'true';
    config.textContent = JSON.stringify({
      initialManifest: { schemaVersion: 2, baseBundleId: BUNDLE, transactions: [] },
      runtimeSessionId: SESSION,
      runtimeFingerprint: 'sha256:b5-witness',
      sessionNonce: NONCE,
    });
    document.head.appendChild(config);
    window.postMessage = (m) => messages.push(m);
    window.eval(window.__BRIDGE_SRC);
    const ready = messages.filter((m) => m.type === 'runtime-ready').pop();
    generation = ready.payload.runtimeGeneration;
    window.dispatchEvent(new MessageEvent('message', {
      source: window, origin: ORIGIN,
      data: {
        protocol: V1, protocolVersion: V1,
        supportedProtocols: [V2, V1],
        source: 'host', type: 'negotiate-protocol', requestId: 'negotiate-b5',
        sessionNonce: NONCE, runtimeGeneration: generation, bundleId: BUNDLE, sessionId: SESSION,
        payload: { selectedProtocol: V2 },
      },
    }));
    const negotiated = messages.filter((m) => m.type === 'protocol-negotiated').pop();
    return { negotiated: negotiated?.payload?.selectedProtocol === V2 };
  }

  function sendV2(type, payload) {
    const requestId = 'b5-req-' + (seq += 1);
    const mark = messages.length;
    window.dispatchEvent(new MessageEvent('message', {
      source: window, origin: ORIGIN,
      data: {
        protocol: V2, protocolVersion: V2,
        supportedProtocols: [V2, V1],
        source: 'host', type,
        sessionNonce: NONCE, requestId,
        runtimeGeneration: generation, bundleId: BUNDLE, sessionId: SESSION,
        payload,
      },
    }));
    return messages.slice(mark);
  }

  function select(domId) {
    document.getElementById(domId).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const sel = messages.filter((m) => m.type === 'selection-changed').pop();
    const element = sel?.payload?.element || {};
    const motion = (element.motion || [])[0] || null;
    const track = (motion?.tracks || []).find((t) => t.property === 'x') || null;
    return { elementId: element.id, motionId: motion?.id || null, track };
  }

  function v3(ownership, intent, value) {
    return {
      schemaVersion: 3,
      semanticProperty: 'translateX',
      runtimeProperty: (ownership && ownership.runtimeProperty) || 'x',
      targetScope: { mode: 'single' },
      intent,
      ...(intent === 'override' ? { value } : {}),
      writeModel: (ownership && ownership.writeModel) || 'absolute',
      affectedTargetCount: (ownership && ownership.affectedTargetCount) || 2,
    };
  }

  function applyTx(txId, elementId, motionId, descriptor) {
    const replies = sendV2('apply-transaction', {
      transaction: {
        id: txId,
        patches: [{ id: txId + ':p1', elementId, kind: 'motion', motionId, property: 'retarget.final', before: null, value: descriptor }],
      },
    });
    const ack = replies.filter((m) => ['transaction-committed', 'transaction-rejected'].includes(m.type)).pop();
    return { committed: ack?.type === 'transaction-committed', ack: ack ? { type: ack.type, code: ack.payload?.code || null } : null };
  }

  function rollbackTx(txId) {
    const replies = sendV2('rollback-transaction', { targetTransactionId: txId });
    const ack = replies.filter((m) => ['transaction-committed', 'transaction-rejected'].includes(m.type)).pop();
    return { committed: ack?.type === 'transaction-committed', ack: ack ? { type: ack.type, code: ack.payload?.code || null } : null };
  }

  // apply-patch simples: carrega a MENSAGEM de recusa (patch-rejected.error).
  function applyPatch(elementId, motionId, property, value) {
    const replies = sendV2('apply-patch', {
      patch: { elementId, kind: 'motion', motionId, property, before: null, value },
    });
    const rejected = replies.filter((m) => m.type === 'patch-rejected').pop();
    return { applied: !rejected, error: rejected ? rejected.payload?.error || null : null };
  }

  function groupEditV2(elementId, motionId, value) {
    return applyPatch(elementId, motionId, 'retarget.final', {
      schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value, writeModel: 'absolute', affectedTargetCount: 2,
    });
  }

  function trajectory(tw, domId) {
    const el = document.getElementById(domId);
    const parked = tw.totalTime();
    const total = tw.totalDuration();
    const samples = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      tw.totalTime(f * total, true);
      return Number(Number(gsap.getProperty(el, 'x')).toFixed(4));
    });
    tw.totalTime(parked, true);
    return samples;
  }

  function temporal(tw) {
    return {
      totalTime: Number(tw.totalTime().toFixed(6)),
      progress: Number(tw.progress().toFixed(6)),
      iteration: typeof tw.iteration === 'function' ? tw.iteration() : null,
      reversed: tw.reversed(),
    };
  }

  function renderAt(tw, t) {
    const parked = tw.totalTime();
    tw.totalTime(t, true);
    const out = {
      a: Number(Number(gsap.getProperty(document.getElementById('a'), 'x')).toFixed(4)),
      b: Number(Number(gsap.getProperty(document.getElementById('b'), 'x')).toFixed(4)),
    };
    tw.totalTime(parked, true);
    return out;
  }

  return { boot, sendV2, select, v3, applyTx, rollbackTx, applyPatch, groupEditV2, trajectory, temporal, renderAt, messages };
})();
`;

const browser = await chromium.launch({ headless: true });

async function newCasePage() {
  const page = await browser.newPage();
  await page.setContent(['a', 'b'].map((id) => `<div id="${id}" style="width:40px;height:40px"></div>`).join(''));
  await page.addScriptTag({ content: gsapSrc });
  await page.evaluate((src) => { window.__BRIDGE_SRC = src; }, bridgeSrc);
  await page.addScriptTag({ content: HARNESS });
  return page;
}

// Caso padrão da chave: repeat:2, parado em ITERAÇÃO POSTERIOR (totalTime 1.5).
async function runCase(body, { repeat = 2, park = 1.5, extraVars = '' } = {}) {
  const page = await newCasePage();
  const out = await page.evaluate(({ caseBody, repeatN, parkAt, extra }) => {
    /* eslint-disable no-undef */
    const H = window.__H;
    const vars = Object.assign(
      { x: 100, duration: 1, ease: 'none', repeat: repeatN, paused: true },
      extra ? JSON.parse(extra) : {},
    );
    const tw = gsap.to([document.getElementById('a'), document.getElementById('b')], vars);
    if (parkAt > 0) tw.totalTime(parkAt, true);
    window.__TW = tw;
    H.boot();
    return new Function('H', 'tw', 'gsap', caseBody)(H, tw, gsap);
  }, { caseBody: body, repeatN: repeat, parkAt: park, extra: extraVars });
  await page.close();
  return out;
}

// ---- Página de REFERÊNCIA (selecionada, nunca editada) — inclui ticks ±ε e
// varredura de callbacks com eventos LIGADOS (suppressEvents=false).
const referencia = await runCase(`
  const A = H.select('a');
  const tickMinus = H.renderAt(tw, 1.45);
  const tickPlus = H.renderAt(tw, 1.55);
  const counts = { onRepeat: 0, onUpdate: 0, onComplete: 0 };
  tw.eventCallback('onRepeat', () => { counts.onRepeat += 1; });
  tw.eventCallback('onUpdate', () => { counts.onUpdate += 1; });
  tw.eventCallback('onComplete', () => { counts.onComplete += 1; });
  tw.totalTime(0, true);
  for (let t = 0.25; t <= 3.0001; t += 0.25) tw.totalTime(Math.min(t, 3), false);
  const sweep = { ...counts };
  tw.totalTime(1.5, true);
  return {
    negotiatedTrack: Boolean(A.track),
    trajA: H.trajectory(tw, 'a'),
    trajB: H.trajectory(tw, 'b'),
    temporal: H.temporal(tw),
    tickMinus, tickPlus, sweep,
  };
`);

// ---- Fluxo principal (n=2, park 1.5): publicação → override → grupo →
// re-exposição → undo/redo → clear final.
const principal = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const published = {
    writeModel: ownership && ownership.writeModel,
    perTargetAvailable: Boolean(ownership && ownership.perTarget && ownership.perTarget.available),
    perTargetWritable: Boolean(ownership && ownership.perTarget && ownership.perTarget.writable),
  };
  const tx1 = H.applyTx('tx-b5-a', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const afterOverride = {
    trajA: H.trajectory(tw, 'a'),
    trajB: H.trajectory(tw, 'b'),
    temporal: H.temporal(tw),
    parkedRender: H.renderAt(tw, tw.totalTime()),
    tickMinus: H.renderAt(tw, 1.45),
    tickPlus: H.renderAt(tw, 1.55),
    varsXType: typeof tw.vars.x,
  };
  tw.totalTime(tw.totalTime() + 0.1, true);
  const tick1 = H.temporal(tw);
  tw.totalTime(1.5, true);
  const wrapperBefore = tw.vars.x;
  const B = H.select('b');
  const tx2 = H.applyTx('tx-b5-c', B.elementId, B.motionId, H.v3(ownership, 'override', 140));
  const identidadeMantida = tw.vars.x === wrapperBefore;
  const afterSecond = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
  const rbB = H.rollbackTx('tx-b5-c');
  const group = H.groupEditV2(A.elementId, A.motionId, 120);
  const afterGroup = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b'), temporal: H.temporal(tw) };
  const reA = H.select('a');
  const reOwnership = reA.track && reA.track.ownership;
  const reexposure = {
    writeModel: reOwnership && reOwnership.writeModel,
    sourceValue: reOwnership && reOwnership.sourceValue,
    writable: Boolean(reOwnership && reOwnership.perTarget && reOwnership.perTarget.writable),
    states: reOwnership && reOwnership.perTarget ? reOwnership.perTarget.states.map((s) => ({ elementId: s.elementId, intent: s.intent, value: s.value === undefined ? null : s.value })) : null,
  };
  const rbA = H.rollbackTx('tx-b5-a');
  const afterUndo = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b'), varsXType: typeof tw.vars.x, varsX: typeof tw.vars.x === 'function' ? null : tw.vars.x };
  const redo = H.applyTx('tx-b5-redo', A.elementId, A.motionId, H.v3(reOwnership, 'override', 160));
  const afterRedo = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
  const clear = H.applyTx('tx-b5-clear', A.elementId, A.motionId, H.v3(reOwnership, 'clear'));
  const afterClear = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b'), varsX: tw.vars.x, varsXType: typeof tw.vars.x, temporal: H.temporal(tw) };
  return { published, tx1, afterOverride, tick1, tx2, identidadeMantida, afterSecond, rbB, group, afterGroup, reexposure, rbA, afterUndo, redo, afterRedo, clear, afterRedoClear: afterClear };
`);

// ---- MATRIZ n=1 (mínimo): park 1.5 = 2ª (última) iteração.
const matrizN1 = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const perTargetAvailable = Boolean(ownership && ownership.perTarget && ownership.perTarget.available);
  const tx = H.applyTx('tx-b5-n1', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const after = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b'), temporal: H.temporal(tw) };
  const rb = H.rollbackTx('tx-b5-n1');
  const afterUndo = { trajA: H.trajectory(tw, 'a'), varsX: tw.vars.x, varsXType: typeof tw.vars.x };
  return { perTargetAvailable, tx, after, rb, afterUndo };
`, { repeat: 1, park: 1.5 });

// ---- MATRIZ n=5 (n>2): park 4.2 = 5ª iteração.
const matrizN5 = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const perTargetAvailable = Boolean(ownership && ownership.perTarget && ownership.perTarget.available);
  const tx = H.applyTx('tx-b5-n5', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const after = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b'), temporal: H.temporal(tw) };
  const rb = H.rollbackTx('tx-b5-n5');
  const afterUndo = { trajA: H.trajectory(tw, 'a'), varsX: tw.vars.x, varsXType: typeof tw.vars.x };
  return { perTargetAvailable, tx, after, rb, afterUndo };
`, { repeat: 5, park: 4.2 });

// ---- FRONTEIRAS EXATAS: park na fronteira de iteração (t=2.0 — GSAP renderiza
// como FIM da anterior, lição 173), no fim absoluto (t=3.0) e em t=0.
const fronteiras = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  tw.totalTime(2.0, true);
  const tx1 = H.applyTx('tx-b5-f1', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const atBoundary = { temporal: H.temporal(tw), render: H.renderAt(tw, tw.totalTime()) };
  tw.totalTime(3.0, true);
  const tx2 = H.applyTx('tx-b5-f2', A.elementId, A.motionId, H.v3(ownership, 'override', 180));
  const atEnd = { temporal: H.temporal(tw), render: H.renderAt(tw, tw.totalTime()) };
  tw.totalTime(0, true);
  const tx3 = H.applyTx('tx-b5-f3', A.elementId, A.motionId, H.v3(ownership, 'override', 200));
  const atZero = { temporal: H.temporal(tw), render: H.renderAt(tw, tw.totalTime()), trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
  return { tx1, atBoundary, tx2, atEnd, tx3, atZero };
`, { repeat: 2, park: 0 });

// ---- TWEEN RODANDO (não pausado): o settlement não garante pausa (advise Q5).
// Só fatos ESTÁVEIS entram no baseline (committed, wrapper, trajetórias pós-pausa).
const running = await (async () => {
  const page = await newCasePage();
  const out = await page.evaluate(() => {
    /* eslint-disable no-undef */
    return (async () => {
      const H = window.__H;
      const tw = gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true });
      tw.totalTime(1.2, true);
      H.boot();
      const A = H.select('a');
      const ownership = A.track && A.track.ownership;
      tw.play();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const wasPlaying = !tw.paused();
      const tx = H.applyTx('tx-b5-run', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
      const stillPlaying = !tw.paused();
      tw.pause();
      const after = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b'), varsXType: typeof tw.vars.x, totalTimeAdvanced: tw.totalTime() > 1.2 };
      return { wasPlaying, tx, stillPlaying, after };
    })();
  });
  await page.close();
  return out;
})();

// ---- CALLBACKS: a mesma varredura da referência na página EDITADA — o
// override não pode mudar a contagem de onRepeat/onUpdate/onComplete.
const callbacks = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const tx = H.applyTx('tx-b5-cb', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const counts = { onRepeat: 0, onUpdate: 0, onComplete: 0 };
  tw.eventCallback('onRepeat', () => { counts.onRepeat += 1; });
  tw.eventCallback('onUpdate', () => { counts.onUpdate += 1; });
  tw.eventCallback('onComplete', () => { counts.onComplete += 1; });
  tw.totalTime(0, true);
  for (let t = 0.25; t <= 3.0001; t += 0.25) tw.totalTime(Math.min(t, 3), false);
  return { tx, sweep: { ...counts } };
`);

// ---- TAMPERING: impostora da página no slot → edições recusadas.
const tampering = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const tx1 = H.applyTx('tx-b5-t1', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  tw.vars.x = () => 999;
  const B = H.select('b');
  const editRefused = H.applyTx('tx-b5-t2', B.elementId, B.motionId, H.v3(ownership, 'override', 140));
  const groupRefused = H.groupEditV2(A.elementId, A.motionId, 120);
  return { tx1, editRefused, groupRefused };
`);

// ---- CONTROLES DE SENSIBILIDADE (o instrumento TEM que ver o positivo):
// (i) escalar cru contamina o irmão; (ii) invalidate CRU corrompe o loop
// parado em iteração posterior (classe P6b — o início vira o valor parkeado).
const sensibilidade = await runCase(`
  H.select('a');
  tw.vars.x = 160;
  tw.invalidate();
  tw.totalTime(1.5, true);
  const rawScalar = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
  return { rawScalar };
`);
const sensibilidadeInvalidate = await runCase(`
  H.select('a');
  const el = document.getElementById('a');
  const wrapper = (i, t) => (t === el ? 160 : 100);
  tw.vars.x = wrapper;
  tw.invalidate(); // CRU — sem park/restore
  tw.totalTime(1.5, true);
  const corrupted = { renderParked: H.renderAt(tw, 1.5), renderStart: H.renderAt(tw, 0) };
  return { corrupted };
`);

// ---- BOUNDARIES por MENSAGEM (cada um na própria página; publicação também).
async function boundaryCase(setup, { useTimeline = false } = {}) {
  const page = await newCasePage();
  const out = await page.evaluate(({ setupBody, timeline }) => {
    /* eslint-disable no-undef */
    const H = window.__H;
    const make = new Function('gsap', 'timeline', setupBody);
    const tw = make(gsap, timeline);
    H.boot();
    const A = H.select('a');
    const ownership = A.track && A.track.ownership;
    const perTargetPublished = Boolean(ownership && ownership.perTarget && ownership.perTarget.available);
    const patch = H.applyPatch(A.elementId, A.motionId, 'retarget.final', H.v3(ownership, 'override', 160));
    return { perTargetPublished, applied: patch.applied, error: patch.error };
  }, { setupBody: setup, timeline: useTimeline });
  await page.close();
  return out;
}

const boundaries = {
  durationInfinity: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: Infinity, ease: 'none', repeat: 2, paused: true });`),
  // ⚠️ r2#3: duration:1e308 NÃO exercita o ramo de overflow — o GSAP normaliza
  // o próprio duration() pra Infinity. O overflow REAL (duration finita ×
  // repeat → totalDuration Infinity) é 1e300 × 1e8.
  durationNormalizedInfinity: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1e308, ease: 'none', repeat: 2, paused: true });`),
  durationOverflow: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1e300, ease: 'none', repeat: 1e8, paused: true });`),
  infinito: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: -1, paused: true });`),
  infinityAutoral: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: Infinity, paused: true });`),
  fracionario: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: 0.5, paused: true });`),
  repeatDelaySetter: await boundaryCase(`const tw = gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true }); tw.repeatDelay(0.4); return tw;`),
  repeatRefresh: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: 2, repeatRefresh: true, paused: true });`),
  yoyoEase: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: 2, yoyo: true, yoyoEase: 'power2.in', paused: true });`),
  yoyoSemRepeat: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', yoyo: true, paused: true });`),
  nestedTimeline: await boundaryCase(`const tl = gsap.timeline({ paused: true }); const tw = gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: 2 }); tl.add(tw); return tw;`),
};

// ---- LANE DE TIMING guardada (audit r1#1: CADA mutação recusada é
// side-effect-free — clock E render intactos, estacionado em iteração
// posterior) + SPLIT available/writable sob drift.
const timingEDrift = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const tx = H.applyTx('tx-b5-tm', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  // (1) playbackMode 'loop' chamaria repeat(-1) com canal ativo → recusa + revert
  const loopPatch = H.applyPatch(A.elementId, A.motionId, 'timing.playbackMode', 'loop');
  const afterLoop = { temporal: H.temporal(tw), render: H.renderAt(tw, tw.totalTime()), repeat: tw.repeat() };
  // (2) repeatDelay 400ms → recusa; no GSAP real o setter re-mapeia o clock
  // (1.5 → 0.5/iteração 1) e o guard TEM que restaurar (repro r1#1).
  const delayPatch = H.applyPatch(A.elementId, A.motionId, 'timing.repeatDelay', 400);
  const afterDelay = { temporal: H.temporal(tw), render: H.renderAt(tw, tw.totalTime()), repeatDelay: tw.repeatDelay() };
  // (3) duration 0 → recusa (zero-duration com repeat>0); clock restaurado.
  const durationPatch = H.applyPatch(A.elementId, A.motionId, 'timing.duration', 0);
  const afterDuration = { temporal: H.temporal(tw), render: H.renderAt(tw, tw.totalTime()), duration: tw.duration() };
  const wrapperIntact = typeof tw.vars.x === 'function';
  // (4) drift REAL da página pra infinito: available (clear ok) sem writable
  tw.repeat(-1);
  const reA = H.select('a');
  const reOwnership = reA.track && reA.track.ownership;
  const drift = {
    available: Boolean(reOwnership && reOwnership.perTarget && reOwnership.perTarget.available),
    writable: Boolean(reOwnership && reOwnership.perTarget && reOwnership.perTarget.writable),
  };
  const writeRefused = H.applyPatch(A.elementId, A.motionId, 'retarget.final', H.v3(reOwnership, 'override', 170));
  const clear = H.applyTx('tx-b5-tm-clear', A.elementId, A.motionId, H.v3(reOwnership, 'clear'));
  const afterClear = { varsX: tw.vars.x, varsXType: typeof tw.vars.x };
  return { tx, loopPatch, afterLoop, delayPatch, afterDelay, durationPatch, afterDuration, wrapperIntact, drift, writeRefused, clear, afterClear };
`);

// ---- DRIFT DE CLOCK (audit r2#1): duration(0) e repeatDelay(-0.5) —
// GSAP real ACEITA delay negativo — quebram o probe de endpoint; publicação,
// gate do clear e sampler recusam pelo MESMO predicado (domínio único).
const clockDrift = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const tx = H.applyTx('tx-b5-ck', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  // (a) drift duration(0)
  tw.duration(0);
  let reA = H.select('a');
  let reOwnership = reA.track && reA.track.ownership;
  const durationZero = {
    available: Boolean(reOwnership && reOwnership.perTarget && reOwnership.perTarget.available),
    clear: H.applyPatch(A.elementId, A.motionId, 'retarget.final', H.v3(reOwnership, 'clear')),
  };
  tw.duration(1);
  tw.totalTime(1.5, true);
  // (b) drift repeatDelay(-0.5)
  tw.repeatDelay(-0.5);
  reA = H.select('a');
  reOwnership = reA.track && reA.track.ownership;
  const negativeDelay = {
    acceptedBySetter: tw.repeatDelay() === -0.5,
    available: Boolean(reOwnership && reOwnership.perTarget && reOwnership.perTarget.available),
    clear: H.applyPatch(A.elementId, A.motionId, 'retarget.final', H.v3(reOwnership, 'clear')),
  };
  tw.repeatDelay(0);
  tw.totalTime(1.5, true);
  // (c) drift totalTime(NaN) — audit r3: persiste no GSAP real com todos os
  // outros getters sãos; aplicado no PATCH-TIME (sem re-seleção — a amostragem
  // da inspeção não restaura parked NaN e deixaria o clock finito).
  tw.totalTime(NaN, true);
  const nanClock = {
    sticks: Number.isNaN(tw.totalTime()),
    write: H.applyPatch(A.elementId, A.motionId, 'retarget.final', H.v3(ownership, 'override', 175)),
    clear: H.applyPatch(A.elementId, A.motionId, 'retarget.final', H.v3(ownership, 'clear')),
    wrapperIntact: typeof tw.vars.x === 'function',
  };
  tw.totalTime(1.5, true);
  // recuperação: com o clock são de volta, o clear volta a funcionar
  reA = H.select('a');
  reOwnership = reA.track && reA.track.ownership;
  const recovered = {
    available: Boolean(reOwnership && reOwnership.perTarget && reOwnership.perTarget.available),
    clear: H.applyTx('tx-b5-ck-clear', A.elementId, A.motionId, H.v3(reOwnership, 'clear')),
    varsXType: typeof tw.vars.x,
  };
  return { tx, durationZero, negativeDelay, nanClock, recovered };
`);

// ---- DRIFT ADAPTATIVO (audit r1#3): repeatRefresh pós-canal → o clear REAL
// recusaria, então a publicação NÃO pode anunciar available.
const adaptiveDrift = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const tx = H.applyTx('tx-b5-ad', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  tw.vars.repeatRefresh = true; // drift da página DEPOIS do canal
  const reA = H.select('a');
  const reOwnership = reA.track && reA.track.ownership;
  const published = {
    available: Boolean(reOwnership && reOwnership.perTarget && reOwnership.perTarget.available),
    writable: Boolean(reOwnership && reOwnership.perTarget && reOwnership.perTarget.writable),
    statesPresent: Boolean(reOwnership && reOwnership.perTarget && reOwnership.perTarget.states && reOwnership.perTarget.states.length === 2),
  };
  const clearRefused = H.applyPatch(A.elementId, A.motionId, 'retarget.final', H.v3(reOwnership, 'clear'));
  return { tx, published, clearRefused };
`);

await browser.close();

const observado = {
  referencia, principal, matrizN1, matrizN5, fronteiras, running, callbacks,
  tampering, sensibilidade, sensibilidadeInvalidate, boundaries, timingEDrift, clockDrift, adaptiveDrift,
};

if (RECORD) {
  console.log(JSON.stringify(observado, null, 2));
  process.exit(0);
}

let red = 0;
const check = (rotulo, ok, detalhe) => {
  if (ok) console.log(`  OK   ${rotulo}`);
  else { red += 1; console.log(`  RED  ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`); }
};
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

console.log('== WITNESS B5 (repeat finito sem yoyo, per-target, protocolo v2, GSAP real) ==');

console.log('(ref) página de referência');
check('track negociada', referencia.negotiatedTrack === true);
check('trajetória A=B (sem edit)', eq(referencia.trajA, referencia.trajB), JSON.stringify(referencia.trajA));
check('trajetória canônica do loop [0,75,50,25,100]', eq(referencia.trajA, [0, 75, 50, 25, 100]), JSON.stringify(referencia.trajA));
check('parked na 2ª iteração (iteration 2, progress .5)', referencia.temporal.iteration === 2 && referencia.temporal.progress === 0.5, JSON.stringify(referencia.temporal));
check('varredura de callbacks: 2 repeats, 1 complete', referencia.sweep.onRepeat === 2 && referencia.sweep.onComplete === 1, JSON.stringify(referencia.sweep));

console.log('(a) publicação + override');
check('writeModel publicado = absolute', principal.published.writeModel === 'absolute');
check('perTarget available+writable', principal.published.perTargetAvailable === true && principal.published.perTargetWritable === true);
check('override commitou', principal.tx1.committed === true, JSON.stringify(principal.tx1.ack));
check('vars.x virou função', principal.afterOverride.varsXType === 'function');
check('trajetória A editada [0,120,80,40,160]', eq(principal.afterOverride.trajA, [0, 120, 80, 40, 160]), JSON.stringify(principal.afterOverride.trajA));
check('irmão B byte-igual à referência', eq(principal.afterOverride.trajB, referencia.trajB), JSON.stringify(principal.afterOverride.trajB));
check('park preservado (totalTime 1.5, iteration 2)', principal.afterOverride.temporal.totalTime === 1.5 && principal.afterOverride.temporal.iteration === 2, JSON.stringify(principal.afterOverride.temporal));
check('render no park: a=80 b=50', eq(principal.afterOverride.parkedRender, { a: 80, b: 50 }), JSON.stringify(principal.afterOverride.parkedRender));
check('tick −ε consistente (a=72 b=45)', eq(principal.afterOverride.tickMinus, { a: 72, b: 45 }), JSON.stringify(principal.afterOverride.tickMinus));
check('tick +ε consistente (a=88 b=55)', eq(principal.afterOverride.tickPlus, { a: 88, b: 55 }), JSON.stringify(principal.afterOverride.tickPlus));
check('tick seguinte: estado temporal intacto', principal.tick1.totalTime === 1.6, JSON.stringify(principal.tick1));

console.log('(c) 2º alvo + identidade');
check('2º override commitou', principal.tx2.committed === true, JSON.stringify(principal.tx2.ack));
check('identidade do wrapper mantida', principal.identidadeMantida === true);
check('trajetória B editada [0,105,70,35,140]', eq(principal.afterSecond.trajB, [0, 105, 70, 35, 140]), JSON.stringify(principal.afterSecond.trajB));

console.log('(d) grupo alcança só quem herda');
check('rollback de B commitou', principal.rbB.committed === true);
check('group-edit 120 aplicou', principal.group.applied === true, principal.group.error || '');
check('A segue 160 [0,120,80,40,160]', eq(principal.afterGroup.trajA, [0, 120, 80, 40, 160]), JSON.stringify(principal.afterGroup.trajA));
check('B herda 120 [0,90,60,30,120]', eq(principal.afterGroup.trajB, [0, 90, 60, 30, 120]), JSON.stringify(principal.afterGroup.trajB));
check('park segue 1.5 após grupo', principal.afterGroup.temporal.totalTime === 1.5, JSON.stringify(principal.afterGroup.temporal));

console.log('(e) re-exposição');
check('writeModel segue absolute', principal.reexposure.writeModel === 'absolute');
check('sourceValue = shared LÓGICO atual (120, pós-grupo — modelo do B4)', principal.reexposure.sourceValue === 120, String(principal.reexposure.sourceValue));
check('writable true', principal.reexposure.writable === true);
check('states: A=override 160, B=none', (() => {
  const states = principal.reexposure.states || [];
  return states.some((s) => s.intent === 'override' && s.value === 160) && states.some((s) => s.intent === 'none');
})(), JSON.stringify(principal.reexposure.states));

console.log('(g) undo/redo');
check('undo do override commitou', principal.rbA.committed === true);
check('A volta a herdar 120', eq(principal.afterUndo.trajA, [0, 90, 60, 30, 120]), JSON.stringify(principal.afterUndo.trajA));
check('colapso: slot escalar = shared ATUAL (120)', principal.afterUndo.varsXType === 'number' && principal.afterUndo.varsX === 120, `${principal.afterUndo.varsXType}:${principal.afterUndo.varsX}`);
check('redo re-aplica', principal.redo.committed === true && eq(principal.afterRedo.trajA, [0, 120, 80, 40, 160]), JSON.stringify(principal.afterRedo.trajA));

console.log('(h) clear final');
check('clear commitou', principal.clear.committed === true, JSON.stringify(principal.clear.ack));
check('slot volta escalar 120 (shared atual, tipo number)', principal.afterRedoClear.varsXType === 'number' && principal.afterRedoClear.varsX === 120, `${principal.afterRedoClear.varsXType}:${principal.afterRedoClear.varsX}`);
check('trajetórias A=B=grupo 120', eq(principal.afterRedoClear.trajA, [0, 90, 60, 30, 120]) && eq(principal.afterRedoClear.trajB, [0, 90, 60, 30, 120]), JSON.stringify(principal.afterRedoClear.trajA));
check('park preservado no fim (1.5)', principal.afterRedoClear.temporal.totalTime === 1.5, JSON.stringify(principal.afterRedoClear.temporal));

console.log('(m1) matriz n=1');
check('perTarget publicado', matrizN1.perTargetAvailable === true);
check('override commitou', matrizN1.tx.committed === true, JSON.stringify(matrizN1.tx.ack));
check('trajetória A [0,80,160,80,160]', eq(matrizN1.after.trajA, [0, 80, 160, 80, 160]), JSON.stringify(matrizN1.after.trajA));
check('irmão B [0,50,100,50,100]', eq(matrizN1.after.trajB, [0, 50, 100, 50, 100]), JSON.stringify(matrizN1.after.trajB));
check('park 1.5 preservado', matrizN1.after.temporal.totalTime === 1.5, JSON.stringify(matrizN1.after.temporal));
check('rollback exato (escalar 100)', matrizN1.rb.committed === true && matrizN1.afterUndo.varsX === 100 && eq(matrizN1.afterUndo.trajA, [0, 50, 100, 50, 100]), JSON.stringify(matrizN1.afterUndo));

console.log('(m5) matriz n=5');
check('perTarget publicado', matrizN5.perTargetAvailable === true);
check('override commitou', matrizN5.tx.committed === true, JSON.stringify(matrizN5.tx.ack));
check('trajetória A [0,80,160,80,160]', eq(matrizN5.after.trajA, [0, 80, 160, 80, 160]), JSON.stringify(matrizN5.after.trajA));
check('irmão B [0,50,100,50,100]', eq(matrizN5.after.trajB, [0, 50, 100, 50, 100]), JSON.stringify(matrizN5.after.trajB));
check('park 4.2 na 5ª iteração preservado', matrizN5.after.temporal.totalTime === 4.2 && matrizN5.after.temporal.iteration === 5, JSON.stringify(matrizN5.after.temporal));
check('rollback exato (escalar 100)', matrizN5.rb.committed === true && matrizN5.afterUndo.varsX === 100, JSON.stringify(matrizN5.afterUndo));

console.log('(fx) fronteiras exatas');
check('override na fronteira t=2.0 commitou', fronteiras.tx1.committed === true, JSON.stringify(fronteiras.tx1.ack));
check('fronteira renderiza fim da anterior (a=160) e park preservado', fronteiras.atBoundary.temporal.totalTime === 2 && fronteiras.atBoundary.render.a === 160, JSON.stringify(fronteiras.atBoundary));
check('override no fim absoluto t=3.0 commitou (a=180)', fronteiras.tx2.committed === true && fronteiras.atEnd.temporal.totalTime === 3 && fronteiras.atEnd.render.a === 180, JSON.stringify(fronteiras.atEnd));
check('override em t=0 commitou (a=0 no início)', fronteiras.tx3.committed === true && fronteiras.atZero.temporal.totalTime === 0 && fronteiras.atZero.render.a === 0, JSON.stringify(fronteiras.atZero));
check('trajetória final A [0,150,100,50,200] B intacta', eq(fronteiras.atZero.trajA, [0, 150, 100, 50, 200]) && eq(fronteiras.atZero.trajB, [0, 75, 50, 25, 100]), JSON.stringify(fronteiras.atZero.trajA));

console.log('(run) tween RODANDO');
check('estava tocando no write', running.wasPlaying === true);
check('override commitou mid-play', running.tx.committed === true, JSON.stringify(running.tx.ack));
check('seguiu tocando após o write', running.stillPlaying === true);
check('clock avançou', running.after.totalTimeAdvanced === true);
check('wrapper instalado', running.after.varsXType === 'function');
check('trajetória A editada, irmão intacto', eq(running.after.trajA, [0, 120, 80, 40, 160]) && eq(running.after.trajB, [0, 75, 50, 25, 100]), JSON.stringify(running.after));

console.log('(cb) callbacks');
check('override não muda a contagem da varredura', eq(callbacks.sweep, referencia.sweep), `${JSON.stringify(callbacks.sweep)} vs ${JSON.stringify(referencia.sweep)}`);

console.log('(f) tampering');
check('override inicial commitou', tampering.tx1.committed === true);
check('edição com impostora → rejected', tampering.editRefused.committed === false, JSON.stringify(tampering.editRefused.ack));
check('group-edit com impostora → recusado', tampering.groupRefused.applied === false, tampering.groupRefused.error || '');

console.log('(i) controles de sensibilidade');
check('escalar cru CONTAMINA o irmão (instrumento vê)', !eq(sensibilidade.rawScalar.trajB, referencia.trajB), JSON.stringify(sensibilidade.rawScalar.trajB));
check('invalidate cru CORROMPE o loop (início vira o parkeado — P6b)', sensibilidadeInvalidate.corrupted.renderStart.a !== 0, JSON.stringify(sensibilidadeInvalidate.corrupted));

console.log('(bx) boundaries por mensagem');
check('duration:Infinity (getter devolve Infinity NUMÉRICO — r2#3) recusa não-finita', boundaries.durationInfinity.applied === false && boundaries.durationInfinity.error === 'Per-target overrides need a finite animation duration.' && boundaries.durationInfinity.perTargetPublished === false, boundaries.durationInfinity.error);
check('duration:1e308 (GSAP normaliza duration() pra Infinity) recusa não-finita', boundaries.durationNormalizedInfinity.applied === false && boundaries.durationNormalizedInfinity.error === 'Per-target overrides need a finite animation duration.', boundaries.durationNormalizedInfinity.error);
check('OVERFLOW real: duration 1e300 FINITA × repeat 1e8 → totalDuration Infinity recusa', boundaries.durationOverflow.applied === false && boundaries.durationOverflow.error === 'Per-target overrides need a finite animation duration.', boundaries.durationOverflow.error);
check('repeat:-1 recusa infinito', boundaries.infinito.applied === false && boundaries.infinito.error === 'Per-target overrides are not available on endlessly repeating animations.' && boundaries.infinito.perTargetPublished === false, boundaries.infinito.error);
check('repeat:Infinity autoral (repeat() null) recusa infinito', boundaries.infinityAutoral.applied === false && boundaries.infinityAutoral.error === 'Per-target overrides are not available on endlessly repeating animations.', boundaries.infinityAutoral.error);
check('repeat:0.5 recusa não-inteiro', boundaries.fracionario.applied === false && boundaries.fracionario.error === 'Per-target overrides need a whole-number repeat count.', boundaries.fracionario.error);
check('repeatDelay via SETTER (vars limpo) recusa pelo getter', boundaries.repeatDelaySetter.applied === false && boundaries.repeatDelaySetter.error === 'Per-target overrides on animations with a repeat delay are not supported yet.' && boundaries.repeatDelaySetter.perTargetPublished === false, boundaries.repeatDelaySetter.error);
check('repeatRefresh recusa', boundaries.repeatRefresh.applied === false && boundaries.repeatRefresh.error === 'This animation re-rolls its values on each repeat — per-target overrides are not available.', boundaries.repeatRefresh.error);
check('yoyoEase recusa adaptativo', boundaries.yoyoEase.applied === false && boundaries.yoyoEase.error === 'This animation changes its easing between legs — per-target overrides are not available.', boundaries.yoyoEase.error);
check('yoyo sem repeat recusa', boundaries.yoyoSemRepeat.applied === false && boundaries.yoyoSemRepeat.error === 'Per-target overrides on yoyo animations without repeats are not supported yet.', boundaries.yoyoSemRepeat.error);
check('tween em timeline-pai recusa', boundaries.nestedTimeline.applied === false && boundaries.nestedTimeline.error === 'Per-target overrides inside timelines are not supported yet.', boundaries.nestedTimeline.error);

console.log('(tm) lane de timing + drift (r1#1: recusa é side-effect-free)');
check('override commitou', timingEDrift.tx.committed === true);
check("playbackMode 'loop' → recusa; clock 1.5/iter 2 e render a=80 INTACTOS", timingEDrift.loopPatch.applied === false && timingEDrift.afterLoop.temporal.totalTime === 1.5 && timingEDrift.afterLoop.temporal.iteration === 2 && timingEDrift.afterLoop.render.a === 80 && timingEDrift.afterLoop.repeat === 2, JSON.stringify(timingEDrift.afterLoop));
check('repeatDelay 400 → recusa; clock restaurado (o setter re-mapeava pra 0.5)', timingEDrift.delayPatch.applied === false && timingEDrift.afterDelay.temporal.totalTime === 1.5 && timingEDrift.afterDelay.temporal.iteration === 2 && timingEDrift.afterDelay.render.a === 80 && timingEDrift.afterDelay.repeatDelay === 0, JSON.stringify(timingEDrift.afterDelay));
check('duration 0 → recusa; clock e duração restaurados', timingEDrift.durationPatch.applied === false && timingEDrift.afterDuration.temporal.totalTime === 1.5 && timingEDrift.afterDuration.render.a === 80 && timingEDrift.afterDuration.duration === 1, JSON.stringify(timingEDrift.afterDuration));
check('wrapper intacto após as 3 recusas', timingEDrift.wrapperIntact === true);
check('drift infinito: available true (clear ok) / writable false', timingEDrift.drift.available === true && timingEDrift.drift.writable === false, JSON.stringify(timingEDrift.drift));
check('write novo sob drift → recusado', timingEDrift.writeRefused.applied === false, timingEDrift.writeRefused.error || '');
check('clear sob drift commitou e colapsou (escalar)', timingEDrift.clear.committed === true && timingEDrift.afterClear.varsXType === 'number', JSON.stringify(timingEDrift.afterClear));

console.log('(ck) drift de clock (r2#1: publicação/gate/sampler = UM domínio)');
check('override commitou antes dos drifts', clockDrift.tx.committed === true);
check('duration(0): available FALSE + clear recusado no gate (mensagem de timing)', clockDrift.durationZero.available === false && clockDrift.durationZero.clear.applied === false && clockDrift.durationZero.clear.error === "This animation's timing cannot be read safely — per-target overrides are not available.", JSON.stringify(clockDrift.durationZero.clear));
check('repeatDelay(-0.5) ACEITO pelo GSAP: available FALSE + clear recusado no gate', clockDrift.negativeDelay.acceptedBySetter === true && clockDrift.negativeDelay.available === false && clockDrift.negativeDelay.clear.applied === false && clockDrift.negativeDelay.clear.error === "This animation's timing cannot be read safely — per-target overrides are not available.", JSON.stringify(clockDrift.negativeDelay.clear));
check('totalTime(NaN) PERSISTE e write+clear recusam no gate (r3), canal intacto', clockDrift.nanClock.sticks === true && clockDrift.nanClock.write.applied === false && clockDrift.nanClock.write.error === "This animation's timing cannot be read safely — per-target overrides are not available." && clockDrift.nanClock.clear.applied === false && clockDrift.nanClock.wrapperIntact === true, JSON.stringify(clockDrift.nanClock));
check('clock recuperado: available volta TRUE e o clear commit+colapsa', clockDrift.recovered.available === true && clockDrift.recovered.clear.committed === true && clockDrift.recovered.varsXType === 'number', JSON.stringify(clockDrift.recovered));

console.log('(ad) drift adaptativo (r1#3: available = removibilidade EFETIVA)');
check('override commitou antes do drift', adaptiveDrift.tx.committed === true);
check('repeatRefresh pós-canal: available FALSE + writable FALSE + states publicados', adaptiveDrift.published.available === false && adaptiveDrift.published.writable === false && adaptiveDrift.published.statesPresent === true, JSON.stringify(adaptiveDrift.published));
check('clear real sob adaptativo → recusado (coerência com a publicação)', adaptiveDrift.clearRefused.applied === false && adaptiveDrift.clearRefused.error === 'This animation re-rolls its values on each repeat — per-target overrides are not available.', adaptiveDrift.clearRefused.error);

// Baseline congelado.
let baseline = null;
try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch (_) { baseline = null; }
if (baseline) {
  check('contrato-vs-baseline byte-igual', eq(observado, baseline));
} else {
  red += 1;
  console.log('  RED  baseline ausente — rode com --record e congele o JSON');
}

console.log(`\n${red} RED${red === 0 ? ' · contrato-vs-baseline: BATE' : ' CHECK(S) FALHARAM'}`);
process.exit(red === 0 ? 0 : 1);
