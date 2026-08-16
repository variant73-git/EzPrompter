// PROBE r2 — bloqueador do Sol na rodada 2: `onRepeat` de um FILHO com repeat,
// quando o que é seekado é a TIMELINE-PAI.
//
// O finding concluiu "onRepeat não é alcançável" a partir de um tween repetido
// seekado DIRETAMENTE (onde o clamp da iteração impede a travessia). O Sol
// apontou que o bridge também seeka timelines, e que `tl.time(1.5)` renderiza um
// filho repetido ALÉM da primeira iteração — o que dispararia o onRepeat dele.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const g = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const b = await chromium.launch({ headless: true }); const p = await b.newPage();
await p.setContent(['x1', 'x2', 'x3'].map((i) => `<div id="${i}"></div>`).join(''));
await p.addScriptTag({ content: g });

const r = await p.evaluate(() => {
  const LIFECYCLE = ['onStart', 'onComplete', 'onRepeat'];
  const mk = (sel) => {
    const f = { r: 0, u: 0 };
    const tl = gsap.timeline({ paused: true });
    tl.to(sel, {
      x: 100, duration: 1, ease: 'none', repeat: 2,
      onRepeat: () => { f.r += 1; }, onUpdate: () => { f.u += 1; },
    });
    return { tl, f, filho: tl.getChildren(true, true, true)[0] };
  };

  // CONTROLE: seekar a TIMELINE além da 1ª iteração do filho dispara o onRepeat?
  // ⚠️ Os DOIS braços pré-renderizam antes de qualquer janela. Sem isso, o braço
  // de teste abriria a janela num filho NUNCA renderizado, e o zero provaria só
  // "inicializou sem callback" — não supressão pós-inicialização (a assimetria
  // de lazy-init do GSAP; bloqueador da rodada 3 do Sol).
  const a = mk('#x1');
  const dims = { duracaoDaTimeline: a.tl.duration(), duracaoDoFilho: a.filho.duration(), totalDoFilho: a.filho.totalDuration() };
  a.tl.pause(); a.tl.time(0.2, false);        // PRÉ-RENDER: inicializa o filho
  const controlePreRender = a.f.r;            // não deve ter cruzado fronteira ainda
  a.tl.time(1.5, false);
  const controleFrente = a.f.r;
  a.tl.time(2.5, false);                      // segue adiante
  const controleMaisFrente = a.f.r;
  a.tl.time(0.2, false);                      // e VOLTA atravessando as fronteiras
  const controleVoltando = a.f.r;

  // TESTE: a janela cobrindo a DESCENDÊNCIA silencia?
  const c = mk('#x2');
  c.tl.pause();
  c.tl.time(0.2, false);                      // PRÉ-RENDER, igual ao controle
  const testePreRender = c.f.r;
  const alvos = [c.tl, ...c.tl.getChildren(true, true, true)];
  const saved = alvos.map((an) => LIFECYCLE.map((k) => [k, Object.prototype.hasOwnProperty.call(an.vars, k), an.vars[k]]));
  alvos.forEach((an) => LIFECYCLE.forEach((k) => { if (Object.prototype.hasOwnProperty.call(an.vars, k)) an.vars[k] = undefined; }));
  let naJanela = 0;
  try {
    const base = c.f.r;
    c.tl.time(1.5, false); c.tl.time(2.5, false); c.tl.time(0.2, false);
    naJanela = c.f.r - base;
  } finally {
    alvos.forEach((an, i) => saved[i].forEach(([k, tinha, v]) => { if (tinha) an.vars[k] = v; }));
  }
  // DEPOIS de restaurar, o onRepeat volta a disparar? (senão a janela não
  // "suprimiu": ela destruiu)
  const baseDepois = c.f.r;
  c.tl.time(0.2, true); c.tl.time(1.5, false);
  const voltouADisparar = c.f.r - baseDepois;

  // e o desenho do filho sobreviveu dentro da janela?
  const d = mk('#x3');
  d.tl.pause();
  d.tl.time(0.2, false);                      // PRÉ-RENDER
  const filho = d.tl.getChildren(true, true, true)[0];
  LIFECYCLE.forEach((k) => { if (Object.prototype.hasOwnProperty.call(filho.vars, k)) filho.vars[k] = undefined; });
  const baseU = d.f.u; d.tl.time(1.5, false);
  const desenhouNaJanela = d.f.u - baseU;

  return { dims, controlePreRender, testePreRender, controleFrente, controleMaisFrente, controleVoltando, naJanela, voltouADisparar, desenhouNaJanela };
});
await b.close();
console.log(JSON.stringify(r, null, 2));
const f = [];
if (r.controleFrente === 0 && r.controleMaisFrente === 0 && r.controleVoltando === 0) {
  console.log('\nRESULTADO: o onRepeat do FILHO não dispara nem sem janela — o bloqueador NÃO se reproduz');
} else {
  console.log(`\nRESULTADO: BLOQUEADOR REPRODUZIDO — onRepeat do filho dispara ao seekar a timeline (frente=${r.controleFrente}, mais frente=${r.controleMaisFrente}, voltando=${r.controleVoltando})`);
  if (r.naJanela !== 0) f.push(`e a janela na descendência NÃO silenciou (${r.naJanela})`);
  else console.log(`a janela na descendência silencia (${r.naJanela}) e o filho segue desenhando (${r.desenhouNaJanela} updates)`);
}
if (r.controlePreRender !== 0 || r.testePreRender !== 0) f.push(`o PRÉ-RENDER já cruzou a fronteira (controle=${r.controlePreRender}, teste=${r.testePreRender}) — os braços não partem do mesmo estado`);
if (r.voltouADisparar === 0) f.push('depois de restaurar o onRepeat NÃO voltou a disparar — a janela destruiu em vez de suprimir');
if (r.desenhouNaJanela === 0) f.push('o filho parou de desenhar dentro da janela');
console.log(f.length ? `\n${f.length} PROBLEMA(S):\n- ${f.join('\n- ')}` : '');
process.exit(f.length ? 1 : 0);
