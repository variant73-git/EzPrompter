// PROBE B3 — escopo da janela: timeline, fachada de stagger e `vars` PARTILHADO.
//
// Hipótese B3 (handoff §3): seekar uma timeline/fachada de stagger não dispara o
// ciclo de vida dos FILHOS — ou, se dispara, a janela precisa cobrir a
// descendência. O clone real é cheio de stagger, então é aqui que a regra vale
// ou não vale onde importa.
//
// Adiciono um caso que a Tabela B não lista e que é uma rota de vazamento
// óbvia: o site pode reusar o MESMO objeto de config em duas animações
// (`const cfg = {...}; gsap.to(a, cfg); gsap.to(b, cfg)`). Se o GSAP guardar a
// referência em vez de copiar, anular em `vars` de UMA silencia a OUTRA — e a
// restauração no fim da janela não desfaz o dano observado no meio dela.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const GSAP = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js';
const gsapSrc = readFileSync(GSAP, 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(
  ['t1a', 't1b', 't2a', 't2b', 't3a', 't3b', 't4a', 't4b', 't4c', 't5a', 't5b', 't5c', 't6a', 't6b', 't7c', 't8a', 't9a', 't9b', 't9c', 't9d']
    .map((id) => `<div id="${id}"></div>`).join('')
);
await page.addScriptTag({ content: gsapSrc });

const r = await page.evaluate(() => {
  const LIFECYCLE = ['onStart', 'onComplete', 'onRepeat'];
  const nulify = (vars) => {
    const saved = LIFECYCLE.map((k) => [k, vars[k]]);
    LIFECYCLE.forEach((k) => { vars[k] = undefined; });
    return () => saved.forEach(([k, v]) => { vars[k] = v; });
  };

  // timeline com dois filhos, cada um com ciclo de vida PRÓPRIO + desenho no update
  const mkTl = (selA, selB, tag) => {
    const fires = { paiStart: 0, paiComplete: 0, aStart: 0, aComplete: 0, aUpdate: 0, bStart: 0, bComplete: 0, bUpdate: 0 };
    const drawn = { a: -1, b: -1 };
    const tl = gsap.timeline({
      paused: true,
      onStart: () => { fires.paiStart += 1; },
      onComplete: () => { fires.paiComplete += 1; },
    });
    tl.to(selA, {
      x: 100, duration: 1, ease: 'none',
      onStart: () => { fires.aStart += 1; },
      onUpdate: () => { fires.aUpdate += 1; drawn.a = Number(gsap.getProperty(selA, 'x')); },
      onComplete: () => { fires.aComplete += 1; },
    });
    tl.to(selB, {
      x: 100, duration: 1, ease: 'none',
      onStart: () => { fires.bStart += 1; },
      onUpdate: () => { fires.bUpdate += 1; drawn.b = Number(gsap.getProperty(selB, 'x')); },
      onComplete: () => { fires.bComplete += 1; },
    });
    return { tl, fires, drawn, tag };
  };

  const out = {};

  // ---- T1 — CONTROLE: seekar a timeline com tudo ligado -------------------
  {
    const c = mkTl('#t1a', '#t1b');
    c.tl.pause();
    for (let i = 1; i <= 10; i += 1) c.tl.time(i * 0.2, false);
    out.t1_controle = { ...c.fires, drawn: { ...c.drawn } };
  }

  // ---- T2 — janela SÓ NA FACHADA (o que o desenho propõe hoje) ------------
  {
    const c = mkTl('#t2a', '#t2b');
    c.tl.pause();
    const restore = nulify(c.tl.vars);
    try { for (let i = 1; i <= 10; i += 1) c.tl.time(i * 0.2, false); } finally { restore(); }
    out.t2_soFachada = { ...c.fires, drawn: { ...c.drawn } };
  }

  // ---- T3 — janela na fachada + DESCENDÊNCIA ------------------------------
  // PRÉ-RENDER suprimido: ver a nota do C2 no probe B1 (lazy-init).
  {
    const c = mkTl('#t3a', '#t3b');
    c.tl.pause();
    c.tl.time(0.5, true);
    const preRenderMoveu = Number(gsap.getProperty('#t3a', 'x')) > 0;
    const restores = [nulify(c.tl.vars), ...c.tl.getChildren(true, true, true).map((ch) => nulify(ch.vars))];
    try { for (let i = 1; i <= 10; i += 1) c.tl.time(i * 0.2, false); } finally { restores.forEach((f) => f()); }
    out.t3_comDescendencia = { preRenderMoveu, ...c.fires, drawn: { ...c.drawn }, filhos: c.tl.getChildren(true, true, true).length };
  }

  // ---- T4 — FACHADA DE STAGGER: onde ficam os callbacks? -----------------
  // Precisa saber o que o stagger cria: um tween só, ou fachada + filhos com
  // `vars` própria (é o que a frente já mediu no furo #4).
  {
    const fires = { start: 0, complete: 0, update: 0, repeat: 0 };
    const tw = gsap.to(['#t4a', '#t4b', '#t4c'], {
      x: 100, duration: 1, ease: 'none', paused: true, stagger: 0.2,
      onStart: () => { fires.start += 1; },
      onUpdate: () => { fires.update += 1; },
      onComplete: () => { fires.complete += 1; },
    });
    const kids = tw.timeline ? tw.timeline.getChildren(true, true, true) : [];
    const kidsComCallback = kids.filter((k) => k.vars && (k.vars.onStart || k.vars.onComplete || k.vars.onUpdate)).length;
    tw.pause();
    for (let i = 1; i <= 10; i += 1) tw.time(i * 0.14, false);
    out.t4_staggerControle = {
      temTimelineInterna: !!tw.timeline,
      filhos: kids.length,
      filhosComCallbackProprio: kidsComCallback,
      ...fires,
    };
  }

  // ---- T5 — stagger com a janela SÓ NA FACHADA ---------------------------
  {
    const fires = { start: 0, complete: 0, update: 0 };
    const drawn = { v: -1 };
    const tw = gsap.to(['#t5a', '#t5b', '#t5c'], {
      x: 100, duration: 1, ease: 'none', paused: true, stagger: 0.2,
      onStart: () => { fires.start += 1; },
      onUpdate: () => { fires.update += 1; drawn.v = Number(gsap.getProperty('#t5c', 'x')); },
      onComplete: () => { fires.complete += 1; },
    });
    tw.pause();
    tw.time(0.5, true);
    const preRenderMoveu = Number(gsap.getProperty('#t5a', 'x')) > 0;
    const restore = nulify(tw.vars);
    try { for (let i = 1; i <= 10; i += 1) tw.time(i * 0.14, false); } finally { restore(); }
    out.t5_staggerSoFachada = { preRenderMoveu, ...fires, drawnUltimoAlvo: drawn.v };
  }

  // ---- T6 — `vars` PARTILHADO entre duas animações ------------------------
  // O GSAP guarda a referência do objeto do autor, ou copia? Se guarda, a
  // janela numa animação silencia a OUTRA enquanto estiver aberta.
  {
    const fires = { a: 0, b: 0 };
    const cfg = {
      x: 100, duration: 1, ease: 'none', paused: true,
      onComplete: function () { fires[this.__tag] = (fires[this.__tag] || 0) + 1; },
    };
    const twA = gsap.to('#t6a', { ...cfg, onComplete: () => { fires.a += 1; } });
    // a MESMA referência de objeto nas duas chamadas (padrão real de site)
    const compartilhado = { x: 100, duration: 1, ease: 'none', paused: true, onComplete: () => { fires.b += 1; } };
    const twB1 = gsap.to('#t6b', compartilhado);
    const twB2 = gsap.to('#t6a', compartilhado);
    const mesmaReferencia = twB1.vars === compartilhado && twB2.vars === compartilhado;
    const mesmoObjetoEntreTweens = twB1.vars === twB2.vars;

    // com a janela aberta em twB1, o twB2 (não seekado) fica silenciado?
    const restore = nulify(twB1.vars);
    twB2.pause(); twB2.time(1, false);      // animação VIZINHA, sem janela própria
    const vizinhoDisparouDurante = fires.b;
    restore();
    twB2.time(0, true); twB2.time(1, false); // depois de restaurar, volta a disparar?
    out.t6_varsPartilhado = {
      mesmaReferencia,
      mesmoObjetoEntreTweens,
      vizinhoDisparouDurante,
      vizinhoDisparouDepois: fires.b - vizinhoDisparouDurante,
      twA: fires.a,
      guardaReferenciaDoAutor: twA.vars !== undefined,
    };
  }

  // ---- T7 — timeline ANINHADA (timeline dentro de timeline) ---------------
  // T3 provou a descendência com filhos DIRETOS. O clone real aninha. Se
  // `getChildren(true,true,true)` não alcançar o neto, a janela vaza justamente
  // na estrutura mais comum.
  {
    const fires = { pai: 0, meio: 0, neto: 0, netoUpdate: 0 };
    const drawn = { v: -1 };
    const pai = gsap.timeline({ paused: true, onComplete: () => { fires.pai += 1; } });
    const meio = gsap.timeline({ onComplete: () => { fires.meio += 1; } });
    meio.to('#t7c', {
      x: 100, duration: 1, ease: 'none',
      onComplete: () => { fires.neto += 1; },
      onUpdate: () => { fires.netoUpdate += 1; drawn.v = Number(gsap.getProperty('#t7c', 'x')); },
    });
    pai.add(meio);

    const kids = pai.getChildren(true, true, true);
    const alcancaNeto = kids.some((k) => {
      try { return (k.targets?.() || []).some((t) => t && t.id === 't7c'); } catch (_) { return false; }
    });

    // CONTROLE: com tudo ligado, o neto dispara?
    pai.pause(); pai.time(1, false);
    const controle = { ...fires };

    // agora a janela sobre pai + tudo que getChildren alcança
    pai.time(0, true);
    const antes = { ...fires };
    const restores = [nulify(pai.vars), ...kids.map((k) => nulify(k.vars))];
    try { pai.time(1, false); } finally { restores.forEach((f) => f()); }
    out.t7_aninhada = {
      filhosAlcancados: kids.length,
      alcancaNeto,
      controle,
      netoNaJanela: fires.neto - antes.neto,
      meioNaJanela: fires.meio - antes.meio,
      paiNaJanela: fires.pai - antes.pai,
      netoDesenhouNaJanela: fires.netoUpdate - antes.netoUpdate,
    };
  }

  // ---- T8 — callback herdado por `defaults` da timeline -------------------
  // `gsap.timeline({ defaults: { onComplete } })`: o callback do autor mora no
  // `defaults` do PAI. Se o GSAP só o resolve na hora (sem copiar para a `vars`
  // do filho), nular a `vars` do filho não alcança nada — e a janela falha num
  // idioma de autoria corriqueiro.
  {
    const fires = { filho: 0 };
    const tl = gsap.timeline({ paused: true, defaults: { onComplete: () => { fires.filho += 1; } } });
    tl.to('#t8a', { x: 100, duration: 1, ease: 'none' });
    const filho = tl.getChildren(true, true, true)[0];
    const copiadoParaOFilho = typeof filho?.vars?.onComplete === 'function';

    tl.pause(); tl.time(1, false);
    const controle = fires.filho;

    tl.time(0, true);
    const antes = fires.filho;
    const restores = [nulify(tl.vars), ...tl.getChildren(true, true, true).map((k) => nulify(k.vars))];
    try { tl.time(1, false); } finally { restores.forEach((f) => f()); }
    out.t8_defaults = {
      copiadoParaOFilho,
      controle,
      naJanela: fires.filho - antes,
      defaultsIntactoDepois: typeof tl.vars?.defaults?.onComplete,
    };
  }

  return out;
});

// ---- T9 — a vizinha tocando no TICKER REAL, não por escrita manual ---------
// O T6 mediu o vazamento de `vars` partilhado com uma escrita manual de relógio
// na vizinha. O cenário real é outro: a vizinha está TOCANDO sozinha enquanto o
// usuário arrasta a barra. Se o disparo no caminho do ticker não lesse `vars` na
// hora, o T6 estaria medindo um caminho que não é o do usuário.
const t9 = await page.evaluate(async () => {
  const espera = (ms) => new Promise((res) => setTimeout(res, ms));
  const rodada = async (comJanela) => {
    const fires = { v: 0 };
    const cfg = { x: 100, duration: 0.25, ease: 'none', onComplete: () => { fires.v += 1; } };
    const vizinha = gsap.to(comJanela ? '#t9a' : '#t9b', cfg);   // TOCANDO no ticker
    const seekada = gsap.to(comJanela ? '#t9c' : '#t9d', cfg);   // MESMO objeto `vars`
    seekada.pause();
    const partilha = vizinha.vars === seekada.vars;
    let saved = null;
    if (comJanela) {
      saved = ['onStart', 'onComplete', 'onRepeat'].map((k) => [k, seekada.vars[k]]);
      ['onStart', 'onComplete', 'onRepeat'].forEach((k) => { seekada.vars[k] = undefined; });
    }
    await espera(600);                       // a vizinha termina AQUI, sozinha
    const durante = fires.v;
    if (saved) saved.forEach(([k, v]) => { seekada.vars[k] = v; });
    return { partilha, durante };
  };
  const controle = await rodada(false);
  const teste = await rodada(true);
  return { controle, teste };
});
Object.assign(r, { t9_vizinhaNoTicker: t9 });

await browser.close();
console.log(JSON.stringify(r, null, 2));

const f = [];
const t1 = r.t1_controle;
if (!(t1.paiComplete > 0 && t1.aComplete > 0 && t1.bComplete > 0)) {
  f.push(`CONTROLE CEGO: nem tudo dispara no caminho de hoje — ${JSON.stringify(t1)}`);
}
if (!(t1.drawn.a > 0 && t1.drawn.b > 0)) f.push('CONTROLE CEGO: o desenho dos filhos não foi observado nem com tudo ligado');

const t2 = r.t2_soFachada;
if (t2.paiComplete !== 0) f.push('janela na fachada não silenciou nem a própria fachada');
const filhosVazaram = t2.aComplete > 0 || t2.bComplete > 0 || t2.aStart > 0 || t2.bStart > 0;

const t3 = r.t3_comDescendencia;
if (t3.paiComplete !== 0 || t3.aComplete !== 0 || t3.bComplete !== 0 || t3.aStart !== 0 || t3.bStart !== 0) {
  f.push(`cobrir a descendência NÃO silenciou tudo — ${JSON.stringify(t3)}`);
}
if (!t3.preRenderMoveu) f.push('T3: o PRÉ-RENDER não moveu o alvo — o zero da janela seria vácuo (lazy-init)');
if (!r.t5_staggerSoFachada.preRenderMoveu) f.push('T5: o PRÉ-RENDER não moveu o alvo — zero vácuo');
if (!(t3.aUpdate > 0 && t3.drawn.a > 0)) f.push('com a descendência coberta o DESENHO dos filhos parou — a regra quebraria o clone');

const t4 = r.t4_staggerControle;
if (!(t4.complete > 0)) f.push('CONTROLE do stagger vácuo: a fachada não disparou onComplete nem hoje');

console.log('\n--- LEITURA ---');
console.log(`B3: com a janela SÓ na fachada, os filhos da timeline ${filhosVazaram ? 'VAZARAM' : 'ficaram silenciosos'} — aStart=${t2.aStart} aComplete=${t2.aComplete} bStart=${t2.bStart} bComplete=${t2.bComplete}`);
console.log(`stagger: timeline interna=${t4.temTimelineInterna}, filhos=${t4.filhos}, filhos com callback próprio=${t4.filhosComCallbackProprio}`);
console.log(`stagger com janela só na fachada: start=${r.t5_staggerSoFachada.start} complete=${r.t5_staggerSoFachada.complete} update=${r.t5_staggerSoFachada.update} desenhou=${r.t5_staggerSoFachada.drawnUltimoAlvo}`);
console.log(`vars partilhado: mesma referência=${r.t6_varsPartilhado.mesmaReferencia}, mesmo objeto entre tweens=${r.t6_varsPartilhado.mesmoObjetoEntreTweens}, vizinho disparou DURANTE a janela=${r.t6_varsPartilhado.vizinhoDisparouDurante}, depois=${r.t6_varsPartilhado.vizinhoDisparouDepois}`);
const t7 = r.t7_aninhada, t8 = r.t8_defaults;
if (!(t7.controle.neto > 0)) f.push('T7 CONTROLE VÁCUO: o neto não disparou nem com tudo ligado');
if (t7.netoNaJanela !== 0) f.push(`janela NÃO alcança o NETO da timeline aninhada (disparou ${t7.netoNaJanela}×)`);
if (!(t7.netoDesenhouNaJanela > 0)) f.push('o neto parou de DESENHAR dentro da janela');
if (!(t8.controle > 0)) f.push('T8 CONTROLE VÁCUO: o callback herdado por defaults não disparou nem com tudo ligado');
if (t8.naJanela !== 0) f.push(`callback herdado por \`defaults\` ESCAPA da janela (disparou ${t8.naJanela}×)`);
console.log(`aninhada: alcança o neto=${t7.alcancaNeto}, filhos alcançados=${t7.filhosAlcancados}`);
console.log(`defaults: copiado para a vars do filho=${t8.copiadoParaOFilho}, na janela=${t8.naJanela}, defaults do pai depois=${t8.defaultsIntactoDepois}`);
if (!r.t9_vizinhaNoTicker.controle.partilha) f.push('T9 VÁCUO: as duas animações não chegaram a partilhar o mesmo objeto vars');
else if (r.t9_vizinhaNoTicker.controle.durante !== 1) f.push(`T9 CONTROLE CEGO: sem janela, a vizinha no ticker não completou (durante=${r.t9_vizinhaNoTicker.controle.durante})`);
console.log(`vizinha NO TICKER: sem janela disparou ${r.t9_vizinhaNoTicker.controle.durante}, com a janela na OUTRA animação disparou ${r.t9_vizinhaNoTicker.teste.durante}`);
console.log(f.length ? `\n${f.length} PROBLEMA(S):\n- ${f.join('\n- ')}` : '\nsem falha de instrumento — ler a seção acima');
process.exit(f.length ? 1 : 0);
