// PROBE r3 — travessia: uma FACHADA DE STAGGER dentro de uma TIMELINE.
//
// A obrigação escrita no finding diz: timeline → getChildren(true,true,true);
// fachada de tween → .timeline.getChildren(...). Falta o caso composto, que é o
// do clone real: a timeline contém uma fachada de stagger, e o stagger em forma
// de OBJETO dá callback próprio a cada filho interno. O getChildren do PAI
// alcança esses netos, ou eles ficam fora e vazam?
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const g = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const b = await chromium.launch({ headless: true }); const p = await b.newPage();
// ⚠️ ELEMENTO PRÓPRIO POR BRAÇO. A versão anterior reusava #z1/#z2 nos três
// braços de teste; o primeiro já deixava x=100, então o controle de pré-render
// (`x > 0`) passava no VÁCUO e um braço poderia inicializar 100→100 sem nada se
// mover (bloqueador r6 do Sol — a armadilha do "verde vácuo", cometida de novo).
await p.setContent(['y1', 'y2', 'z1', 'z2', 'w1', 'w2', 'v1', 'v2'].map((i) => `<div id="${i}"></div>`).join(''));
await p.addScriptTag({ content: g });

const r = await p.evaluate(() => {
  const LIFECYCLE = ['onStart', 'onComplete', 'onRepeat'];
  const mk = (s1, s2) => {
    const f = { filhosDoStagger: 0, fachada: 0, u: 0 };
    const tl = gsap.timeline({ paused: true });
    tl.to([s1, s2], {
      x: 100, duration: 0.5, ease: 'none',
      stagger: { each: 0.2, onComplete: () => { f.filhosDoStagger += 1; } },
      onComplete: () => { f.fachada += 1; },
      onUpdate: () => { f.u += 1; },
    });
    return { tl, f };
  };

  // travessia INGÊNUA (só getChildren do pai) vs travessia que DESCE no .timeline
  const listaIngenua = (tl) => tl.getChildren(true, true, true);
  // Versão que o finding prescrevia até a r5: desce nos FILHOS do `.timeline`,
  // mas nunca inclui a PRÓPRIA timeline interna — um callback instalado nela
  // escapa (bloqueador r5 do Sol).
  const listaCompletaAntiga = (tl) => {
    const acc = [];
    const desce = (an) => {
      acc.push(an);
      const kids = typeof an.getChildren === 'function'
        ? an.getChildren(true, true, true)
        : (an.timeline && typeof an.timeline.getChildren === 'function' ? an.timeline.getChildren(true, true, true) : []);
      kids.forEach(desce);
    };
    desce(tl);
    return acc;
  };
  // Corrigida: visita a própria `an.timeline` como NÓ, com Set de visitados
  // (o `.timeline` de um filho aponta para o pai — sem o Set, laço infinito).
  const listaCompleta = (tl) => {
    const acc = []; const vistos = new Set();
    const desce = (an) => {
      if (!an || vistos.has(an)) return;
      vistos.add(an); acc.push(an);
      if (typeof an.getChildren === 'function') an.getChildren(true, true, true).forEach(desce);
      else if (an.timeline) desce(an.timeline);
    };
    desce(tl);
    return acc;
  };

  const janela = (alvos, body) => {
    const saved = alvos.map((an) => LIFECYCLE.map((k) => [k, Object.prototype.hasOwnProperty.call(an.vars, k), an.vars[k]]));
    alvos.forEach((an) => LIFECYCLE.forEach((k) => { if (Object.prototype.hasOwnProperty.call(an.vars, k)) an.vars[k] = undefined; }));
    try { body(); } finally { alvos.forEach((an, i) => saved[i].forEach(([k, tinha, v]) => { if (tinha) an.vars[k] = v; })); }
  };

  // CONTROLE
  const a = mk('#y1', '#y2');
  a.tl.pause(); a.tl.time(a.tl.duration(), false);
  const controle = { ...a.f };
  const ingenuaAlcanca = listaIngenua(a.tl).length;
  const completaAlcanca = listaCompleta(a.tl).length;

  // ⚠️ Os braços de TESTE pré-renderizam de forma SUPRIMIDA antes da janela.
  // Sem isso, um zero provaria "inicializou sem callback" e não supressão
  // pós-inicialização (bloqueador r4 do Sol — o mesmo lazy-init da r3, que eu
  // tinha fechado nos outros probes e não neste, escrito antes da lição).
  // TESTE 1 — travessia ingênua (o que a obrigação escrita diz para timeline)
  const c = mk('#z1', '#z2');
  c.tl.pause();
  const antesPre1 = Number(gsap.getProperty('#z1', 'x'));
  c.tl.time(0.3, true);
  const depoisPre1 = Number(gsap.getProperty('#z1', 'x'));
  const preRender1 = depoisPre1 > antesPre1 && depoisPre1 < 100;   // moveu E não está no fim
  const base1 = { ...c.f };
  janela([c.tl, ...listaIngenua(c.tl)], () => { c.tl.time(c.tl.duration(), false); });
  const comIngenua = { fachada: c.f.fachada - base1.fachada, filhos: c.f.filhosDoStagger - base1.filhosDoStagger };

  // TESTE 2 — travessia que desce no .timeline das fachadas
  const d = mk('#w1', '#w2');
  d.tl.pause();
  const antesPre2 = Number(gsap.getProperty('#w1', 'x'));
  d.tl.time(0.3, true);
  const depoisPre2 = Number(gsap.getProperty('#w1', 'x'));
  const preRender2 = depoisPre2 > antesPre2 && depoisPre2 < 100;
  const base2 = { ...d.f };
  const xAntesDaJanela = Number(gsap.getProperty('#w2', 'x'));   // o 2º alvo do stagger
  janela(listaCompleta(d.tl), () => { d.tl.time(d.tl.duration(), false); });
  const xDepoisDaJanela = Number(gsap.getProperty('#w2', 'x'));
  const comCompleta = {
    fachada: d.f.fachada - base2.fachada,
    filhos: d.f.filhosDoStagger - base2.filhosDoStagger,
    onUpdateChamado: d.f.u - base2.u,
    // DESENHO EFETIVO: deslocamento renderizado, não contagem de onUpdate
    desenhouDeFato: xDepoisDaJanela > xAntesDaJanela,
    xAntesDaJanela, xDepoisDaJanela,
  };
  // e DEPOIS de restaurar: volta tudo a disparar? (separa suprimir de destruir)
  const base3 = { ...d.f };
  d.tl.time(0, true); d.tl.time(d.tl.duration(), false);
  const depoisDoRestore = { fachada: d.f.fachada - base3.fachada, filhos: d.f.filhosDoStagger - base3.filhosDoStagger };

  // ---- r5 — callback instalado na TIMELINE INTERNA da fachada de stagger ----
  const e = mk('#v1', '#v2');
  let internos = 0;
  const fachada = e.tl.getChildren(true, true, true)[0];
  fachada.timeline.eventCallback('onComplete', () => { internos += 1; });
  e.tl.pause();
  const antesPre3 = Number(gsap.getProperty('#v1', 'x'));
  e.tl.time(0.3, true);
  const depoisPre3 = Number(gsap.getProperty('#v1', 'x'));
  const preRender3 = depoisPre3 > antesPre3 && depoisPre3 < 100;
  const baseCtl = internos;
  e.tl.time(e.tl.duration(), false);          // CONTROLE: a interna dispara?
  const internaControle = internos - baseCtl;

  const listaAntiga = listaCompletaAntiga(e.tl);
  const listaNova = listaCompleta(e.tl);
  const internaNaAntiga = listaAntiga.includes(fachada.timeline);
  const internaNaNova = listaNova.includes(fachada.timeline);

  e.tl.time(0, true);
  const baseA = internos;
  janela(listaAntiga, () => { e.tl.time(e.tl.duration(), false); });
  const internaComAntiga = internos - baseA;

  e.tl.time(0, true);
  const baseB = internos;
  janela(listaNova, () => { e.tl.time(e.tl.duration(), false); });
  const internaComNova = internos - baseB;

  e.tl.time(0, true);
  const baseC = internos;
  e.tl.time(e.tl.duration(), false);
  const internaDepoisDoRestore = internos - baseC;

  return { controle, ingenuaAlcanca, completaAlcanca, comIngenua, comCompleta, preRender1, preRender2, depoisDoRestore,
    r5: { preRender3, internaControle, internaNaAntiga, internaNaNova, internaComAntiga, internaComNova, internaDepoisDoRestore,
      nosAntiga: listaAntiga.length, nosNova: listaNova.length } };
});
await b.close();
console.log(JSON.stringify(r, null, 2));
const f = [];
if (!(r.controle.filhosDoStagger > 0)) f.push('CONTROLE VÁCUO: os filhos do stagger não dispararam nem com tudo ligado');
if (r.comIngenua.filhos > 0) console.log(`\nRESULTADO: a travessia INGÊNUA (só getChildren do pai) VAZA os filhos do stagger (${r.comIngenua.filhos} disparos) — alcança ${r.ingenuaAlcanca} nós contra ${r.completaAlcanca} da completa`);
else console.log('\nRESULTADO: a travessia ingênua já cobre os filhos do stagger — o caso composto NÃO é um furo');
if (!r.preRender1 || !r.preRender2) f.push(`PRÉ-RENDER não moveu o alvo (t1=${r.preRender1}, t2=${r.preRender2}) — os zeros seriam vácuo`);
if (r.comCompleta.filhos !== 0) f.push(`a travessia COMPLETA também não silenciou (${r.comCompleta.filhos})`);
if (!(r.depoisDoRestore.filhos === 2 && r.depoisDoRestore.fachada === 1)) f.push(`depois do restore não voltou a disparar como o controle (filhos=${r.depoisDoRestore.filhos} esperado 2, fachada=${r.depoisDoRestore.fachada} esperado 1) — a janela destruiu em vez de suprimir`);
if (!r.comCompleta.desenhouDeFato) f.push(`com a travessia completa o DESENHO não avançou de fato (x ${r.comCompleta.xAntesDaJanela} → ${r.comCompleta.xDepoisDaJanela})`);
const q = r.r5;
console.log(`\n--- r5 (callback na TIMELINE INTERNA da fachada) ---`);
console.log(`controle=${q.internaControle}; incluída na travessia antiga=${q.internaNaAntiga} (${q.nosAntiga} nós) / na nova=${q.internaNaNova} (${q.nosNova} nós)`);
console.log(`disparos na janela: travessia antiga=${q.internaComAntiga}, travessia nova=${q.internaComNova}; depois do restore=${q.internaDepoisDoRestore}`);
if (!q.preRender3) f.push('r5: pré-render não moveu o alvo');
if (q.internaControle === 0) f.push('r5 CONTROLE VÁCUO: o callback da timeline interna não dispara nem com tudo ligado');
else {
  if (q.internaComAntiga === 0) console.log('→ o bloqueador do Sol NÃO se reproduz: a travessia antiga já silenciava a interna');
  else console.log(`→ BLOQUEADOR REPRODUZIDO: a travessia antiga deixa a timeline interna disparar (${q.internaComAntiga})`);
  if (q.internaComNova !== 0) f.push(`a travessia CORRIGIDA também não silenciou a timeline interna (${q.internaComNova})`);
  if (q.internaDepoisDoRestore === 0) f.push('r5: depois do restore a interna não voltou a disparar — destruiu em vez de suprimir');
}
console.log(f.length ? `\n${f.length} PROBLEMA(S):\n- ${f.join('\n- ')}` : '');
process.exit(f.length ? 1 : 0);
