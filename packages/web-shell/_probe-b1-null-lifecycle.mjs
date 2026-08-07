// PROBE B1 (+ B2 parcial) — o mecanismo do caminho escolhido.
//
// Hipótese B1: anular `vars.onStart` / `vars.onComplete` / `vars.onRepeat` de um
// tween JÁ INSTANCIADO impede esses callbacks de disparar no seek, enquanto o
// `onUpdate` continua rodando e DESENHANDO.
//
// Motivo concreto de desconfiança (handoff §3): sabe-se que o GSAP guarda cópia
// interna do `onUpdate` (`_onUpdate`). Se guardar dos outros também, o método cai.
//
// Hipótese B2 (parcial, aqui): a restauração devolve `vars` com as MESMAS chaves,
// na MESMA ordem, com a MESMA identidade de função e os MESMOS descritores.
//
// Regras da frente honradas aqui:
// - elemento PRÓPRIO por caso (nada de "verde vácuo" comparando 100 com 100);
// - controle de sensibilidade POR CALLBACK (provar que o instrumento enxerga
//   cada um dos três por um caminho conhecido antes de acreditar num zero);
// - controle de sensibilidade do DESENHO (provar que o instrumento detecta o
//   desenho parado, senão "desenhou" não vale nada);
// - medir também o que o desenho NÃO listou (onReverseComplete), porque o scrub
//   anda pra trás o tempo todo.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const GSAP = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js';
const gsapSrc = readFileSync(GSAP, 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(
  '<div id="ctl"></div><div id="c1"></div><div id="c2"></div><div id="c3"></div>' +
  '<div id="c4a"></div><div id="c4b"></div><div id="c12"></div><div id="c13"></div><div id="c5a"></div><div id="c5b"></div><div id="c6"></div>' +
  '<div id="c7"></div><div id="c8"></div><div id="c9"></div><div id="c10"></div><div id="c11"></div>'
);
await page.addScriptTag({ content: gsapSrc });

const r = await page.evaluate(() => {
  // ---- utilitários -------------------------------------------------------
  // Um tween cujo DESENHO vive dentro do onUpdate (padrão A5: sequência de
  // quadros). `drawn` só avança se o onUpdate rodar.
  const mk = (sel, extra = {}) => {
    const fires = { onStart: 0, onUpdate: 0, onComplete: 0, onRepeat: 0, onReverseComplete: 0 };
    // `drawn` = ÚLTIMO valor desenhado; `drawnMax` = maior já desenhado. O
    // último pode voltar a 0 legitimamente (seek pra trás) — usar só ele como
    // controle produz "instrumento cego" falso.
    const state = { drawn: -1, drawnMax: -1 };
    const tw = gsap.to(sel, {
      x: 100, duration: 1, ease: 'none', paused: true,
      onStart: () => { fires.onStart += 1; },
      onUpdate: () => {
        fires.onUpdate += 1;
        state.drawn = Number(gsap.getProperty(sel, 'x'));
        if (state.drawn > state.drawnMax) state.drawnMax = state.drawn;
      },
      onComplete: () => { fires.onComplete += 1; },
      onRepeat: () => { fires.onRepeat += 1; },
      onReverseComplete: () => { fires.onReverseComplete += 1; },
      ...extra,
    });
    return { tw, fires, state };
  };

  // A janela PROPOSTA pelo desenho, nas duas formas de anular que existem.
  // `delete` remove a chave; `= undefined` mantém a chave. As duas precisam ser
  // medidas: a forma escolhida muda o que a restauração tem que devolver (B2).
  const LIFECYCLE = ['onStart', 'onComplete', 'onRepeat'];
  const janela = (tw, modo, body) => {
    const saved = LIFECYCLE.map((k) => [k, tw.vars[k]]);
    if (modo === 'delete') LIFECYCLE.forEach((k) => { delete tw.vars[k]; });
    else LIFECYCLE.forEach((k) => { tw.vars[k] = undefined; });
    try { body(); } finally { saved.forEach(([k, v]) => { tw.vars[k] = v; }); }
  };

  const snapVars = (vars) => ({
    keys: Object.keys(vars),
    desc: LIFECYCLE.map((k) => {
      const d = Object.getOwnPropertyDescriptor(vars, k);
      return d ? { k, has: true, w: d.writable, e: d.enumerable, c: d.configurable, t: typeof d.value } : { k, has: false };
    }),
    ids: LIFECYCLE.map((k) => vars[k]),
  });

  const out = {};

  // ---- CONTROLE DE SENSIBILIDADE POR CALLBACK ----------------------------
  // Sem isto, "0 disparos" no caso nulado poderia ser callback que nunca
  // funciona. Caminho conhecido: reprodução natural até o fim, com repeat.
  {
    const c = mk('#ctl', { repeat: 1 });
    c.tw.progress(1);            // avança natural: onStart, onUpdate, onRepeat
    c.tw.totalProgress(1);       // chega ao fim total: onComplete
    c.tw.reverse(); c.tw.totalTime(0); // volta ao começo: onReverseComplete
    out.controleCallbacks = { ...c.fires, desenhou: c.state.drawnMax > 0, drawnFinal: c.state.drawn };
  }

  // ---- C1 — o caminho de HOJE (eventos ligados, vars intactas) ------------
  // Reprodução do defeito DENTRO deste instrumento (não herdar do probe antigo).
  {
    const c = mk('#c1');
    c.tw.pause();
    for (let i = 1; i <= 10; i += 1) c.tw.time(i / 10, false);
    out.c1_hoje = { ...c.fires, drawn: c.state.drawn };
  }

  // ---- C2 — janela por `delete`, seek com EVENTOS LIGADOS -----------------
  // ⚠️ PRÉ-RENDER SUPRIMIDO antes da janela: o GSAP inicializa lazy, e abrir a
  // janela num tween nunca renderizado faria o zero provar "inicializou sem
  // callback" em vez de supressão (bloqueador r3 do Sol, aplicado à classe).
  // Suprimido para não sujar as contagens; `preRenderMoveu` prova que houve
  // render de verdade.
  {
    const c = mk('#c2');
    c.tw.pause();
    c.tw.time(0.05, true);
    const preRenderMoveu = Number(gsap.getProperty('#c2', 'x')) > 0;
    const antes = snapVars(c.tw.vars);
    janela(c.tw, 'delete', () => {
      for (let i = 1; i <= 10; i += 1) c.tw.time(i / 10, false);
    });
    const depois = snapVars(c.tw.vars);
    out.c2_delete = {
      preRenderMoveu,
      ...c.fires,
      drawn: c.state.drawn,
      restauro: {
        keysIguais: JSON.stringify(antes.keys) === JSON.stringify(depois.keys),
        keysAntes: antes.keys,
        keysDepois: depois.keys,
        identidade: antes.ids.every((f, i) => f === depois.ids[i]),
        descIguais: JSON.stringify(antes.desc) === JSON.stringify(depois.desc),
      },
    };
  }

  // ---- C3 — janela por `= undefined`, seek com EVENTOS LIGADOS ------------
  {
    const c = mk('#c3');
    c.tw.pause();
    c.tw.time(0.05, true);
    const preRenderMoveu = Number(gsap.getProperty('#c3', 'x')) > 0;
    const antes = snapVars(c.tw.vars);
    janela(c.tw, 'undefined', () => {
      for (let i = 1; i <= 10; i += 1) c.tw.time(i / 10, false);
    });
    const depois = snapVars(c.tw.vars);
    out.c3_undefined = {
      preRenderMoveu,
      ...c.fires,
      drawn: c.state.drawn,
      restauro: {
        keysIguais: JSON.stringify(antes.keys) === JSON.stringify(depois.keys),
        keysAntes: antes.keys,
        keysDepois: depois.keys,
        identidade: antes.ids.every((f, i) => f === depois.ids[i]),
        descIguais: JSON.stringify(antes.desc) === JSON.stringify(depois.desc),
      },
    };
  }

  // ---- C4 — onRepeat: precisa do modificador ATIVO e de cruzar a fronteira -
  // ⚠️ TWEEN PRÓPRIO por braço. A 1ª versão media o controle e o teste no MESMO
  // tween (controle na 1ª travessia da fronteira, teste na 2ª, depois de um
  // reset suprimido) — verde path-dependent, a armadilha do item 175.
  {
    const a = mk('#c4a', { repeat: 2 });
    a.tw.pause(); a.tw.totalTime(1.5, false);
    const semJanela = a.fires.onRepeat;

    const b = mk('#c4b', { repeat: 2 });
    b.tw.pause();
    janela(b.tw, 'undefined', () => { b.tw.totalTime(1.5, false); });
    out.c4_repeat = { semJanela, comJanela: b.fires.onRepeat, drawnMax: b.state.drawnMax };
  }

  // ---- C12 — HAZARD de reentrância, medido (não suposto) -------------------
  // O desenho exige contador de profundidade. Aqui se mede o dano da versão
  // INGÊNUA (sem contador) para que a obrigação deixe de ser opinião: o
  // onUpdate do site dispara outro seek DENTRO da janela; a janela interna
  // salva o estado JÁ NULADO e o restaura ao sair, deixando os callbacks do
  // site desligados PARA SEMPRE.
  {
    const c = mk('#c12');
    let reentrou = false;
    c.tw.vars.onUpdate = () => {
      if (reentrou) return;
      reentrou = true;
      janela(c.tw, 'undefined', () => { c.tw.time(0.9, false); }); // seek ANINHADO
    };
    c.tw.pause();
    janela(c.tw, 'undefined', () => { c.tw.time(0.5, false); });
    // depois de tudo fechado, os callbacks do site voltaram?
    const tipos = LIFECYCLE.map((k) => typeof c.tw.vars[k]);
    // e ainda disparam numa reprodução de verdade?
    c.tw.time(0, true); c.tw.vars.onUpdate = () => {};
    c.tw.time(1, false);
    out.c12_reentranciaIngenua = { reentrou, tiposDepois: tipos, completeDepois: c.fires.onComplete };
  }

  // ---- C5 — onReverseComplete: o desenho NÃO lista este callback -----------
  // O scrub anda pra trás. Se o seek pra trás dispara isto, é um buraco do
  // desenho (a lista de três não cobre o ciclo de vida inteiro).
  {
    const a = mk('#c5a');
    a.tw.pause(); a.tw.time(0.5, false); a.tw.reverse(); a.tw.time(0, false);
    const semJanela = a.fires.onReverseComplete;

    const b = mk('#c5b');
    b.tw.pause(); b.tw.time(0.5, false); b.tw.reverse();
    janela(b.tw, 'delete', () => { b.tw.time(0, false); });
    out.c5_reverseComplete = { semJanela, comJanelaDeTres: b.fires.onReverseComplete };
  }

  // ---- C6 — CONTROLE do instrumento de DESENHO -----------------------------
  // Prova que `drawn` sabe ficar parado: com supressão total (o caminho
  // refutado), o desenho derivado do onUpdate não acontece.
  {
    const c = mk('#c6');
    c.tw.pause();
    for (let i = 1; i <= 10; i += 1) c.tw.time(i / 10, true);
    out.c6_controleDesenho = { onUpdate: c.fires.onUpdate, drawn: c.state.drawn };
  }

  // ---- C7 — o GSAP relê `vars` na hora, ou cacheia? -----------------------
  // Teste direto do medo do handoff: TROCAR o callback depois de instanciado.
  // Se o disparo for da função NOVA, o GSAP relê `vars` (anular funciona).
  {
    const c = mk('#c7');
    let novoCompleteRodou = 0;
    c.tw.vars.onComplete = () => { novoCompleteRodou += 1; };
    let novoUpdateRodou = 0;
    c.tw.vars.onUpdate = () => { novoUpdateRodou += 1; };
    c.tw.pause(); c.tw.time(1, false);
    out.c7_releVars = {
      completeOriginal: c.fires.onComplete,
      completeNovo: novoCompleteRodou,
      updateOriginal: c.fires.onUpdate,
      updateNovo: novoUpdateRodou,
    };
  }

  // ---- C8 — o caminho EXATO do bridge (pause?.() + time(v,false)) ---------
  // com a janela em volta. Não medir uma aproximação do call-site.
  {
    const c = mk('#c8');
    janela(c.tw, 'delete', () => {
      c.tw.pause?.();
      c.tw.time?.(Math.max(0, 1000 - 0) / 1000, false);
    });
    out.c8_callSiteReal = { ...c.fires, drawn: c.state.drawn };
  }

  // ---- C13 — a MESMA reentrância, com o estado salvo num SLOT COMPARTILHADO
  // O C12 mostrou que salvar em variável LOCAL por chamada se cura sozinho
  // (a restauração externa é a última a rodar e devolve o original). O hazard
  // real é da implementação que guarda o salvo num slot único do módulo: a
  // janela interna sobrescreve o slot com o estado JÁ NULADO, e as duas
  // restaurações passam a devolver `undefined` — o site fica sem ciclo de vida
  // PARA SEMPRE. Medir os dois para que a obrigação seja precisa em vez de
  // genérica.
  {
    const c = mk('#c13');
    let slot = null;                     // ← o erro: um slot só, do módulo
    const abrir = () => { slot = LIFECYCLE.map((k) => [k, c.tw.vars[k]]); LIFECYCLE.forEach((k) => { c.tw.vars[k] = undefined; }); };
    const fechar = () => { (slot || []).forEach(([k, v]) => { c.tw.vars[k] = v; }); };
    let reentrou = false;
    c.tw.vars.onUpdate = () => {
      if (reentrou) return;
      reentrou = true;
      abrir(); try { c.tw.time(0.9, false); } finally { fechar(); }
    };
    c.tw.pause();
    abrir(); try { c.tw.time(0.5, false); } finally { fechar(); }
    out.c13_reentranciaSlotUnico = {
      reentrou,
      tiposDepois: LIFECYCLE.map((k) => typeof c.tw.vars[k]),
    };
  }

  // ---- C9 — o caso REAL: animação que JÁ RENDERIZOU antes da janela --------
  // Os casos C2/C3/C7 abriram a janela num tween que nunca tinha renderizado.
  // O GSAP inicializa o tween LAZY, no primeiro render — se ele cachear os
  // callbacks nesse momento, anular DEPOIS não teria efeito, e o probe anterior
  // estaria medindo um caso que não é o do usuário (que arrasta a barra de uma
  // animação já em voo).
  {
    const c = mk('#c9');
    c.tw.pause();
    c.tw.time(0.4, false);              // renderiza de verdade, com eventos: inicializa
    const depoisDoPrimeiroRender = { ...c.fires };
    janela(c.tw, 'undefined', () => { c.tw.time(1, false); });
    out.c9_jaRenderizado = {
      primeiroRender: depoisDoPrimeiroRender,
      depoisDaJanela: { ...c.fires },
      completeNaJanela: c.fires.onComplete - depoisDoPrimeiroRender.onComplete,
      updateNaJanela: c.fires.onUpdate - depoisDoPrimeiroRender.onUpdate,
      drawnMax: c.state.drawnMax,
    };
  }

  // ---- C10 — troca de callback DEPOIS do primeiro render (cache lazy?) -----
  {
    const c = mk('#c10');
    c.tw.pause();
    c.tw.time(0.4, false);              // inicializa
    let novoComplete = 0; let novoUpdate = 0;
    c.tw.vars.onComplete = () => { novoComplete += 1; };
    c.tw.vars.onUpdate = () => { novoUpdate += 1; };
    const antes = { ...c.fires };
    c.tw.time(1, false);
    out.c10_trocaDepoisDoRender = {
      completeOriginalNaSegunda: c.fires.onComplete - antes.onComplete,
      completeNovo: novoComplete,
      updateOriginalNaSegunda: c.fires.onUpdate - antes.onUpdate,
      updateNovo: novoUpdate,
    };
  }

  // ---- C11 — a janela de QUATRO (incluindo onReverseComplete) --------------
  // Se C5 mostrar que o seek pra trás dispara onReverseComplete, esta é a
  // resposta pronta: o mesmo mecanismo cobre o quarto callback?
  {
    const c = mk('#c11');
    c.tw.pause(); c.tw.time(0.5, false); c.tw.reverse();
    const saved = ['onStart', 'onComplete', 'onRepeat', 'onReverseComplete'].map((k) => [k, c.tw.vars[k]]);
    saved.forEach(([k]) => { c.tw.vars[k] = undefined; });
    try { c.tw.time(0, false); } finally { saved.forEach(([k, v]) => { c.tw.vars[k] = v; }); }
    out.c11_janelaDeQuatro = { onReverseComplete: c.fires.onReverseComplete, onUpdate: c.fires.onUpdate, drawnMax: c.state.drawnMax };
  }

  return out;
});

await browser.close();
console.log(JSON.stringify(r, null, 2));

const f = [];
const esperado = [];
const ctl = r.controleCallbacks;
if (!(ctl.onStart > 0 && ctl.onUpdate > 0 && ctl.onComplete > 0 && ctl.onRepeat > 0 && ctl.onReverseComplete > 0)) {
  f.push(`CONTROLE CEGO: nem todo callback dispara no caminho natural — ${JSON.stringify(ctl)}`);
}
if (!ctl.desenhou) f.push('CONTROLE CEGO: o instrumento de desenho não registrou nada nem no caminho natural');
if (r.c6_controleDesenho.drawn !== -1) f.push(`CONTROLE DO DESENHO INSENSÍVEL: com supressão total o desenho ainda avançou (drawn=${r.c6_controleDesenho.drawn})`);
if (!(r.c1_hoje.onComplete > 0)) f.push('DEFEITO NÃO REPRODUZIDO neste instrumento: o caminho de hoje não disparou onComplete');

for (const [nome, c] of [['delete', r.c2_delete], ['undefined', r.c3_undefined]]) {
  if (!c.preRenderMoveu) f.push(`${nome}: o PRÉ-RENDER não moveu o alvo — a janela abriria num tween não inicializado e o zero seria vácuo`);
  if (c.onStart !== 0 || c.onComplete !== 0) f.push(`B1 REFUTADA (${nome}): ciclo de vida ainda disparou — onStart=${c.onStart} onComplete=${c.onComplete}`);
  if (!(c.onUpdate > 0)) f.push(`B1 REFUTADA (${nome}): o onUpdate parou de rodar`);
  if (!(c.drawn > 0 && c.drawn <= 100)) f.push(`B1 REFUTADA (${nome}): o desenho derivado não avançou (drawn=${c.drawn})`);
  // O `delete` REFUTAR a restauração idêntica é ACHADO DOCUMENTADO, não falha do
  // probe: a asserção é invertida para que ele passe a falhar se o achado deixar
  // de reproduzir (senão este arquivo sairia com erro para sempre e quem o
  // rerodasse leria como quebrado).
  if (nome === 'delete') {
    if (c.restauro.keysIguais) f.push('ACHADO PERDIDO: `delete` voltou a restaurar a ordem das chaves — o §2 do finding precisa ser revisto');
    else esperado.push(`achado reproduzido: \`delete\` reordena as chaves — ${JSON.stringify(c.restauro.keysAntes)} → ${JSON.stringify(c.restauro.keysDepois)}`);
  } else if (!c.restauro.keysIguais) f.push(`B2 REFUTADA (${nome}): ordem/conjunto de chaves mudou — ${JSON.stringify(c.restauro.keysAntes)} → ${JSON.stringify(c.restauro.keysDepois)}`);
  if (!c.restauro.identidade) f.push(`B2 REFUTADA (${nome}): identidade de função não voltou (===)`);
  if (!c.restauro.descIguais) f.push(`B2 REFUTADA (${nome}): descritores não voltaram idênticos`);
}

if (!(r.c4_repeat.semJanela > 0)) f.push('CONTROLE de onRepeat vácuo: nem sem janela ele disparou (fronteira não foi cruzada)');
else if (r.c4_repeat.comJanela !== 0) f.push(`B1 REFUTADA (onRepeat): ainda disparou com a janela (${r.c4_repeat.comJanela})`);
if (!r.c12_reentranciaIngenua.reentrou) f.push('C12 VÁCUO: a reentrância não chegou a acontecer — o hazard não foi montado');

if (r.c7_releVars.completeNovo === 0 && r.c7_releVars.completeOriginal > 0) {
  f.push('MECANISMO CAI: o GSAP disparou o onComplete ORIGINAL depois de vars.onComplete ter sido trocado — há cache interno');
}

// C9/C10 — o caso do usuário (animação já renderizada) é o que decide.
if (!(r.c9_jaRenderizado.primeiroRender.onUpdate > 0 && r.c9_jaRenderizado.primeiroRender.onStart > 0)) {
  f.push('C9 VÁCUO: o primeiro render não inicializou o tween (nenhum callback antes da janela) — o caso "já renderizado" não foi montado');
}
if (r.c9_jaRenderizado.completeNaJanela !== 0) f.push(`B1 REFUTADA no caso REAL (já renderizado): onComplete disparou ${r.c9_jaRenderizado.completeNaJanela}× dentro da janela`);
if (!(r.c9_jaRenderizado.updateNaJanela > 0)) f.push('B1 REFUTADA no caso REAL: onUpdate não rodou dentro da janela');
if (r.c10_trocaDepoisDoRender.completeOriginalNaSegunda > 0) {
  f.push('CACHE LAZY: depois do primeiro render, o GSAP ainda disparou o onComplete ORIGINAL apesar de vars.onComplete ter sido trocado');
}
if (r.c11_janelaDeQuatro.onReverseComplete !== 0) f.push(`onReverseComplete NÃO é silenciável pela mesma via (disparou ${r.c11_janelaDeQuatro.onReverseComplete}×)`);

console.log('\n--- LEITURA ---');
esperado.forEach((linha) => console.log(`- ${linha}`));
console.log(`onReverseComplete no seek pra trás: sem janela=${r.c5_reverseComplete.semJanela}, com a janela de três=${r.c5_reverseComplete.comJanelaDeTres}`);
console.log(f.length ? `\n${f.length} PROBLEMA(S):\n- ${f.join('\n- ')}` : '\nB1 sustentada neste instrumento (ver leitura acima antes de fechar o desenho)');
process.exit(f.length ? 1 : 0);
