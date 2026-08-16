// PROBE — do movimento que o USUÁRIO vê, quanto o editor alcança?
//
// Enunciado do Adilson: "pro usuário não importa se é GSAP ou WAAPI, ele vê
// animação e quer editar". Então a pergunta não é quantas animações o inventário
// encontra — é: **do que se mexe na tela, quanto o editor oferece para editar?**
//
// DENOMINADOR (o que o usuário vê mexer): elementos cuja aparência PRÓPRIA muda —
// `transform`, `opacity` ou `visibility` computados — entre amostras tiradas em
// várias posições de rolagem E em dois instantes por posição (para pegar tanto
// movimento dirigido por rolagem quanto por tempo). `getComputedStyle().transform`
// é o transform PRÓPRIO do elemento, não o acumulado do pai — então herdar o
// movimento do pai não conta como movimento próprio, por construção.
//
// NUMERADOR (o que o editor alcança): para uma amostra dos que se mexeram, faz-se
// o que o usuário faria — **clica** no elemento e lê o que o bridge publica em
// `selection-changed`. Se vier `element.motion` com pelo menos um clipe, o editor
// alcança. É o caminho real do produto, não uma função interna.
//
// ⚠️ CONTROLE DE SENSIBILIDADE: clica-se também numa amostra de elementos que NÃO
// se mexeram. Se o editor relatar movimento para todo mundo, o instrumento não
// discrimina e o numerador não significa nada.
//
// ⚠️ Um elemento que se mexe mas o bridge não deixa SELECIONAR é contado à parte:
// é limitação real de alcance (o usuário não consegue chegar nele), não falha do
// instrumento.
//
// Uso: node _probe-alcance-editor.mjs <url>
import { chromium } from 'playwright-core';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const url = process.argv[2];
if (!url) { console.error('uso: node _probe-alcance-editor.mjs <url>'); process.exit(2); }

const bridgeSrc = getRuntimeBridgeSource();
const POSICOES = 7;      // paradas de rolagem
const MAX_ALVOS = 30;    // moveram, amostrados para clique
const MAX_CONTROLE = 15; // não moveram, para sensibilidade

const HARNESS = `
window.__H = (() => {
  const V1 = 'uncraft-motion-editor/v1', V2 = 'uncraft-motion-editor/v2';
  const NONCE = 'nonce-alcance-1234567', BUNDLE = 'bundle-alc', SESSION = 'session-alc';
  const ORIGIN = 'https://app.uncraft.test';
  const messages = []; let generation = null, seq = 0;
  function boot() {
    const cfg = document.createElement('script');
    cfg.type = 'application/json'; cfg.dataset.uncraftRuntimeConfig = 'true';
    cfg.textContent = JSON.stringify({
      initialManifest: { schemaVersion: 2, baseBundleId: BUNDLE, transactions: [] },
      runtimeSessionId: SESSION, runtimeFingerprint: 'sha256:alcance', sessionNonce: NONCE,
    });
    document.head.appendChild(cfg);
    window.postMessage = (m) => messages.push(m);
    window.eval(window.__BRIDGE_SRC);
    const ready = messages.filter((m) => m.type === 'runtime-ready').pop();
    generation = ready && ready.payload ? ready.payload.runtimeGeneration : null;
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: ORIGIN, data: {
      protocol: V1, protocolVersion: V1, supportedProtocols: [V2, V1], source: 'host',
      type: 'negotiate-protocol', requestId: 'neg-alc', sessionNonce: NONCE,
      runtimeGeneration: generation, bundleId: BUNDLE, sessionId: SESSION,
      payload: { selectedProtocol: V2 } } }));
    const neg = messages.filter((m) => m.type === 'protocol-negotiated').pop();
    return { negociou: neg && neg.payload && neg.payload.selectedProtocol === V2 };
  }
  // Clica como o usuário e devolve o que o editor publicou sobre a seleção.
  function clicar(idx) {
    const el = document.querySelector('[data-probe-idx="' + idx + '"]');
    if (!el) return { erro: 'sumiu' };
    const antes = messages.length;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const sel = messages.slice(antes).filter((m) => m.type === 'selection-changed').pop();
    if (!sel) return { selecionavel: false };
    const e = sel.payload && sel.payload.element;
    if (!e) return { selecionavel: false };
    const motion = e.motion || [];
    return {
      selecionavel: true,
      // O bridge pode resolver a seleção para um ANCESTRAL. Registra-se isso:
      // o usuário chegou em movimento, mas talvez não no elemento que ele mirou.
      mesmoElemento: e.id === el.getAttribute('data-uncraft-id'),
      clipes: motion.length,
      engines: [...new Set(motion.map((m) => m.engine || 'desconhecido'))],
    };
  }
  return { boot, clicar, messages };
})();
`;

const MARCAR = () => {
  let i = 0;
  for (const el of document.querySelectorAll('body *')) {
    el.setAttribute('data-probe-idx', String(i));
    i += 1;
    if (i >= 4000) break;
  }
  return i;
};

// Aparência PRÓPRIA. `transform` computado é o do elemento, não o acumulado.
const AMOSTRAR = () => {
  const saida = {};
  for (const el of document.querySelectorAll('[data-probe-idx]')) {
    const cs = getComputedStyle(el);
    saida[el.getAttribute('data-probe-idx')] =
      (cs.transform === 'none' ? '' : cs.transform) + '|' + cs.opacity + '|' + cs.visibility;
  }
  return saida;
};

const browser = await chromium.launch({ headless: true });
const out = { url };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate((src) => { window.__BRIDGE_SRC = src; }, bridgeSrc);
  await page.evaluate(HARNESS);
  out.marcados = await page.evaluate(MARCAR);

  const altura = await page.evaluate(() => document.body.scrollHeight);
  const maxScroll = Math.max(0, altura - 900);
  const mudou = new Set();
  let anterior = null;

  for (let i = 0; i < POSICOES; i += 1) {
    const y = Math.round((maxScroll * i) / Math.max(1, POSICOES - 1));
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(700);
    const a1 = await page.evaluate(AMOSTRAR);
    // Segundo instante na MESMA posição: pega movimento dirigido por TEMPO
    // (loop, Lottie, entrada em andamento), que uma amostra só perderia.
    await page.waitForTimeout(700);
    const a2 = await page.evaluate(AMOSTRAR);
    for (const k of Object.keys(a1)) {
      if (a2[k] !== undefined && a2[k] !== a1[k]) mudou.add(k);
      if (anterior && anterior[k] !== undefined && anterior[k] !== a1[k]) mudou.add(k);
    }
    anterior = a2;
  }
  out.moveram = mudou.size;

  // Volta ao topo e liga o bridge só agora: durante a observação ele não deve
  // interferir na página.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  out.bridge = await page.evaluate(() => window.__H.boot());

  const listaMoveu = [...mudou];
  const passo = Math.max(1, Math.floor(listaMoveu.length / MAX_ALVOS));
  const alvos = listaMoveu.filter((_, i) => i % passo === 0).slice(0, MAX_ALVOS);
  const parados = [];
  for (let i = 0; i < out.marcados && parados.length < MAX_CONTROLE; i += 37) {
    if (!mudou.has(String(i))) parados.push(String(i));
  }

  async function clicarLote(lista) {
    const r = [];
    for (const idx of lista) {
      // Traz o elemento para a viewport: o bridge pode ignorar clique fora dela.
      await page.evaluate((i) => {
        const el = document.querySelector('[data-probe-idx="' + i + '"]');
        if (el) el.scrollIntoView({ block: 'center' });
      }, idx);
      await page.waitForTimeout(120);
      r.push(await page.evaluate((i) => window.__H.clicar(i), idx));
    }
    return r;
  }

  const rMoveu = await clicarLote(alvos);
  const rParado = await clicarLote(parados);

  const comMovimento = (r) => r.filter((x) => x.selecionavel && x.clipes > 0);
  const engines = {};
  comMovimento(rMoveu).forEach((x) => x.engines.forEach((e) => { engines[e] = (engines[e] || 0) + 1; }));

  out.amostra = {
    moveramAmostrados: rMoveu.length,
    naoSelecionaveis: rMoveu.filter((x) => !x.selecionavel).length,
    editorOfereceMovimento: comMovimento(rMoveu).length,
    resolveuNoMesmoElemento: comMovimento(rMoveu).filter((x) => x.mesmoElemento).length,
    engines,
    // CONTROLE: quantos dos PARADOS o editor também diz ter movimento.
    controleParados: rParado.length,
    controleComMovimento: comMovimento(rParado).length,
  };
  const a = out.amostra;
  out.resumo = {
    alcanceNaAmostra: a.moveramAmostrados ? Number((a.editorOfereceMovimento / a.moveramAmostrados).toFixed(3)) : null,
    // Sem contraste entre os dois braços, o alcance não é legível.
    instrumentoDiscrimina: a.controleParados > 0
      && (a.controleComMovimento / a.controleParados) < (a.editorOfereceMovimento / Math.max(1, a.moveramAmostrados)),
  };
} catch (e) {
  out.erro = String(e).slice(0, 200);
}
await browser.close();
console.log(JSON.stringify(out));
