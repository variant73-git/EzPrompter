/**
 * PRODUTOR DE CLONE NATIVO — a peça que faltava.
 *
 * O plano da frente (2026-07-26, l.332) pedia: "Extend deferred reconstruction
 * with an explicit native result kind. Keep the current Iter9 result path
 * unchanged." O lado que RECEBE foi construído (`register-bundle.js`,
 * `bundle-store.js`, a rota `/api/native-clone`); o lado que PRODUZ nunca foi.
 * Sem ele, `reconstructSiteNode` só tem `reconstructPage`, que devolve HTML de
 * visão — e esse HTML **descarta o movimento** (medido: zero ocorrências de
 * gsap/@keyframes/animation na saída).
 *
 * Este produtor faz o oposto do iter9: em vez de reconstruir a aparência por
 * visão, ele **preserva o site** — baixa cada recurso que a página pediu,
 * reescreve as referências para caminhos do bundle e mantém os scripts vivos.
 * É o mesmo princípio do clone que já provou fidelidade neste projeto
 * (`Clone/`, SSIM 0,96, altura exata, 369 assets).
 *
 * O que ele NÃO faz, e não finge fazer: não grava vídeo de referência, não
 * documenta inventário de animação e não roda QA offline. Essas três etapas da
 * receita original continuam fora. Aqui está a base — a página independente do
 * domínio, com o runtime do site preservado, no formato que o editor consome.
 */
import { createHash } from 'node:crypto';
import { chromium as chromiumPadrao } from 'playwright-core';

/**
 * Mesma política de navegador do caminho de captura já existente: usa o
 * Browserbase quando há chave, senão um Chromium local. Sem isto o produtor
 * funcionaria no laboratório e falharia no servidor, que é o modo de falha que
 * separou o editor do produto até agora.
 */
async function abrirNavegador(launcher) {
  const chromium = launcher || chromiumPadrao;
  if (!launcher && process.env.BROWSERBASE_API_KEY) {
    return chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(process.env.BROWSERBASE_API_KEY)}`);
  }
  return chromium.launch({ headless: true });
}

const MAX_ASSETS = 1200;
const MAX_BYTES_TOTAL = 220 * 1024 * 1024;
const MAX_ASSET_BYTES = 40 * 1024 * 1024;

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/**
 * Caminho de bundle a partir de uma URL absoluta. Determinístico e sem colisão
 * entre hosts: o host entra no caminho, então dois CDNs com `/main.js` não se
 * sobrescrevem.
 */
export function bundlePathForUrl(rawUrl, entryUrl) {
  const url = new URL(rawUrl);
  const entry = new URL(entryUrl);
  const mesmoHost = url.host === entry.host;
  let caminho = url.pathname.replace(/^\/+/, '');
  if (!caminho || caminho.endsWith('/')) caminho += 'index.html';
  // A query faz parte da identidade do recurso: `?v=2` costuma ser outro
  // arquivo. Sem isso, duas versões colidiriam e uma sumiria em silêncio.
  if (url.search) {
    const marca = createHash('sha1').update(url.search).digest('hex').slice(0, 8);
    caminho = caminho.replace(/(\.[^./]+)$/, `.${marca}$1`) || `${caminho}.${marca}`;
    if (!/\.[^./]+$/.test(caminho)) caminho += `.${marca}`;
  }
  const prefixo = mesmoHost ? '' : `_ext/${url.host}/`;
  return `${prefixo}${caminho}`
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/[^A-Za-z0-9._/-]/g, '_');
}

/**
 * Reescreve toda referência absoluta que foi capturada para o caminho relativo
 * do bundle. Só troca URLs que EXISTEM no mapa — o que não foi capturado fica
 * como está, e o relatório diz quais são, em vez de quebrar em silêncio.
 */
export function rewriteReferences(texto, mapa, profundidade = 0) {
  const subir = profundidade > 0 ? '../'.repeat(profundidade) : './';
  let saida = texto;
  // Ordena do mais longo para o mais curto: senão uma URL que é prefixo de
  // outra substitui primeiro e corrompe a mais longa.
  const urls = [...mapa.keys()].sort((a, b) => b.length - a.length);
  for (const url of urls) {
    if (!saida.includes(url)) continue;
    saida = saida.split(url).join(`${subir}${mapa.get(url)}`);
  }
  return saida;
}

const TEXTUAL = /\.(html?|css|js|mjs|json|svg|txt|webmanifest)$/i;

/**
 * Captura uma URL como bundle nativo.
 *
 * @param {string} url
 * @param {object} opts
 * @param {(estado: object) => void} [opts.onProgress]
 * @param {object} [opts.browser] navegador já aberto (para teste)
 * @returns {Promise<{kind:'native', bundle:object, relatorio:object}>}
 */
export async function captureNativeBundle(url, opts = {}) {
  const { onProgress = () => {}, viewport = { width: 1440, height: 900 }, chromium } = opts;

  onProgress({ etapa: 'launching' });
  const browser = await abrirNavegador(chromium);
  const recursos = new Map();   // url absoluta -> { bytes, contentType }
  let bytesTotal = 0;
  const descartados = [];

  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    page.on('response', async (res) => {
      try {
        const u = res.url();
        if (!/^https?:/i.test(u) || recursos.has(u)) return;
        if (recursos.size >= MAX_ASSETS) { descartados.push({ u, motivo: 'limite de arquivos' }); return; }
        const bytes = await res.body().catch(() => null);
        if (!bytes) return;
        if (bytes.byteLength > MAX_ASSET_BYTES) { descartados.push({ u, motivo: 'arquivo grande demais' }); return; }
        if (bytesTotal + bytes.byteLength > MAX_BYTES_TOTAL) { descartados.push({ u, motivo: 'limite total' }); return; }
        bytesTotal += bytes.byteLength;
        recursos.set(u, { bytes, contentType: (res.headers()['content-type'] || '').split(';')[0].trim() });
      } catch (_) { /* resposta que não dá corpo (redirect, 204) não é falha */ }
    });

    onProgress({ etapa: 'navigating' });
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);

    // Percorre a página inteira: recurso preguiçoso só é pedido quando entra na
    // tela, e sem isso o bundle sairia sem metade das imagens.
    onProgress({ etapa: 'scrolling' });
    const altura = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < altura; y += 700) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(160);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);

    onProgress({ etapa: 'collecting' });
    const engines = await page.evaluate(() => ({
      gsap: Boolean(window.gsap),
      scrollTrigger: Boolean(window.ScrollTrigger || (window.gsap && window.gsap.plugins && window.gsap.plugins.ScrollTrigger)),
      lenis: Boolean(window.lenis),
      lottie: Boolean(window.lottie || window.bodymovin),
      browserAnimations: typeof document.getAnimations === 'function' ? document.getAnimations().length : 0,
    }));

    // ⚠️ O HTML do bundle é o DOM SERVIDO, não o serializado do DOM vivo. Um DOM
    // vivo já mutado pelos scripts, servido de novo COM os scripts, seria
    // processado duas vezes — animação de entrada partindo do estado final,
    // elementos duplicados. Preservar significa entregar o documento original.
    const entradaOriginal = [...recursos.keys()].find((u) => u === page.url())
      || [...recursos.keys()].find((u) => u.split('#')[0] === url.split('#')[0]);
    if (!entradaOriginal) throw new Error('native_bundle_entry_not_captured');

    const mapa = new Map();
    for (const u of recursos.keys()) mapa.set(u, bundlePathForUrl(u, page.url()));
    // ⚠️ Uma URL como `/promo` vira o caminho `promo`, SEM extensão — e qualquer
    // servidor estático entrega isso como binário, então a página nunca abre.
    // Renomeia-se a entrada ANTES de reescrever, para que toda referência a ela
    // aponte para o nome novo.
    const entradaBruta = mapa.get(entradaOriginal);
    if (!/\.html?$/i.test(entradaBruta)) {
      const dir = entradaBruta.includes('/') ? entradaBruta.slice(0, entradaBruta.lastIndexOf('/') + 1) : '';
      mapa.set(entradaOriginal, `${dir}index.html`);
    }
    const entryPath = mapa.get(entradaOriginal);

    const assets = [];
    for (const [u, { bytes, contentType }] of recursos) {
      const caminho = mapa.get(u);
      const profundidade = caminho.split('/').length - 1;
      let corpo = bytes;
      if (TEXTUAL.test(caminho) || /^(text|application)\/(html|css|javascript|json|xml)/.test(contentType || '')) {
        corpo = Buffer.from(rewriteReferences(bytes.toString('utf8'), mapa, profundidade), 'utf8');
      }
      assets.push({ path: caminho, body: new Uint8Array(corpo), contentType: contentType || undefined });
    }

    await context.close();
    onProgress({ etapa: 'finalizing' });

    return {
      kind: 'native',
      bundle: {
        entryPath,
        assets,
        runtimeFingerprint: sha256(Buffer.from(assets.map((a) => a.path).sort().join('\n'))),
        reconstructionCapabilities: {
          detectedEngines: Object.entries(engines).filter(([, v]) => v).map(([k]) => k),
          candidateControls: [],
        },
      },
      relatorio: {
        arquivos: assets.length,
        bytes: bytesTotal,
        entryPath,
        engines,
        // Nada some em silêncio: o que não coube é nomeado.
        descartados: descartados.slice(0, 40),
        totalDescartados: descartados.length,
      },
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
