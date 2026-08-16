// FASE 0 / P5 — transplante da INSTÂNCIA VIVA (o caminho novo do Sol).
//
// A aposta: pra stagger, o GSAP já cria um tween interno por alvo. Em vez de
// reconstruir um clone por medição (o que falhou 6×), REPARENTEAR a própria
// instância — PropTweens, estado, valores resolvidos e tempo local intactos —
// pra uma timeline independente.
//
// GSAP puro, SEM bridge: a pergunta é do motor; a integração é Fase 1.
// Método: referência intocada em página própria; asserção de VIDA antes;
// dano no tick seguinte (delta de tempo igual nos dois lados); sensibilidade
// (transplante deliberadamente errado TEM que ser detectado).
//
// Casos determinísticos ASSERTAM; semânticas de herança (repeat/timeScale/
// callbacks/repeatRefresh/splittext) REGISTRAM — a decisão é da Fase 1.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const root = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0';
const gsapSrc = readFileSync(`${root}/gsap.min.js`, 'utf8');
const splitSrc = readFileSync(`${root}/SplitText.min.js`, 'utf8');

const browser = await chromium.launch({ headless: true });
const HTML = `<div id="wrap" style="width:300px">
  <div class="item" id="i0" style="width:20px;height:20px"></div>
  <div class="item" id="i1" style="width:20px;height:20px"></div>
  <div class="item" id="i2" style="width:20px;height:20px"></div>
  <h1 id="h">Design without borders</h1>
</div>`;

async function runPage(body, arg) {
  const page = await browser.newPage();
  await page.setContent(HTML);
  await page.addScriptTag({ content: gsapSrc });
  await page.addScriptTag({ content: splitSrc });
  const out = await page.evaluate(([b, a]) => new Function('arg', b)(a), [body, arg ?? null]);
  await page.close();
  return out;
}

// Helpers injetados por string em cada corpo (página é isolada).
const LIB = `
  const X = (id) => Number(gsap.getProperty(document.getElementById(id), 'x'));
  const innerChildOf = (tween, el) => {
    const kids = tween.timeline ? tween.timeline.getChildren(true, true, false) : [];
    return kids.find((c) => c.targets && c.targets().length === 1 && c.targets()[0] === el) || null;
  };
  // O transplante: captura o tempo LOCAL do filho, remove do pai, adiciona em
  // timeline nova em 0 e re-posiciona no MESMO tempo local (suppressEvents).
  const transplant = (tween, el, { restoreTime = true } = {}) => {
    const child = innerChildOf(tween, el);
    if (!child) return null;
    const local = child.totalTime();
    tween.timeline.remove(child);
    const tl = gsap.timeline({ paused: true });
    tl.add(child, 0);
    tl.totalTime(restoreTime ? local : 0, true);
    return { tl, child, local };
  };
`;

const registro = {};
const falhas = [];
const assert = (cond, msg) => { if (!cond) falhas.push(msg); };

// --- referência (intocada) usada pelos casos determinísticos ----------------
// stagger 0.2, duration 1 → total 1.4; parado em 0.7 o i1 está em local 0.5
const REF_SETUP = `
  window.__tw = gsap.to('.item', { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });
  window.__tw.totalTime(0.7, true);
`;
const refInstante = await runPage(`${LIB}
  ${REF_SETUP}
  const antes = { i0: X('i0'), i1: X('i1'), i2: X('i2') };
  window.__tw.totalTime(0.9, true);
  const depois = { i0: X('i0'), i1: X('i1'), i2: X('i2') };
  return { antes, depois };
`);
assert(refInstante.antes.i1 > 0, `referência: i1 não estava vivo em 0.7 (x=${refInstante.antes.i1})`);

// --- plain-midflight: continuidade + independência ---------------------------
{
  const r = await runPage(`${LIB}
    ${REF_SETUP}
    const el = document.getElementById('i1');
    const vida = X('i1');
    const t = transplant(window.__tw, el);
    if (!t) return { erro: 'sem filho interno' };
    const noInstante = { i0: X('i0'), i1: X('i1'), i2: X('i2') };
    // avanço IGUAL nos dois relógios (delta 0.2)
    window.__tw.totalTime(0.9, true);
    t.tl.totalTime(t.local + 0.2, true);
    const aposAvanco = { i0: X('i0'), i1: X('i1'), i2: X('i2') };
    // independência: só o novo relógio avança → só i1 se move
    const antesSolo = { i0: X('i0'), i1: X('i1'), i2: X('i2') };
    t.tl.totalTime(t.local + 0.4, true);
    const aposSolo = { i0: X('i0'), i1: X('i1'), i2: X('i2') };
    return { vida, noInstante, aposAvanco, antesSolo, aposSolo, localCapturado: t.local };
  `);
  registro.plainMidflight = r;
  assert(!r.erro, `plain: ${r.erro}`);
  assert(r.vida > 0, `plain: alvo não estava vivo antes (x=${r.vida})`);
  assert(r.noInstante.i1 === refInstante.antes.i1,
    `plain: transplante moveu o alvo no instante (${r.noInstante.i1} vs ${refInstante.antes.i1})`);
  assert(r.noInstante.i0 === refInstante.antes.i0 && r.noInstante.i2 === refInstante.antes.i2,
    `plain: transplante moveu IRMÃOS no instante`);
  assert(r.aposAvanco.i1 === refInstante.depois.i1,
    `plain: trajetória do alvo divergiu da referência após avanço igual (${r.aposAvanco.i1} vs ${refInstante.depois.i1})`);
  assert(r.aposAvanco.i0 === refInstante.depois.i0 && r.aposAvanco.i2 === refInstante.depois.i2,
    `plain: irmãos divergiram da referência após avanço igual`);
  assert(r.aposSolo.i1 !== r.antesSolo.i1 && r.aposSolo.i0 === r.antesSolo.i0 && r.aposSolo.i2 === r.antesSolo.i2,
    `plain: independência falhou (só i1 devia mover): ${JSON.stringify({ antes: r.antesSolo, apos: r.aposSolo })}`);
}

// --- sensibilidade: transplante ERRADO tem que ser detectado -----------------
{
  const r = await runPage(`${LIB}
    ${REF_SETUP}
    const el = document.getElementById('i1');
    const t = transplant(window.__tw, el, { restoreTime: false });   // ERRADO de propósito
    const semRender = X('i1');   // totalTime(0) em relógio já em 0 é NO-OP — não renderiza
    t.tl.totalTime(0.01, true);  // o TICK SEGUINTE é onde o dano aparece (lição do método)
    const noTickSeguinte = X('i1');
    return { semRender, noTickSeguinte };
  `);
  registro.sensibilidade = { ...r, xReferenciaNoInstante: refInstante.antes.i1 };
  // ⭐ registro de método: no INSTANTE o erro é invisível (no-op de render) —
  // só o tick seguinte revela. Correto ≈ 51 (50 + tick); errado ≈ 1 (voltou pro início).
  assert(r.noTickSeguinte < refInstante.antes.i1 - 20,
    `sensibilidade: o transplante errado NÃO produziu salto no tick seguinte (x=${r.noTickSeguinte}) — instrumento cego`);
}

// --- pai-repeat-yoyo: o que carrega? (REGISTRO) ------------------------------
{
  const r = await runPage(`${LIB}
    window.__tw = gsap.to('.item', { x: 100, duration: 1, ease: 'none', stagger: 0.2, repeat: 2, yoyo: true, paused: true });
    window.__tw.totalTime(0.7, true);
    const el = document.getElementById('i1');
    const child = innerChildOf(window.__tw, el);
    if (!child) return { erro: 'sem filho interno' };
    const antes = { childRepeat: child.repeat ? child.repeat() : null, childYoyo: child.yoyo ? child.yoyo() : null,
                    childDur: child.duration(), childTotalDur: child.totalDuration(),
                    paiRepeat: window.__tw.repeat(), paiTotalDur: window.__tw.totalDuration() };
    const t = transplant(window.__tw, el);
    const depois = { tlTotalDur: t.tl.totalDuration(), childTotalDur: t.child.totalDuration() };
    return { antes, depois };
  `);
  registro.paiRepeatYoyo = r;
}

// --- pai-timescale (REGISTRO) ------------------------------------------------
{
  const r = await runPage(`${LIB}
    window.__tw = gsap.to('.item', { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });
    window.__tw.timeScale(2);
    window.__tw.totalTime(0.35, true);   // = 0.7 de tempo interno
    const el = document.getElementById('i1');
    const xAntes = X('i1');
    const t = transplant(window.__tw, el);
    const xNoInstante = X('i1');
    return { xAntes, xNoInstante, tlTimeScale: t.tl.timeScale(), childTimeScale: t.child.timeScale() };
  `);
  registro.paiTimescale = r;
}

// --- callbacks (REGISTRO) ----------------------------------------------------
{
  const r = await runPage(`${LIB}
    window.__n = { complete: 0 };
    window.__tw = gsap.to('.item', { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true,
      onComplete() { window.__n.complete++; } });
    window.__tw.totalTime(0.7, true);
    const el = document.getElementById('i1');
    const t = transplant(window.__tw, el);
    // completa os DOIS relógios
    window.__tw.totalTime(window.__tw.totalDuration(), true);
    t.tl.totalTime(t.tl.totalDuration(), true);
    const comSuppress = { ...window.__n };
    // e sem suppress (como um play real chegaria lá)
    window.__tw.totalTime(0.7, true); t.tl.totalTime(0, true);
    window.__tw.totalTime(window.__tw.totalDuration());
    t.tl.totalTime(t.tl.totalDuration());
    return { comSuppress, semSuppress: { ...window.__n } };
  `);
  registro.callbacks = r;
}

// --- repeatRefresh-child (REGISTRO; valores random → só fatos estruturais) ---
{
  const r = await runPage(`${LIB}
    window.__tw = gsap.to('.item', { x: 'random(50, 150)', duration: 1, ease: 'none', stagger: 0.2,
      repeat: 1, repeatRefresh: true, paused: true });
    window.__tw.totalTime(0.7, true);
    const el = document.getElementById('i1');
    const xAntes = X('i1');
    const t = transplant(window.__tw, el);
    const xNoInstante = X('i1');
    const preservouResolvido = xAntes === xNoInstante;
    // cruza a fronteira de repetição no relógio novo — sobrevive sem erro?
    let erroAoCruzar = null;
    try { t.tl.totalTime(t.child.totalDuration() * 0.9, true); } catch (e) { erroAoCruzar = String(e); }
    const xFinal = X('i1');
    return { xAntes, xNoInstante, preservouResolvido, erroAoCruzar, xFinalFinito: Number.isFinite(xFinal) };
  `);
  registro.repeatRefreshChild = r;
}

// --- splittext-stagger + re-split (REGISTRO; P1 prevê órfão) -----------------
{
  const r = await runPage(`${LIB}
    gsap.registerPlugin(SplitText);
    const split = new SplitText(document.getElementById('h'), { type: 'lines,words,chars' });
    window.__tw = gsap.to(split.chars, { x: 30, duration: 1, ease: 'none', stagger: 0.05, paused: true });
    window.__tw.totalTime(0.5, true);
    const alvo = split.chars[3];
    const child = innerChildOf(window.__tw, alvo);
    if (!child) return { erro: 'sem filho interno por char' };
    const t = transplant(window.__tw, alvo);
    const vivoAntesDoResplit = document.contains(t.child.targets()[0]);
    document.getElementById('wrap').style.width = '150px';
    split.split({ type: 'lines,words,chars' });
    const vivoDepoisDoResplit = document.contains(t.child.targets()[0]);
    return { temFilhoPorChar: true, vivoAntesDoResplit, vivoDepoisDoResplit };
  `);
  registro.splittextStagger = r;
}

await browser.close();
console.log(JSON.stringify(registro, null, 2));
if (falhas.length) {
  console.error(`\nP5 FALHOU:\n${falhas.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nP5 determinísticos OK — semânticas de herança registradas acima');
