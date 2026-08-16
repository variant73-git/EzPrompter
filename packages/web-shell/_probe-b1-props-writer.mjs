// B1 / PROBES 5+6 — DONO DA PROPRIEDADE/HERANÇA + WRITER NO FILHO VIVO
// (prescrição do advise Sol 2026-08-06).
//
// (5) ESCOPO HONESTO (estreitado no audit Sol r1): este probe NÃO testa uma
//     máquina de herança/override — ela não existe ainda (é o TransplantLink,
//     design futuro). A "edição de grupo" aqui é enumeração explícita dos
//     filhos escrita pelo probe. O que o probe PROVA no motor: enumeração
//     recursiva ALCANÇA o filho aninhado; writes por-filho no transplantado
//     são possíveis e ISOLADOS (não tocam irmãos); writes em propriedades
//     distintas do mesmo filho não colidem; dois transplantados coexistem.
//     A SEMÂNTICA de herança (override map, reset-herda-atual) é obrigação
//     do witness do TransplantLink.
// (6) Writer no filho vivo midflight: editar vars + invalidate + render do
//     início (doutrina) NÃO rebasa o start, NÃO toca irmãos, e o rollback
//     (vars verbatim + mesmo protocolo) devolve byte-igual à referência.
//
// Edição = idioma do bridge em miniatura: child.vars.<p> = v; child.invalidate();
// fachada re-renderiza DO INÍCIO (lição permanente) e volta ao playhead.
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
  const P = (id, p) => Number(gsap.getProperty(document.getElementById(id), p));
  const snap = (ids) => Object.fromEntries(ids.map((id) => [id, { x: P(id, 'x'), o: P(id, 'opacity') }]));
  const mk = (sel) => gsap.to(sel, { x: 100, opacity: 0.2, duration: 1, ease: 'none', stagger: 0.2, paused: true });
  const childOf = (tw, el) => tw.timeline.getChildren(true, true, false)
    .find((c) => c.targets && c.targets()[0] === el) || null;
  const nest = (tw, el) => {
    const child = childOf(tw, el);
    const st = child.startTime();
    tw.timeline.remove(child);
    const wrap = gsap.timeline();
    wrap.add(child, 0);
    tw.timeline.add(wrap, st);
    return { wrap, child, st };
  };
  // writer REAL do bridge em miniatura: invalidatePreservingStart no clock do
  // PRÓPRIO filho — parquear no 0 ANTES de invalidar (renderiza o start no DOM),
  // invalidar, restaurar (re-init amostra o start correto). invalidate cru
  // rebasa o start pelo DOM midflight (foi o que os 10 RED da v1 mediram).
  const editVars = (tw, child, patch) => {
    Object.assign(child.vars, patch);
    const parked = child.totalTime();
    if (Number.isFinite(parked) && parked > 0) child.totalTime(0, true);
    child.invalidate();
    if (Number.isFinite(parked) && parked > 0) child.totalTime(parked, true);
  };
`;

const registro = {};
const falhas = [];
const assert = (cond, msg) => { if (!cond) falhas.push(msg); };
const close = (x, y) => Math.abs(x - y) < 1e-6;

// --- (5) override isolado + herança de grupo + reset-herda-valor-novo --------
{
  const r = await runPage(`${LIB}
    const twA = mk('.ga'); const twR = mk('.gr');
    twA.totalTime(0.7, true); twR.totalTime(0.7, true);
    const t = nest(twA, document.getElementById('a1'));
    const base = { a: snap(['a0','a1','a2']), r: snap(['r0','r1','r2']) };

    // override de x SÓ no transplantado (55 em vez de 100)
    editVars(twA, t.child, { x: 55 });
    const posOverride = { a: snap(['a0','a1','a2']) };

    // edição de GRUPO: opacity end 0.2→0.6 em TODOS (incl. transplantado, herdada)
    for (const c of twA.timeline.getChildren(true, true, false)) {
      const alvo = c.targets && c.targets()[0];
      if (alvo) editVars(twA, c, { opacity: 0.6 });
    }
    for (const c of twR.timeline.getChildren(true, true, false)) editVars(twR, c, { opacity: 0.6 });
    const posGrupoOpacity = { a: snap(['a0','a1','a2']), r: snap(['r0','r1','r2']) };

    // grupo muda x 100→80 nos NÃO-overridados (a0, a2 e toda a referência)
    for (const c of twA.timeline.getChildren(true, true, false)) {
      const alvo = c.targets && c.targets()[0];
      if (alvo && alvo.id !== 'a1') editVars(twA, c, { x: 80 });
    }
    for (const c of twR.timeline.getChildren(true, true, false)) editVars(twR, c, { x: 80 });
    const posGrupoX = { a: snap(['a0','a1','a2']), r: snap(['r0','r1','r2']) };

    // reset do override: a1 volta a herdar o valor ATUAL do grupo (80, não 100)
    editVars(twA, t.child, { x: 80 });
    const posReset = { a: snap(['a0','a1','a2']), r: snap(['r0','r1','r2']) };
    return { base, posOverride, posGrupoOpacity, posGrupoX, posReset };
  `);
  registro.heranca = r;
  const b = r.base, po = r.posOverride, pg = r.posGrupoOpacity, px = r.posGrupoX, pr = r.posReset;
  assert(b.a.a1.x === b.r.r1.x && b.a.a1.o === b.r.r1.o, `heranca: base divergiu ${JSON.stringify(b)}`);
  assert(po.a.a1.x < b.a.a1.x && po.a.a0.x === b.a.a0.x && po.a.a2.x === b.a.a2.x,
    `heranca: override de x não ficou isolado no a1 ${JSON.stringify({ b, po })}`);
  assert(pg.a.a1.o === pg.r.r1.o && pg.a.a0.o === pg.r.r0.o,
    `heranca: opacity de grupo NÃO alcançou o transplantado igual à ref ${JSON.stringify(pg)}`);
  assert(pg.a.a1.x === po.a.a1.x, `heranca: edição de grupo em opacity pisou no override de x (${pg.a.a1.x} vs ${po.a.a1.x})`);
  assert(px.a.a0.x === px.r.r0.x && px.a.a2.x === px.r.r2.x && px.a.a1.x === po.a.a1.x,
    `heranca: grupo x=80 não aplicou nos irmãos / vazou no override ${JSON.stringify(px)}`);
  assert(pr.a.a1.x === pr.r.r1.x, `heranca: reset não herdou o valor ATUAL do grupo (${pr.a.a1.x} vs ${pr.r.r1.x})`);
}

// --- (5b) DOIS alvos transplantados ------------------------------------------
{
  const r = await runPage(`${LIB}
    const twA = mk('.ga'); const twR = mk('.gr');
    twA.totalTime(0.7, true); twR.totalTime(0.7, true);
    const t0 = nest(twA, document.getElementById('a0'));
    const t1 = nest(twA, document.getElementById('a1'));
    editVars(twA, t0.child, { x: 40 });
    editVars(twA, t1.child, { x: 55 });
    const posOverrides = snap(['a0','a1','a2']);
    for (const c of twA.timeline.getChildren(true, true, false)) {
      const alvo = c.targets && c.targets()[0];
      if (alvo) editVars(twA, c, { opacity: 0.6 });
    }
    for (const c of twR.timeline.getChildren(true, true, false)) editVars(twR, c, { opacity: 0.6 });
    const posGrupo = { a: snap(['a0','a1','a2']), r: snap(['r0','r1','r2']) };
    return { posOverrides, posGrupo };
  `);
  registro.doisAlvos = r;
  assert(r.posGrupo.a.a0.o === r.posGrupo.r.r0.o && r.posGrupo.a.a1.o === r.posGrupo.r.r1.o && r.posGrupo.a.a2.o === r.posGrupo.r.r2.o,
    `doisAlvos: opacity de grupo não alcançou os 2 transplantados ${JSON.stringify(r.posGrupo)}`);
  assert(r.posGrupo.a.a0.x === r.posOverrides.a0.x && r.posGrupo.a.a1.x === r.posOverrides.a1.x,
    `doisAlvos: overrides não sobreviveram à edição de grupo ${JSON.stringify(r)}`);
}

// --- (6) writer vivo: start não rebasa, irmãos intactos, rollback exato ------
{
  const r = await runPage(`${LIB}
    const twA = mk('.ga'); const twR = mk('.gr');
    twA.totalTime(0.7, true); twR.totalTime(0.7, true);
    const t = nest(twA, document.getElementById('a1'));
    const varsAntes = JSON.stringify({ x: t.child.vars.x, opacity: t.child.vars.opacity });

    editVars(twA, t.child, { x: 55 });
    // start não rebasou: no INÍCIO o a1 tem que estar em x=0 (start autoral), não no valor midflight
    twA.totalTime(0, true);
    const noInicio = snap(['a0','a1','a2']);
    twA.totalTime(0.7, true);
    const noPlayhead = { a: snap(['a0','a1','a2']), r: snap(['r0','r1','r2']) };

    // rollback: vars verbatim + mesmo protocolo
    editVars(twA, t.child, { x: 100 });
    const posRollback = { a: snap(['a0','a1','a2']), r: snap(['r0','r1','r2']) };
    // tick seguinte nos dois lados
    twA.totalTime(0.9, true); twR.totalTime(0.9, true);
    const tick = { a: snap(['a0','a1','a2']), r: snap(['r0','r1','r2']) };
    return { varsAntes, noInicio, noPlayhead, posRollback, tick };
  `);
  registro.writerVivo = r;
  assert(r.noInicio.a1.x === 0 && r.noInicio.a0.x === 0,
    `writer: start REBASOU (início a1=${r.noInicio.a1.x})`);
  assert(r.noPlayhead.a.a0.x === r.noPlayhead.r.r0.x && r.noPlayhead.a.a2.x === r.noPlayhead.r.r2.x,
    `writer: edição tocou IRMÃOS ${JSON.stringify(r.noPlayhead)}`);
  assert(r.posRollback.a.a1.x === r.posRollback.r.r1.x && r.posRollback.a.a1.o === r.posRollback.r.r1.o,
    `writer: rollback não devolveu byte-igual ${JSON.stringify(r.posRollback)}`);
  assert(r.tick.a.a1.x === r.tick.r.r1.x && r.tick.a.a0.x === r.tick.r.r0.x && r.tick.a.a2.x === r.tick.r.r2.x,
    `writer: tick seguinte divergiu pós-rollback ${JSON.stringify(r.tick)}`);
}

await browser.close();
console.log(JSON.stringify(registro, null, 2));
console.log(falhas.length ? `\n${falhas.length} RED:\n- ${falhas.join('\n- ')}` : '\n0 RED');
process.exit(falhas.length ? 1 : 0);
