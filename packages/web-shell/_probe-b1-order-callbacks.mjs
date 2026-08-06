// B1 / PROBE 4 — DURAÇÃO, ORDEM e CALLBACKS (prescrição do advise Sol 2026-08-06).
//
// Fatos: (A) aninhar primeiro/meio/último NÃO pode mudar duration/totalDuration
// da fachada (o último define o fim — remove+add errado encurtaria e
// anteciparia onComplete); (B) filhos com MESMO startTime: remove+add muda a
// ordem na cadeia? (fato de risco pro round-trip); (C) a CIRURGIA não pode
// vazar callback nenhum (surgery com renders suprimidos = 0 fires); (D) com
// wrapper aninhado, onComplete da fachada dispara com MESMA contagem e MESMO
// playhead da referência (paridade em ticker real).
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
  const num = (v) => ({ t: typeof v, s: String(v), fin: typeof v === 'number' && Number.isFinite(v) ? v : null });
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

// --- (A) duração da fachada intacta ao aninhar primeiro/meio/último ----------
for (const alvo of ['a0', 'a1', 'a2']) {
  const r = await runPage(`${LIB}
    const tw = gsap.to('.ga', { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });
    tw.totalTime(0.7, true);
    const antes = { dur: num(tw.duration()), total: num(tw.totalDuration()), innerDur: num(tw.timeline.duration()) };
    nest(tw, document.getElementById(arg));
    const depois = { dur: num(tw.duration()), total: num(tw.totalDuration()), innerDur: num(tw.timeline.duration()) };
    return { antes, depois };
  `, alvo);
  registro[`duracao_${alvo}`] = r;
  assert(r.antes.total.s === r.depois.total.s && r.antes.dur.s === r.depois.dur.s && r.antes.innerDur.s === r.depois.innerDur.s,
    `duração(${alvo}): mudou com o aninhamento ${JSON.stringify(r)}`);
}

// --- (B) mesmo startTime: remove+add preserva a ordem? (fato) ----------------
{
  const r = await runPage(`${LIB}
    const tw = gsap.to('.ga', { x: 100, duration: 1, ease: 'none', stagger: { each: 0 }, paused: true });
    if (!tw.timeline) return { semInner: true };
    tw.totalTime(0.5, true);
    const ids = (t) => t.timeline.getChildren(true, true, false)
      .map((c) => c.targets ? (c.targets()[0] && c.targets()[0].id) || 'wrap' : 'wrap');
    const antes = ids(tw);
    const sts = tw.timeline.getChildren(true, true, false).map((c) => num(c.startTime()));
    nest(tw, document.getElementById('a1'));
    const depois = ids(tw);
    return { antes, sts, depois };
  `);
  registro.mesmoStart = r;
  // Fato ASSERTADO (Sol r1: registrar sem assertar deixa o doc sem lastro):
  // o design do rollback DEPENDE de a ordem mudar aqui — se o GSAP mudar esse
  // comportamento, este probe tem que acusar.
  if (!r.semInner) {
    assert(r.depois.length === r.antes.length, `mesmoStart: contagem mudou ${JSON.stringify(r)}`);
    const ordemPreservada = JSON.stringify(r.antes) === JSON.stringify(r.depois);
    registro.fatoOrdemMesmoStart = { antes: r.antes, depois: r.depois, ordemPreservada };
    assert(!ordemPreservada,
      `mesmoStart: ordem FOI preservada (${JSON.stringify(r.depois)}) — fato do doc/design caiu, re-derivar rollback`);
  }
}

// --- (C) cirurgia não vaza callback -----------------------------------------
{
  const r = await runPage(`${LIB}
    // Escopo honesto (Sol r1): só callbacks de FACHADA — o shape B1 não tem
    // callback autoral por-filho, e onRepeat sem repeat seria contador vácuo.
    const fires = { onStart: 0, onUpdate: 0, onComplete: 0 };
    const tw = gsap.to('.ga', {
      x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true,
      onStart: () => fires.onStart++, onUpdate: () => fires.onUpdate++,
      onComplete: () => fires.onComplete++,
    });
    tw.totalTime(0.7, true);                    // suprimido — posiciona
    const antesCirurgia = { ...fires };
    const t = nest(tw, document.getElementById('a1'));
    tw.totalTime(0.7, true);                    // re-render suprimido pós-cirurgia
    const aposCirurgia = { ...fires };
    return { antesCirurgia, aposCirurgia };
  `);
  registro.vazamento = r;
  assert(JSON.stringify(r.antesCirurgia) === JSON.stringify(r.aposCirurgia),
    `vazamento: cirurgia disparou callback ${JSON.stringify(r)}`);
}

// --- (D) paridade de onComplete com a referência (ticker real) ---------------
{
  const r = await runPage(`${LIB}
    const rec = { a: [], r: [] };
    const mkCb = (lado, tag) => function () { rec[lado].push({ tag, t: this.totalTime() }); };
    const twA = gsap.to('.ga', { x: 100, duration: 0.5, ease: 'none', stagger: 0.1, paused: true,
      onComplete: mkCb('a', 'complete'), onStart: mkCb('a', 'start') });
    const twR = gsap.to('.gr', { x: 100, duration: 0.5, ease: 'none', stagger: 0.1, paused: true,
      onComplete: mkCb('r', 'complete'), onStart: mkCb('r', 'start') });
    twA.totalTime(0.2, true); twR.totalTime(0.2, true);
    nest(twA, document.getElementById('a1'));
    twA.play(); twR.play();
    await wait(900);                            // total 0.7s — completa com folga
    return { a: rec.a, r: rec.r, done: twA.progress() === 1 && twR.progress() === 1 };
  `);
  registro.paridadeCallback = r;
  assert(r.done, `paridade: fachadas não completaram ${JSON.stringify(r)}`);
  assert(JSON.stringify(r.a) === JSON.stringify(r.r),
    `paridade: sequência/timing de callbacks divergiu ${JSON.stringify(r)}`);
  assert(r.a.filter((e) => e.tag === 'complete').length === 1,
    `paridade: onComplete count != 1 (${JSON.stringify(r.a)})`);
}

await browser.close();
console.log(JSON.stringify(registro, null, 2));
console.log(falhas.length ? `\n${falhas.length} RED:\n- ${falhas.join('\n- ')}` : '\n0 RED');
process.exit(falhas.length ? 1 : 0);
