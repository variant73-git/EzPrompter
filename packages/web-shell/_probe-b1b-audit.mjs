// PROBE B1b — os achados da auditoria do Sol, cada um medido no GSAP 3.15 real.
//
// Contexto: o finding "Tabela B medida" foi auditado e o Sol apontou que vários
// vereditos meus cobriam MAIS do que os probes montaram. Cada caso aqui existe
// para confirmar ou derrubar um achado ESPECÍFICO dele — nenhum é decorativo.
//
// A1/A2/A3 → achado 1: `= undefined` não restaura idêntico quando a chave NÃO
//            existia (a atribuição CRIA propriedade própria) nem quando o
//            callback é HERDADO (cria sombra própria).
// B1/B2    → achado 2: o veredito "idem" no caso já renderizado não vale para
//            onStart/onRepeat, e o onRepeat foi medido por `totalTime()`
//            enquanto o bridge chama `time()`.
// C1       → achado 2/3: o C5 forçou `reverse()`; medir a forma do call-site.
// D1       → achado 2: o site pode trocar o próprio callback DENTRO da janela
//            (via `eventCallback`) e o `finally` o sobrescreve.
// E1       → achado 5: stagger em forma de OBJETO pode dar callback próprio aos
//            filhos — a conclusão "o ciclo de vida é só da fachada" foi tirada
//            de `stagger: 0.2`.
// F1       → achado 5: tween de duração ZERO (`.set()`) dentro da timeline.
// G1       → achado 4: o vazamento de `vars` partilhado só é dano se o vizinho
//            avançar DENTRO da janela síncrona — rota reentrante real.
// H1       → achado 5: a travessia a partir de uma FACHADA de tween (stagger)
//            não é `getChildren` — é preciso passar por `.timeline`.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const GSAP = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js';
const gsapSrc = readFileSync(GSAP, 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(
  ['a1', 'a2', 'a3', 'b1', 'b1c', 'b2', 'b2c', 'c1', 'c1c', 'd1', 'e1a', 'e1b', 'f1a', 'f1b', 'g1a', 'g1b', 'h1a', 'h1b']
    .map((id) => `<div id="${id}"></div>`).join('')
);
await page.addScriptTag({ content: gsapSrc });

const r = await page.evaluate(() => {
  const LIFECYCLE = ['onStart', 'onComplete', 'onRepeat'];
  const out = {};

  // A janela INGÊNUA que o finding propunha: atribui `undefined` a todas as três.
  const janelaIngenua = (vars, body) => {
    const saved = LIFECYCLE.map((k) => [k, vars[k]]);
    LIFECYCLE.forEach((k) => { vars[k] = undefined; });
    try { body(); } finally { saved.forEach(([k, v]) => { vars[k] = v; }); }
  };

  // A janela CORRIGIDA pelo achado 1: só toca no que EXISTE como propriedade
  // PRÓPRIA, e desfaz qualquer sombra que ela mesma tenha criado.
  const janelaCorrigida = (vars, body) => {
    const saved = LIFECYCLE.map((k) => ({
      k,
      tinhaPropria: Object.prototype.hasOwnProperty.call(vars, k),
      desc: Object.getOwnPropertyDescriptor(vars, k),
      herdado: !Object.prototype.hasOwnProperty.call(vars, k) && typeof vars[k] === 'function',
    }));
    saved.forEach(({ k, tinhaPropria, herdado }) => {
      if (tinhaPropria || herdado) vars[k] = undefined;   // sombra proposital no herdado
    });
    try {
      body();
    } finally {
      saved.forEach(({ k, tinhaPropria, desc }) => {
        if (tinhaPropria) Object.defineProperty(vars, k, desc);
        else delete vars[k];                              // remove a sombra criada
      });
    }
  };

  const forma = (vars) => ({
    keys: Object.keys(vars),
    forIn: (() => { const a = []; for (const k in vars) a.push(k); return a; })(),
    proprias: LIFECYCLE.map((k) => Object.prototype.hasOwnProperty.call(vars, k)),
    tipos: LIFECYCLE.map((k) => typeof vars[k]),
  });

  // ---- A1 — chave AUSENTE: a janela ingênua CRIA propriedade própria? ------
  {
    const fires = { c: 0 };
    // sem `onRepeat` e sem `onStart` — só onComplete/onUpdate, como um site comum
    const tw = gsap.to('#a1', {
      x: 100, duration: 1, ease: 'none', paused: true,
      onUpdate: () => {}, onComplete: () => { fires.c += 1; },
    });
    tw.pause();
    const antes = forma(tw.vars);
    janelaIngenua(tw.vars, () => { tw.time(1, false); });
    const depois = forma(tw.vars);
    out.a1_chaveAusente = {
      antes, depois,
      keysIguais: JSON.stringify(antes.keys) === JSON.stringify(depois.keys),
      forInIgual: JSON.stringify(antes.forIn) === JSON.stringify(depois.forIn),
      criouPropriedade: depois.proprias.filter(Boolean).length > antes.proprias.filter(Boolean).length,
    };
  }

  // ---- A2 — callback HERDADO pelo protótipo -------------------------------
  // A frente já sabe (item 170) que o GSAP processa herdadas enumeráveis via
  // for..in. Aqui: o herdado dispara? e a janela ingênua cria sombra própria?
  {
    const fires = { c: 0 };
    const proto = { onComplete: () => { fires.c += 1; } };
    const varsHerdado = Object.create(proto);
    Object.assign(varsHerdado, { x: 100, duration: 1, ease: 'none', paused: true });
    const tw = gsap.to('#a2', varsHerdado);
    tw.pause();
    tw.time(1, false);
    const herdadoDispara = fires.c;                 // CONTROLE
    tw.time(0, true); const antesFires = fires.c;
    const antes = forma(tw.vars);
    janelaIngenua(tw.vars, () => { tw.time(1, false); });
    const depois = forma(tw.vars);
    out.a2_herdado = {
      herdadoDispara,
      naJanela: fires.c - antesFires,
      antesPropria: antes.proprias, depoisPropria: depois.proprias,
      forInIgual: JSON.stringify(antes.forIn) === JSON.stringify(depois.forIn),
      antesForIn: antes.forIn, depoisForIn: depois.forIn,
    };
  }

  // ---- A3 — a janela CORRIGIDA restaura a forma nos dois casos? ------------
  {
    const semRepeat = gsap.to('#a3', {
      x: 100, duration: 1, ease: 'none', paused: true,
      onUpdate: () => {}, onComplete: () => {},
    });
    semRepeat.pause();
    const antes = forma(semRepeat.vars);
    janelaCorrigida(semRepeat.vars, () => { semRepeat.time(1, false); });
    const depois = forma(semRepeat.vars);

    const protoFires = { c: 0 };
    const proto = { onComplete: () => { protoFires.c += 1; } };
    const varsH = Object.create(proto);
    Object.assign(varsH, { x: 100, duration: 1, ease: 'none', paused: true });
    const comHerdado = gsap.to('#a3', varsH);
    comHerdado.pause();
    const hAntes = forma(comHerdado.vars);
    let disparouNaJanela = 0;
    janelaCorrigida(comHerdado.vars, () => {
      const base = protoFires.c; comHerdado.time(1, false); disparouNaJanela = protoFires.c - base;
    });
    const hDepois = forma(comHerdado.vars);

    out.a3_janelaCorrigida = {
      ausente: {
        keysIguais: JSON.stringify(antes.keys) === JSON.stringify(depois.keys),
        forInIgual: JSON.stringify(antes.forIn) === JSON.stringify(depois.forIn),
        propriasIguais: JSON.stringify(antes.proprias) === JSON.stringify(depois.proprias),
      },
      herdado: {
        silenciou: disparouNaJanela === 0,
        forInIgual: JSON.stringify(hAntes.forIn) === JSON.stringify(hDepois.forIn),
        propriasIguais: JSON.stringify(hAntes.proprias) === JSON.stringify(hDepois.proprias),
        aindaHerdaFuncao: typeof comHerdado.vars.onComplete,
      },
    };
  }

  // ---- B1 — onRepeat pelo caminho do bridge (`time`) vs `totalTime` --------
  {
    const mkRep = (sel) => {
      const fires = { r: 0 };
      const tw = gsap.to(sel, { x: 100, duration: 1, ease: 'none', paused: true, repeat: 2, onRepeat: () => { fires.r += 1; }, onUpdate: () => {} });
      tw.pause();
      return { tw, fires };
    };
    // CONTROLE por `time()` — o bridge chama time(), não totalTime()
    const ctl = mkRep('#b1c');
    for (let i = 1; i <= 30; i += 1) ctl.tw.time((i / 10) % 1.0001, false);
    const porTime = ctl.fires.r;
    // e por totalTime, para comparar
    const ctl2 = mkRep('#b1');
    ctl2.tw.totalTime(1.5, false);
    const porTotalTime = ctl2.fires.r;
    out.b1_repeatPorTime = { porTime, porTotalTime };
  }

  // ---- B2 — onStart no caso JÁ RENDERIZADO, cruzando a própria fronteira ---
  // O achado: no C9 o onStart já tinha disparado antes da janela, então o zero
  // dentro dela não provava supressão. Aqui o tween é levado de volta a 0 (com
  // supressão) e a janela cobre a travessia 0→frente, onde o onStart dispara.
  {
    const mkS = (sel) => {
      const fires = { s: 0 };
      const tw = gsap.to(sel, { x: 100, duration: 1, ease: 'none', paused: true, onStart: () => { fires.s += 1; }, onUpdate: () => {} });
      tw.pause(); tw.time(0.4, false);          // renderiza: inicializa e dispara onStart
      tw.time(0, true); tw.invalidate();         // volta ao começo em silêncio
      return { tw, fires };
    };
    const ctl = mkS('#b2c'); const antesCtl = ctl.fires.s;
    ctl.tw.time(0.5, false);
    const controle = ctl.fires.s - antesCtl;     // CONTROLE: o onStart volta a disparar?

    const t = mkS('#b2'); const antesT = t.fires.s;
    janelaIngenua(t.tw.vars, () => { t.tw.time(0.5, false); });
    out.b2_onStartJaRenderizado = { controle, naJanela: t.fires.s - antesT };
  }

  // ---- C1 — onReverseComplete pela FORMA DO CALL-SITE (sem reverse()) -----
  // O C5 chamou `reverse()`. O bridge chama `pause?.()` + `time?.(v,false)`.
  // Duas perguntas: (i) um tween NÃO revertido dispara onReverseComplete ao
  // seekar para 0? (ii) e um que o SITE deixou revertido?
  {
    const mkR = (sel) => {
      const fires = { rc: 0 };
      const tw = gsap.to(sel, { x: 100, duration: 1, ease: 'none', paused: true, onReverseComplete: () => { fires.rc += 1; }, onUpdate: () => {} });
      return { tw, fires };
    };
    const a = mkR('#c1');
    a.tw.pause(); a.tw.time(0.5, false); a.tw.time(0, false);      // forma do call-site, SEM reverse
    const semReverse = a.fires.rc;

    const b = mkR('#c1c');
    b.tw.time(0.5, false); b.tw.reverse();                          // o SITE reverteu
    b.tw.pause(); b.tw.time(0, false);                              // forma do call-site
    const siteRevertido = b.fires.rc;
    out.c1_reverseCompleteNoCallSite = { semReverse, siteRevertido };
  }

  // ---- D1 — o site troca o PRÓPRIO callback dentro da janela --------------
  {
    const originais = { antiga: 0, nova: 0 };
    const antiga = () => { originais.antiga += 1; };
    const tw = gsap.to('#d1', {
      x: 100, duration: 1, ease: 'none', paused: true,
      onComplete: antiga,
      onUpdate: function () {
        // o site decide, no meio do render, trocar o próprio onComplete
        if (this.__trocou) return; this.__trocou = true;
        tw.eventCallback('onComplete', () => { originais.nova += 1; });
      },
    });
    tw.pause();
    janelaIngenua(tw.vars, () => { tw.time(0.5, false); });
    out.d1_siteTrocaDentroDaJanela = {
      eventCallbackEscreveEmVars: true,
      depoisDaJanela: tw.vars.onComplete === antiga ? 'a ANTIGA foi restaurada por cima' : 'a nova do site sobreviveu',
    };
  }

  // ---- E1 — stagger em forma de OBJETO com callback ------------------------
  {
    const fires = { fachada: 0, filhos: 0 };
    const tw = gsap.to(['#e1a', '#e1b'], {
      x: 100, duration: 0.5, ease: 'none', paused: true,
      stagger: { each: 0.2, onComplete: () => { fires.filhos += 1; } },
      onComplete: () => { fires.fachada += 1; },
      onUpdate: () => {},
    });
    const kids = tw.timeline ? tw.timeline.getChildren(true, true, true) : [];
    const filhosComCallbackProprio = kids.filter((k) => typeof k.vars?.onComplete === 'function').length;
    tw.pause(); tw.time(tw.duration(), false);      // CONTROLE: tudo ligado
    const controle = { ...fires };

    // agora a janela SÓ NA FACHADA — o que o desenho faria se acreditasse no T4
    tw.time(0, true);
    const antes = { ...fires };
    janelaIngenua(tw.vars, () => { tw.time(tw.duration(), false); });
    out.e1_staggerObjeto = {
      filhos: kids.length,
      filhosComCallbackProprio,
      controle,
      fachadaNaJanela: fires.fachada - antes.fachada,
      filhosNaJanela: fires.filhos - antes.filhos,
    };
  }

  // ---- F1 — tween de duração ZERO (`.set()`) dentro da timeline ------------
  {
    const fires = { set: 0 };
    const tl = gsap.timeline({ paused: true });
    tl.set('#f1a', { x: 50, onComplete: () => { fires.set += 1; } });
    tl.to('#f1b', { x: 100, duration: 1, ease: 'none', onUpdate: () => {} });
    const kids = tl.getChildren(true, true, true);
    const zeroNoTraversal = kids.some((k) => finiteDur(k) === 0);
    function finiteDur(k) { try { return Number(k.duration()); } catch (_) { return NaN; } }
    tl.pause(); tl.time(0.5, false);
    const controle = fires.set;
    tl.time(0, true);
    const antes = fires.set;
    const restores = kids.map((k) => {
      const saved = LIFECYCLE.map((x) => [x, k.vars[x]]);
      LIFECYCLE.forEach((x) => { if (Object.prototype.hasOwnProperty.call(k.vars, x)) k.vars[x] = undefined; });
      return () => saved.forEach(([x, v]) => { if (v !== undefined) k.vars[x] = v; });
    });
    try { tl.time(0.5, false); } finally { restores.forEach((f) => f()); }
    out.f1_duracaoZero = { filhos: kids.length, zeroNoTraversal, controle, naJanela: fires.set - antes };
  }

  // ---- G1 — vizinho avançando DENTRO da janela síncrona (rota reentrante) --
  // O achado 4 do Sol: como a janela é síncrona, o ticker não intercala. O dano
  // só existe se o vizinho for avançado de dentro da própria janela — por
  // exemplo pelo `onUpdate` do site, que roda lá dentro por desenho.
  {
    const fires = { vizinho: 0 };
    const cfg = { x: 100, duration: 1, ease: 'none', paused: true, onComplete: () => { fires.vizinho += 1; } };
    const vizinho = gsap.to('#g1b', cfg);       // MESMO objeto `vars`
    const alvo = gsap.to('#g1a', cfg);
    const partilha = vizinho.vars === alvo.vars;

    // CONTROLE: sem janela, o site avançando o vizinho de dentro do onUpdate
    // faz o vizinho completar normalmente?
    let armado = false;
    cfg.onUpdate = () => { if (armado) { armado = false; vizinho.time(1, false); } };
    alvo.pause(); vizinho.pause();
    armado = true; alvo.time(0.5, false);
    const controle = fires.vizinho;

    vizinho.time(0, true); const antes = fires.vizinho;
    armado = true;
    janelaIngenua(alvo.vars, () => { alvo.time(0.6, false); });
    out.g1_vizinhoReentrante = { partilha, controle, naJanela: fires.vizinho - antes };
  }

  // ---- H1 — travessia a partir de uma FACHADA de tween --------------------
  {
    const tw = gsap.to(['#h1a', '#h1b'], { x: 100, duration: 0.5, paused: true, stagger: 0.2, onUpdate: () => {} });
    out.h1_travessiaDaFachada = {
      fachadaTemGetChildren: typeof tw.getChildren === 'function',
      temTimeline: !!tw.timeline,
      viaTimeline: tw.timeline && typeof tw.timeline.getChildren === 'function'
        ? tw.timeline.getChildren(true, true, true).length : null,
    };
  }

  return out;
});

await browser.close();
console.log(JSON.stringify(r, null, 2));

const f = [];
const nota = [];

if (r.a1_chaveAusente.criouPropriedade || !r.a1_chaveAusente.forInIgual) {
  nota.push(`ACHADO 1 CONFIRMADO: chave ausente vira propriedade própria com \`= undefined\` — for-in antes ${JSON.stringify(r.a1_chaveAusente.antes.forIn)} / depois ${JSON.stringify(r.a1_chaveAusente.depois.forIn)}`);
} else nota.push('achado 1 (chave ausente) NÃO reproduzido');

if (r.a2_herdado.herdadoDispara > 0) {
  nota.push(`ACHADO 1 (herdado) CONFIRMADO em parte: callback herdado DISPARA (${r.a2_herdado.herdadoDispara}), silenciado na janela=${r.a2_herdado.naJanela === 0}, sombra própria criada=${JSON.stringify(r.a2_herdado.depoisPropria)}`);
} else nota.push('callback herdado NÃO dispara neste GSAP — a sub-hipótese cai');

const a3 = r.a3_janelaCorrigida;
if (!(a3.ausente.forInIgual && a3.ausente.propriasIguais && a3.herdado.forInIgual && a3.herdado.propriasIguais)) {
  f.push(`a janela CORRIGIDA ainda não restaura a forma: ${JSON.stringify(a3)}`);
} else nota.push(`janela corrigida (hasOwn + defineProperty + delete da sombra) restaura a forma nos dois casos; herdado silenciado=${a3.herdado.silenciou}`);

nota.push(`onRepeat: por time()=${r.b1_repeatPorTime.porTime}, por totalTime()=${r.b1_repeatPorTime.porTotalTime}`);
nota.push(`onStart já-renderizado: controle=${r.b2_onStartJaRenderizado.controle}, na janela=${r.b2_onStartJaRenderizado.naJanela}`);
nota.push(`onReverseComplete na forma do call-site: sem reverse=${r.c1_reverseCompleteNoCallSite.semReverse}, site revertido=${r.c1_reverseCompleteNoCallSite.siteRevertido}`);
nota.push(`site trocando o próprio callback na janela: ${r.d1_siteTrocaDentroDaJanela.depoisDaJanela}`);
nota.push(`stagger OBJETO: filhos=${r.e1_staggerObjeto.filhos}, com callback próprio=${r.e1_staggerObjeto.filhosComCallbackProprio}, controle=${JSON.stringify(r.e1_staggerObjeto.controle)}, filhos na janela só-fachada=${r.e1_staggerObjeto.filhosNaJanela}`);
nota.push(`duração zero: no traversal=${r.f1_duracaoZero.zeroNoTraversal}, controle=${r.f1_duracaoZero.controle}, na janela=${r.f1_duracaoZero.naJanela}`);
nota.push(`vizinho reentrante: partilha=${r.g1_vizinhoReentrante.partilha}, controle=${r.g1_vizinhoReentrante.controle}, na janela=${r.g1_vizinhoReentrante.naJanela}`);
nota.push(`travessia da fachada: getChildren na fachada=${r.h1_travessiaDaFachada.fachadaTemGetChildren}, via .timeline=${r.h1_travessiaDaFachada.viaTimeline}`);

if (r.b2_onStartJaRenderizado.controle === 0) f.push('B2 CONTROLE VÁCUO: o onStart não voltou a disparar nem sem janela — a travessia não foi montada');
if (r.e1_staggerObjeto.controle.filhos === 0 && r.e1_staggerObjeto.filhosComCallbackProprio > 0) f.push('E1 CONTROLE VÁCUO: os filhos têm callback mas não dispararam nem com tudo ligado');
if (r.f1_duracaoZero.controle === 0) f.push('F1 CONTROLE VÁCUO: o tween de duração zero não disparou nem com tudo ligado');
if (r.g1_vizinhoReentrante.controle === 0) f.push('G1 CONTROLE VÁCUO: o vizinho não completou nem sem janela — o hazard não foi montado');

console.log(`\n--- LEITURA ---\n- ${nota.join('\n- ')}`);
console.log(f.length ? `\n${f.length} PROBLEMA(S) DE INSTRUMENTO:\n- ${f.join('\n- ')}` : '\nsem falha de instrumento');
process.exit(f.length ? 1 : 0);
