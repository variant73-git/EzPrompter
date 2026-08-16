// WITNESS do seek silencioso: GSAP 3.15 REAL, pelo caminho de protocolo v2 do
// bridge (negotiate + select + seek-motion). O vitest da feature usa um GSAP
// falso, fiel só nos dois fatos medidos; é este arquivo que prova o
// comportamento no motor de verdade.
//
// Regras do instrumento (cada uma custou rodada de auditoria nesta frente):
//   - ELEMENTO PRÓPRIO por braço — nunca reusar alvo (verde vácuo comparando
//     100 com 100);
//   - PRÉ-RENDER SUPRIMIDO antes de qualquer janela, com asserção de que o alvo
//     MOVEU e NÃO chegou ao fim (o GSAP inicializa lazy: janela num alvo nunca
//     renderizado faz o zero provar "inicializou sem callback");
//   - CONTROLE por braço antes de acreditar em qualquer zero;
//   - desenho medido por DESLOCAMENTO RENDERIZADO, nunca por contagem de
//     `onUpdate`.
//
// Uso:
//   node _probe-seek-silence-witness.mjs            # assertivo (contra baseline)
//   node _probe-seek-silence-witness.mjs --record   # imprime o JSON pra congelar
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const bridgeSrc = getRuntimeBridgeSource();
const RECORD = process.argv.includes('--record');
const BASELINE_PATH = new URL('./_probe-seek-silence-witness.baseline.json', import.meta.url);

const HARNESS = `
window.__H = (() => {
  const V1 = 'uncraft-motion-editor/v1';
  const V2 = 'uncraft-motion-editor/v2';
  const NONCE = 'nonce-seek-witness-123456';
  const BUNDLE = 'bundle-seek';
  const SESSION = 'session-seek';
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
      runtimeFingerprint: 'sha256:seek-witness',
      sessionNonce: NONCE,
    });
    document.head.appendChild(config);
    window.postMessage = (m) => messages.push(m);
    window.eval(window.__BRIDGE_SRC);
    const ready = messages.filter((m) => m.type === 'runtime-ready').pop();
    generation = ready.payload.runtimeGeneration;
    window.dispatchEvent(new MessageEvent('message', {
      source: window, origin: ORIGIN,
      data: {
        protocol: V1, protocolVersion: V1,
        supportedProtocols: [V2, V1],
        source: 'host', type: 'negotiate-protocol', requestId: 'negotiate-seek',
        sessionNonce: NONCE, runtimeGeneration: generation, bundleId: BUNDLE, sessionId: SESSION,
        payload: { selectedProtocol: V2 },
      },
    }));
    const negotiated = messages.filter((m) => m.type === 'protocol-negotiated').pop();
    return { negotiated: negotiated?.payload?.selectedProtocol === V2 };
  }

  function sendV2(type, payload) {
    const requestId = 'seek-req-' + (seq += 1);
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

  function select(domId) {
    document.getElementById(domId).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const sel = messages.filter((m) => m.type === 'selection-changed').pop();
    const element = sel?.payload?.element || {};
    const motion = (element.motion || []).find((m) => m.engine === 'GSAP') || null;
    return { elementId: element.id, motionId: motion?.id || null, duration: motion?.duration ?? null };
  }

  function seek(motionId, ms) { return sendV2('seek-motion', { motionId, currentTime: ms }); }

  return { boot, select, seek, sendV2, messages };
})();
`;

async function novaPagina(browser, html) {
  const page = await browser.newPage();
  await page.setContent(html);
  await page.addScriptTag({ content: gsapSrc });
  await page.addInitScript(() => {});
  await page.evaluate((src) => { window.__BRIDGE_SRC = src; }, bridgeSrc);
  await page.evaluate(HARNESS);
  return page;
}

const browser = await chromium.launch({ headless: true });
const out = {};

// ---------------------------------------------------------------------------
// Caso 1 — tween solto: os quatro em silêncio, desenho vivo, `vars` idêntico.
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser, '<div id="ctl"></div><div id="alvo"></div>');
  out.caso1 = await page.evaluate(() => {
    window.__H.boot();
    const fires = { ctlStart: 0, ctlComplete: 0, start: 0, update: 0, complete: 0 };

    // CONTROLE: elemento PRÓPRIO, sem passar pelo bridge — prova que existe
    // oportunidade de despacho e que os callbacks funcionam.
    const ctl = gsap.to('#ctl', {
      x: 100, duration: 1, ease: 'none', paused: true,
      onStart: () => { fires.ctlStart += 1; },
      onUpdate: () => {},
      onComplete: () => { fires.ctlComplete += 1; },
    });
    // ⚠️ o `onStart` só despacha saindo de 0. Pré-renderizar para 0.2 e seguir
    // adiante deixaria o braço SEM oportunidade de despacho, e o zero do teste
    // não provaria nada. Inicializa e VOLTA a 0, tudo em silêncio.
    ctl.pause(); ctl.time(0.2, true); ctl.time(0, true); ctl.time(1, false);

    const alvo = gsap.to('#alvo', {
      x: 100, duration: 1, ease: 'none', paused: true,
      onStart: () => { fires.start += 1; },
      onUpdate: () => { fires.update += 1; },
      onComplete: () => { fires.complete += 1; },
    });
    alvo.pause();
    // PRÉ-RENDER suprimido: inicializa sem disparar; mede que MOVEU; volta a 0
    // para que o seek do bridge cruze a fronteira do `onStart`.
    alvo.time(0.2, true);
    const preX = Number(gsap.getProperty('#alvo', 'x'));
    alvo.time(0, true);

    const keysAntes = Object.keys(alvo.vars);
    const fnsAntes = [alvo.vars.onStart, alvo.vars.onComplete];

    const sel = window.__H.select('alvo');
    window.__H.seek(sel.motionId, 1000);

    return {
      controle: { start: fires.ctlStart, complete: fires.ctlComplete },
      preRenderMoveu: preX > 0 && preX < 100,
      preX,
      silenciado: { start: fires.start, complete: fires.complete },
      desenhou: fires.update > 0,
      xFinal: Number(gsap.getProperty('#alvo', 'x')),
      keysIguais: JSON.stringify(Object.keys(alvo.vars)) === JSON.stringify(keysAntes),
      identidade: alvo.vars.onStart === fnsAntes[0] && alvo.vars.onComplete === fnsAntes[1],
    };
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Caso 2 — seek pra trás: `onReverseComplete`.
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser, '<div id="ctl"></div><div id="alvo"></div>');
  out.caso2 = await page.evaluate(() => {
    window.__H.boot();
    const fires = { ctl: 0, alvo: 0 };

    const ctl = gsap.to('#ctl', {
      x: 100, duration: 1, ease: 'none', paused: true,
      onUpdate: () => {}, onReverseComplete: () => { fires.ctl += 1; },
    });
    ctl.pause(); ctl.time(0.5, true); ctl.time(0, false);

    const alvo = gsap.to('#alvo', {
      x: 100, duration: 1, ease: 'none', paused: true,
      onUpdate: () => {}, onReverseComplete: () => { fires.alvo += 1; },
    });
    alvo.pause(); alvo.time(0.5, true);
    const preX = Number(gsap.getProperty('#alvo', 'x'));

    const sel = window.__H.select('alvo');
    window.__H.seek(sel.motionId, 0);

    return {
      controle: fires.ctl,
      preRenderMoveu: preX > 0 && preX < 100,
      silenciado: fires.alvo,
      aindaFuncao: typeof alvo.vars.onReverseComplete === 'function',
    };
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Caso 3 — filho com `repeat: 2` dentro de timeline.
// Reporta TAMBÉM qual animação o bridge registra (fachada ou filho): se ele
// registra o filho, o seek fica clampado à iteração e a fronteira de repetição
// não é alcançável por esta rota — fato do produto, não do motor.
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser, '<div id="ctl"></div><div id="alvo"></div>');
  out.caso3 = await page.evaluate(() => {
    window.__H.boot();
    const fires = { ctl: 0, alvo: 0 };

    const tlCtl = gsap.timeline({ paused: true });
    tlCtl.to('#ctl', { x: 100, duration: 1, ease: 'none', repeat: 2, onUpdate: () => {}, onRepeat: () => { fires.ctl += 1; } });
    tlCtl.pause(); tlCtl.time(0.2, true);
    tlCtl.time(1.5, false); tlCtl.time(2.5, false); tlCtl.time(0.2, false);

    const tl = gsap.timeline({ paused: true });
    tl.to('#alvo', { x: 100, duration: 1, ease: 'none', repeat: 2, onUpdate: () => {}, onRepeat: () => { fires.alvo += 1; } });
    tl.pause(); tl.time(0.2, true);
    const preX = Number(gsap.getProperty('#alvo', 'x'));

    const sel = window.__H.select('alvo');
    const filho = tl.getChildren(true, true, true)[0];
    const respostas = window.__H.seek(sel.motionId, 1500);
    window.__H.seek(sel.motionId, 2500);
    window.__H.seek(sel.motionId, 200);
    const naJanela = fires.alvo;
    // A duração PUBLICADA diz o que o bridge está de fato dirigindo: a duração
    // da iteração (o filho) ou o span repetido inteiro (a timeline). É isso que
    // define se a fronteira de repetição é sequer alcançável por esta rota.
    const estado = respostas.filter((m) => m.type === 'timeline-changed').pop();
    const duracaoPublicada = estado?.payload?.duration ?? null;

    return {
      controle: fires.ctl,
      preRenderMoveu: preX > 0 && preX < 100,
      naJanela,
      duracaoPublicada,
      dirigeOSpanRepetido: duracaoPublicada != null && duracaoPublicada > 1500,
      filhoAindaFuncao: typeof filho.vars.onRepeat === 'function',
    };
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Caso 4 — fachada de stagger (forma OBJETO, callback próprio por filho) dentro
// de timeline, mais um callback na timeline INTERNA da fachada.
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser,
    '<div id="c1"></div><div id="c2"></div><div id="alvo"></div><div id="a2"></div>');
  out.caso4 = await page.evaluate(() => {
    window.__H.boot();
    const fires = { ctlFilhos: 0, ctlInterna: 0, filhos: 0, interna: 0, update: 0 };

    const tlCtl = gsap.timeline({ paused: true });
    tlCtl.to(['#c1', '#c2'], {
      x: 100, duration: 0.5, ease: 'none',
      stagger: { each: 0.2, onComplete: () => { fires.ctlFilhos += 1; } },
      onUpdate: () => {},
    });
    const fachadaCtl = tlCtl.getChildren(true, true, true)[0];
    fachadaCtl.timeline.eventCallback('onComplete', () => { fires.ctlInterna += 1; });
    tlCtl.pause(); tlCtl.time(0.2, true); tlCtl.time(tlCtl.duration(), false);

    const tl = gsap.timeline({ paused: true });
    tl.to(['#alvo', '#a2'], {
      x: 100, duration: 0.5, ease: 'none',
      stagger: { each: 0.2, onComplete: () => { fires.filhos += 1; } },
      onUpdate: () => { fires.update += 1; },
    });
    const fachada = tl.getChildren(true, true, true)[0];
    fachada.timeline.eventCallback('onComplete', () => { fires.interna += 1; });
    tl.pause(); tl.time(0.2, true);
    const preX = Number(gsap.getProperty('#alvo', 'x'));
    const xAntes = Number(gsap.getProperty('#a2', 'x'));

    const sel = window.__H.select('alvo');
    window.__H.seek(sel.motionId, Math.round(tl.duration() * 1000));

    return {
      controle: { filhos: fires.ctlFilhos, interna: fires.ctlInterna },
      preRenderMoveu: preX > 0 && preX < 100,
      silenciado: { filhos: fires.filhos, interna: fires.interna },
      desenhouDeFato: Number(gsap.getProperty('#a2', 'x')) > xAntes,
      internaAindaFuncao: typeof fachada.timeline.vars.onComplete === 'function',
    };
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Caso 5 — configuração PARTILHADA: fail-closed protege a vizinha.
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser, '<div id="alvo"></div><div id="vizinho"></div>');
  out.caso5 = await page.evaluate(() => {
    window.__H.boot();
    const fires = { vizinho: 0 };
    let armado = false;
    let vizinho = null;
    // UM objeto de config, DUAS animações
    const cfg = {
      x: 100, duration: 1, ease: 'none', paused: true,
      onUpdate: () => { if (armado && vizinho) { armado = false; vizinho.time(1, false); } },
      onComplete: () => { fires.vizinho += 1; },
    };
    const alvo = gsap.to('#alvo', cfg);
    vizinho = gsap.to('#vizinho', cfg);
    const partilha = alvo.vars === vizinho.vars;
    alvo.pause(); vizinho.pause();
    alvo.time(0.2, true);
    const preX = Number(gsap.getProperty('#alvo', 'x'));

    const sel = window.__H.select('alvo');
    armado = true;
    window.__H.seek(sel.motionId, 600);

    return {
      partilha,
      preRenderMoveu: preX > 0 && preX < 100,
      // fail-closed: a janela não abriu, o vizinho manteve o callback dele
      vizinhoDisparou: fires.vizinho,
      configIntacta: typeof cfg.onComplete === 'function',
    };
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Caso 6 — desenho DERIVADO: o único output visível vive no `onUpdate`.
// É a razão de existir da feature (o caso A5 do finding).
// ---------------------------------------------------------------------------
{
  const page = await novaPagina(browser, '<div id="alvo"></div><canvas id="tela" width="10" height="10"></canvas>');
  out.caso6 = await page.evaluate(() => {
    window.__H.boot();
    const desenho = { frames: 0, ultimo: -1 };
    const alvo = gsap.to('#alvo', {
      x: 100, duration: 1, ease: 'none', paused: true,
      onUpdate: () => {
        desenho.frames += 1;
        desenho.ultimo = Math.round(Number(gsap.getProperty('#alvo', 'x')));
      },
      onComplete: () => {},
    });
    alvo.pause(); alvo.time(0.2, true);
    const preX = Number(gsap.getProperty('#alvo', 'x'));

    const sel = window.__H.select('alvo');
    window.__H.seek(sel.motionId, 700);

    return {
      preRenderMoveu: preX > 0 && preX < 100,
      desenhouNaJanela: desenho.frames > 0,
      // deslocamento RENDERIZADO, não contagem de onUpdate
      avancou: Number(gsap.getProperty('#alvo', 'x')) > preX,
      xAntes: preX,
      xDepois: Number(gsap.getProperty('#alvo', 'x')),
      ultimoDesenhado: desenho.ultimo,
    };
  });
  await page.close();
}

await browser.close();

if (RECORD) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error('baseline ausente — rode com --record e confira ANTES de congelar');
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const falhas = [];

// Controles primeiro: um zero só vale depois de um controle > 0 na MESMA rodada.
if (!(out.caso1.controle.start > 0 && out.caso1.controle.complete > 0)) falhas.push('caso1: controle cego');
if (!(out.caso2.controle > 0)) falhas.push('caso2: controle cego (onReverseComplete não dispara nem sem a janela)');
if (!(out.caso3.controle > 0)) falhas.push('caso3: controle cego (onRepeat não dispara nem sem a janela)');
if (out.caso3.duracaoPublicada == null) falhas.push('caso3: o bridge não publicou duração — não dá para saber que rota ele dirige, e o zero fica ambíguo');
if (!(out.caso4.controle.filhos > 0 && out.caso4.controle.interna > 0)) falhas.push('caso4: controle cego');
if (!out.caso5.partilha) falhas.push('caso5: as duas animações não chegaram a partilhar a config');
[1, 2, 3, 4, 5, 6].forEach((n) => {
  if (!out['caso' + n].preRenderMoveu) falhas.push(`caso${n}: pré-render não moveu o alvo (ou levou ao fim) — zero seria vácuo`);
});

const iguais = JSON.stringify(out) === JSON.stringify(baseline);
if (!iguais) {
  falhas.push('divergiu do baseline');
  console.log('--- ATUAL ---');
  console.log(JSON.stringify(out, null, 2));
  console.log('--- BASELINE ---');
  console.log(JSON.stringify(baseline, null, 2));
}

// Leitura honesta do caso 3: se o bridge dirige a ITERAÇÃO (duração publicada
// igual à do filho) em vez do span repetido, a fronteira de repetição não é
// alcançável por esta rota — e o zero é INALCANÇABILIDADE, não supressão.
console.log('--- leitura ---');
console.log(out.caso3.dirigeOSpanRepetido
  ? `caso3: o bridge dirige o span repetido (${out.caso3.duracaoPublicada}ms) e a supressão do onRepeat está exercitada`
  : `caso3: o bridge dirige a ITERAÇÃO (${out.caso3.duracaoPublicada}ms) — a fronteira de repetição não é alcançável por ESTA rota (tween seekado, clampado à iteração), então o zero daqui NÃO é evidência de supressão. Quem exercita o onRepeat é o vitest "silencia o onRepeat de um filho quando o render do pai cruza a repetição", cuja procedência foi medida: tirar onRepeat de SEEK_SILENCED_CALLBACKS deixa aquele teste vermelho.`);

console.log(falhas.length ? `${falhas.length} PROBLEMA(S):\n- ${falhas.join('\n- ')}` : 'witness OK — comportamento bate com o baseline');
process.exit(falhas.length ? 1 : 0);
