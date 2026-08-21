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
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { chromium as chromiumPadrao } from 'playwright-core';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PREVIEW_VIDEO_PATH, PREVIEW_VIDEO_MAX_BYTES, PREVIEW_VIDEO_SIZE, previewCaptureEnabled,
} from '../preview-video.js';

/**
 * SSRF — o produtor GRAVA o corpo de cada resposta num bundle que o usuário vê.
 * Sem este bloqueio, uma página pública pode pedir `169.254.169.254` ou um
 * serviço interno e o conteúdo sai do outro lado. É diferente de só buscar a
 * URL: aqui há EXFILTRAÇÃO. Achado P0 do Sol.
 */
const FAIXAS_PROIBIDAS = [
  /^127\./, /^10\./, /^169\.254\./, /^192\.168\./, /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];
function ipEhPrivado(ip) {
  if (!ip) return true;
  if (isIP(ip) === 6) {
    const n = ip.toLowerCase();
    return n === '::1' || n === '::' || n.startsWith('fc') || n.startsWith('fd')
      || n.startsWith('fe80') || n.startsWith('::ffff:127.') || n.startsWith('::ffff:10.')
      || n.startsWith('::ffff:169.254.') || n.startsWith('::ffff:192.168.');
  }
  return FAIXAS_PROIBIDAS.some((r) => r.test(ip));
}
const cacheHost = new Map();
export async function hostEhPublico(hostname) {
  if (cacheHost.has(hostname)) return cacheHost.get(hostname);
  let ok = false;
  try {
    if (isIP(hostname)) ok = !ipEhPrivado(hostname);
    else {
      const enderecos = await lookup(hostname, { all: true });
      // TODOS precisam ser públicos: um nome que resolve para público E privado
      // é o vetor clássico de rebind.
      ok = enderecos.length > 0 && enderecos.every((e) => !ipEhPrivado(e.address));
    }
  } catch (_) { ok = false; }
  cacheHost.set(hostname, ok);
  return ok;
}

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
// Página com altura absurda mantinha o navegador rolando por horas (P0 do Sol).
const MAX_ALTURA_PX = 120000;

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
/**
 * Anexa o vídeo do preview ao bundle. Exportada porque é a parte que pode
 * ERRAR (teto, arquivo vazio, leitura falha) e precisa de teste próprio — a
 * gravação em si é comportamento do Playwright, provado por testemunha.
 *
 * Contrato: fail-open TOTAL. Qualquer problema vira uma linha em `descartados`
 * e o clone segue inteiro; o node volta a mostrar o PNG, que é o de hoje.
 */
export async function anexarPreviewAoBundle({ assets, descartados, gravacao, ler = readFile, medir = stat }) {
  if (!gravacao) return null;
  try {
    const caminho = await gravacao.path();
    if (!caminho) { descartados.push({ u: PREVIEW_VIDEO_PATH, motivo: 'preview sem arquivo' }); return null; }
    // ⚠️ O TAMANHO vem do disco ANTES de ler. Ler para depois comparar carrega
    // o arquivo inteiro na memória — foi exatamente o P0 que o Sol pegou no
    // `res.body()` da coleta de assets, e uma página patológica (o teto de
    // altura permite 120000px) produz um webm bem maior que o limite.
    const { size } = await medir(caminho);
    if (size > PREVIEW_VIDEO_MAX_BYTES) {
      descartados.push({ u: PREVIEW_VIDEO_PATH, motivo: `preview grande demais (${size}B)` });
      return null;
    }
    const bytes = await ler(caminho);
    if (!bytes || bytes.byteLength === 0) {
      descartados.push({ u: PREVIEW_VIDEO_PATH, motivo: 'preview vazio' });
      return null;
    }
    if (bytes.byteLength > PREVIEW_VIDEO_MAX_BYTES) {
      descartados.push({ u: PREVIEW_VIDEO_PATH, motivo: `preview grande demais (${bytes.byteLength}B)` });
      return null;
    }
    const asset = { path: PREVIEW_VIDEO_PATH, body: new Uint8Array(bytes), contentType: 'video/webm' };
    assets.push(asset);
    return asset;
  } catch (e) {
    descartados.push({ u: PREVIEW_VIDEO_PATH, motivo: `preview falhou: ${String(e?.message || e).slice(0, 80)}` });
    return null;
  }
}

export async function captureNativeBundle(url, opts = {}) {
  const { onProgress = () => {}, viewport = { width: 1440, height: 900 }, chromium, signal,
    preview = previewCaptureEnabled() } = opts;

  // A URL de ENTRADA passa pelo mesmo bloqueio dos subrecursos.
  const alvo = new URL(url);
  if (!/^https?:$/.test(alvo.protocol) || !(await hostEhPublico(alvo.hostname))) {
    throw Object.assign(new Error('native_bundle_blocked_host'), { code: 'blocked_host' });
  }

  onProgress({ etapa: 'launching' });
  const browser = await abrirNavegador(chromium);
  const recursos = new Map();   // url absoluta -> { bytes, contentType }
  let bytesTotal = 0;
  const descartados = [];
  // ⚠️ Os handlers de `response` são assíncronos e ninguém os aguardava: a
  // montagem do bundle podia rodar com corpos ainda em leitura, e eles sumiam
  // sem sequer entrar em `descartados`. Achado P1 do Sol.
  const emVoo = new Set();
  // ⚠️ O `Promise.race` de fora rejeita, mas nada cancelava a captura — o
  // navegador seguia rolando por horas numa página gigante. Achado P0 do Sol.
  let cancelado = false;
  let dirVideo = null;
  const aoCancelar = () => { cancelado = true; browser.close().catch(() => {}); };
  if (signal) {
    if (signal.aborted) { await browser.close().catch(() => {}); throw Object.assign(new Error('native_bundle_aborted'), { code: 'aborted' }); }
    signal.addEventListener('abort', aoCancelar, { once: true });
  }

  try {
    // ⏺️ PREVIEW ANIMADO — grava a passada de scroll que já acontece logo abaixo.
    // O diretório é temporário e some no `finally`; falha aqui NUNCA derruba o
    // clone (fail-open), o node só volta a mostrar o PNG.
    if (preview) {
      dirVideo = await mkdtemp(join(tmpdir(), 'uncraft-preview-')).catch(() => null);
    }
    const context = await browser.newContext({
      viewport,
      ...(dirVideo ? { recordVideo: { dir: dirVideo, size: PREVIEW_VIDEO_SIZE } } : {}),
    });
    const page = await context.newPage();
    const gravacao = dirVideo ? page.video() : null;

    page.on('response', (res) => {
      const tarefa = (async () => {
        try {
          const u = res.url();
          if (cancelado || !/^https?:/i.test(u) || recursos.has(u)) return;
          if (!(await hostEhPublico(new URL(u).hostname))) { descartados.push({ u, motivo: 'host nao publico' }); return; }
          // RESERVA a vaga antes do await: sem isso, N respostas simultâneas
          // passam pelo teste de limite antes de qualquer uma gravar.
          if (recursos.size >= MAX_ASSETS) { descartados.push({ u, motivo: 'limite de arquivos' }); return; }
          recursos.set(u, null);
          // O tamanho é conferido pelo CABEÇALHO antes de bufferizar: `body()`
          // carrega o arquivo inteiro na memória, então checar depois não limita
          // nada. Achado P0 do Sol.
          const declarado = Number(res.headers()['content-length'] || 0);
          if (declarado > MAX_ASSET_BYTES || (declarado && bytesTotal + declarado > MAX_BYTES_TOTAL)) {
            recursos.delete(u); descartados.push({ u, motivo: 'grande demais (declarado)' }); return;
          }
          const bytes = await res.body().catch(() => null);
          if (!bytes) { recursos.delete(u); return; }
          if (bytes.byteLength > MAX_ASSET_BYTES || bytesTotal + bytes.byteLength > MAX_BYTES_TOTAL) {
            recursos.delete(u); descartados.push({ u, motivo: 'grande demais' }); return;
          }
          bytesTotal += bytes.byteLength;
          recursos.set(u, { bytes, contentType: (res.headers()['content-type'] || '').split(';')[0].trim() });
        } catch (_) { /* resposta sem corpo (redirect, 204, 304) não é falha */ }
      })();
      emVoo.add(tarefa);
      tarefa.finally(() => emVoo.delete(tarefa));
    });

    onProgress({ etapa: 'navigating' });
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);

    // Percorre a página inteira: recurso preguiçoso só é pedido quando entra na
    // tela, e sem isso o bundle sairia sem metade das imagens.
    onProgress({ etapa: 'scrolling' });
    const altura = Math.min(await page.evaluate(() => document.body.scrollHeight), MAX_ALTURA_PX);
    for (let y = 0; y < altura && !cancelado; y += 700) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(160);
    }
    if (cancelado) throw Object.assign(new Error('native_bundle_aborted'), { code: 'aborted' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);

    onProgress({ etapa: 'collecting' });
    // Espera os corpos que ainda estavam sendo lidos ANTES de montar o bundle.
    await Promise.allSettled([...emVoo]);
    for (const [u, v] of [...recursos]) if (!v) { recursos.delete(u); descartados.push({ u, motivo: 'corpo nao chegou' }); }
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
    // Respostas nunca carregam fragmento, mas `page.url()` pode — e depois de um
    // redirect a URL original também não serve. Compara-se SEM fragmento dos
    // dois lados, tentando a final antes da pedida. Achado P1 do Sol.
    const semHash = (u) => u.split('#')[0];
    const finalUrl = semHash(page.url());
    const entradaOriginal = [...recursos.keys()].find((u) => semHash(u) === finalUrl)
      || [...recursos.keys()].find((u) => semHash(u) === semHash(url));
    if (!entradaOriginal) throw new Error('native_bundle_entry_not_captured');

    // ⚠️ Caminhos podem COLIDIR (`/a%20b.js` e `/a_20b.js` normalizam igual; o
    // macOS ainda trata `A.js` e `a.js` como o mesmo arquivo). Sem desempate, o
    // registrador aborta o clone inteiro. Desempata-se por conteúdo. Achado P1.
    const mapa = new Map();
    const usados = new Set();
    for (const u of recursos.keys()) {
      let caminho = bundlePathForUrl(u, page.url());
      const chave = caminho.toLowerCase();
      if (usados.has(chave)) {
        const marca = createHash('sha1').update(u).digest('hex').slice(0, 10);
        caminho = /\.[^./]+$/.test(caminho)
          ? caminho.replace(/(\.[^./]+)$/, `.${marca}$1`)
          : `${caminho}.${marca}`;
      }
      usados.add(caminho.toLowerCase());
      mapa.set(u, caminho);
    }
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
        let texto = rewriteReferences(bytes.toString('utf8'), mapa, profundidade);
        // ⚠️ Reescrever o conteúdo invalida o hash de `integrity=`, e o browser
        // passa a BLOQUEAR o próprio arquivo que acabamos de preservar — a
        // página abriria sem script nenhum. Achado P1 do Sol.
        if (/\.html?$/i.test(caminho)) texto = texto.replace(/\s+integrity=(["'])[^"']*\1/gi, '');
        corpo = Buffer.from(texto, 'utf8');
      }
      assets.push({ path: caminho, body: new Uint8Array(corpo), contentType: contentType || undefined });
    }

    await context.close();
    onProgress({ etapa: 'finalizing' });

    // O arquivo só existe depois de `context.close()` — é aí que o Playwright
    // fecha o container. Tudo aqui é fail-open: sem vídeo, o node usa o PNG.
    await anexarPreviewAoBundle({ assets, descartados, gravacao });

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
      // O relatório viaja com o resultado: sem ele o snapshot fica 'pronto'
      // mesmo faltando script ou fonte, e a falta some. Achado P1 do Sol.
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
    // O diretório temporário do vídeo some SEMPRE — inclusive quando o clone
    // falhou no meio. Em serverless o /tmp é pequeno e compartilhado entre
    // invocações: deixar arquivo para trás enche o disco silenciosamente.
    if (dirVideo) await rm(dirVideo, { recursive: true, force: true }).catch(() => {});
  }
}
