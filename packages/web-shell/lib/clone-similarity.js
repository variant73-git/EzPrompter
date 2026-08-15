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
