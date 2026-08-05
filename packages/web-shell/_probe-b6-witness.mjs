// WITNESS do GATE B6 (Fase 1): per-target override sob repeat FINITO + YOYO,
// protocolo v2 real, GSAP 3.15 real, writeModel/perTarget derivados da
// PUBLICAÇÃO. É a PROVA que promove a chave B6 (multi-target plano · repeat
// inteiro positivo finito, yoyo:true, sem outros modificadores temporais ·
// per-target · patch real) pro degrau 3 na Tabela B.
//
// Predicado QUANTIFICADO (advise Sol 2026-08-05): matriz n=1 (2 pernas,
// descansa no INÍCIO — paridade par), n=2 (3 pernas, descansa no FIM —
// paridade ímpar) e n=3 (4 pernas, canônico — parado numa perna de VOLTA).
// Amostragem DIRECIONAL da trajetória (quartos de perna, t=x.25): uma perna
// de volta em .25 renderiza 75 (100→0), a de ida 25 — meios de perna (50)
// seriam cegos à direção. Atestação parada na volta mede o fim da IDA
// (probe F3). Sensibilidade: invalidate cru corrompe o loop (P6b).
//
// Uso:
//   node _probe-b6-witness.mjs            # assertivo (baseline + contagem RED)
//   node _probe-b6-witness.mjs --record   # imprime JSON pra congelar
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const bridgeSrc = getRuntimeBridgeSource();
const RECORD = process.argv.includes('--record');
const BASELINE_PATH = new URL('./_probe-b6-witness.baseline.json', import.meta.url);

const HARNESS = `
window.__H = (() => {
  const V1 = 'uncraft-motion-editor/v1';
  const V2 = 'uncraft-motion-editor/v2';
  const NONCE = 'nonce-b6-witness-123456';
  const BUNDLE = 'bundle-b6';
  const SESSION = 'session-b6';
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
      runtimeFingerprint: 'sha256:b6-witness',
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
        source: 'host', type: 'negotiate-protocol', requestId: 'negotiate-b6',
        sessionNonce: NONCE, runtimeGeneration: generation, bundleId: BUNDLE, sessionId: SESSION,
        payload: { selectedProtocol: V2 },
      },
    }));
    const negotiated = messages.filter((m) => m.type === 'protocol-negotiated').pop();
    return { negotiated: negotiated?.payload?.selectedProtocol === V2 };
  }

  function sendV2(type, payload) {
    const requestId = 'b6-req-' + (seq += 1);
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

  // Amostragem DIRECIONAL: fronteiras + quartos de perna (x.25) — uma perna de
  // volta renderiza 75 no quarto, a de ida 25; meios (50) são cegos à direção.
  function yoyoTrajectory(tw, domId) {
    const el = document.getElementById(domId);
    const parked = tw.totalTime();
    const total = tw.totalDuration();
    const points = [];
    for (let leg = 0; leg < total; leg += 1) { points.push(leg, leg + 0.25); }
    points.push(total);
    const samples = points.map((t) => {
      tw.totalTime(t, true);
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

  return { boot, sendV2, select, v3, applyTx, rollbackTx, applyPatch, groupEditV2, yoyoTrajectory, temporal, renderAt, messages };
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

// Caso padrão da chave: repeat:3 + yoyo, parado numa perna de VOLTA (t=1.5).
async function runCase(body, { repeat = 3, park = 1.5 } = {}) {
  const page = await newCasePage();
  const out = await page.evaluate(({ caseBody, repeatN, parkAt }) => {
    /* eslint-disable no-undef */
    const H = window.__H;
    const tw = gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: repeatN, yoyo: true, paused: true });
    if (parkAt > 0) tw.totalTime(parkAt, true);
    window.__TW = tw;
    H.boot();
    return new Function('H', 'tw', 'gsap', caseBody)(H, tw, gsap);
  }, { caseBody: body, repeatN: repeat, parkAt: park });
  await page.close();
  return out;
}

// ---- REFERÊNCIA (n=3, park na volta 1.5): trajetória direcional, ticks ±ε,
// varredura de callbacks com eventos ligados.
const referencia = await runCase(`
  const A = H.select('a');
  const tickMinus = H.renderAt(tw, 1.45);
  const tickPlus = H.renderAt(tw, 1.55);
  const counts = { onRepeat: 0, onUpdate: 0, onComplete: 0 };
  tw.eventCallback('onRepeat', () => { counts.onRepeat += 1; });
  tw.eventCallback('onUpdate', () => { counts.onUpdate += 1; });
  tw.eventCallback('onComplete', () => { counts.onComplete += 1; });
  tw.totalTime(0, true);
  for (let t = 0.25; t <= 4.0001; t += 0.25) tw.totalTime(Math.min(t, 4), false);
  const sweep = { ...counts };
  tw.totalTime(1.5, true);
  return {
    negotiatedTrack: Boolean(A.track),
    trajA: H.yoyoTrajectory(tw, 'a'),
    trajB: H.yoyoTrajectory(tw, 'b'),
    temporal: H.temporal(tw),
    tickMinus, tickPlus, sweep,
  };
`);

// ---- FLUXO PRINCIPAL (n=3, park na VOLTA 1.5).
const principal = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const published = {
    writeModel: ownership && ownership.writeModel,
    perTargetAvailable: Boolean(ownership && ownership.perTarget && ownership.perTarget.available),
    perTargetWritable: Boolean(ownership && ownership.perTarget && ownership.perTarget.writable),
  };
  const tx1 = H.applyTx('tx-b6-a', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const afterOverride = {
    trajA: H.yoyoTrajectory(tw, 'a'),
    trajB: H.yoyoTrajectory(tw, 'b'),
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
  const tx2 = H.applyTx('tx-b6-c', B.elementId, B.motionId, H.v3(ownership, 'override', 140));
  const identidadeMantida = tw.vars.x === wrapperBefore;
  const afterSecond = { trajB: H.yoyoTrajectory(tw, 'b') };
  const rbB = H.rollbackTx('tx-b6-c');
  const group = H.groupEditV2(A.elementId, A.motionId, 120);
  const afterGroup = { trajA: H.yoyoTrajectory(tw, 'a'), trajB: H.yoyoTrajectory(tw, 'b'), temporal: H.temporal(tw) };
  const reA = H.select('a');
  const reOwnership = reA.track && reA.track.ownership;
  const reexposure = {
    writeModel: reOwnership && reOwnership.writeModel,
    sourceValue: reOwnership && reOwnership.sourceValue,
    writable: Boolean(reOwnership && reOwnership.perTarget && reOwnership.perTarget.writable),
    states: reOwnership && reOwnership.perTarget ? reOwnership.perTarget.states.map((s) => ({ elementId: s.elementId, intent: s.intent, value: s.value === undefined ? null : s.value })) : null,
  };
  const rbA = H.rollbackTx('tx-b6-a');
  const afterUndo = { trajA: H.yoyoTrajectory(tw, 'a'), varsXType: typeof tw.vars.x, varsX: typeof tw.vars.x === 'function' ? null : tw.vars.x };
  const redo = H.applyTx('tx-b6-redo', A.elementId, A.motionId, H.v3(reOwnership, 'override', 160));
  const clear = H.applyTx('tx-b6-clear', A.elementId, A.motionId, H.v3(reOwnership, 'clear'));
  const afterClear = { trajA: H.yoyoTrajectory(tw, 'a'), trajB: H.yoyoTrajectory(tw, 'b'), varsX: tw.vars.x, varsXType: typeof tw.vars.x, temporal: H.temporal(tw) };
  return { published, tx1, afterOverride, tick1, tx2, identidadeMantida, afterSecond, rbB, group, afterGroup, reexposure, rbA, afterUndo, redo, clear, afterClear };
`);

// ---- MATRIZ n=1 (2 pernas; descansa no INÍCIO — paridade PAR): park na volta 1.5.
const matrizN1 = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const perTargetAvailable = Boolean(ownership && ownership.perTarget && ownership.perTarget.available);
  const tx = H.applyTx('tx-b6-n1', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const after = { trajA: H.yoyoTrajectory(tw, 'a'), trajB: H.yoyoTrajectory(tw, 'b'), temporal: H.temporal(tw), restAtEnd: H.renderAt(tw, 2) };
  const rb = H.rollbackTx('tx-b6-n1');
  const afterUndo = { trajA: H.yoyoTrajectory(tw, 'a'), varsX: tw.vars.x, varsXType: typeof tw.vars.x };
  return { perTargetAvailable, tx, after, rb, afterUndo };
`, { repeat: 1, park: 1.5 });

// ---- MATRIZ n=2 (3 pernas; descansa no FIM — paridade ÍMPAR): park na perna
// de IDA final (2.3) — a chave cobre qualquer estacionamento.
const matrizN2 = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const perTargetAvailable = Boolean(ownership && ownership.perTarget && ownership.perTarget.available);
  const tx = H.applyTx('tx-b6-n2', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const after = { trajA: H.yoyoTrajectory(tw, 'a'), trajB: H.yoyoTrajectory(tw, 'b'), temporal: H.temporal(tw), restAtEnd: H.renderAt(tw, 3) };
  const rb = H.rollbackTx('tx-b6-n2');
  const afterUndo = { trajA: H.yoyoTrajectory(tw, 'a'), varsX: tw.vars.x, varsXType: typeof tw.vars.x };
  return { perTargetAvailable, tx, after, rb, afterUndo };
`, { repeat: 2, park: 2.3 });

// ---- FRONTEIRAS n=3: pico (t=1), vale (t=2), última volta (3.5), fim (4).
const fronteiras = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  tw.totalTime(1.0, true);
  const tx1 = H.applyTx('tx-b6-f1', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const atPeak = { temporal: H.temporal(tw), render: H.renderAt(tw, tw.totalTime()) };
  tw.totalTime(2.0, true);
  const tx2 = H.applyTx('tx-b6-f2', A.elementId, A.motionId, H.v3(ownership, 'override', 180));
  const atValley = { temporal: H.temporal(tw), render: H.renderAt(tw, tw.totalTime()) };
  tw.totalTime(3.5, true);
  const tx3 = H.applyTx('tx-b6-f3', A.elementId, A.motionId, H.v3(ownership, 'override', 200));
  const atLastReturn = { temporal: H.temporal(tw), render: H.renderAt(tw, tw.totalTime()) };
  tw.totalTime(4.0, true);
  const tx4 = H.applyTx('tx-b6-f4', A.elementId, A.motionId, H.v3(ownership, 'override', 220));
  const atEnd = { temporal: H.temporal(tw), render: H.renderAt(tw, tw.totalTime()), trajB: H.yoyoTrajectory(tw, 'b') };
  return { tx1, atPeak, tx2, atValley, tx3, atLastReturn, tx4, atEnd };
`, { repeat: 3, park: 0 });

// ---- TWEEN RODANDO.
const running = await (async () => {
  const page = await newCasePage();
  const out = await page.evaluate(() => {
    /* eslint-disable no-undef */
    return (async () => {
      const H = window.__H;
      const tw = gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: 3, yoyo: true, paused: true });
      tw.totalTime(1.2, true);
      H.boot();
      const A = H.select('a');
      const ownership = A.track && A.track.ownership;
      tw.play();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const wasPlaying = !tw.paused();
      const tx = H.applyTx('tx-b6-run', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
      const stillPlaying = !tw.paused();
      tw.pause();
      const after = { trajA: H.yoyoTrajectory(tw, 'a'), trajB: H.yoyoTrajectory(tw, 'b'), varsXType: typeof tw.vars.x, totalTimeAdvanced: tw.totalTime() > 1.2 };
      return { wasPlaying, tx, stillPlaying, after };
    })();
  });
  await page.close();
  return out;
})();

// ---- CALLBACKS: varredura na página editada = referência.
const callbacks = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const tx = H.applyTx('tx-b6-cb', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const counts = { onRepeat: 0, onUpdate: 0, onComplete: 0 };
  tw.eventCallback('onRepeat', () => { counts.onRepeat += 1; });
  tw.eventCallback('onUpdate', () => { counts.onUpdate += 1; });
  tw.eventCallback('onComplete', () => { counts.onComplete += 1; });
  tw.totalTime(0, true);
  for (let t = 0.25; t <= 4.0001; t += 0.25) tw.totalTime(Math.min(t, 4), false);
  return { tx, sweep: { ...counts } };
`);

// ---- SENSIBILIDADE: invalidate cru parado na VOLTA corrompe (P6b — o início
// vira o valor parkeado da volta).
const sensibilidade = await runCase(`
  H.select('a');
  const el = document.getElementById('a');
  tw.vars.x = (i, t) => (t === el ? 160 : 100);
  tw.invalidate(); // CRU
  tw.totalTime(1.5, true);
  return { corrupted: { renderParked: H.renderAt(tw, 1.5), renderStart: H.renderAt(tw, 0) } };
`);

// ---- BOUNDARIES específicos da chave yoyo (a taxonomia completa vive no
// witness B5; aqui os que tocam a FORMA yoyo).
async function boundaryCase(setup) {
  const page = await newCasePage();
  const out = await page.evaluate((setupBody) => {
    /* eslint-disable no-undef */
    const H = window.__H;
    const tw = new Function('gsap', setupBody)(gsap);
    H.boot();
    const A = H.select('a');
    const ownership = A.track && A.track.ownership;
    const perTargetPublished = Boolean(ownership && ownership.perTarget && ownership.perTarget.available);
    const patch = H.applyPatch(A.elementId, A.motionId, 'retarget.final', H.v3(ownership, 'override', 160));
    return { perTargetPublished, applied: patch.applied, error: patch.error };
  }, setup);
  await page.close();
  return out;
}

const boundaries = {
  yoyoEase: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: 3, yoyo: true, yoyoEase: 'power2.in', paused: true });`),
  yoyoRepeatRefresh: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: 3, yoyo: true, repeatRefresh: true, paused: true });`),
  yoyoInfinito: await boundaryCase(`return gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: -1, yoyo: true, paused: true });`),
};

// ---- LANE DE TIMING: desligar o yoyo com canal ativo (B6→B5) é PERMITIDO;
// playbackMode 'ping-pong' (repeat -1) recusa.
const timing = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const tx = H.applyTx('tx-b6-tm', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const yoyoOff = H.applyPatch(A.elementId, A.motionId, 'timing.yoyo', false);
  const yoyoAfter = tw.yoyo();
  const pingPong = H.applyPatch(A.elementId, A.motionId, 'timing.playbackMode', 'ping-pong');
  const afterPingPong = { temporal: H.temporal(tw), repeat: tw.repeat() };
  const wrapperIntact = typeof tw.vars.x === 'function';
  return { tx, yoyoOff, yoyoAfter, pingPong, afterPingPong, wrapperIntact };
`);

await browser.close();

const observado = {
  referencia, principal, matrizN1, matrizN2, fronteiras, running, callbacks,
  sensibilidade, boundaries, timing,
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

// Trajetória direcional canônica (n=3, 0→100): fronteiras+quartos
// t=[0,.25,1,1.25,2,2.25,3,3.25,4] → [0,25,100,75,0,25,100,75,0].
const REF = [0, 25, 100, 75, 0, 25, 100, 75, 0];
const EDITED = [0, 40, 160, 120, 0, 40, 160, 120, 0];
const GROUP120 = [0, 30, 120, 90, 0, 30, 120, 90, 0];

console.log('== WITNESS B6 (repeat finito + yoyo, per-target, protocolo v2, GSAP real) ==');

console.log('(ref) página de referência (park na VOLTA 1.5)');
check('track negociada', referencia.negotiatedTrack === true);
check('trajetória direcional canônica', eq(referencia.trajA, REF) && eq(referencia.trajB, REF), JSON.stringify(referencia.trajA));
check('parked na volta (iteration 2, x=50 descendo)', referencia.temporal.iteration === 2 && referencia.temporal.totalTime === 1.5, JSON.stringify(referencia.temporal));
check('ticks ±ε espelhados (volta: −ε=55, +ε=45)', eq(referencia.tickMinus, { a: 55, b: 55 }) && eq(referencia.tickPlus, { a: 45, b: 45 }), `${JSON.stringify(referencia.tickMinus)} ${JSON.stringify(referencia.tickPlus)}`);
check('varredura: 3 repeats, 1 complete', referencia.sweep.onRepeat === 3 && referencia.sweep.onComplete === 1, JSON.stringify(referencia.sweep));

console.log('(a) publicação + override na perna de VOLTA');
check('writeModel absolute + perTarget available/writable', principal.published.writeModel === 'absolute' && principal.published.perTargetAvailable === true && principal.published.perTargetWritable === true, JSON.stringify(principal.published));
check('override commitou parado na volta', principal.tx1.committed === true, JSON.stringify(principal.tx1.ack));
check('vars.x virou função', principal.afterOverride.varsXType === 'function');
check('trajetória A editada (pernas espelhadas ×1.6)', eq(principal.afterOverride.trajA, EDITED), JSON.stringify(principal.afterOverride.trajA));
check('irmão B byte-igual à referência', eq(principal.afterOverride.trajB, REF), JSON.stringify(principal.afterOverride.trajB));
check('park preservado na volta (1.5, iteration 2)', principal.afterOverride.temporal.totalTime === 1.5 && principal.afterOverride.temporal.iteration === 2, JSON.stringify(principal.afterOverride.temporal));
check('render no park: a=80 (volta de 160) b=50', eq(principal.afterOverride.parkedRender, { a: 80, b: 50 }), JSON.stringify(principal.afterOverride.parkedRender));
check('ticks ±ε editados espelhados (−ε=88, +ε=72)', eq(principal.afterOverride.tickMinus, { a: 88, b: 55 }) && eq(principal.afterOverride.tickPlus, { a: 72, b: 45 }), `${JSON.stringify(principal.afterOverride.tickMinus)} ${JSON.stringify(principal.afterOverride.tickPlus)}`);
check('tick seguinte: temporal intacto (1.6)', principal.tick1.totalTime === 1.6, JSON.stringify(principal.tick1));

console.log('(c) 2º alvo + identidade');
check('2º override commitou', principal.tx2.committed === true, JSON.stringify(principal.tx2.ack));
check('identidade do wrapper mantida', principal.identidadeMantida === true);
check('trajetória B=140 espelhada', eq(principal.afterSecond.trajB, [0, 35, 140, 105, 0, 35, 140, 105, 0]), JSON.stringify(principal.afterSecond.trajB));

console.log('(d) grupo + re-exposição + undo/clear');
check('rollback de B + grupo 120 aplicou', principal.rbB.committed === true && principal.group.applied === true, principal.group.error || '');
check('A segue 160, B herda 120', eq(principal.afterGroup.trajA, EDITED) && eq(principal.afterGroup.trajB, GROUP120), JSON.stringify(principal.afterGroup.trajB));
check('park segue 1.5 após grupo', principal.afterGroup.temporal.totalTime === 1.5, JSON.stringify(principal.afterGroup.temporal));
check('re-exposição: absolute, sourceValue=shared 120, states A=160/B=none', (() => {
  const states = principal.reexposure.states || [];
  return principal.reexposure.writeModel === 'absolute' && principal.reexposure.sourceValue === 120
    && states.some((s) => s.intent === 'override' && s.value === 160) && states.some((s) => s.intent === 'none');
})(), JSON.stringify(principal.reexposure));
check('undo → colapso escalar shared 120', principal.rbA.committed === true && principal.afterUndo.varsXType === 'number' && principal.afterUndo.varsX === 120 && eq(principal.afterUndo.trajA, GROUP120), JSON.stringify(principal.afterUndo));
check('redo + clear final → escalar 120, trajetórias iguais', principal.redo.committed === true && principal.clear.committed === true && principal.afterClear.varsX === 120 && eq(principal.afterClear.trajA, GROUP120) && eq(principal.afterClear.trajB, GROUP120), JSON.stringify(principal.afterClear.trajA));
check('park preservado no fim (1.5)', principal.afterClear.temporal.totalTime === 1.5, JSON.stringify(principal.afterClear.temporal));

console.log('(m1) matriz n=1 (paridade PAR — descansa no início)');
check('perTarget publicado + override commitou', matrizN1.perTargetAvailable === true && matrizN1.tx.committed === true, JSON.stringify(matrizN1.tx.ack));
check('trajetória A [0,40,160,120,0]', eq(matrizN1.after.trajA, [0, 40, 160, 120, 0]), JSON.stringify(matrizN1.after.trajA));
check('irmão B [0,25,100,75,0]', eq(matrizN1.after.trajB, [0, 25, 100, 75, 0]), JSON.stringify(matrizN1.after.trajB));
check('descanso no fim = INÍCIO (0) — paridade par', matrizN1.after.restAtEnd.a === 0 && matrizN1.after.restAtEnd.b === 0, JSON.stringify(matrizN1.after.restAtEnd));
check('park na volta preservado (1.5)', matrizN1.after.temporal.totalTime === 1.5, JSON.stringify(matrizN1.after.temporal));
check('rollback exato (escalar 100)', matrizN1.rb.committed === true && matrizN1.afterUndo.varsX === 100 && eq(matrizN1.afterUndo.trajA, [0, 25, 100, 75, 0]), JSON.stringify(matrizN1.afterUndo));

console.log('(m2) matriz n=2 (paridade ÍMPAR — descansa no fim)');
check('perTarget publicado + override commitou', matrizN2.perTargetAvailable === true && matrizN2.tx.committed === true, JSON.stringify(matrizN2.tx.ack));
check('trajetória A [0,40,160,120,0,40,160]', eq(matrizN2.after.trajA, [0, 40, 160, 120, 0, 40, 160]), JSON.stringify(matrizN2.after.trajA));
check('descanso no fim = FIM editado (160) — paridade ímpar', matrizN2.after.restAtEnd.a === 160 && matrizN2.after.restAtEnd.b === 100, JSON.stringify(matrizN2.after.restAtEnd));
check('park 2.3 na ida final preservado', matrizN2.after.temporal.totalTime === 2.3, JSON.stringify(matrizN2.after.temporal));
check('rollback exato (escalar 100)', matrizN2.rb.committed === true && matrizN2.afterUndo.varsX === 100, JSON.stringify(matrizN2.afterUndo));

console.log('(fx) fronteiras: pico/vale/última volta/fim');
check('pico t=1: commit + renderiza fim da IDA (160)', fronteiras.tx1.committed === true && fronteiras.atPeak.temporal.totalTime === 1 && fronteiras.atPeak.render.a === 160, JSON.stringify(fronteiras.atPeak));
check('vale t=2: commit + renderiza início (0)', fronteiras.tx2.committed === true && fronteiras.atValley.temporal.totalTime === 2 && fronteiras.atValley.render.a === 0, JSON.stringify(fronteiras.atValley));
check('última volta t=3.5: commit + espelho (a=100 de 200)', fronteiras.tx3.committed === true && fronteiras.atLastReturn.temporal.totalTime === 3.5 && fronteiras.atLastReturn.render.a === 100, JSON.stringify(fronteiras.atLastReturn));
check('fim absoluto t=4 (paridade par → 0): commit + irmão intacto', fronteiras.tx4.committed === true && fronteiras.atEnd.temporal.totalTime === 4 && fronteiras.atEnd.render.a === 0 && eq(fronteiras.atEnd.trajB, REF), JSON.stringify(fronteiras.atEnd.render));

console.log('(run) tween RODANDO');
check('tocando no write, commit, segue tocando', running.wasPlaying === true && running.tx.committed === true && running.stillPlaying === true, JSON.stringify(running.tx.ack));
check('clock avançou + wrapper + trajetórias', running.after.totalTimeAdvanced === true && running.after.varsXType === 'function' && eq(running.after.trajA, EDITED) && eq(running.after.trajB, REF), JSON.stringify(running.after.trajA));

console.log('(cb) callbacks');
check('override não muda a contagem da varredura', eq(callbacks.sweep, referencia.sweep), `${JSON.stringify(callbacks.sweep)} vs ${JSON.stringify(referencia.sweep)}`);

console.log('(i) sensibilidade');
check('invalidate cru parado na volta CORROMPE (início ≠ 0 — P6b)', sensibilidade.corrupted.renderStart.a !== 0, JSON.stringify(sensibilidade.corrupted));

console.log('(bx) boundaries da forma yoyo');
check('yoyoEase recusa adaptativo', boundaries.yoyoEase.applied === false && boundaries.yoyoEase.error === 'This animation changes its easing between legs — per-target overrides are not available.', boundaries.yoyoEase.error);
check('yoyo+repeatRefresh recusa', boundaries.yoyoRepeatRefresh.applied === false && boundaries.yoyoRepeatRefresh.error === 'This animation re-rolls its values on each repeat — per-target overrides are not available.', boundaries.yoyoRepeatRefresh.error);
check('yoyo+repeat:-1 recusa infinito', boundaries.yoyoInfinito.applied === false && boundaries.yoyoInfinito.error === 'Per-target overrides are not available on endlessly repeating animations.' && boundaries.yoyoInfinito.perTargetPublished === false, boundaries.yoyoInfinito.error);

console.log('(tm) lane de timing');
check('desligar yoyo com canal (B6→B5) PERMITIDO', timing.yoyoOff.applied === true && timing.yoyoAfter === false, timing.yoyoOff.error || '');
check("ping-pong (repeat -1) com canal → recusa side-effect-free (repeat 3, clock intacto)", timing.pingPong.applied === false && timing.afterPingPong.repeat === 3 && timing.afterPingPong.temporal.totalTime === 1.5 && timing.wrapperIntact === true, JSON.stringify(timing.afterPingPong));

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
