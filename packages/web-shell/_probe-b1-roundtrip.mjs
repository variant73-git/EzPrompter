// B1 / PROBE 7 — ROUND-TRIP ESTRUTURAL (prescrição do advise Sol 2026-08-06).
//
// validate-transaction aplica e restaura DUAS vezes antes do commit real —
// o transplante precisa sobreviver a apply/rollback×2 + commit/undo/redo com
// topologia BYTE-IGUAL (fingerprint: identidade do filho, parent, ordem,
// startTime, vars, duração) e DOM igual à referência por 2 ticks.
// Sensibilidade do INSTRUMENTO: com filhos de MESMO startTime, um round-trip
// sem restauração ordinal muda SÓ a ordem (probe 4) — o fingerprint tem que
// VER a mudança de ordem pura (startTimes idênticos, asserção incluída).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const root = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0';
const gsapSrc = readFileSync(`${root}/gsap.min.js`, 'utf8');

const browser = await chromium.launch({ headless: true });
const HTML = `<div>
  <div class="ga" id="a0"></div><div class="ga" id="a1"></div><div class="ga" id="a2"></div>
  <div class="gr" id="r0"></div><div class="gr" id="r1"></div><div class="gr" id="r2"></div>
</div>`;

async function runPage(body, arg) {
  const page = await browser.newPage();
  await page.setContent(HTML);
  await page.addScriptTag({ content: gsapSrc });
  const out = await page.evaluate(
    ([b, a]) => new Function('arg', `return (async () => {${b}})()`)(a),
    [body, arg ?? null],
  );
  await page.close();
  return out;
}

const LIB = `
  const X = (id) => Number(gsap.getProperty(document.getElementById(id), 'x'));
  const snapA = () => ({ a0: X('a0'), a1: X('a1'), a2: X('a2') });
  const snapR = () => ({ r0: X('r0'), r1: X('r1'), r2: X('r2') });
  const childOf = (tw, el) => tw.timeline.getChildren(true, true, false)
    .find((c) => c.targets && c.targets()[0] === el) || null;
  // fingerprint de topologia RECURSIVO (Sol r1: só a cadeia de topo deixava
  // corrupção DENTRO do wrapper invisível): ordem REAL da cadeia (_first→_next)
  // em cada nível, identidade (marca __pid), parent correto, startTime/durações
  // como string, vars serializados
  const fpNode = (node, parent) => {
    const base = {
      pid: node.__pid ?? null,
      target: node.targets ? ((node.targets()[0] && node.targets()[0].id) || 'anon') : 'tl',
      st: String(node.startTime()),
      dur: String(node.duration()),
      parentOk: node.parent === parent,
      vars: node.vars ? JSON.stringify({ x: node.vars.x, opacity: node.vars.opacity }) : null,
    };
    if (node.getChildren) {
      base.kids = [];
      let sub = node._first;
      while (sub) { base.kids.push(fpNode(sub, node)); sub = sub._next; }
    }
    return base;
  };
  // REGISTRO único (Sol r3: o canônico omitia dur/total EXTERNOS, então
  // canonEq=true não cobria todos os campos não-ordinais). Os DOIS
  // serializadores saem daqui — o canônico difere só por ordenar as cadeias.
  const fpRecord = (tw) => {
    const kids = [];
    let node = tw.timeline._first;
    while (node) { kids.push(fpNode(node, tw.timeline)); node = node._next; }
    return { kids, dur: String(tw.duration()), total: String(tw.totalDuration()) };
  };
  const sortKids = (node) => {
    if (!node.kids) return node;
    const kids = node.kids.map(sortKids).sort((x, y) => {
      const kx = x.target + '|' + x.pid, ky = y.target + '|' + y.pid;
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    });
    return { ...node, kids };
  };
  // serializador canônico exposto SOBRE O REGISTRO (Sol r4: só assim dá pra
  // testar sensibilidade campo a campo, com cópias que diferem em EXATAMENTE
  // um campo — mutar a animação viva confunde campos, ex.: adicionar filho
  // muda kids E as durações externas juntos)
  const canonSerialize = (record) => JSON.stringify(sortKids(record));
  const fingerprint = (tw) => JSON.stringify(fpRecord(tw));
  const canonical = (tw) => canonSerialize(fpRecord(tw));
  const mark = (tw) => tw.timeline.getChildren(true, true, false).forEach((c, i) => { c.__pid = i; });
  const nest = (tw, el) => {
    const child = childOf(tw, el);
    const frozen = { st: child.startTime(), pid: child.__pid };
    tw.timeline.remove(child);
    const wrap = gsap.timeline();
    wrap.add(child, 0);
    tw.timeline.add(wrap, frozen.st);
    return { wrap, child, frozen };
  };
  // NOTA: este unnest restaura startTime mas NÃO restaura posição ordinal —
  // correto pra starts distintos (sortChildren re-ordena); pra starts IGUAIS
  // ele corrompe a ordem (fato do probe 4), o que o bloco de sensibilidade
  // usa como mutante. Restauração ordinal = obrigação do design (rollback).
  const unnest = (tw, t) => {
    t.wrap.remove(t.child);
    tw.timeline.remove(t.wrap);
    tw.timeline.add(t.child, t.frozen.st);
    t.child.startTime(t.frozen.st);
    t.wrap.kill();
  };
`;

const registro = {};
const falhas = [];
const assert = (cond, msg) => { if (!cond) falhas.push(msg); };

// --- round-trip: apply/rollback ×2 + commit/undo/redo ------------------------
{
  const r = await runPage(`${LIB}
    const mk = (sel) => gsap.to(sel, { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });
    const twA = mk('.ga'); const twR = mk('.gr');
    twA.totalTime(0.7, true); twR.totalTime(0.7, true);
    mark(twA);
    const fp0 = fingerprint(twA);
    // identidade REFERENCIAL estrita (Sol r1: __pid é marca copiável; === não é)
    const childRef0 = childOf(twA, document.getElementById('a1'));

    const roundtrip = () => { const t = nest(twA, document.getElementById('a1')); unnest(twA, t); };
    roundtrip();                       // validate pass 1
    const fp1 = fingerprint(twA);
    roundtrip();                       // validate pass 2
    const fp2 = fingerprint(twA);
    const dom2 = { a: snapA(), r: snapR() };

    // commit / undo / redo
    const tCommit = nest(twA, document.getElementById('a1'));   // commit
    const fpCommit = fingerprint(twA);
    unnest(twA, tCommit);                                        // undo
    const fpUndo = fingerprint(twA);
    const tRedo = nest(twA, document.getElementById('a1'));      // redo
    // fachada arrasta o filho no estado committed (spot-check)
    twA.totalTime(0.9, true); twR.totalTime(0.9, true);
    const tick1 = { a: snapA(), r: snapR() };
    twA.totalTime(1.1, true); twR.totalTime(1.1, true);
    const tick2 = { a: snapA(), r: snapR() };
    unnest(twA, tRedo);
    twA.totalTime(0.7, true); twR.totalTime(0.7, true);
    const fpFinal = fingerprint(twA);
    const domFinal = { a: snapA(), r: snapR() };
    const identidade = childOf(twA, document.getElementById('a1')) === childRef0;
    return { fp0, fp1, fp2, fpCommit, fpUndo, fpFinal, dom2, tick1, tick2, domFinal, identidade };
  `);
  registro.roundtrip = {
    fpEq1: r.fp0 === r.fp1, fpEq2: r.fp0 === r.fp2, fpUndoEq: r.fp0 === r.fpUndo,
    fpFinalEq: r.fp0 === r.fpFinal, commitDiferente: r.fpCommit !== r.fp0,
    identidade: r.identidade, dom2: r.dom2, tick1: r.tick1, tick2: r.tick2, domFinal: r.domFinal,
  };
  assert(r.fp0 === r.fp1, `roundtrip: fingerprint divergiu após validate 1\n${r.fp0}\n${r.fp1}`);
  assert(r.fp0 === r.fp2, `roundtrip: fingerprint divergiu após validate 2 (corrupção CUMULATIVA)\n${r.fp2}`);
  assert(r.fp0 === r.fpUndo, `roundtrip: undo não restaurou a topologia\n${r.fpUndo}`);
  assert(r.fp0 === r.fpFinal, `roundtrip: estado final divergiu\n${r.fpFinal}`);
  assert(r.fpCommit !== r.fp0, 'roundtrip: fingerprint NÃO distinguiu committed (instrumento cego)');
  assert(r.identidade, 'roundtrip: identidade do filho se perdeu (não é a MESMA instância)');
  const eq = (sa, sr) => sa.a0 === sr.r0 && sa.a1 === sr.r1 && sa.a2 === sr.r2;
  assert(eq(r.dom2.a, r.dom2.r), `roundtrip: DOM divergiu após 2 validates ${JSON.stringify(r.dom2)}`);
  assert(eq(r.tick1.a, r.tick1.r) && eq(r.tick2.a, r.tick2.r),
    `roundtrip: ticks divergiram no estado committed ${JSON.stringify({ t1: r.tick1, t2: r.tick2 })}`);
  assert(eq(r.domFinal.a, r.domFinal.r), `roundtrip: DOM final divergiu ${JSON.stringify(r.domFinal)}`);
}

// --- sensibilidade: reinserção ingênua com MESMO startTime é detectada -------
{
  const r = await runPage(`${LIB}
    const mk = (sel) => gsap.to(sel, { x: 100, duration: 1, ease: 'none', stagger: { each: 0 }, paused: true });
    const twA = mk('.ga');
    twA.totalTime(0.5, true);
    mark(twA);
    // Isolamento do mutante (Sol r2): provar que SÓ a ordem mudou —
    // (a) cadeia _first→_next antes/depois com mudança ASSERTADA;
    // (b) fingerprint CANÔNICO (mesmos campos, ordenado por alvo — independe
    //     da ordem da cadeia) byte-igual antes/depois;
    // (c) identidade referencial === por alvo preservada.
    // Só então fp0 !== fp1 atribui a detecção à ORDEM.
    const chainIds = (tw) => {
      const out = []; let n = tw.timeline._first;
      while (n) { out.push(n.targets ? ((n.targets()[0] && n.targets()[0].id) || 'anon') : 'tl'); n = n._next; }
      return out;
    };
    // canônico = MESMO registro recursivo do fingerprint (incl. dur/total
    // externos), só com as cadeias ordenadas por alvo — Sol r3
    const canon = canonical;
    const refsDe = (tw) => Object.fromEntries(['a0', 'a1', 'a2']
      .map((id) => [id, childOf(tw, document.getElementById(id))]));

    const fp0 = fingerprint(twA);
    const chain0 = chainIds(twA);
    const canon0 = canon(twA);
    const refs0 = refsDe(twA);
    const t = nest(twA, document.getElementById('a1'));
    // Mutante: re-add no MESMO startTime congelado; com starts iguais o add
    // reinsere DEPOIS dos irmãos de mesmo start — a hipótese "só ordem" é
    // ASSERTADA abaixo, não presumida do probe 4 (que mediu nest, não o
    // round-trip completo).
    unnest(twA, t);
    const fp1 = fingerprint(twA);
    const chain1 = chainIds(twA);
    const canon1 = canon(twA);
    const refs1 = refsDe(twA);
    const identidades = ['a0', 'a1', 'a2'].every((id) => refs0[id] === refs1[id] && refs0[id] != null);
    const sts = twA.timeline.getChildren(true, true, false).map((c) => String(c.startTime()));
    return { fp0, fp1, chain0, chain1, canonEq: canon0 === canon1, identidades, sts };
  `);
  registro.sensibilidade = {
    detectou: r.fp0 !== r.fp1, chain0: r.chain0, chain1: r.chain1,
    canonEq: r.canonEq, identidades: r.identidades, startTimes: r.sts,
  };
  assert(r.sts.every((s) => s === '0'), `sensibilidade: mutante mexeu em startTime (${r.sts}) — não é mutante de ordem pura`);
  assert(JSON.stringify(r.chain0) !== JSON.stringify(r.chain1),
    `sensibilidade: a ORDEM não mudou no round-trip (${r.chain0} → ${r.chain1}) — mutante inerte`);
  assert(r.canonEq, 'sensibilidade: campos NÃO-ordinais divergiram — a detecção não é atribuível só à ordem');
  assert(r.identidades, 'sensibilidade: identidade referencial se perdeu no mutante — divergência não é só ordinal');
  assert(r.fp0 !== r.fp1, 'sensibilidade: mudança de ORDEM pura ficou INVISÍVEL pro fingerprint (instrumento sem sensibilidade)');
}

// --- controle do CANÔNICO: ele sabe detectar mudança NÃO-ordinal? -----------
// (doutrina da frente: `canonEq === true` só vale como evidência se o canônico
// for sensível ao que ele alega cobrir — senão é verde vácuo)
{
  const r = await runPage(`${LIB}
    const mk = (sel) => gsap.to(sel, { x: 100, duration: 1, ease: 'none', stagger: { each: 0 }, paused: true });
    const twA = mk('.ga');
    twA.totalTime(0.5, true);
    mark(twA);
    const c0 = canonical(twA);
    // (i) end-to-end: permuta pura na animação VIVA não pode mudar o canônico
    const t = nest(twA, document.getElementById('a1'));
    unnest(twA, t);
    const cPermuta = canonical(twA);

    // (ii) sensibilidade CAMPO A CAMPO sobre o REGISTRO (Sol r4): cada cópia
    // difere em EXATAMENTE um campo — nada de mutação viva, que confunde.
    const base = fpRecord(twA);
    const cBase = canonSerialize(base);
    const clone = () => JSON.parse(JSON.stringify(base));
    const soDur = clone();   soDur.dur = String(Number(soDur.dur) + 1);
    const soTotal = clone(); soTotal.total = String(Number(soTotal.total) + 1);
    const soSt = clone();    soSt.kids[0].st = String(Number(soSt.kids[0].st) + 0.5);
    const soKidDur = clone(); soKidDur.kids[0].dur = String(Number(soKidDur.kids[0].dur) + 0.5);
    const soVars = clone();  soVars.kids[0].vars = JSON.stringify({ x: 99, opacity: undefined });
    const soParent = clone(); soParent.kids[0].parentOk = !soParent.kids[0].parentOk;
    // target e pid são CHAVE DE ORDENAÇÃO (Sol r5): uma mudança que
    // reposiciona o nó seria detectada pela ordem mesmo com o campo omitido
    // da saída. Usar valores que PRESERVAM a posição canônica ('a0'->'a0x'
    // continua antes de 'a1'; pid 0->0.5 idem) e ASSERTAR a preservação
    // comparando a sequência posicional do outro campo.
    const soPid = clone();   soPid.kids[0].pid = 0.5;
    const soTarget = clone(); soTarget.kids[0].target = 'a0x';
    const idem = clone();    // cópia idêntica: canônico tem que bater
    const seqDe = (s, campo) => JSON.parse(s).kids.map((k) => k[campo]).join(',');
    return {
      permutaIgual: c0 === cPermuta,
      idemIgual: canonSerialize(idem) === cBase,
      durMuda: canonSerialize(soDur) !== cBase,
      totalMuda: canonSerialize(soTotal) !== cBase,
      stMuda: canonSerialize(soSt) !== cBase,
      kidDurMuda: canonSerialize(soKidDur) !== cBase,
      varsMuda: canonSerialize(soVars) !== cBase,
      parentMuda: canonSerialize(soParent) !== cBase,
      pidMuda: canonSerialize(soPid) !== cBase,
      targetMuda: canonSerialize(soTarget) !== cBase,
      // provas de NÃO-reposicionamento (senão o check acima seria confundido)
      pidPosPreservada: seqDe(canonSerialize(soPid), 'target') === seqDe(cBase, 'target'),
      targetPosPreservada: seqDe(canonSerialize(soTarget), 'pid') === seqDe(cBase, 'pid'),
    };
  `);
  registro.controleCanonico = r;
  assert(r.permutaIgual, 'controle: canônico MUDOU com permuta pura — não é independente de ordem');
  assert(r.idemIgual, 'controle: canônico não é determinístico (cópia idêntica divergiu)');
  assert(r.durMuda, 'controle: canônico cego a `duration` EXTERNO da fachada (gap da r3)');
  assert(r.totalMuda, 'controle: canônico cego a `totalDuration` EXTERNO da fachada (gap da r3)');
  assert(r.stMuda, 'controle: canônico cego a startTime de filho');
  assert(r.kidDurMuda, 'controle: canônico cego a duração de filho');
  assert(r.varsMuda, 'controle: canônico cego a vars');
  assert(r.parentMuda, 'controle: canônico cego a parentOk');
  assert(r.pidMuda, 'controle: canônico cego a identidade (pid)');
  assert(r.targetMuda, 'controle: canônico cego a troca de alvo');
  assert(r.pidPosPreservada, 'controle: mutação de pid REPOSICIONOU o nó — pidMuda seria confundido com ordem');
  assert(r.targetPosPreservada, 'controle: mutação de target REPOSICIONOU o nó — targetMuda seria confundido com ordem');
}

await browser.close();
console.log(JSON.stringify(registro, null, 2));
console.log(falhas.length ? `\n${falhas.length} RED:\n- ${falhas.join('\n- ')}` : '\n0 RED');
process.exit(falhas.length ? 1 : 0);
