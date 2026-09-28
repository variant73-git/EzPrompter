// VERBATIM — etapas 1 e 2 da receita (docs/clone-verbatim/CLONE_PROMPT.md):
// gravar a referência ANTES de tocar em código, e inventariar o que a página
// faz. Zero IA. O que sai daqui é o INSUMO da re-expressão (etapa 3) e a
// evidência de revisão que a receita exige como entregável.
//
// Etapa 1 — gravação:
//   "viewport 1440x1200, DPR 1, zoom 100%, Chromium; comece a gravação antes
//    do carregamento para capturar o preloader; um único scroll vertical,
//    contínuo, uniforme e sem interrupções, do topo absoluto ao fim absoluto;
//    não reverta, não arraste a barra, não acione hovers; permaneça no fim."
//   O scroll é feito por rAF a velocidade constante — não por saltos — porque
//   é a coreografia que está sendo gravada, e salto não é scroll.
//   ⚠️ A gravação NÃO é o substrato da métrica: vídeo é com perda e duas
//   gravações do mesmo conteúdo já diferem por ruído de codec. Quem mede é o
//   portão (scripts/verbatim-gate.mjs), em PNG sem perda. Isto aqui é a
//   referência humana de coreografia, como a receita pede.
//
// Etapa 2 — inventário: reusa o coletor que já existe no produto
//   (lib/remake/motion-evidence.js), que interroga o GSAP/ScrollTrigger VIVO e
//   devolve valores observáveis (duração, delay, easing, stagger, scrub) em vez
//   de adivinhar por screenshot.
//   Colhe-se DUAS vezes, depois da entrada e no fim do percurso. Eu supunha que
//   a segunda pegaria gatilhos "nascidos" durante a rolagem; a MEDIDA refutou:
//   no farmminerals a primeira colheita é a completa (107 únicas) e a segunda
//   não traz NENHUMA exclusiva — ela PERDE 44, porque o GSAP descarta tween
//   concluído. Logo `aposEntrada` é a fonte do inventário e `aposPercurso`
//   fica como verificação (denuncia se algo só existir tarde em outro site).
//
// USO
//   node scripts/verbatim-source.mjs --url https://site/ --out _verbatim/source

import { mkdir, writeFile, rename, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { coletorNaPagina } from '../lib/remake/motion-evidence.js';

const VIEWPORT = { width: 1440, height: 1200 };   // a receita
const SETTLE_MS = 4000;      // deixa preloader + animação de entrada terminarem
const SCROLL_PX_PER_SEC = 700;
const SCROLL_CAP_MS = 120000;
const HOLD_MS = 4000;        // permanência no fim, para o rodapé animar

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function temFfmpeg() {
  return new Promise((r) => {
    const p = spawn('ffmpeg', ['-version']);
    p.on('error', () => r(false));
    p.on('close', (code) => r(code === 0));
  });
}

function converterParaMp4(webm, mp4) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-y', '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', mp4], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

// Um único scroll contínuo e uniforme, por rAF. Devolve o que realmente
// aconteceu — a altura pode CRESCER durante a descida (conteúdo preguiçoso),
// e é isso que a receita quer registrado em "distância final de scroll".
async function scrollContinuo(page, pxPorSegundo, capMs) {
  return page.evaluate(async ([velocidade, cap]) => {
    const alturaTotal = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const maximo = () => Math.max(0, alturaTotal() - window.innerHeight);
    const inicio = performance.now();
    let ultimo = inicio;
    await new Promise((resolve) => {
      const passo = (agora) => {
        const dt = Math.min(0.05, (agora - ultimo) / 1000);
        ultimo = agora;
        window.scrollTo(0, window.scrollY + velocidade * dt);
        const fim = window.scrollY >= maximo() - 2;
        if (fim || agora - inicio > cap) { resolve(); return; }
        requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    });
    return {
      duracaoMs: Math.round(performance.now() - inicio),
      alturaFinal: alturaTotal(),
      scrollFinal: Math.round(window.scrollY),
      maximoFinal: maximo(),
    };
  }, [pxPorSegundo, capMs]);
}

async function main() {
  const url = arg('--url');
  const out = arg('--out', '_verbatim/source');
  if (!url) { console.error('uso: --url <url> [--out <dir>]'); process.exit(2); }
  await mkdir(out, { recursive: true });

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  // recordVideo começa no momento em que o contexto nasce: a gravação já está
  // rodando quando a navegação parte, que é a exigência da etapa 1 (pegar o
  // preloader e a animação inicial).
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: out, size: VIEWPORT },
  });
  const page = await context.newPage();

  const consoleErros = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErros.push(m.text().slice(0, 160)); });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(SETTLE_MS);

  // Etapa 2, primeira colheita: depois da entrada, antes de rolar.
  const inventarioTopo = await page.evaluate(coletorNaPagina()).catch((e) => ({ erro: String(e?.message || e) }));

  const percurso = await scrollContinuo(page, SCROLL_PX_PER_SEC, SCROLL_CAP_MS);
  await page.waitForTimeout(HOLD_MS);

  // Segunda colheita: gatilhos que só existem depois de a página ser percorrida.
  const inventarioFim = await page.evaluate(coletorNaPagina()).catch((e) => ({ erro: String(e?.message || e) }));

  const geometria = await page.evaluate(() => ({
    alturaPagina: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    larguraViewport: window.innerWidth,
    alturaViewport: window.innerHeight,
    dpr: window.devicePixelRatio,
    secoes: document.querySelectorAll('section, [class*="section" i]').length,
    imagens: document.images.length,
    imagensDecodificadas: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length,
    texto: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
  }));

  const versaoNavegador = browser.version();
  await context.close();   // <- só aqui o vídeo é finalizado e gravado
  await browser.close();

  // O arquivo sai com nome aleatório; renomeia para algo que se possa citar.
  const arquivos = await readdir(out);
  const bruto = arquivos.find((f) => f.endsWith('.webm'));
  let video = null;
  if (bruto) {
    video = path.join(out, 'reference.webm');
    await rename(path.join(out, bruto), video);
    if (await temFfmpeg()) {
      const mp4 = path.join(out, 'reference.mp4');
      if (await converterParaMp4(video, mp4)) video = mp4;   // a receita pede MP4
    }
  }

  const contar = (inv) => ({
    animacoes: Array.isArray(inv?.animacoes) ? inv.animacoes.length : 0,
    gatilhosDeRolagem: Array.isArray(inv?.rolagem) ? inv.rolagem.length : 0,
    animacoesCss: Array.isArray(inv?.css) ? inv.css.length : 0,
    motores: inv?.motores || null,
  });

  const meta = {
    url,
    gravadoEm: new Date().toISOString(),
    navegador: `Chromium ${versaoNavegador} (canal chrome)`,
    viewport: VIEWPORT,
    dpr: 1,
    zoom: '100%',
    fpsNominal: 25,                       // cadência do gravador do Playwright
    video: video ? path.basename(video) : null,
    duracaoTotalMs: Date.now() - t0,
    scroll: percurso,
    geometria,
    consoleErros: consoleErros.length,
    // O que a receita chama de "referência complementar": a contagem por
    // colheita deixa VISÍVEL quanto nasceu durante a rolagem.
    inventario: { aposEntrada: contar(inventarioTopo), aposPercurso: contar(inventarioFim) },
  };

  await writeFile(path.join(out, 'reference.meta.json'), JSON.stringify(meta, null, 2));
  await writeFile(path.join(out, 'motion-inventory.json'), JSON.stringify({
    url, colhidoEm: meta.gravadoEm, aposEntrada: inventarioTopo, aposPercurso: inventarioFim,
  }, null, 2));

  console.log(JSON.stringify(meta, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
