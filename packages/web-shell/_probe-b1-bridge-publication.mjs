// B1 / PROBES 9+12 (núcleo) — CAMINHO REAL DO BRIDGE: o que a publicação diz
// HOJE sobre um stagger, e a convivência com o shape plano no mesmo elemento.
//
// Os probes 1–7 mediram o MOTOR (GSAP puro). Estes medem o PRODUTO: protocolo
// v2 real (negotiate + apply-transaction), publicação como verdade (nunca
// forçar ownership/writeModel), recusa avaliada por DISCRIMINADOR legível por
// máquina — e comparada com OUTRA classe de recusa (senão "indistinguível"
// seria opinião, não medida).
//
// Perguntas:
//  (A) stagger publica UMA animação lógica (não N por alvo) e com que
//      capabilities/razões/ownership?
//  (B) patch per-target num stagger: recusa? mexe no DOM? — trajetória dos 3
//      alvos comparada ANTES vs DEPOIS + observador de mutação de style
//      durante a transação, ambos com controle de sensibilidade.
//  (B2) a recusa é DISTINGUÍVEL de outra classe de recusa? (mede, não supõe)
//  (C) elemento com DUAS animações (plana + stagger): ambas publicadas com
//      IDs distintos e canais corretamente associados; editar a plana COMMITA
//      e não contamina o canal do stagger — com controle de sensibilidade.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const bridgeSrc = getRuntimeBridgeSource();

const HARNESS = `
window.__H = (() => {
  const V1 = 'uncraft-motion-editor/v1';
  const V2 = 'uncraft-motion-editor/v2';
  const NONCE = 'nonce-b1-bridge-123456';
  const BUNDLE = 'bundle-b1';
  const SESSION = 'session-b1';
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
      runtimeFingerprint: 'sha256:b1-bridge',
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
        protocol: V1, protocolVersion: V1, supportedProtocols: [V2, V1],
        source: 'host', type: 'negotiate-protocol', requestId: 'negotiate-b1',
        sessionNonce: NONCE, runtimeGeneration: generation, bundleId: BUNDLE, sessionId: SESSION,
        payload: { selectedProtocol: V2 },
      },
    }));
    const negotiated = messages.filter((m) => m.type === 'protocol-negotiated').pop();
    return { negotiated: negotiated?.payload?.selectedProtocol === V2 };
  }

  function sendV2(type, payload) {
    const requestId = 'b1-req-' + (seq += 1);
    const mark = messages.length;
    window.dispatchEvent(new MessageEvent('message', {
      source: window, origin: ORIGIN,
      data: {
        protocol: V2, protocolVersion: V2, supportedProtocols: [V2, V1],
        source: 'host', type, sessionNonce: NONCE, requestId,
        runtimeGeneration: generation, bundleId: BUNDLE, sessionId: SESSION, payload,
      },
    }));
    return messages.slice(mark);
  }

  function selectFull(domId) {
    document.getElementById(domId).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const sel = messages.filter((m) => m.type === 'selection-changed').pop();
    const element = sel?.payload?.element || {};
    const motions = (element.motion || []).map((m) => ({
      id: m.id,
      engine: m.engine || null,
      editability: m.editability || null,
      capabilities: m.capabilities ? JSON.parse(JSON.stringify(m.capabilities)) : null,
      // ⚠️ ownership vive POR TRACK (não no motion) — ler no motion devolvia
      // undefined e me fez afirmar "stagger não publica ownership", que é
      // FALSO (Sol r3 expôs a leitura errada)
      ownershipMotion: m.ownership ? JSON.parse(JSON.stringify(m.ownership)) : null,
      trackProps: (m.tracks || []).map((t) => t.property),
      trackEditable: (m.tracks || []).map((t) => ({
        p: t.property,
        keyframeEditable: t.keyframeEditable ?? null,
        keyframeEditReason: t.keyframeEditReason ?? null,
        ownership: t.ownership ? JSON.parse(JSON.stringify(t.ownership)) : null,
      })),
    }));
    return { elementId: element.id, motions };
  }

  // (o helper que FABRICAVA descriptor v3 foi removido — Sol r3/r4: todo
  // descriptor v3 usado aqui sai da ownership PUBLICADA e é provado
  // commitando num contexto suportado antes de ser levado ao stagger)

  function applyTxRaw(txId, elementId, motionId, descriptor, property) {
    const replies = sendV2('apply-transaction', {
      transaction: {
        id: txId,
        patches: [{ id: txId + ':p1', elementId, kind: 'motion', motionId,
                    property: property || 'retarget.final', before: null, value: descriptor }],
      },
    });
    const ack = replies.filter((m) => ['transaction-committed', 'transaction-rejected'].includes(m.type)).pop();
    return {
      committed: ack?.type === 'transaction-committed',
      type: ack?.type || null,
      code: ack?.payload?.code || null,
      // TUDO que a recusa carrega — o discriminador, se existir, está aqui
      payload: ack?.payload ? JSON.parse(JSON.stringify(ack.payload)) : null,
    };
  }

  // Observador de mutação de style DURANTE a chamada (prova de que a
  // transação não escreveu nem transitoriamente e desfez)
  function withStyleWatch(ids, fn) {
    const seen = [];
    const obs = new MutationObserver((recs) => {
      recs.forEach((r) => seen.push({ id: r.target.id, attr: r.attributeName, old: r.oldValue }));
    });
    ids.forEach((id) => obs.observe(document.getElementById(id), {
      attributes: true, attributeFilter: ['style'], attributeOldValue: true,
    }));
    let out;
    try { out = fn(); } finally { obs.takeRecords().forEach((r) => seen.push({ id: r.target.id, attr: r.attributeName, old: r.oldValue })); obs.disconnect(); }
    return { out, mutacoes: seen.length, detalhe: seen.slice(0, 4) };
  }

  function X(id) { return Number(Number(gsap.getProperty(document.getElementById(id), 'x')).toFixed(4)); }
  function Y(id) { return Number(Number(gsap.getProperty(document.getElementById(id), 'y')).toFixed(4)); }
  function trajetoria(tw, id, prop) {
    const parked = tw.totalTime();
    const total = tw.totalDuration();
    const read = prop === 'y' ? Y : X;
    const out = [0, 0.25, 0.5, 0.75, 1].map((f) => { tw.totalTime(f * total, true); return read(id); });
    tw.totalTime(parked, true);
    return out;
  }
  function trajTodos(tw, ids, prop) {
    return Object.fromEntries(ids.map((id) => [id, trajetoria(tw, id, prop)]));
  }
  return { boot, sendV2, selectFull, applyTxRaw, withStyleWatch, X, Y, trajetoria, trajTodos, messages };
})();
`;

const browser = await chromium.launch({ headless: true });
async function newPage(html) {
  const page = await browser.newPage();
  await page.setContent(html);
  await page.addScriptTag({ content: gsapSrc });
  await page.evaluate((src) => { window.__BRIDGE_SRC = src; }, bridgeSrc);
  await page.addScriptTag({ content: HARNESS });
  return page;
}
const HTML3 = ['s0', 's1', 's2'].map((id) => `<div id="${id}" style="width:40px;height:40px"></div>`).join('');

const registro = {};
const falhas = [];
const assert = (cond, msg) => { if (!cond) falhas.push(msg); };

// --- (A) publicação de um stagger ------------------------------------------
{
  const page = await newPage(HTML3);
  const r = await page.evaluate(() => {
    const boot = window.__H.boot();
    window.__tw = gsap.to('#s0, #s1, #s2', { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });
    window.__tw.totalTime(0.7, true);
    return { boot, pub: window.__H.selectFull('s1') };
  });
  registro.publicacaoStagger = r;
  assert(r.boot.negotiated, 'A: protocolo v2 não negociou');
  assert(r.pub.motions.length === 1,
    `A: stagger publicou ${r.pub.motions.length} animações (esperado 1 lógica)`);
  const m0 = r.pub.motions[0] || {};
  // Sol r1: `.every` passa com zero tracks — exigir tracks NÃO VAZIOS primeiro
  assert((m0.trackProps || []).length > 0, 'A: motion publicada sem track nenhum (every() seria vácuo)');
  assert((m0.trackProps || []).includes('x'), `A: canal x ausente (${JSON.stringify(m0.trackProps)})`);
  assert(m0.capabilities && m0.capabilities.keyframes === false,
    `A: capabilities.keyframes deveria ser false pro stagger hoje (${JSON.stringify(m0.capabilities)})`);
  assert((m0.trackEditable || []).length > 0
    && m0.trackEditable.every((t) => t.keyframeEditable === false && t.keyframeEditReason === 'stagger'),
    `A: razão por-track deveria ser 'stagger' em todos os canais (${JSON.stringify(m0.trackEditable)})`);
  const ownX = (m0.trackEditable || []).find((t) => t.p === 'x')?.ownership || null;
  registro.ownershipStagger = ownX;
  assert(ownX != null, 'A: stagger não publicou ownership no track x');
  assert(ownX && ownX.retargetable === false,
    `A: ownership do stagger deveria trazer retargetable:false (${JSON.stringify(ownX)})`);
  assert(ownX && ownX.stagger && ownX.stagger.mode === 'staggered' && ownX.stagger.targetCount === 3,
    `A: ownership do stagger deveria trazer o descritor stagger (${JSON.stringify(ownX?.stagger)})`);
  assert(ownX && ownX.affectedTargetCount === 3,
    `A: affectedTargetCount deveria ser 3 (${JSON.stringify(ownX?.affectedTargetCount)})`);
  registro.perTargetStagger = ownX?.perTarget ?? null;
  await page.close();
}

// --- (B0) o descriptor v3 per-target COMMITA num contexto suportado? --------
// (Sol r3: sem este controle, a recusa do stagger pode ser do DESCRIPTOR
// fabricado — a publicação do stagger não traz ownership, então qualquer v3
// per-target ali é inventado por mim. Aqui o descriptor sai da publicação
// REAL de um shape suportado — multi-target plano, chave B4 shipada — e é
// PROVADO commitando; é esse mesmo objeto que a seção B2 leva ao stagger.)
let DESCRIPTOR_PROVADO = null;
{
  const page = await newPage(HTML3);
  const r = await page.evaluate(() => {
    window.__H.boot();
    // multi-target PLANO (sem stagger) com os MESMOS 3 alvos e a mesma
    // propriedade do caso do stagger — assim affectedTargetCount/runtimeProperty
    // batem e a ÚNICA variável entre commitar e recusar é o `stagger`
    window.__plano = gsap.to('#s0, #s1, #s2', { x: 100, duration: 1, ease: 'none', paused: true });
    window.__plano.totalTime(0.5, true);
    const pub = window.__H.selectFull('s1');
    const motion = (pub.motions || []).find((m) => (m.trackProps || []).includes('x')) || null;
    if (!motion) return { semMotion: true };
    // descriptor construído A PARTIR da ownership publicada NO TRACK (nada inventado)
    const own = (motion.trackEditable || []).find((t) => t.p === 'x')?.ownership || null;
    const desc = own ? {
      schemaVersion: 3,
      semanticProperty: 'translateX',
      runtimeProperty: own.runtimeProperty,
      targetScope: { mode: 'single' },
      intent: 'override',
      value: '55',
      writeModel: own.writeModel,
      affectedTargetCount: own.affectedTargetCount,
    } : null;
    const res = desc ? window.__H.applyTxRaw('tx-b0', pub.elementId, motion.id, desc) : null;
    return { ownershipPublicada: own, desc, res: res && { committed: res.committed, code: res.code } };
  });
  registro.descriptorProvado = r;
  assert(!r.semMotion, 'B0: shape plano multi-target não publicou animação');
  assert(r.ownershipPublicada != null,
    'B0: shape suportado não publicou ownership — não há de onde tirar descriptor não-fabricado');
  assert(r.res && r.res.committed,
    `B0: o descriptor v3 per-target NÃO commitou nem no contexto suportado (${JSON.stringify(r.res)}) — sem isso, recusa no stagger não é atribuível ao stagger`);
  DESCRIPTOR_PROVADO = r.desc;
  await page.close();
}

// --- (B) per-target num stagger: recusa E não escreve (trajetória + watcher) -
{
  const page = await newPage(HTML3);
  const r = await page.evaluate((descProvado) => {
    window.__H.boot();
    const ids = ['s0', 's1', 's2'];
    window.__tw = gsap.to('#s0, #s1, #s2', { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });
    window.__tw.totalTime(0.7, true);
    const pub = window.__H.selectFull('s1');
    const motion = pub.motions[0] || null;
    if (!motion) return { semMotion: true };
    // trajetória ANTES (Sol r1: só o x estacionado não prova preservação)
    const trajAntes = window.__H.trajTodos(window.__tw, ids, 'x');
    const parkedAntes = { s0: window.__H.X('s0'), s1: window.__H.X('s1'), s2: window.__H.X('s2') };

    // MESMO objeto que commitou no shape suportado (Sol r4: provar "recusa"
    // com um descriptor e "não escreve" com outro não compõe o claim)
    const w = window.__H.withStyleWatch(ids, () =>
      window.__H.applyTxRaw('tx-b1-B', pub.elementId, motion.id, descProvado));

    const trajDepois = window.__H.trajTodos(window.__tw, ids, 'x');
    const parkedDepois = { s0: window.__H.X('s0'), s1: window.__H.X('s1'), s2: window.__H.X('s2') };

    // CONTROLE de sensibilidade do instrumento, em DUAS dimensões:
    //  - watcher: uma escrita de style REAL tem que ser vista;
    //  - comparador de trajetória: uma mudança REAL da animação tem que
    //    aparecer. (gsap.set não serve pro 2º: a amostragem re-renderiza o
    //    tween e sobrescreve o inline — foi o RED que este controle pegou.)
    const ctrl = window.__H.withStyleWatch(ids, () => { gsap.set('#s1', { x: 999 }); return null; });
    window.__tw.vars.x = 55;
    window.__tw.invalidate();
    const trajCtrl = window.__H.trajTodos(window.__tw, ids, 'x');
    return {
      res: w.out, mutacoesDurante: w.mutacoes, detalheMutacao: w.detalhe,
      trajAntes, trajDepois, parkedAntes, parkedDepois,
      ctrlMutacoes: ctrl.mutacoes, trajCtrl, descriptorUsado: descProvado,
    };
  }, DESCRIPTOR_PROVADO);
  registro.patchPerTargetStagger = r;
  assert(!r.semMotion, 'B: nenhuma animação publicada pro alvo');
  if (!r.semMotion) {
    assert(!r.res.committed,
      `B: per-target num stagger foi COMMITADO — a tranca do 172 caiu (${JSON.stringify(r.res)})`);
    assert(r.res.type === 'transaction-rejected' && r.res.code === 'unsupported_patch',
      `B: forma da recusa mudou (${JSON.stringify({ type: r.res.type, code: r.res.code })})`);
    assert(JSON.stringify(r.trajAntes) === JSON.stringify(r.trajDepois),
      `B: TRAJETÓRIA mudou apesar da recusa\n antes: ${JSON.stringify(r.trajAntes)}\n depois: ${JSON.stringify(r.trajDepois)}`);
    assert(JSON.stringify(r.parkedAntes) === JSON.stringify(r.parkedDepois),
      `B: valor estacionado mudou apesar da recusa ${JSON.stringify({ a: r.parkedAntes, d: r.parkedDepois })}`);
    assert(r.mutacoesDurante === 0,
      `B: houve escrita de style DURANTE a transação recusada (${r.mutacoesDurante}) ${JSON.stringify(r.detalheMutacao)}`);
    // controle: o instrumento SABE detectar escrita
    assert(r.ctrlMutacoes > 0, 'B/controle: watcher não viu uma escrita REAL — instrumento cego');
    assert(JSON.stringify(r.trajCtrl) !== JSON.stringify(r.trajDepois),
      'B/controle: trajetória não mudou com escrita real — comparador cego');
  }
  await page.close();
}

// --- (B2) a recusa é DISTINGUÍVEL de outra classe de recusa? ----------------
{
  const page = await newPage(HTML3);
  const r = await page.evaluate((descProvado) => {
    window.__H.boot();
    window.__tw = gsap.to('#s0, #s1, #s2', { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });
    window.__tw.totalTime(0.7, true);
    const pub = window.__H.selectFull('s1');
    const motion = pub.motions[0];
    // classe 1: MESMO descriptor que commitou no shape suportado, agora no
    // stagger — a única variável é o contexto (Sol r3)
    const r1 = window.__H.applyTxRaw('tx-b2-1', pub.elementId, motion.id, descProvado);
    // classe 2: OUTRA recusa — motionId inexistente (patch igualmente inválido,
    // motivo completamente diferente)
    const r2 = window.__H.applyTxRaw('tx-b2-2', pub.elementId, 'gsap-nao-existe', descProvado);
    // classe 3: propriedade não suportada — ISOLADA numa animação PLANA
    // (Sol r2: mandar skewZ com targetScope 'single' no stagger repetia a
    // condição inválida de r1, então payloads iguais não provavam nada).
    // Página limpa própria, com CONTROLE: o descriptor equivalente com
    // propriedade suportada TEM que commitar; só então trocar a propriedade
    // isola a classe.
    window.__plainB2 = gsap.to('#s0', { y: 50, duration: 1, ease: 'none', paused: true });
    window.__plainB2.totalTime(0.5, true);
    const pubPlano = window.__H.selectFull('s0');
    const mPlano = (pubPlano.motions || []).find((m) => (m.trackProps || []).includes('y')) || null;
    const descOk = { schemaVersion: 2, semanticProperty: 'translateY', runtimeProperty: 'y',
                     value: '20', writeModel: 'absolute', affectedTargetCount: 1 };
    const ctrlCommit = mPlano
      ? window.__H.applyTxRaw('tx-b2-ctrl', pubPlano.elementId, mPlano.id, descOk) : null;
    // ⚠️ 'skewZ' NÃO serve de classe 3: medido, ele COMMITA (o bridge cria o
    // canal — propriedade suportada). A classe 3 usa uma OPERAÇÃO de patch
    // desconhecida no MESMO motion editável, com o mesmo descriptor que o
    // controle acabou de commitar: muda só a operação.
    const r3 = mPlano
      ? window.__H.applyTxRaw('tx-b2-3', pubPlano.elementId, mPlano.id, descOk, 'bogus.operation')
      : null;
    const r3skew = mPlano
      ? window.__H.applyTxRaw('tx-b2-3s', pubPlano.elementId, mPlano.id,
          { ...descOk, semanticProperty: 'skewZ', runtimeProperty: 'skewZ' })
      : null;
    // MESMA classe, transação diferente: a fingerprint é discriminador
    // ESTÁVEL de classe, ou varia por transação? (decide se a "obrigação de
    // design" se sustenta — pode REFUTAR o claim do autor)
    const r1b = window.__H.applyTxRaw('tx-b2-1-bis', pub.elementId, motion.id, descProvado);
    // e um alvo IRMÃO do mesmo stagger, mesma classe
    const pubIrmao = window.__H.selectFull('s2');
    const r1c = window.__H.applyTxRaw('tx-b2-1-tri', pubIrmao.elementId, pubIrmao.motions[0].id, descProvado);
    const semFingerprint = (p) => {
      if (!p) return null;
      const c = JSON.parse(JSON.stringify(p));
      if (c.diagnostics) delete c.diagnostics.fingerprint;
      delete c.transactionId;
      return c;
    };
    return {
      ctrlCommit: ctrlCommit ? { committed: ctrlCommit.committed, code: ctrlCommit.code } : null,
      r1: { code: r1.code, payload: r1.payload, canon: semFingerprint(r1.payload) },
      r2: { code: r2.code, payload: r2.payload, canon: semFingerprint(r2.payload) },
      r3: r3 ? { code: r3.code, payload: r3.payload, canon: semFingerprint(r3.payload) } : null,
      fps: [r1.payload?.diagnostics?.fingerprint, r2.payload?.diagnostics?.fingerprint, r3?.payload?.diagnostics?.fingerprint],
      fpMesmaClasse: {
        mesmoAlvoOutraTx: r1b.payload?.diagnostics?.fingerprint,
        irmaoMesmaClasse: r1c.payload?.diagnostics?.fingerprint,
      },
      fatoSkewZ: r3skew ? { committed: r3skew.committed, code: r3skew.code } : null,
    };
  }, DESCRIPTOR_PROVADO);
  registro.discriminadorDeRecusa = r;
  assert(!r.r1.payload?.committed && r.r1.code, 'B2: classe 1 não recusou');
  // O FATO medido (não suposto): as classes são distinguíveis por algo estável?
  const c1 = JSON.stringify(r.r1.canon), c2 = JSON.stringify(r.r2.canon), c3 = JSON.stringify(r.r3?.canon);
  registro.fatoDiscriminador = {
    codigos: [r.r1.code, r.r2.code, r.r3?.code],
    controleCommitou: r.ctrlCommit,
    canonIguais_1_2: c1 === c2,
    canonIguais_1_3: c1 === c3,
    fingerprints: r.fps,
    fingerprintsDistintos: new Set(r.fps.filter(Boolean)).size,
    fpMesmaClasse: r.fpMesmaClasse,
    fpEstavelPorClasse: r.fps[0] === r.fpMesmaClasse.mesmoAlvoOutraTx
      && r.fps[0] === r.fpMesmaClasse.irmaoMesmaClasse,
    // fato colateral medido: propriedade nova COMMITA (não é "não suportada")
    skewZCommita: r.fatoSkewZ,
  };
  // Fatos assertados (a leitura do doc depende deles):
  assert(r.r2.code === 'motion_missing',
    `B2: classe "motion inexistente" deveria ter código próprio (${r.r2.code})`);
  // CONTROLE do isolamento (Sol r2): a classe 3 só é "propriedade não
  // suportada" se o MESMO descriptor com propriedade suportada COMMITAR.
  assert(r.ctrlCommit && r.ctrlCommit.committed,
    `B2/controle: descriptor equivalente com propriedade suportada NÃO commitou (${JSON.stringify(r.ctrlCommit)}) — a classe 3 não está isolada`);
  assert(r.r3 && !r.r3.committed && r.r3.code,
    `B2: classe "operação desconhecida" não recusou (código=${r.r3?.code})`);
  assert(registro.fatoDiscriminador.canonIguais_1_3,
    `B2: stagger-per-target e operação-desconhecida NÃO são idênticos no payload canônico — o catch-all NÃO é compartilhado, a obrigação de design cai/muda de forma (${JSON.stringify([r.r1.code, r.r3?.code])})`);
}

// --- (C) duas animações no mesmo elemento: publicação + edição sem contaminar
{
  const page = await newPage(HTML3);
  const r = await page.evaluate(() => {
    window.__H.boot();
    window.__tw = gsap.to('#s0, #s1, #s2', { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });
    window.__plain = gsap.to('#s1', { y: 50, duration: 1, ease: 'none', paused: true });
    window.__tw.totalTime(0.7, true);
    window.__plain.totalTime(0.5, true);
    const pub = window.__H.selectFull('s1');
    const comX = pub.motions.filter((m) => (m.trackProps || []).includes('x'));
    const comY = pub.motions.filter((m) => (m.trackProps || []).includes('y'));
    const trajXAntes = window.__H.trajTodos(window.__tw, ['s0', 's1', 's2'], 'x');
    const trajYAntes = window.__H.trajetoria(window.__plain, 's1', 'y');

    let edicaoPlana = null, trajXDepois = null, trajYDepois = null;
    if (comY.length === 1) {
      const mY = comY[0];
      // descriptor v2 (mesma forma do groupEditV2 do witness B4, conhecida-boa
      // pro shape plano de alvo único) — v3 per-target aqui deu invalid_value,
      // e a pergunta desta seção é convivência, não a forma do descriptor
      edicaoPlana = window.__H.applyTxRaw('tx-c-1', pub.elementId, mY.id, {
        schemaVersion: 2, semanticProperty: 'translateY', runtimeProperty: 'y',
        value: '20', writeModel: 'absolute', affectedTargetCount: 1,
      });
      trajXDepois = window.__H.trajTodos(window.__tw, ['s0', 's1', 's2'], 'x');
      trajYDepois = window.__H.trajetoria(window.__plain, 's1', 'y');
    }
    return {
      n: pub.motions.length,
      ids: pub.motions.map((m) => m.id),
      comX: comX.map((m) => ({ id: m.id, props: m.trackProps, razao: (m.trackEditable[0] || {}).keyframeEditReason })),
      comY: comY.map((m) => ({ id: m.id, props: m.trackProps, razao: (m.trackEditable[0] || {}).keyframeEditReason })),
      edicaoPlana, trajXAntes, trajXDepois, trajYAntes, trajYDepois,
    };
  });
  registro.duasAnimacoes = r;
  assert(r.n === 2, `C: elemento com 2 animações publicou ${r.n} — regra de produto exige AMBAS`);
  assert(new Set(r.ids).size === r.ids.length, `C: IDs duplicados ${JSON.stringify(r.ids)}`);
  // associação EXATA (Sol r1): stagger→x com razão 'stagger'; plana→y sem razão
  assert(r.comX.length === 1 && r.comX[0].razao === 'stagger',
    `C: canal x não está associado à animação de stagger ${JSON.stringify(r.comX)}`);
  assert(r.comY.length === 1 && r.comY[0].razao === null,
    `C: canal y não está associado à animação plana editável ${JSON.stringify(r.comY)}`);
  assert(r.comX[0].id !== r.comY[0].id, 'C: x e y saíram da MESMA animação — associação errada');
  // editar a plana COMMITA e NÃO contamina o canal do stagger
  assert(r.edicaoPlana && r.edicaoPlana.committed,
    `C: edição da animação plana não commitou ${JSON.stringify(r.edicaoPlana)}`);
  assert(JSON.stringify(r.trajXAntes) === JSON.stringify(r.trajXDepois),
    `C: editar a plana CONTAMINOU o canal do stagger\n antes: ${JSON.stringify(r.trajXAntes)}\n depois: ${JSON.stringify(r.trajXDepois)}`);
  // controle: a edição realmente MUDOU o que devia (senão "não contaminou" é vácuo)
  assert(JSON.stringify(r.trajYAntes) !== JSON.stringify(r.trajYDepois),
    `C/controle: a edição da plana não mudou o canal y — não-contaminação seria vácua ${JSON.stringify({ a: r.trajYAntes, d: r.trajYDepois })}`);
  await page.close();
}

await browser.close();
console.log(JSON.stringify(registro, null, 2));
console.log(falhas.length ? `\n${falhas.length} RED:\n- ${falhas.join('\n- ')}` : '\n0 RED');
process.exit(falhas.length ? 1 : 0);
