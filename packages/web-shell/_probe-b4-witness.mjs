// WITNESS do GATE B4 (Fase 1): override per-target REAL pelo caminho de
// protocolo v2 (negotiate + apply-transaction/rollback-transaction), GSAP
// 3.15 real, writeModel/perTarget derivados da PUBLICAÇÃO (nunca forçados).
// É a PROVA que promove a chave B4 (multi-target plano · nenhum modificador ·
// per-target · patch real) pro degrau 3 na Tabela B do finding doc.
//
// Método (template: _probe-editwrite-witness.mjs):
//   - página nova por caso; referência = página selecionada mas NÃO editada;
//   - trajetória = amostras de x em frações do clock total, render real;
//   - irmão byte-idêntico à referência (o override NÃO pode vazar);
//   - controle de sensibilidade (caso i): um "override" por escalar cru TEM
//     que contaminar o irmão e o instrumento TEM que enxergar — um probe sem
//     controle mede o próprio bug (lição 172).
//
// Uso:
//   node _probe-b4-witness.mjs            # assertivo (baseline + contagem RED)
//   node _probe-b4-witness.mjs --record   # imprime JSON pra congelar
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const bridgeSrc = getRuntimeBridgeSource();
const RECORD = process.argv.includes('--record');
const BASELINE_PATH = new URL('./_probe-b4-witness.baseline.json', import.meta.url);

// Harness in-page: boot v2 real (config + negotiate), seleção, transactions.
const HARNESS = `
window.__H = (() => {
  const V1 = 'uncraft-motion-editor/v1';
  const V2 = 'uncraft-motion-editor/v2';
  const NONCE = 'nonce-b4-witness-123456';
  const BUNDLE = 'bundle-b4';
  const SESSION = 'session-b4';
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
      runtimeFingerprint: 'sha256:b4-witness',
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
        source: 'host', type: 'negotiate-protocol', requestId: 'negotiate-b4',
        sessionNonce: NONCE, runtimeGeneration: generation, bundleId: BUNDLE, sessionId: SESSION,
        payload: { selectedProtocol: V2 },
      },
    }));
    const negotiated = messages.filter((m) => m.type === 'protocol-negotiated').pop();
    return { negotiated: negotiated?.payload?.selectedProtocol === V2 };
  }

  function sendV2(type, payload) {
    const requestId = 'b4-req-' + (seq += 1);
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

  function groupEditV2(elementId, motionId, value) {
    const replies = sendV2('apply-patch', {
      patch: {
        elementId, kind: 'motion', motionId, property: 'retarget.final', before: null,
        value: { schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value, writeModel: 'absolute', affectedTargetCount: 2 },
      },
    });
    const rejected = replies.filter((m) => m.type === 'patch-rejected').pop();
    return { applied: !rejected, error: rejected ? rejected.payload?.error || null : null };
  }

  // Trajetória REAL: amostra x renderizando em frações do clock total e
  // restaura o clock exato.
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
      reversed: tw.reversed(),
    };
  }

  return { boot, sendV2, select, v3, applyTx, rollbackTx, groupEditV2, trajectory, temporal, messages };
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

// Cada caso roda num evaluate próprio; o corpo recebe o harness H e o gsap.
async function runCase(body) {
  const page = await newCasePage();
  const out = await page.evaluate((caseBody) => {
    /* eslint-disable no-undef */
    const H = window.__H;
    const tw = gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', paused: true });
    window.__TW = tw;
    H.boot();
    return new Function('H', 'tw', 'gsap', caseBody)(H, tw, gsap);
  }, body);
  await page.close();
  return out;
}

// Página de REFERÊNCIA: selecionada, nunca editada.
const referencia = await runCase(`
  const A = H.select('a');
  return {
    negotiatedTrack: Boolean(A.track),
    trajA: H.trajectory(tw, 'a'),
    trajB: H.trajectory(tw, 'b'),
    temporal: H.temporal(tw),
  };
`);

// Página de referência do GRUPO-120 (só full-scope, sem override) — baseline do caso (h).
const referenciaGrupo120 = await runCase(`
  const A = H.select('a');
  const group = H.groupEditV2(A.elementId, A.motionId, 120);
  return {
    applied: group.applied,
    trajA: H.trajectory(tw, 'a'),
    trajB: H.trajectory(tw, 'b'),
    varsX: tw.vars.x,
    varsXType: typeof tw.vars.x,
  };
`);

// (a)+(b)+(c)+(d)+(e) — fluxo principal na MESMA página (estado é cumulativo
// por natureza do canal); cada letra tem checks próprios.
const principal = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const published = {
    writeModel: ownership && ownership.writeModel,
    perTargetAvailable: Boolean(ownership && ownership.perTarget && ownership.perTarget.available),
    statesBefore: ownership && ownership.perTarget ? ownership.perTarget.states : null,
  };
  // (a) override A=160 pelo caminho v2 real
  const tx1 = H.applyTx('tx-b4-a', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const afterOverride = {
    trajA: H.trajectory(tw, 'a'),
    trajB: H.trajectory(tw, 'b'),
    temporal: H.temporal(tw),
    varsXType: typeof tw.vars.x,
  };
  // tick seguinte: estado temporal intacto
  tw.totalTime(tw.totalTime() + 0.1, true);
  const tick1 = H.temporal(tw);
  tw.totalTime(0, true);
  // (c) 2ª edição mantém a identidade da função (igualdade referencial na página)
  const wrapperBefore = tw.vars.x;
  const B = H.select('b');
  const tx2 = H.applyTx('tx-b4-c', B.elementId, B.motionId, H.v3(ownership, 'override', 140));
  const identidadeMantida = tw.vars.x === wrapperBefore;
  const afterSecond = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
  // desfaz o override de B pra isolar o grupo (d)
  const rbB = H.rollbackTx('tx-b4-c');
  // (d) edição posterior do GRUPO alcança só quem herda
  const group = H.groupEditV2(A.elementId, A.motionId, 120);
  const afterGroup = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
  // (e) re-exposição correta
  const reA = H.select('a');
  const reOwnership = reA.track && reA.track.ownership;
  const reexposure = {
    writeModel: reOwnership && reOwnership.writeModel,
    sourceValue: reOwnership && reOwnership.sourceValue,
    states: reOwnership && reOwnership.perTarget ? reOwnership.perTarget.states.map((s) => ({ elementId: s.elementId, intent: s.intent, value: s.value === undefined ? null : s.value })) : null,
  };
  // (g) undo por rollback-transaction → A volta a herdar (120); redo re-aplica
  const rbA = H.rollbackTx('tx-b4-a');
  const afterUndo = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b'), varsXType: typeof tw.vars.x, varsX: typeof tw.vars.x === 'function' ? null : tw.vars.x };
  const redo = H.applyTx('tx-b4-redo', A.elementId, A.motionId, H.v3(reOwnership, 'override', 160));
  const afterRedo = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
  // (h) último reset restaura slot/tipo/trajetória — grupo mudou durante o override
  const clear = H.applyTx('tx-b4-clear', A.elementId, A.motionId, H.v3(reOwnership, 'clear'));
  const afterClear = {
    trajA: H.trajectory(tw, 'a'),
    trajB: H.trajectory(tw, 'b'),
    varsX: tw.vars.x,
    varsXType: typeof tw.vars.x,
  };
  return { published, tx1, afterOverride, tick1, tx2, identidadeMantida, afterSecond, rbB, group, afterGroup, reexposure, rbA, afterUndo, redo, afterRedo, clear, afterClear };
`);

// (f) tampering: impostora no slot → edições recusadas.
const tampering = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const tx1 = H.applyTx('tx-b4-f', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  tw.vars.x = () => 999; // impostora da página
  const B = H.select('b');
  const editRefused = H.applyTx('tx-b4-f2', B.elementId, B.motionId, H.v3(ownership, 'override', 140));
  const groupRefused = H.groupEditV2(A.elementId, A.motionId, 120);
  return { tx1, editRefused, groupRefused };
`);

// (i) CONTROLE DE SENSIBILIDADE: "override" por escalar cru contamina o irmão
// e o instrumento (comparação de trajetória do irmão) TEM que enxergar.
const sensibilidade = await runCase(`
  H.select('a');
  tw.vars.x = 160; // o write ingênuo que o canal existe pra substituir
  tw.invalidate();
  tw.totalTime(0, true);
  return { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
`);

// (k) AUDIT r1 (achados A+B do review adversarial): rollback de GROUP-EDIT
// por transaction com canal ativo replaya o shared LÓGICO (nunca a amostra
// do alvo overridado), e o redo pós-colapso ressincroniza o shared com o
// slot ATUAL (o tombstone nunca ressuscita um shared morto).
const auditRollback = await runCase(`
  const A = H.select('a');
  const ownership = A.track && A.track.ownership;
  const tx1 = H.applyTx('tx-b4-k1', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  // group-edit POR TRANSACTION (o before canônico tem que ser shared=100)
  const groupTx = (() => {
    const replies = H.sendV2('apply-transaction', {
      transaction: {
        id: 'tx-b4-k2',
        patches: [{ id: 'tx-b4-k2:p1', elementId: A.elementId, kind: 'motion', motionId: A.motionId, property: 'retarget.final', before: null,
          value: { schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value: 120, writeModel: 'absolute', affectedTargetCount: 2 } }],
      },
    });
    const ack = replies.filter((m) => ['transaction-committed', 'transaction-rejected'].includes(m.type)).pop();
    const patch = ack && ack.payload && ack.payload.transaction ? ack.payload.transaction.patches[0] : null;
    return { committed: ack?.type === 'transaction-committed', beforeValue: patch ? patch.before.value : null, valueValue: patch ? patch.value.value : null };
  })();
  const afterGroup = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
  // rollback do group-edit → shared volta a 100; A segue 160
  const rbGroup = H.rollbackTx('tx-b4-k2');
  const afterGroupUndo = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
  // undo do override → colapso no slot ATUAL (100, nunca 120)
  const rbOverride = H.rollbackTx('tx-b4-k1');
  const afterOverrideUndo = { varsX: tw.vars.x, varsXType: typeof tw.vars.x };
  // redo do override → tombstone reativado ressincroniza shared=100
  const redo = H.applyTx('tx-b4-k3', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
  const afterRedo = { trajA: H.trajectory(tw, 'a'), trajB: H.trajectory(tw, 'b') };
  return { tx1, groupTx, afterGroup, rbGroup, afterGroupUndo, rbOverride, afterOverrideUndo, redo, afterRedo };
`);

// (j) repeat:2 na MESMA página é recusado (chave B5 fechada) + publicação sem perTarget.
const repeatRefusal = await (async () => {
  const page = await newCasePage();
  const out = await page.evaluate(() => {
    /* eslint-disable no-undef */
    const H = window.__H;
    const tw = gsap.to([document.getElementById('a'), document.getElementById('b')], { x: 100, duration: 1, ease: 'none', repeat: 2, paused: true });
    H.boot();
    const A = H.select('a');
    const ownership = A.track && A.track.ownership;
    const perTargetPublished = Boolean(ownership && ownership.perTarget && ownership.perTarget.available);
    const tx = H.applyTx('tx-b4-j', A.elementId, A.motionId, H.v3(ownership, 'override', 160));
    return { perTargetPublished, tx };
  });
  await page.close();
  return out;
})();

await browser.close();

const observado = { referencia, referenciaGrupo120, principal, tampering, sensibilidade, auditRollback, repeatRefusal };

if (RECORD) {
  console.log(JSON.stringify(observado, null, 2));
  process.exit(0);
}

let red = 0;
const check = (rotulo, ok, detalhe) => {
  if (!ok) red += 1;
  console.log(`  ${ok ? 'OK  ' : 'RED '} ${rotulo}${!ok && detalhe ? ` — ${detalhe}` : ''}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('publicação (writeModel/perTarget derivados, nunca forçados)');
check("writeModel publicado = 'absolute'", principal.published.writeModel === 'absolute', `writeModel=${principal.published.writeModel}`);
check('perTarget.available publicado', principal.published.perTargetAvailable === true);

console.log('(a) trajetória completa do alvo + tick seguinte');
check('override commitou pelo caminho v2', principal.tx1.committed === true, JSON.stringify(principal.tx1.ack));
check('A anima 0→160 desde o início', eq(principal.afterOverride.trajA, [0, 40, 80, 120, 160]), JSON.stringify(principal.afterOverride.trajA));
check('estado temporal intacto no instante', eq(principal.afterOverride.temporal, referencia.temporal),
  `${JSON.stringify(principal.afterOverride.temporal)} vs ref ${JSON.stringify(referencia.temporal)}`);

console.log('(b) irmão byte-idêntico à referência');
check('B == referência não-editada', eq(principal.afterOverride.trajB, referencia.trajB),
  `${JSON.stringify(principal.afterOverride.trajB)} vs ref ${JSON.stringify(referencia.trajB)}`);

console.log('(c) 2ª edição mantém a identidade da função');
check('2º override commitou', principal.tx2.committed === true, JSON.stringify(principal.tx2.ack));
check('vars.x identidade preservada (=== na página)', principal.identidadeMantida === true);
check('B anima 0→140 após o próprio override', eq(principal.afterSecond.trajB, [0, 35, 70, 105, 140]), JSON.stringify(principal.afterSecond.trajB));
check('A segue 0→160', eq(principal.afterSecond.trajA, [0, 40, 80, 120, 160]), JSON.stringify(principal.afterSecond.trajA));

console.log('(d) edição posterior do GRUPO alcança só quem herda');
check('rollback do override de B commitou', principal.rbB.committed === true, JSON.stringify(principal.rbB.ack));
check('grupo→120 aplicou', principal.group.applied === true, principal.group.error);
check('A (override) segue 0→160', eq(principal.afterGroup.trajA, [0, 40, 80, 120, 160]), JSON.stringify(principal.afterGroup.trajA));
check('B (herda) anima 0→120', eq(principal.afterGroup.trajB, [0, 30, 60, 90, 120]), JSON.stringify(principal.afterGroup.trajB));

console.log('(e) re-exposição correta');
check("re-inspeção publica writeModel 'absolute'", principal.reexposure.writeModel === 'absolute', `writeModel=${principal.reexposure.writeModel}`);
check('sourceValue = shared (120)', principal.reexposure.sourceValue === 120, `sourceValue=${principal.reexposure.sourceValue}`);
check('states: A=override/160 e B=none', (() => {
  const states = principal.reexposure.states || [];
  const overrideState = states.find((s) => s.intent === 'override');
  const noneState = states.find((s) => s.intent === 'none');
  return states.length === 2 && overrideState?.value === 160 && Boolean(noneState);
})(), JSON.stringify(principal.reexposure.states));

console.log('(g) undo/redo por rollback-transaction');
check('rollback do 1º override commitou', principal.rbA.committed === true, JSON.stringify(principal.rbA.ack));
check('A volta a herdar (0→120)', eq(principal.afterUndo.trajA, [0, 30, 60, 90, 120]), JSON.stringify(principal.afterUndo.trajA));
check('colapso: vars.x volta a escalar 120', principal.afterUndo.varsXType === 'number' && principal.afterUndo.varsX === 120,
  `type=${principal.afterUndo.varsXType} vars.x=${principal.afterUndo.varsX}`);
check('redo re-aplica (A 0→160)', principal.redo.committed === true && eq(principal.afterRedo.trajA, [0, 40, 80, 120, 160]),
  JSON.stringify(principal.afterRedo.trajA));

console.log('(h) último reset restaura slot/tipo/trajetória (grupo mudou durante o override)');
check('clear commitou', principal.clear.committed === true, JSON.stringify(principal.clear.ack));
check('slot = escalar 120 (number, shared ATUAL — nunca o 100 original)',
  principal.afterClear.varsXType === 'number' && principal.afterClear.varsX === 120,
  `type=${principal.afterClear.varsXType} vars.x=${principal.afterClear.varsX}`);
check('trajetórias == referência grupo-120 (byte)',
  eq(principal.afterClear.trajA, referenciaGrupo120.trajA) && eq(principal.afterClear.trajB, referenciaGrupo120.trajB),
  `A=${JSON.stringify(principal.afterClear.trajA)} B=${JSON.stringify(principal.afterClear.trajB)} vs ref ${JSON.stringify(referenciaGrupo120.trajA)}`);

console.log('(f) tampering (impostora) recusado');
check('override sobre impostora → rejected', tampering.editRefused.committed === false, JSON.stringify(tampering.editRefused.ack));
check('grupo sobre impostora → rejected', tampering.groupRefused.applied === false, tampering.groupRefused.error);

console.log('(i) controle de sensibilidade: escalar cru contamina o irmão E o instrumento detecta');
check('write ingênuo contamina B (≠ referência)', !eq(sensibilidade.trajB, referencia.trajB),
  `B=${JSON.stringify(sensibilidade.trajB)} — se igual à referência, o instrumento é cego`);
check('write ingênuo move A e B juntos', eq(sensibilidade.trajA, sensibilidade.trajB));

console.log('(k) audit r1: rollback de grupo lógico + tombstone ressincronizado');
check('group-edit por transaction commitou com before = shared (100)',
  auditRollback.groupTx.committed === true && auditRollback.groupTx.beforeValue === '100' && auditRollback.groupTx.valueValue === '120',
  `before=${auditRollback.groupTx.beforeValue} value=${auditRollback.groupTx.valueValue}`);
check('rollback do grupo: B volta a 0→100, A segue 0→160',
  auditRollback.rbGroup.committed === true
  && eq(auditRollback.afterGroupUndo.trajB, referencia.trajB)
  && eq(auditRollback.afterGroupUndo.trajA, [0, 40, 80, 120, 160]),
  `B=${JSON.stringify(auditRollback.afterGroupUndo.trajB)} A=${JSON.stringify(auditRollback.afterGroupUndo.trajA)}`);
check('undo do override colapsa no slot ATUAL (100, nunca o 120 morto)',
  auditRollback.rbOverride.committed === true && auditRollback.afterOverrideUndo.varsXType === 'number' && auditRollback.afterOverrideUndo.varsX === 100,
  `vars.x=${auditRollback.afterOverrideUndo.varsX}`);
check('redo reativa o tombstone com shared ressincronizado (B em 0→100)',
  auditRollback.redo.committed === true
  && eq(auditRollback.afterRedo.trajA, [0, 40, 80, 120, 160])
  && eq(auditRollback.afterRedo.trajB, referencia.trajB),
  `A=${JSON.stringify(auditRollback.afterRedo.trajA)} B=${JSON.stringify(auditRollback.afterRedo.trajB)}`);

console.log('(j) repeat:2 recusado (chave B5 fechada)');
check('publicação sem perTarget', repeatRefusal.perTargetPublished === false);
check('v3 → transaction-rejected', repeatRefusal.tx.committed === false, JSON.stringify(repeatRefusal.tx.ack));

let baseline = null;
try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch (_) {}
if (!baseline) {
  console.error(`\n${red} RED · sem baseline — rode com --record e congele em _probe-b4-witness.baseline.json`);
  process.exit(red === 0 ? 1 : 1);
}
const contrato = JSON.stringify(observado) === JSON.stringify(baseline);
console.log(`\n${red} RED · contrato-vs-baseline: ${contrato ? 'BATE' : 'DIVERGIU'}`);
process.exit(red === 0 && contrato ? 0 : 1);
