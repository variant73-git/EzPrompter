/**
 * Semelhança entre um clone e o screenshot que o originou — gravada POR CLONE.
 *
 * Pedido antigo do Adilson: o SSIM do QA offline (pasta Clone/) tinha que virar
 * acompanhamento permanente. A peça de linha de comando (`scripts/
 * medir-semelhanca.mjs`) usa ffmpeg — que NÃO existe no servidor de produção.
 * Esta aqui roda onde o clone roda: renderiza o HTML num Chromium (o mesmo
 * lançador do caminho de captura) e computa o SSIM DENTRO da página, via
 * canvas — dependência nova: nenhuma.
 *
 * ⚠️ O QUE O NÚMERO NÃO DIZ (vale aqui como lá): SSIM compara pixels
 * alinhados. Clone perfeito deslocado pontua mal; página vazia da cor do fundo
 * pontua bem. É detector de deriva entre versões do pipeline, não nota de
 * qualidade — ler junto com o olho.
 */
import { launchBrowser } from './browser.js';

/**
 * SSIM clássico (Wang et al.): janelas 8×8 andando de 4 em 4, por canal RGB,
 * média dos três — a mesma família do filtro do ffmpeg, contra o qual esta
 * implementação foi validada (delta medido nas fatias do QA do Clone/; ver
 * teste). Função PURA e sem DOM de propósito: roda no Node (testes) e dentro
 * do browser (produção) via serialização — o mesmo padrão do observeInPage
 * do design-eval.
 *
 * @param a,b Uint8ClampedArray RGBA (ImageData.data) do MESMO tamanho
 */
export function computeSsimRgb(a, b, width, height) {
  if (a.length !== b.length || a.length !== width * height * 4) {
    throw new Error('computeSsimRgb: buffers e dimensões não batem');
  }
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const JANELA = 8;
  const PASSO = 4;
  let soma = 0;
  let janelas = 0;
  for (let canal = 0; canal < 3; canal += 1) {
    for (let y = 0; y + JANELA <= height; y += PASSO) {
      for (let x = 0; x + JANELA <= width; x += PASSO) {
        let ma = 0; let mb = 0;
        for (let j = 0; j < JANELA; j += 1) {
          for (let i = 0; i < JANELA; i += 1) {
            const p = ((y + j) * width + (x + i)) * 4 + canal;
            ma += a[p]; mb += b[p];
          }
        }
        const n = JANELA * JANELA;
        ma /= n; mb /= n;
        let va = 0; let vb = 0; let cov = 0;
        for (let j = 0; j < JANELA; j += 1) {
          for (let i = 0; i < JANELA; i += 1) {
            const p = ((y + j) * width + (x + i)) * 4 + canal;
            const da = a[p] - ma; const db = b[p] - mb;
            va += da * da; vb += db * db; cov += da * db;
          }
        }
        va /= n - 1; vb /= n - 1; cov /= n - 1;
        soma += ((2 * ma * mb + C1) * (2 * cov + C2))
          / ((ma * ma + mb * mb + C1) * (va + vb + C2));
        janelas += 1;
      }
    }
  }
  return janelas ? soma / janelas : 0;
}

/**
 * Mede a semelhança entre o HTML de um clone e o screenshot-fonte.
 *
 * Renderiza o clone no MESMO tamanho da fonte (senão o SSIM compararia coisas
 * desalinhadas por construção) e computa dentro da página. Falha vira `null`
 * lá no chamador — medição nunca pode derrubar um clone que deu certo.
 *
 * @param html               o clone completo (auto-contido)
 * @param screenshotDataUrl  a fonte (data URL de imagem)
 * @param opts.browser       reusar um browser aberto (senão lança e fecha um)
 * @param opts.signal        aborta entre as etapas (prazo da rota)
 * @returns { ssim, width, height, ms }
 */
export async function measureCloneSimilarity(html, screenshotDataUrl, { browser = null, signal } = {}) {
  const t0 = Date.now();
  const proprio = !browser;
  const nav = browser || await launchBrowser();
  try {
    if (signal?.aborted) throw new Error('aborted');
    const page = await nav.newPage();
    try {
      // 1) dimensões reais da fonte, medidas pela própria imagem
      const dims = await page.evaluate((dataUrl) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('screenshot-fonte ilegível'));
        img.src = dataUrl;
      }), screenshotDataUrl);
      if (signal?.aborted) throw new Error('aborted');

      // 2) o clone, renderizado no tamanho da fonte
      await page.setViewportSize({ width: dims.w, height: dims.h });
      await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForTimeout(400); // fontes assentarem
      const renderPng = await page.screenshot({ type: 'png' });
      const renderDataUrl = `data:image/png;base64,${renderPng.toString('base64')}`;
      if (signal?.aborted) throw new Error('aborted');

      // 3) os dois pra canvas, SSIM dentro da página (sem dependência nova).
      //    `page.evaluate` serializa a função pura — mesmo padrão do
      //    observeInPage do design-eval.
      await page.goto('about:blank');
      const ssim = await page.evaluate(async ({ fonte, render, fnSrc }) => {
        const computeSsimRgb = new Function(`return (${fnSrc})`)();
        const carregar = (dataUrl) => new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('imagem ilegível no canvas'));
          img.src = dataUrl;
        });
        const [imgA, imgB] = await Promise.all([carregar(fonte), carregar(render)]);
        const w = imgA.naturalWidth; const h = imgA.naturalHeight;
        const pixels = (img) => {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, w, h);
          return ctx.getImageData(0, 0, w, h).data;
        };
        return computeSsimRgb(pixels(imgA), pixels(imgB), w, h);
      }, { fonte: screenshotDataUrl, render: renderDataUrl, fnSrc: computeSsimRgb.toString() });

      return { ssim, width: dims.w, height: dims.h, ms: Date.now() - t0 };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (proprio) await nav.close().catch(() => {});
  }
}


import { origensDoBundle, translateRuntimeOrigins, translateRuntimeOriginsInHtml, translateRuntimeOriginsInJson } from './native-clone/translate-runtime-origins.js';

/** SSIM entre dois data-URLs, computado DENTRO de uma página (canvas). */
async function ssimEntreDataUrls(page, fonte, render) {
  return page.evaluate(async ({ a, b, fnSrc }) => {
    const computeSsimRgb = new Function(`return (${fnSrc})`)();
    const carregar = (dataUrl) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('imagem ilegível no canvas'));
      img.src = dataUrl;
    });
    const [imgA, imgB] = await Promise.all([carregar(a), carregar(b)]);
    const w = imgA.naturalWidth; const h = imgA.naturalHeight;
    const pixels = (img) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    };
    return computeSsimRgb(pixels(imgA), pixels(imgB), w, h);
  }, { a: fonte, b: render, fnSrc: computeSsimRgb.toString() });
}

/**
 * Semelhança do CLONE NATIVO: renderiza o BUNDLE (entry + assets servidos por
 * interceptação, nada de rede) e compara com o screenshot do site vivo tirado
 * na própria captura — topo da página, mesmo viewport.
 *
 * ⚠️ Mesmo aviso do measureCloneSimilarity, e mais um: o nativo tem animação
 * VIVA nos dois lados (marquee, lottie), e os relógios não estão
 * sincronizados — parte da diferença é fase de animação, não fidelidade.
 * Detector de deriva entre clones da MESMA URL; não comparar entre sites.
 */
export async function measureBundleSimilarity({ browser, assets, entryPath, screenshotDataUrl, signal }) {
  const t0 = Date.now();
  if (!browser) throw new Error('measureBundleSimilarity exige o browser da captura');
  const porCaminho = new Map();
  for (const a of assets) porCaminho.set(a.path, a);
  const hosts = origensDoBundle(assets);
  const page = await browser.newPage();
  let erroDeServico = null;   // throw dentro do route handler não propaga sozinho
  try {
    if (signal?.aborted) throw new Error('aborted');
    const dims = await page.evaluate((dataUrl) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error('screenshot-fonte ilegível'));
      img.src = dataUrl;
    }), screenshotDataUrl);
    await page.setViewportSize({ width: dims.w, height: dims.h });

    // Serve o bundle por interceptação: origem sintética, caminho → asset.
    // Fora do bundle = abortado (o render é offline por construção).
    // ⚠️ https DE PROPÓSITO: origem http não-localhost não é contexto seguro,
    // `crypto.randomUUID` não existe, e o script do site morre no início —
    // medido: 3 tweens em vez de 138, preloader eterno, SSIM 0,57 "parecendo
    // funcionar". A interceptação atende https sem TLS real.
    const ORIGEM = 'https://uncraft-bundle.invalid';
    await page.route('**/*', (rota) => {
      const u = rota.request().url();
      if (!u.startsWith(ORIGEM)) return rota.abort();
      let caminho = decodeURIComponent(new URL(u).pathname).replace(/^\/+/, '');
      if (!caminho) caminho = entryPath;
      // URLs traduzidas chegam sob /b/… — tenta o caminho exato primeiro.
      let asset = porCaminho.get(caminho);
      if (!asset && caminho.startsWith('b/')) { caminho = caminho.slice(2); asset = porCaminho.get(caminho); }
      if (!asset) return rota.abort();
      // ⚠️ A TRADUÇÃO DE ORIGENS acontece no PORTÃO, na hora de servir — não
      // está gravada no bundle. Servir os arquivos crus deixou 264 pedidos
      // indo ao CDN absoluto, o preloader esperando o primeiro quadro da
      // sequência e o render inteiro bege (medido; SSIM 0,55 num clone que a
      // bateria mede em ~0,96). Este servidor replica o passo do portão.
      let corpo = Buffer.from(asset.body);
      const tipo = asset.contentType || '';
      // ⚠️ O tradutor EXIGE base não-vazia (`runtimeBase: ''` lança) — e a
      // primeira versão engolia o throw num catch mudo e servia tudo CRU: a
      // medida saía 0,58 parecendo funcionar. Base '/b' + normalização no
      // roteador; falha de tradução agora é DITA, nunca muda o resultado em
      // silêncio.
      try {
        if (/^(?:text|application)\/javascript(?:;|$)/i.test(tipo)) {
          corpo = Buffer.from(translateRuntimeOrigins(corpo.toString('utf8'), { hosts, runtimeBase: '/b' }).texto);
        } else if (/^application\/json(?:;|$)/i.test(tipo)) {
          corpo = Buffer.from(translateRuntimeOriginsInJson(corpo.toString('utf8'), { hosts, runtimeBase: '/b' }).texto);
        } else if (/^text\/html(?:;|$)/i.test(tipo)) {
          corpo = Buffer.from(translateRuntimeOriginsInHtml(corpo.toString('utf8'), { hosts, runtimeBase: '/b' }).texto);
        }
      } catch (e) {
        // ⚠️ THROW do tradutor é bug da MEDIÇÃO (ex.: base inválida) — servir
        // cru e seguir gravaria um SSIM contaminado como se fosse fidelidade
        // (Sol). Relançar derruba a medição inteira no fail-open externo:
        // clone preservado, similarity = null. (Tradução INCOMPLETA é outra
        // coisa: o portão também serve o original nesse caso, então o render
        // espelha o que o usuário vê — essa não anula.)
        rota.abort().catch(() => {});
        erroDeServico = erroDeServico || e;
        return undefined;
      }
      return rota.fulfill({
        status: 200,
        headers: { 'content-type': tipo || 'application/octet-stream' },
        body: corpo,
      });
    });
    await page.goto(`${ORIGEM}/${entryPath}`, { waitUntil: 'load', timeout: 30_000 });
    // Espera a ENTRADA assentar antes de mexer: o preloader deste tipo de
    // site leva ~5s, e fotografar no meio mede a fase da intro, não o clone.
    // Sinal genérico: GSAP ocioso (nenhum tween ativo) em duas leituras
    // seguidas; site sem GSAP pula; teto de 10s.
    for (let i = 0, ociosas = 0; i < 20 && ociosas < 2; i += 1) {
      const ativos = await page.evaluate(() =>
        window.gsap ? (window.gsap.globalTimeline?.getChildren?.(true, true, false) || []).filter((t) => t.isActive?.()).length : null);
      if (ativos === null) break;
      ociosas = ativos === 0 ? ociosas + 1 : 0;
      if (ociosas < 2) await page.waitForTimeout(500);
    }
    // ⚠️ MESMO PROCEDIMENTO do lado vivo, senão a medida compara FASES: a
    // referência foi tirada depois da travessia inteira (intro terminada,
    // preguiçosas carregadas) — um render fotografado 1,2s após carregar está
    // no meio da animação de entrada e marcou 0,556 num clone que a bateria
    // mede em ~0,96. Travessia rápida + volta ao topo + assentar, igual lá.
    const alturaRender = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < Math.min(alturaRender, 30_000); y += 700) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(80);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    if (signal?.aborted) throw new Error('aborted');
    // Handlers de rota podem estar EM VOO no instante da checagem — um
    // tradutor que falhe tarde apareceria DEPOIS do screenshot (Sol). E o
    // dreno sozinho não basta: sem rota, pedido posterior iria à REDE REAL,
    // que não garante falha nem inércia (Sol, rodada seguinte). Ordem:
    // (1) guarda no CONTEXTO aborta e REGISTRA qualquer pedido tardio;
    // (2) drena os handlers da página; (3) decide; (4) fotografa;
    // (5) pedido tardio ao PRÓPRIO bundle = a página ainda queria conteúdo
    //     que paramos de servir → medida suspeita → anula (fail-open).
    //     Tardio externo (beacon) é registrado e não altera pixel servido.
    const tardios = [];
    const contexto = page.context();
    await contexto.route('**/*', (rota) => {
      tardios.push(rota.request().url());
      return rota.abort();
    });
    await page.unrouteAll({ behavior: 'wait' });
    if (erroDeServico) throw erroDeServico;
    const renderPng = await page.screenshot({ type: 'png' });
    const renderDataUrl = `data:image/png;base64,${renderPng.toString('base64')}`;
    // O julgamento vem DEPOIS que a página morre: navegar para about:blank
    // encerra o documento — nenhum pedido novo pode nascer dele — e só então
    // o registro é lido, cobrindo por ORDEM tudo desde o dreno, inclusive um
    // pedido nascido entre o screenshot e a navegação (Sol: julgar antes
    // deixava janela). Pedido tardio ao próprio bundle = a página ainda
    // queria conteúdo no instante da foto → medida suspeita → anula.
    // FAIL-CLOSED para o NÚMERO (nenhum SSIM suspeito é gravado); o fail-open
    // é do CLONE, no chamador — a captura segue e grava similarity null.
    await page.goto('about:blank');
    const tardiosDoBundle = tardios.filter((u) => u.startsWith(ORIGEM));
    if (tardiosDoBundle.length) {
      throw new Error(`render pediu conteudo do bundle apos o dreno (${tardiosDoBundle.length})`);
    }
    await contexto.unroute('**/*').catch(() => {});
    const ssim = await ssimEntreDataUrls(page, screenshotDataUrl, renderDataUrl);
    return { ssim, width: dims.w, height: dims.h, ms: Date.now() - t0 };
  } finally {
    await page.close().catch(() => {});
  }
}
