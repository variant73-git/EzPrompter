// B1 / PROBE 3 — dono do CLOCK/timeScale (prescrição do advise Sol 2026-08-06).
//
// "timeScale não é um valor copiável; é parte de uma linhagem de clock."
// Fatos a medir: (1) TS autoral pré-transplante — aninhado segue a referência;
// (2) TS mudado DEPOIS (setter posterior do site) — aninhado herda por
// construção; (3) CONTROLE copy-once: transplante externo com TS copiado no
// instante TEM que divergir quando o setter muda depois (se não divergir, o
// instrumento não sabe detectar e "copiar timeScale" pareceria seguro);
// (4) pause posterior da fachada congela o aninhado junto.
// Mesmo ticker (mesma página) ⇒ igualdade byte-a-byte esperada no aninhado.
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
  const mk = (sel) => gsap.to(sel, { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });
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
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
`;

const registro = {};
const falhas = [];
const assert = (cond, msg) => { if (!cond) falhas.push(msg); };
const eq = (sa, sr) => sa.a0 === sr.r0 && sa.a1 === sr.r1 && sa.a2 === sr.r2;

// --- (1) TS autoral 0.5 ANTES do transplante --------------------------------
{
  const r = await runPage(`${LIB}
    const twA = mk('.ga'); const twR = mk('.gr');
    twA.timeScale(0.5); twR.timeScale(0.5);
    twA.totalTime(0.7, true); twR.totalTime(0.7, true);
    nest(twA, document.getElementById('a1'));
    twA.play(); twR.play();
    await wait(500);                       // TS 0.5 ⇒ +0.25 de tween-time
    twA.pause(); twR.pause();
    return { a: snapA(), r: snapR(), tA: twA.totalTime(), tR: twR.totalTime(), ts: twA.timeScale() };
  `);
  registro.tsAntes = r;
  assert(r.tA === r.tR && eq(r.a, r.r), `tsAntes: divergiu ${JSON.stringify(r)}`);
  assert(r.a.a1 > 50, `tsAntes: a1 não avançou sob play (${r.a.a1})`);
}

// --- (2) TS mudado DEPOIS do transplante (setter posterior do site) ----------
{
  const r = await runPage(`${LIB}
    const twA = mk('.ga'); const twR = mk('.gr');
    twA.totalTime(0.7, true); twR.totalTime(0.7, true);
    nest(twA, document.getElementById('a1'));
    twA.timeScale(2); twR.timeScale(2);    // o site muda o rate DEPOIS
    twA.play(); twR.play();
    await wait(150);                       // TS 2 ⇒ +~0.3 — a1 tem que ficar EM VOO (senão o check satura em 100 e vira vácuo)
    twA.pause(); twR.pause();
    return { a: snapA(), r: snapR(), tA: twA.totalTime(), tR: twR.totalTime() };
  `);
  registro.tsDepois = r;
  assert(r.tA === r.tR && eq(r.a, r.r), `tsDepois: aninhado NÃO herdou setter posterior ${JSON.stringify(r)}`);
  assert(r.a.a1 > 50 && r.a.a1 < 100, `tsDepois: a1 fora do voo (${r.a.a1}) — check saturado é vácuo`);
}

// --- (3) CONTROLE copy-once: externo com TS copiado TEM que divergir ---------
{
  const r = await runPage(`${LIB}
    const twA = mk('.ga'); const twR = mk('.gr');
    twA.totalTime(0.7, true); twR.totalTime(0.7, true);
    const child = childOf(twA, document.getElementById('a1'));
    const local = child.totalTime();
    twA.timeline.remove(child);
    const ext = gsap.timeline();           // NÃO pausada: corre no ticker global
    ext.add(child, 0); ext.totalTime(local, true);
    ext.timeScale(twA.timeScale());        // copy-once no instante (TS=1)
    twA.timeScale(2); twR.timeScale(2);    // o site muda DEPOIS da cópia
    twA.play(); twR.play(); ext.play();
    await wait(250);
    twA.pause(); twR.pause(); ext.pause();
    return { a: snapA(), r: snapR(), extTS: ext.timeScale(), refT: twR.totalTime(), extT: ext.totalTime() };
  `);
  registro.copyOnce = r;
  assert(r.a.a1 !== r.r.r1, `copyOnce: cópia única de TS ficou INVISÍVEL (a1=${r.a.a1} vs r1=${r.r.r1}) — instrumento sem sensibilidade`);
  assert(r.a.a1 > 50 && r.a.a1 < r.r.r1, `copyOnce: esperado externo ATRASADO vs ref (a1=${r.a.a1}, r1=${r.r.r1})`);
}

// --- (4) pause POSTERIOR da fachada congela o aninhado junto -----------------
{
  const r = await runPage(`${LIB}
    const twA = mk('.ga'); const twR = mk('.gr');
    twA.totalTime(0.7, true); twR.totalTime(0.7, true);
    nest(twA, document.getElementById('a1'));
    twA.play(); twR.play();
    await wait(150);
    twA.pause(); twR.pause();              // o site pausa a fachada
    const noPause = { a: snapA(), r: snapR() };
    await wait(120);                       // tempo real passa; nada deve mover
    const depois = { a: snapA(), r: snapR() };
    return { noPause, depois };
  `);
  registro.pausePosterior = r;
  assert(eq(r.noPause.a, r.noPause.r), `pause: divergiu no instante ${JSON.stringify(r.noPause)}`);
  assert(r.depois.a.a1 === r.noPause.a.a1 && r.depois.a.a0 === r.noPause.a.a0,
    `pause: aninhado continuou correndo com a fachada pausada ${JSON.stringify(r)}`);
}

await browser.close();
console.log(JSON.stringify(registro, null, 2));
console.log(falhas.length ? `\n${falhas.length} RED:\n- ${falhas.join('\n- ')}` : '\n0 RED');
process.exit(falhas.length ? 1 : 0);
