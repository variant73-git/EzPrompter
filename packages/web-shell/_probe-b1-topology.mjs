// B1 / PROBE 1 — dono da TOPOLOGIA do stagger (prescrição do advise Sol 2026-08-06).
//
// Pergunta: quem é dono de quê na estrutura fachada→timeline-interna→filhos,
// nos três estados (antes de init, midflight, completa), pros três alvos
// (primeiro/meio/último). Fatos: identidade do parent, startTime, ordem
// (_prev/_next + índice), targets, flags do inner (smoothChildTiming/
// sortChildren), duração fachada vs filho.
//
// Método da frente: GSAP 3.15 real, números serializados com typeof/finitude
// explícitos (JSON.stringify mascara Infinity/NaN), asserção de vida.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const root = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0';
const gsapSrc = readFileSync(`${root}/gsap.min.js`, 'utf8');

const browser = await chromium.launch({ headless: true });
const HTML = `<div id="wrap">
  <div class="item" id="i0"></div>
  <div class="item" id="i1"></div>
  <div class="item" id="i2"></div>
</div>`;

async function runPage(body, arg) {
  const page = await browser.newPage();
  await page.setContent(HTML);
  await page.addScriptTag({ content: gsapSrc });
  const out = await page.evaluate(([b, a]) => new Function('arg', b)(a), [body, arg ?? null]);
  await page.close();
  return out;
}

const LIB = `
  const num = (v) => ({ t: typeof v, s: String(v), fin: typeof v === 'number' && Number.isFinite(v) ? v : null });
  const snapChild = (tl, child, els) => {
    const kids = tl.getChildren(true, true, false);
    const idx = kids.indexOf(child);
    return {
      parentIsInner: child.parent === tl,
      startTime: num(child.startTime()),
      idx,
      prevIsChild: child._prev ? kids.includes(child._prev) : null,
      nextIsChild: child._next ? kids.includes(child._next) : null,
      targetsLen: child.targets ? child.targets().length : null,
      targetId: child.targets && child.targets()[0] && child.targets()[0].id || null,
      dur: num(child.duration()),
      totalDur: num(child.totalDuration()),
      initted: !!child._initted,
      time: num(child.totalTime()),
    };
  };
  const snapFacade = (tw) => ({
    hasInner: !!tw.timeline,
    innerIsTimeline: tw.timeline ? String(tw.timeline.constructor.name) : null,
    smoothChildTiming: tw.timeline ? !!tw.timeline.smoothChildTiming : null,
    sortChildren: tw.timeline ? ('_sort' in tw.timeline ? !!tw.timeline._sort : 'ausente') : null,
    facadeDur: num(tw.duration()),
    facadeTotalDur: num(tw.totalDuration()),
    facadeParentIsGlobal: tw.parent === gsap.globalTimeline,
    kidsCount: tw.timeline ? tw.timeline.getChildren(true, true, false).length : 0,
    initted: !!tw._initted,
  });
  const snapAll = (tw) => {
    const tl = tw.timeline;
    const kids = tl ? tl.getChildren(true, true, false) : [];
    const byId = (id) => kids.find((c) => c.targets && c.targets()[0] === document.getElementById(id)) || null;
    return {
      facade: snapFacade(tw),
      first: byId('i0') ? snapChild(tl, byId('i0')) : null,
      middle: byId('i1') ? snapChild(tl, byId('i1')) : null,
      last: byId('i2') ? snapChild(tl, byId('i2')) : null,
    };
  };
`;

const SETUP = `window.__tw = gsap.to('.item', { x: 100, duration: 1, ease: 'none', stagger: 0.2, paused: true });`;

const registro = {};
const falhas = [];
const assert = (cond, msg) => { if (!cond) falhas.push(msg); };

// --- estado 1: ANTES de init (criado paused, nunca renderizado) --------------
registro.preInit = await runPage(`${LIB}${SETUP}
  return snapAll(window.__tw);
`);

// --- estado 2: midflight (totalTime 0.7 — i1 local 0.5) ----------------------
registro.midflight = await runPage(`${LIB}${SETUP}
  window.__tw.totalTime(0.7, true);
  const s = snapAll(window.__tw);
  s.vida = Number(gsap.getProperty(document.getElementById('i1'), 'x'));
  return s;
`);

// --- estado 3: completa ------------------------------------------------------
registro.completa = await runPage(`${LIB}${SETUP}
  window.__tw.totalTime(window.__tw.totalDuration(), true);
  const s = snapAll(window.__tw);
  s.xFinal = Number(gsap.getProperty(document.getElementById('i2'), 'x'));
  return s;
`);

// --- asserções de fato -------------------------------------------------------
for (const [nome, s] of Object.entries(registro)) {
  assert(s.facade.hasInner, `${nome}: fachada sem timeline interna`);
  assert(s.facade.kidsCount === 3, `${nome}: kidsCount=${s.facade.kidsCount} (esperado 3)`);
  for (const k of ['first', 'middle', 'last']) {
    assert(s[k], `${nome}: filho ${k} não encontrado por alvo`);
    if (s[k]) {
      assert(s[k].parentIsInner, `${nome}/${k}: parent NÃO é a inner timeline`);
      assert(s[k].targetsLen === 1, `${nome}/${k}: targetsLen=${s[k].targetsLen}`);
      assert(s[k].startTime.fin !== null, `${nome}/${k}: startTime não-finito: ${s[k].startTime.s}`);
    }
  }
  if (s.first && s.middle && s.last) {
    assert(s.first.startTime.fin === 0 && Math.abs(s.middle.startTime.fin - 0.2) < 1e-9 && Math.abs(s.last.startTime.fin - 0.4) < 1e-9,
      `${nome}: startTimes ${s.first.startTime.s}/${s.middle.startTime.s}/${s.last.startTime.s} (esperado 0/0.2/0.4)`);
    assert(s.first.idx === 0 && s.middle.idx === 1 && s.last.idx === 2,
      `${nome}: ordem ${s.first.idx}/${s.middle.idx}/${s.last.idx}`);
  }
}
assert(registro.midflight.vida > 0, `midflight: i1 não estava vivo (x=${registro.midflight.vida})`);
assert(registro.completa.xFinal === 100, `completa: i2 xFinal=${registro.completa.xFinal}`);
// init lazy? fato registrado, não assumido:
registro.fatoInit = {
  facadeInittedPreInit: registro.preInit.facade.initted,
  childInittedPreInit: registro.preInit.first ? registro.preInit.first.initted : null,
  childInittedMidflight: registro.midflight.first ? registro.midflight.first.initted : null,
};

await browser.close();
console.log(JSON.stringify(registro, null, 2));
console.log(falhas.length ? `\n${falhas.length} RED:\n- ${falhas.join('\n- ')}` : '\n0 RED');
process.exit(falhas.length ? 1 : 0);
