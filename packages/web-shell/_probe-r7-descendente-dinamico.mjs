// PROBE r7 — bloqueador do Sol: a travessia é um SNAPSHOT tirado antes do seek.
// Se o `onUpdate` do site (que fica vivo, por desenho) CRIAR um descendente
// dentro da janela, os callbacks dele nunca foram anulados.
//
// O que decide o ALCANCE do residual: um filho criado durante uma escrita de
// relógio chega a ser renderizado NESSA MESMA escrita? Se só for renderizado na
// seguinte, ela é outro seek — com janela própria, que já o incluiria no
// snapshot. Se for na mesma, o furo é real dentro de uma única escrita.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const g = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const b = await chromium.launch({ headless: true }); const p = await b.newPage();
await p.setContent(['m1', 'm2', 'n1', 'n2'].map((i) => `<div id="${i}"></div>`).join(''));
await p.addScriptTag({ content: g });

const r = await p.evaluate(() => {
  const LIFECYCLE = ['onStart', 'onComplete', 'onRepeat'];
  const trav = (tl) => {
    const acc = []; const vistos = new Set();
    const desce = (an) => {
      if (!an || vistos.has(an)) return;
      vistos.add(an); acc.push(an);
      if (typeof an.getChildren === 'function') an.getChildren(true, true, true).forEach(desce);
      else if (an.timeline) desce(an.timeline);
    };
    desce(tl); return acc;
  };
  const janela = (alvos, body) => {
    const saved = alvos.map((an) => LIFECYCLE.map((k) => [k, Object.prototype.hasOwnProperty.call(an.vars, k), an.vars[k]]));
    alvos.forEach((an) => LIFECYCLE.forEach((k) => { if (Object.prototype.hasOwnProperty.call(an.vars, k)) an.vars[k] = undefined; }));
    try { body(); } finally { alvos.forEach((an, i) => saved[i].forEach(([k, tinha, v]) => { if (tinha) an.vars[k] = v; })); }
  };

  const monta = (selA, selB) => {
    const f = { novo: 0, criou: 0 };
    const tl = gsap.timeline({ paused: true });
    tl.to(selA, {
      x: 100, duration: 1, ease: 'none',
      onUpdate: () => {
        if (f.criou) return; f.criou = 1;
        // o site cria um filho NOVO na timeline que está sendo seekada, numa
        // posição JÁ ULTRAPASSADA pelo seek em curso
        tl.to(selB, { x: 100, duration: 0.2, ease: 'none', onComplete: () => { f.novo += 1; } }, 0);
      },
    });
    return { tl, f };
  };

  // CONTROLE: sem janela, o filho criado dentro do render dispara — e QUANDO?
  const a = monta('#m1', '#m2');
  a.tl.pause(); a.tl.time(0.1, false);          // inicializa e cria o novo filho
  const criouNaPrimeira = a.f.criou;
  const disparouNaMesmaEscrita = a.f.novo;
  a.tl.time(0.9, false);                        // SEGUNDA escrita de relógio
  const disparouNaSegunda = a.f.novo - disparouNaMesmaEscrita;

  // TESTE: com a janela (snapshot ANTES do seek), o filho novo escapa?
  const c = monta('#n1', '#n2');
  c.tl.pause();
  c.tl.time(0.05, true);                        // pré-render suprimido (já cria o filho)
  const criouNoPreRender = c.f.criou;
  const base = c.f.novo;
  janela(trav(c.tl), () => { c.tl.time(0.9, false); });
  const escapouNaJanela = c.f.novo - base;

  // e o caso EXTREMO: snapshot antes, criação DENTRO da mesma escrita
  const d = monta('#n1', '#n2');
  d.tl.pause();
  const base2 = d.f.novo;
  janela(trav(d.tl), () => { d.tl.time(0.9, false); });   // cria E renderiza na mesma janela
  const escapouNaMesmaEscrita = d.f.novo - base2;

  return {
    criouNaPrimeira, disparouNaMesmaEscrita, disparouNaSegunda,
    criouNoPreRender, escapouNaJanela, escapouNaMesmaEscrita,
  };
});
await b.close();
console.log(JSON.stringify(r, null, 2));
const f = [];
if (!r.criouNaPrimeira) f.push('CONTROLE VÁCUO: o site não chegou a criar o filho novo');
if (r.disparouNaMesmaEscrita === 0 && r.disparouNaSegunda === 0) f.push('CONTROLE VÁCUO: o filho novo não dispara em escrita nenhuma');
console.log('\n--- LEITURA ---');
console.log(`filho criado dentro do render dispara: na MESMA escrita=${r.disparouNaMesmaEscrita}, na SEGUINTE=${r.disparouNaSegunda}`);
console.log(`com a janela: escapou (criado no pré-render, seek depois)=${r.escapouNaJanela}; escapou (criado E renderizado na mesma janela)=${r.escapouNaMesmaEscrita}`);
console.log(f.length ? `\n${f.length} PROBLEMA(S):\n- ${f.join('\n- ')}` : '');
process.exit(f.length ? 1 : 0);
