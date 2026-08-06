// B1 / PROBE 2 — wrapper ANINHADO vs EXTERNO (prescrição do advise Sol 2026-08-06).
//
// Candidato do Sol: wrapper timeline reinserido NA POSIÇÃO EXATA do filho
// dentro da timeline interna da fachada, contendo a MESMA instância viva —
// linhagem de clock preservada por construção, com ponto de controle próprio.
//
// Método: referência intocada NA MESMA PÁGINA (mesmo ticker ⇒ igualdade
// byte-a-byte); asserção de vida; sensibilidade (posição deliberadamente
// errada TEM que ser detectada); ticker REAL além de clock manual;
// play/pause/seek/reverse/restart. Externo (P5) medido em contraste:
// fachada tocando NÃO arrasta o filho externo (fato, não falha).
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
  const eq = (sa, sr) => sa.a0 === sr.r0 && sa.a1 === sr.r1 && sa.a2 === sr.r2;
  const mk = (sel) => gsap.to(sel, { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });
  const childOf = (tw, el) => tw.timeline.getChildren(true, true, false)
    .find((c) => c.targets && c.targets()[0] === el) || null;
  // transplante ANINHADO: wrapper na MESMA posição do filho, filho em 0 no wrapper
  const nest = (tw, el, offset = 0) => {
    const child = childOf(tw, el);
    const st = child.startTime();
    tw.timeline.remove(child);
    const wrap = gsap.timeline();
    wrap.add(child, 0);
    tw.timeline.add(wrap, st + offset);
    return { wrap, child, st };
  };
`;
const SETUP = `
  const twA = mk('.ga'); const twR = mk('.gr');
  twA.totalTime(0.7, true); twR.totalTime(0.7, true);
`;

const registro = {};
const falhas = [];
const assert = (cond, msg) => { if (!cond) falhas.push(msg); };

// --- (a)–(f): clock manual — instante, arrasto pela fachada, freeze, scrub ---
{
  const r = await runPage(`${LIB}${SETUP}
    const vidaOk = X('a1') > 0 && X('a1') === X('r1');
    const t = nest(twA, document.getElementById('a1'));
    twA.totalTime(0.7, true);                       // força render pós-cirurgia
    const instante = { a: snapA(), r: snapR() };
    twA.totalTime(0.9, true); twR.totalTime(0.9, true);
    const arrasto = { a: snapA(), r: snapR() };     // fachada arrasta o aninhado?
    t.wrap.pause();
    twA.totalTime(1.1, true); twR.totalTime(1.1, true);
    const freeze = { a: snapA(), r: snapR() };      // a1 congelado, irmãos seguem
    const preScrub = snapA();
    t.wrap.totalTime(0.05, true);                   // scrub do wrapper pausado
    const posScrub = { a: snapA(), facadeT: twA.totalTime() };
    t.wrap.totalTime(0.2, true);                    // volta pro valor do freeze
    const resumeJump = (() => { t.wrap.play(); twA.totalTime(1.1, true); return snapA(); })();
    return { vidaOk, instante, arrasto, freeze, preScrub, posScrub, resumeJump,
             wrapParentIsInner: t.wrap.parent === twA.timeline, st: t.st };
  `);
  registro.manual = r;
  assert(r.vidaOk, 'manual: alvo não estava vivo/igual à referência antes');
  assert(r.wrapParentIsInner, 'manual: wrapper não ficou DENTRO da inner');
  assert(eq(r.instante.a, r.instante.r), `manual: instante divergiu ${JSON.stringify(r.instante)}`);
  assert(eq(r.arrasto.a, r.arrasto.r), `manual: fachada NÃO arrastou o aninhado igual à ref ${JSON.stringify(r.arrasto)}`);
  assert(r.freeze.a.a1 === r.arrasto.a.a1, `manual: wrapper pausado não congelou a1 (${r.freeze.a.a1} vs ${r.arrasto.a.a1})`);
  assert(r.freeze.a.a0 === r.freeze.r.r0 && r.freeze.a.a2 === r.freeze.r.r2, 'manual: irmãos divergiram sob freeze');
  assert(r.posScrub.a.a1 !== r.preScrub.a1 && r.posScrub.a.a0 === r.preScrub.a0 && r.posScrub.a.a2 === r.preScrub.a2,
    `manual: scrub do wrapper não moveu SÓ a1 ${JSON.stringify({ pre: r.preScrub, pos: r.posScrub })}`);
  assert(r.posScrub.facadeT === 1.1, `manual: scrub do wrapper mexeu no playhead da fachada (${r.posScrub.facadeT})`);
  registro.fatoResume = { resumeJump: r.resumeJump }; // semântica de resume = REGISTRO
}

// --- eq helper no Node (pra asserções acima) --------------------------------
function eq(sa, sr) { return sa.a0 === sr.r0 && sa.a1 === sr.r1 && sa.a2 === sr.r2; }

// --- (g)(h)(i): ticker REAL — play, reverse, restart -------------------------
{
  const r = await runPage(`${LIB}
    const twA = mk('.ga'); const twR = mk('.gr');
    twA.totalTime(0, true); twR.totalTime(0, true);
    nest(twA, document.getElementById('a1'));
    twA.totalTime(0, true);
    twA.play(); twR.play();
    // 350ms: além do startTime do a1 (0.2s) — senão a1=0 é legítimo e o check é vácuo
    await new Promise((res) => setTimeout(res, 350));
    twA.pause(); twR.pause();
    const play = { a: snapA(), r: snapR(), tA: twA.totalTime(), tR: twR.totalTime() };
    twA.reverse(); twR.reverse();
    await new Promise((res) => setTimeout(res, 150));
    twA.pause(); twR.pause();
    const rev = { a: snapA(), r: snapR(), tA: twA.totalTime(), tR: twR.totalTime() };
    // restart SEM seek corretivo (Sol r1: totalTime(0) depois forçava o resultado
    // e o check virava vácuo) — pause é síncrono, nenhum tick entra no meio
    twA.restart(); twR.restart(); twA.pause(); twR.pause();
    const restart = { a: snapA(), r: snapR(), tA: twA.totalTime(), tR: twR.totalTime() };
    return { play, rev, restart };
  `);
  registro.ticker = r;
  assert(r.play.tA === r.play.tR, `ticker: playheads divergiram no play (${r.play.tA} vs ${r.play.tR})`);
  assert(eq(r.play.a, r.play.r), `ticker: valores divergiram no play ${JSON.stringify(r.play)}`);
  assert(r.play.a.a1 > 0, `ticker: a1 não se moveu no play real (${r.play.a.a1})`);
  assert(r.rev.tA === r.rev.tR && eq(r.rev.a, r.rev.r), `ticker: reverse divergiu ${JSON.stringify(r.rev)}`);
  // reverse tem que ANDAR PRA TRÁS de verdade (Sol r1: só A===R não prova movimento)
  assert(r.rev.tA < r.play.tA, `ticker: reverse não recuou o playhead (${r.play.tA} → ${r.rev.tA})`);
  assert(eq(r.restart.a, r.restart.r) && r.restart.a.a1 === 0 && r.restart.tA === 0 && r.restart.tR === 0,
    `ticker: restart divergiu/não zerou sem seek corretivo ${JSON.stringify(r.restart)}`);
}

// --- (j) sensibilidade: posição deliberadamente ERRADA tem que aparecer ------
{
  const r = await runPage(`${LIB}${SETUP}
    nest(twA, document.getElementById('a1'), 0.1);   // ERRADO de propósito
    twA.totalTime(0.7, true);
    const instante = { a: snapA(), r: snapR() };
    twA.totalTime(0.9, true); twR.totalTime(0.9, true);
    const tick = { a: snapA(), r: snapR() };
    return { instante, tick };
  `);
  registro.sensibilidade = r;
  assert(r.instante.a.a1 !== r.instante.r.r1 || r.tick.a.a1 !== r.tick.r.r1,
    `sensibilidade: erro de +0.1 na posição ficou INVISÍVEL ${JSON.stringify(r)}`);
}

// --- contraste: transplante EXTERNO não é arrastado pela fachada (fato) ------
{
  const r = await runPage(`${LIB}
    const twA = mk('.ga'); const twR = mk('.gr');
    twA.totalTime(0.7, true); twR.totalTime(0.7, true);
    const child = childOf(twA, document.getElementById('a1'));
    const local = child.totalTime();
    twA.timeline.remove(child);
    const ext = gsap.timeline({ paused: true });
    ext.add(child, 0); ext.totalTime(local, true);
    twA.play(); twR.play();
    await new Promise((res) => setTimeout(res, 120));
    twA.pause(); twR.pause();
    return { a: snapA(), r: snapR(), extT: ext.totalTime(), local };
  `);
  registro.externoContraste = r;
  assert(r.a.a1 === r.r.r1 || r.a.a1 !== r.r.r1, 'nunca'); // registro puro
  registro.fatoExterno = {
    fachadaArrastouExterno: r.a.a1 !== 50 ? 'moveu?' : 'congelado',
    a1: r.a.a1, r1: r.r.r1, extClock: r.extT,
  };
  assert(r.a.a1 === 50, `externo: esperado a1 CONGELADO em 50 com fachada tocando (a1=${r.a.a1})`);
  assert(r.r.r1 > 50, `externo: referência não avançou (r1=${r.r.r1})`);
}

await browser.close();
console.log(JSON.stringify(registro, null, 2));
console.log(falhas.length ? `\n${falhas.length} RED:\n- ${falhas.join('\n- ')}` : '\n0 RED');
process.exit(falhas.length ? 1 : 0);
