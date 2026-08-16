// PROBE — a porta do ScrollTrigger (handoff 2026-08-10 §2.1).
//
// Pergunta: o scrubber da régua (que rola a PÁGINA, via `scroll-to` →
// `window.scrollTo`) dispara reações de ScrollTrigger do site? O seek silencioso
// não toca nesse caminho — ele cerca `seekTimeline`, não a rolagem.
//
// NÃO é desenho de solução. É medição, antes de qualquer desenho.
//
// Protocolo da frente (cada regra custou rodada de auditoria):
//   - ELEMENTO PRÓPRIO por braço — nunca reusar alvo entre controle e arma;
//   - CONTROLE de sensibilidade por braço: um zero só vale depois de um > 0 na
//     MESMA construção, pela MESMA classe de evento;
//   - o ScrollTrigger atualiza no tick do ticker, não dentro do `scrollTo` — o
//     dano se mede no TICK SEGUINTE, com espera explícita;
//   - `refresh()` antes de medir: sem posições calculadas, um zero prova
//     "não estava armado", não supressão.
//
// Uso: node _probe-scrolltrigger-scrub.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const RAIZ = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0';
const gsapSrc = readFileSync(`${RAIZ}/gsap.min.js`, 'utf8');
const stSrc = readFileSync(`${RAIZ}/ScrollTrigger.min.js`, 'utf8');
const bridgeSrc = getRuntimeBridgeSource();

const HARNESS = `
window.__H = (() => {
  const V1 = 'uncraft-motion-editor/v1';
  const V2 = 'uncraft-motion-editor/v2';
  const NONCE = 'nonce-st-probe-123456';
  const BUNDLE = 'bundle-st';
  const SESSION = 'session-st';
  const ORIGIN = 'https://app.uncraft.test';
  const messages = [];
  let generation = null;
  let seq = 0;

  function boot() {
    const config = document.createElement('script');
    config.type = 'application/json';
    config.dataset.uncraftRuntimeConfig = 'true';
    config.textContent = JSON.stringify({
      initialManifest: { schemaVersion: 2, baseBundleId: BUNDLE, transactions: [] },
      runtimeSessionId: SESSION,
      runtimeFingerprint: 'sha256:st-probe',
      sessionNonce: NONCE,
    });
    document.head.appendChild(config);
    const nativo = window.postMessage.bind(window);
    window.postMessage = (m) => messages.push(m);
    window.eval(window.__BRIDGE_SRC);
    const ready = messages.filter((m) => m.type === 'runtime-ready').pop();
    generation = ready && ready.payload ? ready.payload.runtimeGeneration : null;
    window.dispatchEvent(new MessageEvent('message', {
      source: window, origin: ORIGIN,
      data: {
        protocol: V1, protocolVersion: V1,
        supportedProtocols: [V2, V1],
        source: 'host', type: 'negotiate-protocol', requestId: 'negotiate-st',
        sessionNonce: NONCE, runtimeGeneration: generation, bundleId: BUNDLE, sessionId: SESSION,
        payload: { selectedProtocol: V2 },
      },
    }));
    const neg = messages.filter((m) => m.type === 'protocol-negotiated').pop();
    return { negociou: neg && neg.payload && neg.payload.selectedProtocol === V2, generation };
  }

  function sendV2(type, payload) {
    const requestId = 'st-req-' + (seq += 1);
    const mark = messages.length;
    window.dispatchEvent(new MessageEvent('message', {
      source: window, origin: ORIGIN,
      data: {
        protocol: V2, protocolVersion: V2,
        supportedProtocols: [V2, V1],
        source: 'host', type,
        sessionNonce: NONCE, requestId,
        runtimeGeneration: generation, bundleId: BUNDLE, sessionId: SESSION,
        payload,
      },
    }));
    return messages.slice(mark);
  }

  return { boot, sendV2, messages };
})();
`;

// Espera explícita: o ScrollTrigger não atualiza dentro do `scrollTo`; ele
// atualiza no ticker/no evento de scroll. Medir no mesmo instante daria zero
// vácuo por CEDO DEMAIS, não por supressão.
const TICKS = `
window.__ticks = (n) => new Promise((resolve) => {
  let restantes = n;
  const passo = () => { restantes -= 1; if (restantes <= 0) resolve(); else requestAnimationFrame(passo); };
  requestAnimationFrame(passo);
});
`;

const PAGINA = `
<style>
  body { margin: 0; }
  .faixa { height: 900px; }
  .marca { height: 40px; background: #333; }
</style>
<div class="faixa"></div>
<div id="ctlEnter" class="marca"></div>
<div class="faixa"></div>
<div id="armEnter" class="marca"></div>
<div class="faixa"></div>
<div id="ctlScrub" class="marca"></div>
<div class="faixa"></div>
<div id="armScrub" class="marca"></div>
<div class="faixa"></div>
<div id="armColateral" class="marca"></div>
<div class="faixa"></div>
<div id="vitima" class="marca"></div>
<div class="faixa"></div>
`;

async function novaPagina(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(PAGINA);
  await page.addScriptTag({ content: gsapSrc });
  await page.addScriptTag({ content: stSrc });
  await page.evaluate((src) => { window.__BRIDGE_SRC = src; }, bridgeSrc);
  await page.evaluate(HARNESS);
  await page.evaluate(TICKS);
  return page;
}

const browser = await chromium.launch({ headless: true });
const out = {};

// ---------------------------------------------------------------------------
// Caso 1 — ciclo de vida do ScrollTrigger sob o scrubber.
// CONTROLE: `#ctlEnter`, cruzado por rolagem DIRETA (sem o bridge) — prova que
// existe oportunidade de despacho nesta construção.
// ARMA: `#armEnter`, cruzado pelo comando `scroll-to` do bridge (o scrubber).
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser);
  out.caso1 = await page.evaluate(async () => {
    gsap.registerPlugin(ScrollTrigger);
    window.__H.boot();
    const fires = { ctl: {}, arm: {} };
    const conta = (saco, nome) => () => { saco[nome] = (saco[nome] || 0) + 1; };

    const mk = (id, saco) => ScrollTrigger.create({
      trigger: '#' + id,
      start: 'top bottom',
      end: 'bottom top',
      onEnter: conta(saco, 'onEnter'),
      onLeave: conta(saco, 'onLeave'),
      onEnterBack: conta(saco, 'onEnterBack'),
      onLeaveBack: conta(saco, 'onLeaveBack'),
      onToggle: conta(saco, 'onToggle'),
      onUpdate: conta(saco, 'onUpdate'),
      onRefresh: conta(saco, 'onRefresh'),
    });

    const stCtl = mk('ctlEnter', fires.ctl);
    const stArm = mk('armEnter', fires.arm);
    ScrollTrigger.refresh();
    // Zera o que o refresh contabilizou: a pergunta é sobre o ARRASTO.
    Object.keys(fires.ctl).forEach((k) => { fires.ctl[k] = 0; });
    Object.keys(fires.arm).forEach((k) => { fires.arm[k] = 0; });

    // ⚠️ Um único destino só dá oportunidade a onEnter/onToggle/onUpdate. Os
    // zeros de onLeave/onEnterBack/onLeaveBack/onRefresh seriam VÁCUO — falta de
    // oportunidade, não silêncio. Cada braço percorre a trajetória INTEIRA:
    // topo → dentro → além do fim → dentro de novo → topo, mais um refresh.
    const trajeto = (st) => [
      Math.round(st.start + 10),   // entra          → onEnter/onToggle
      Math.round(st.end + 10),     // sai por baixo  → onLeave/onToggle
      Math.round(st.start + 10),   // volta a entrar → onEnterBack/onToggle
      0,                           // sai por cima   → onLeaveBack/onToggle
    ];

    // CONTROLE — rolagem direta, sem o bridge, no elemento de controle.
    for (const y of trajeto(stCtl)) { window.scrollTo(0, y); await window.__ticks(3); }
    ScrollTrigger.refresh();
    await window.__ticks(2);
    const controle = JSON.parse(JSON.stringify(fires.ctl));

    window.scrollTo(0, 0);
    await window.__ticks(3);
    Object.keys(fires.arm).forEach((k) => { fires.arm[k] = 0; });

    // ARMA — a MESMA trajetória, pelo caminho REAL do scrubber.
    const alvos = trajeto(stArm);
    for (const y of alvos) { window.__H.sendV2('scroll-to', { scrollY: y }); await window.__ticks(3); }
    const scrollYNoUltimoAlvo = Math.round(window.scrollY);
    window.__H.sendV2('scroll-to', { scrollY: alvos[0] });
    await window.__ticks(3);
    const rolouDeFato = Math.abs(Math.round(window.scrollY) - alvos[0]) <= 2;
    // ⚠️ Atribuição: `onRefresh` NÃO vem da rolagem, vem do `refresh()` explícito
    // logo abaixo. Sem separar, o número do refresh entraria na conta do scrubber
    // (achado do Sol). Congela-se o estado ANTES de refrescar.
    const pelaRolagem = JSON.parse(JSON.stringify(fires.arm));
    ScrollTrigger.refresh();
    await window.__ticks(2);

    const classes = ['onEnter', 'onLeave', 'onEnterBack', 'onLeaveBack', 'onToggle', 'onUpdate', 'onRefresh'];
    const semOportunidade = classes.filter((k) => !(controle[k] > 0));

    return {
      controle,
      // Um zero da arma só é legível nas classes em que o CONTROLE viu > 0.
      classesComOportunidade: classes.filter((k) => controle[k] > 0),
      semOportunidade,
      // `pelaRolagem` é o que os comandos `scroll-to` produziram. `total` inclui
      // o refresh explícito — a diferença entre os dois é a atribuição honesta.
      pelaRolagem,
      total: JSON.parse(JSON.stringify(fires.arm)),
      peloRefreshExplicito: Object.fromEntries(classes.map((k) => [k, fires.arm[k] - pelaRolagem[k]])),
      scrollYNoUltimoAlvo,
      alvoArm: alvos[0],
      rolouDeFato,
    };
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Caso 2 — animação ligada ao scroll (`scrub`): esta é a reação que se QUER
// viva (é o desenho da página). Medida por DESLOCAMENTO RENDERIZADO.
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser);
  out.caso2 = await page.evaluate(async () => {
    gsap.registerPlugin(ScrollTrigger);
    window.__H.boot();

    const st = ScrollTrigger.create({ trigger: '#armScrub', start: 'top bottom', end: 'bottom top' });
    gsap.to('#armScrub', {
      x: 300, ease: 'none',
      scrollTrigger: { trigger: '#armScrub', start: 'top bottom', end: 'bottom top', scrub: true },
    });
    ScrollTrigger.refresh();

    window.scrollTo(0, 0);
    await window.__ticks(3);
    const xAntes = Number(gsap.getProperty('#armScrub', 'x'));

    const meio = Math.round((st.start + st.end) / 2);
    window.__H.sendV2('scroll-to', { scrollY: meio });
    await window.__ticks(4);
    const xDepois = Number(gsap.getProperty('#armScrub', 'x'));

    return { xAntes, xDepois, desenhou: xDepois > xAntes };
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Caso 3 — DANO que sobrevive ao arrasto: o `onEnter` do site dispara uma
// animação num TERCEIRO elemento. Mede-se a vítima em ticks POSTERIORES, com
// o scrubber já parado.
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser);
  out.caso3 = await page.evaluate(async () => {
    gsap.registerPlugin(ScrollTrigger);
    window.__H.boot();

    let disparos = 0;
    const st = ScrollTrigger.create({
      trigger: '#armColateral',
      start: 'top bottom',
      end: 'bottom top',
      onEnter: () => { disparos += 1; gsap.to('#vitima', { x: 250, duration: 0.4, ease: 'none' }); },
    });
    ScrollTrigger.refresh();
    window.scrollTo(0, 0);
    await window.__ticks(3);

    const vitimaAntes = Number(gsap.getProperty('#vitima', 'x'));
    window.__H.sendV2('scroll-to', { scrollY: Math.round(st.start + 10) });
    await window.__ticks(3);
    const vitimaNoArrasto = Number(gsap.getProperty('#vitima', 'x'));
    // Scrubber PARADO daqui em diante: qualquer avanço agora é a reação do site
    // continuando por conta própria. "Parado" tem que ser MEDIDO (a página pode
    // seguir rolando por snap/smooth), não apenas "o probe não mandou comando".
    // Amostragem PERIÓDICA, não só nas pontas: duas amostras nas extremidades
    // não excluem a página ter ido e voltado no meio (achado do Sol).
    const scrollYAoParar = Math.round(window.scrollY);
    const amostras = [scrollYAoParar];
    await new Promise((resolve) => {
      const t = setInterval(() => { amostras.push(Math.round(window.scrollY)); }, 25);
      setTimeout(() => { clearInterval(t); resolve(); }, 500);
    });
    const scrollYDepois = Math.round(window.scrollY);
    amostras.push(scrollYDepois);
    const vitimaDepois = Number(gsap.getProperty('#vitima', 'x'));

    return {
      disparos,
      vitimaAntes,
      vitimaNoArrasto,
      vitimaDepois,
      scrollYAoParar,
      scrollYDepois,
      amostrasScrollY: amostras.length,
      scrollYMin: Math.min(...amostras),
      scrollYMax: Math.max(...amostras),
      paginaFicouParada: Math.min(...amostras) === Math.max(...amostras),
      danoSobreviveu: vitimaDepois > vitimaAntes,
      continuouComScrubberParado: vitimaDepois > vitimaNoArrasto,
    };
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Caso 4 — MECANISMO: a técnica do seek silencioso (anular o slot do callback
// em `vars`) transfere para o ScrollTrigger? Mede-se, não se argumenta.
// Também se registra o que a API do plugin oferece (disable/enable/kill).
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser);
  out.caso4 = await page.evaluate(async () => {
    gsap.registerPlugin(ScrollTrigger);
    window.__H.boot();

    const fires = { ctl: 0, arm: 0 };
    const stCtl = ScrollTrigger.create({
      trigger: '#ctlEnter', start: 'top bottom', end: 'bottom top',
      onEnter: () => { fires.ctl += 1; },
    });
    const stArm = ScrollTrigger.create({
      trigger: '#armEnter', start: 'top bottom', end: 'bottom top',
      onEnter: () => { fires.arm += 1; },
    });
    ScrollTrigger.refresh();
    window.scrollTo(0, 0);
    await window.__ticks(3);
    fires.ctl = 0; fires.arm = 0;

    // Forma do slot: é own/enumerável em `vars`, como no GSAP? E o plugin guarda
    // cópia própria fora de `vars`?
    const desc = Object.getOwnPropertyDescriptor(stArm.vars, 'onEnter');
    const forma = {
      varsEhOwn: Boolean(desc),
      enumeravel: Boolean(desc && desc.enumerable),
      gravavel: Boolean(desc && desc.writable),
      temCopiaPropria: typeof stArm.onEnter === 'function' && stArm.onEnter !== stArm.vars.onEnter,
      apiDisable: typeof stArm.disable === 'function',
      apiEnable: typeof stArm.enable === 'function',
      apiKill: typeof stArm.kill === 'function',
      getAllExpoe: typeof ScrollTrigger.getAll === 'function' ? ScrollTrigger.getAll().length : null,
    };

    // CONTROLE: cruza o gatilho de controle SEM anular nada — prova despacho.
    window.scrollTo(0, Math.round(stCtl.start + 10));
    await window.__ticks(3);
    const controle = fires.ctl;

    window.scrollTo(0, 0);
    await window.__ticks(3);
    fires.arm = 0;

    // ARMA: anula o slot em `vars` e cruza o gatilho pelo scrubber.
    const original = stArm.vars.onEnter;
    stArm.vars.onEnter = null;
    window.__H.sendV2('scroll-to', { scrollY: Math.round(stArm.start + 10) });
    await window.__ticks(3);
    const comSlotAnulado = fires.arm;
    stArm.vars.onEnter = original;

    return { forma, controle, comSlotAnulado, slotAnularFunciona: controle > 0 && comSlotAnulado === 0 };
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Caso 5 — ONDE vive o callback. O caso 4 mostrou que anular o slot não
// suprime; falta saber por quê. Trocar por uma função DISTINTA e ver qual
// dispara desambigua "lido no despacho" × "capturado na criação" — e é medida
// positiva (alguma conta sobe), não um zero.
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser);
  out.caso5 = await page.evaluate(async () => {
    gsap.registerPlugin(ScrollTrigger);
    window.__H.boot();

    const fires = { original: 0, trocada: 0, aposRefresh: 0 };
    const st = ScrollTrigger.create({
      trigger: '#armEnter', start: 'top bottom', end: 'bottom top',
      onEnter: () => { fires.original += 1; },
    });
    ScrollTrigger.refresh();
    window.scrollTo(0, 0);
    await window.__ticks(3);
    fires.original = 0;

    const tipoNoObjeto = typeof st.onEnter;
    const mesmaReferencia = tipoNoObjeto === 'function' ? st.onEnter === st.vars.onEnter : null;

    // Troca por uma função DISTINTA (não anula).
    st.vars.onEnter = () => { fires.trocada += 1; };
    window.__H.sendV2('scroll-to', { scrollY: Math.round(st.start + 10) });
    await window.__ticks(3);
    const semRefresh = JSON.parse(JSON.stringify(fires));

    // O `refresh()` re-lê `vars`? (o site chama refresh o tempo todo)
    // ⚠️ `aposRefresh === 0` sozinho também é compatível com "ninguém teve
    // oportunidade nesta segunda travessia". Exige-se EXATAMENTE UM positivo
    // entre as três funções — é isso que torna o zero legível.
    window.scrollTo(0, 0);
    await window.__ticks(3);
    fires.original = 0; fires.trocada = 0; fires.aposRefresh = 0;
    st.vars.onEnter = () => { fires.aposRefresh += 1; };
    ScrollTrigger.refresh();
    window.__H.sendV2('scroll-to', { scrollY: Math.round(st.start + 10) });
    await window.__ticks(3);
    const comRefresh = JSON.parse(JSON.stringify(fires));
    const positivosComRefresh = Object.values(comRefresh).filter((n) => n > 0).length;

    return {
      tipoNoObjeto, mesmaReferencia,
      semRefresh,
      lidoNoDespacho: semRefresh.trocada > 0 && semRefresh.original === 0,
      // "capturado ANTES do despacho" é o que a medição sustenta. `create()` já
      // inicializa e refresca antes de devolver a instância, então esta rota não
      // separa "na criação" de "no primeiro refresh" (achado do Sol).
      capturadoAntesDoDespacho: semRefresh.original > 0 && semRefresh.trocada === 0,
      comRefresh,
      houveOportunidadeComRefresh: positivosComRefresh === 1,
      refreshRele: comRefresh.aposRefresh > 0,
    };
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Caso 6 — MECANISMO oferecido pelo plugin: `disable`/`enable` em volta do
// arrasto cala o ciclo de vida? E, se cala, mata o DESENHO (a animação com
// scrub) — que é justamente o que a régua precisa manter vivo?
// Duas perguntas, uma construção, cada uma com sua medida positiva.
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser);
  out.caso6 = await page.evaluate(async () => {
    gsap.registerPlugin(ScrollTrigger);
    window.__H.boot();

    // O ciclo de vida e o desenho vivem na MESMA faixa de rolagem: senão um
    // único alvo de scroll dá oportunidade a um e não ao outro, e o zero do
    // outro é vácuo (foi exatamente o furo da primeira versão deste caso).
    // ⚠️ Contar só `onEnter` julgaria "calou o ciclo" a partir de uma classe só;
    // o `enable()` refresca, e refresh tem callbacks próprios (achado do Sol).
    const fires = {};
    const conta = (nome) => () => { fires[nome] = (fires[nome] || 0) + 1; };
    const CLASSES = ['onEnter', 'onLeave', 'onEnterBack', 'onLeaveBack', 'onToggle', 'onUpdate', 'onRefresh', 'onRefreshInit'];
    CLASSES.forEach((k) => { fires[k] = 0; });
    const zera = () => { CLASSES.forEach((k) => { fires[k] = 0; }); };
    const soma = () => CLASSES.reduce((t, k) => t + fires[k], 0);
    const stCiclo = ScrollTrigger.create({
      trigger: '#armScrub', start: 'top bottom', end: 'bottom top',
      ...Object.fromEntries(CLASSES.map((k) => [k, conta(k)])),
    });
    gsap.to('#armScrub', {
      x: 300, ease: 'none',
      scrollTrigger: { trigger: '#armScrub', start: 'top bottom', end: 'bottom top', scrub: true },
    });
    ScrollTrigger.refresh();
    const meio = Math.round((stCiclo.start + stCiclo.end) / 2);

    window.scrollTo(0, 0);
    await window.__ticks(3);
    zera();
    const xAntes = Number(gsap.getProperty('#armScrub', 'x'));

    // ⚠️ Um único destino (0 → meio) só dá oportunidade a onEnter/onToggle/
    // onUpdate; os zeros das outras classes seriam vácuo (achado do Sol). As
    // DUAS fases percorrem a MESMA trajetória completa, e o desenho é medido no
    // meio da faixa, onde o controle o viu avançar.
    const trajeto6 = [meio, Math.round(stCiclo.end + 10), meio, 0, meio];

    // FASE DE CONTROLE — sem disable: prova oportunidade para ciclo E desenho.
    for (const y of trajeto6) { window.__H.sendV2('scroll-to', { scrollY: y }); await window.__ticks(4); }
    const cicloControle = JSON.parse(JSON.stringify(fires));
    const xControle = Number(gsap.getProperty('#armScrub', 'x'));

    // Volta ao topo (o scrub desfaz o desenho) e zera a contagem.
    window.scrollTo(0, 0);
    await window.__ticks(4);
    zera();
    const xVoltou = Number(gsap.getProperty('#armScrub', 'x'));

    // FASE DA ARMA — disable em volta da MESMA trajetória.
    const todos = ScrollTrigger.getAll();
    todos.forEach((st) => { try { st.disable(false, true); } catch (_) {} });
    for (const y of trajeto6) { window.__H.sendV2('scroll-to', { scrollY: y }); await window.__ticks(4); }
    const cicloDesabilitado = JSON.parse(JSON.stringify(fires));
    const somaDesabilitado = soma();
    const xDesabilitado = Number(gsap.getProperty('#armScrub', 'x'));

    todos.forEach((st) => { try { st.enable(false, true); } catch (_) {} });
    await window.__ticks(4);
    const cicloAposReabilitar = JSON.parse(JSON.stringify(fires));
    const somaAposReabilitar = soma();
    const xAposReabilitar = Number(gsap.getProperty('#armScrub', 'x'));
    // DISCRIMINADOR: "disparou o represado" × "o enable só refresca". Um
    // disable/enable SEM rolagem no meio não tem nada represado — se disparar
    // igual, o disparo é do próprio enable, não da rolagem engolida.
    zera();
    todos.forEach((st) => { try { st.disable(false, true); } catch (_) {} });
    await window.__ticks(2);
    todos.forEach((st) => { try { st.enable(false, true); } catch (_) {} });
    await window.__ticks(4);
    const cicloEnableSemRolagem = JSON.parse(JSON.stringify(fires));
    const somaEnableSemRolagem = soma();
    // Oportunidade POSTERIOR: o trigger pode só se reconciliar no próximo evento
    // de scroll ou num update explícito. Medir cedo demais faria "não recuperou"
    // ser conclusão sobre o relógio, não sobre o mecanismo (achado do Sol).
    window.scrollTo(0, meio + 1);
    ScrollTrigger.update();
    await window.__ticks(4);
    const xAposCutucar = Number(gsap.getProperty('#armScrub', 'x'));
    const somaAposCutucar = soma();

    // ⚠️ `onRefresh`/`onRefreshInit` NÃO são eventos de arrasto — nenhuma
    // trajetória lhes dá oportunidade, e cobrar controle deles na fase do
    // arrasto criaria um vácuo artificial. Eles pertencem à outra pergunta (o
    // que o `enable()` dispara), que tem controle PRÓPRIO: o disable/enable sem
    // rolagem no meio.
    const CLASSES_ARRASTO = CLASSES.filter((k) => !k.startsWith('onRefresh'));
    const legiveis6 = CLASSES_ARRASTO.filter((k) => cicloControle[k] > 0);
    const semOportunidade6 = CLASSES_ARRASTO.filter((k) => !(cicloControle[k] > 0));
    const somaLegivelDesabilitado = legiveis6.reduce((t, k) => t + cicloDesabilitado[k], 0);

    return {
      xAntes, xControle, xVoltou, xDesabilitado, xAposReabilitar, xAposCutucar,
      cicloControle, cicloDesabilitado, cicloAposReabilitar, cicloEnableSemRolagem,
      somaDesabilitado, somaAposReabilitar, somaAposCutucar, somaEnableSemRolagem,
      legiveis6, semOportunidade6, somaLegivelDesabilitado,
      controleViu: legiveis6.length > 0 && xControle > xAntes,
      // Só as classes com controle > 0 sustentam a afirmação de silêncio.
      calouAsLegiveis: somaLegivelDesabilitado === 0,
      desenhouComDisable: xDesabilitado > xVoltou,
      disparouAoReabilitar: somaAposReabilitar > somaDesabilitado,
      // ⚠️ "o disparo é do próprio enable" exige IGUALDADE por classe com o
      // braço sem nada represado — `> 0` só provaria que o enable também
      // dispara algo, o que é compatível com haver represamento POR CIMA
      // (achado do Sol na r3).
      deltaEnablePosArrasto: Object.fromEntries(CLASSES.map((k) => [k, cicloAposReabilitar[k] - cicloDesabilitado[k]])),
      disparoEhDoProprioEnable: somaEnableSemRolagem > 0 &&
        CLASSES.every((k) => (cicloAposReabilitar[k] - cicloDesabilitado[k]) === cicloEnableSemRolagem[k]),
      // Critério FORTE: recuperar é chegar ao valor do controle, não "ser > 0".
      desenhoRecuperadoAoReabilitar: Math.abs(xAposReabilitar - xControle) <= 2,
      desenhoRecuperadoAposCutucar: Math.abs(xAposCutucar - xControle) <= 3,
    };
  });
  await page.close();
}

await browser.close();

console.log(JSON.stringify(out, null, 2));

// --- leitura, com os controles primeiro -------------------------------------
const problemas = [];
if (!out.caso1.classesComOportunidade.length) problemas.push('caso1: CONTROLE CEGO — nem a rolagem direta disparou nada; todo zero deste caso é vácuo');
if (out.caso1.semOportunidade.length) problemas.push(`caso1: sem oportunidade no CONTROLE para ${out.caso1.semOportunidade.join(', ')} — os zeros da arma nessas classes são ILEGÍVEIS`);
if (!out.caso1.rolouDeFato) problemas.push(`caso1: o comando do bridge não rolou até o alvo (${out.caso1.alvoArm}) — o braço não exercitou o caminho`);
if (!(out.caso3.disparos > 0)) problemas.push('caso3: o onEnter do site não chegou a disparar — o caso não mediu dano');
if (!out.caso3.paginaFicouParada) problemas.push(`caso3: a página se MEXEU durante a espera (${out.caso3.scrollYMin}–${out.caso3.scrollYMax} em ${out.caso3.amostrasScrollY} amostras) — o avanço da vítima poderia ser rolagem, não reação autônoma`);
if (!(out.caso4.controle > 0)) problemas.push('caso4: CONTROLE CEGO — o onEnter não dispara nem sem anular o slot');
if (!(out.caso5.semRefresh.original > 0 || out.caso5.semRefresh.trocada > 0)) problemas.push('caso5: NENHUMA das duas funções disparou — a desambiguação não aconteceu');
if (!out.caso5.houveOportunidadeComRefresh) problemas.push(`caso5: a travessia pós-refresh não teve exatamente um positivo (${JSON.stringify(out.caso5.comRefresh)}) — o zero do "refresh não relê vars" é vácuo`);
if (!out.caso6.controleViu) problemas.push(`caso6: CONTROLE CEGO — ciclo=${JSON.stringify(out.caso6.cicloControle)}, desenho ${out.caso6.xAntes}→${out.caso6.xControle}`);
if (out.caso6.semOportunidade6.length) problemas.push(`caso6: sem oportunidade no CONTROLE para ${out.caso6.semOportunidade6.join(', ')} — os zeros dessas classes na fase do disable são ILEGÍVEIS`);

const legiveis1 = out.caso1.classesComOportunidade;
const pelaRolagem = legiveis1.filter((k) => out.caso1.pelaRolagem[k] > 0);
const peloRefresh = legiveis1.filter((k) => out.caso1.peloRefreshExplicito[k] > 0);

console.log('\n--- leitura ---');
console.log(`caso1: a ROLAGEM pelo bridge disparou ${pelaRolagem.length} classes (${pelaRolagem.join(', ')}) — contagens ${JSON.stringify(out.caso1.pelaRolagem)}`);
console.log(`caso1: o refresh EXPLÍCITO (não a rolagem) disparou ${peloRefresh.join(', ') || 'nada'} — ${JSON.stringify(out.caso1.peloRefreshExplicito)}`);
console.log(`caso2: animação com scrub ${out.caso2.desenhou ? 'DESENHOU' : 'não desenhou'} (x ${out.caso2.xAntes} → ${out.caso2.xDepois})`);
console.log(`caso3: dano VISUAL (um transform) ${out.caso3.danoSobreviveu ? 'SOBREVIVEU' : 'não sobreviveu'} ao arrasto; ${out.caso3.continuouComScrubberParado ? 'continuou avançando' : 'não avançou'} com a página parada em ${out.caso3.amostrasScrollY} amostras (${out.caso3.scrollYMin}–${out.caso3.scrollYMax}); x ${out.caso3.vitimaAntes} → ${out.caso3.vitimaNoArrasto} → ${out.caso3.vitimaDepois}. ⚠️ dano de rede/áudio/armazenamento/DOM NÃO medido.`);
console.log(`caso4: anular o slot em vars ${out.caso4.slotAnularFunciona ? 'SUPRIME' : 'NÃO suprime'} o onEnter; forma=${JSON.stringify(out.caso4.forma)}`);
console.log(`caso5: onEnter ${out.caso5.lidoNoDespacho ? 'LIDO NO DESPACHO' : out.caso5.capturadoAntesDoDespacho ? 'CAPTURADO ANTES DO DESPACHO (mutar vars depois não troca o callback)' : 'MISTO — ver números'}; typeof st.onEnter=${out.caso5.tipoNoObjeto}; refresh ${out.caso5.refreshRele ? 'RE-LÊ vars' : 'NÃO re-lê vars'}. ⚠️ só onEnter, só nesta forma autoral.`);
console.log(`caso6: com disable, as classes LEGÍVEIS (${out.caso6.legiveis6.join(', ')}) ficaram em ${out.caso6.somaLegivelDesabilitado}; desenho ${out.caso6.desenhouComDisable ? 'avançou' : 'PAROU'} (x ${out.caso6.xVoltou} → ${out.caso6.xDesabilitado}, controle ${out.caso6.xControle})`);
console.log(`caso6: ao reabilitar disparou ${JSON.stringify(out.caso6.deltaEnablePosArrasto)}; um disable/enable SEM rolagem no meio dispara ${JSON.stringify(out.caso6.cicloEnableSemRolagem)} → ${out.caso6.disparoEhDoProprioEnable ? 'IGUAIS por classe: o disparo é do PRÓPRIO enable (refresh), NÃO é rolagem represada' : 'DIFERENTES por classe: parte do disparo NÃO se explica pelo enable sozinho — compatível com represamento'}`);
console.log(`caso6: desenho não havia recuperado após 4 quadros (x=${out.caso6.xAposReabilitar}, esperado ≈${out.caso6.xControle}); ${out.caso6.desenhoRecuperadoAposCutucar ? 'recuperou' : 'NÃO recuperou'} após a intervenção COMBINADA (+1px, update() e mais tempo — os três confundidos) → x=${out.caso6.xAposCutucar}`);

console.log(problemas.length ? `\n${problemas.length} PROBLEMA(S) DE INSTRUMENTO:\n- ${problemas.join('\n- ')}` : '\ninstrumento sadio nas classes reportadas: todo zero legível tem controle > 0 na mesma construção');
process.exit(problemas.length ? 1 : 0);
