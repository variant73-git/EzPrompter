/**
 * record.mjs — grava um vídeo de scroll de uma página, como um usuário faria,
 * para alimentar o experimento video-to-superprompt (skill do MengTo/Skills).
 *
 * IMPORTANTE: este script NÃO lê DOM, não extrai assets, não faz probe de CSS.
 * Ele só rola a página e grava o vídeo — é o stand-in automatizado do
 * "vídeo gravado do site" que o Adilson mandava manualmente. Todo o resto do
 * experimento parte exclusivamente do .webm produzido aqui.
 *
 * Uso: node record.mjs <url> [outDir]
 * Saída: <outDir>/site.webm + <outDir>/frames/frame-%03d.jpg (1 fps)
 */
import { chromium } from 'playwright-core';
import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL_ARG = process.argv[2];
const OUT_DIR = process.argv[3] || join(__dirname, 'out');
if (!URL_ARG) { console.error('uso: node record.mjs <url> [outDir]'); process.exit(1); }

const VIEWPORT = { width: 1280, height: 720 };
const FFMPEG = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
const CHROMIUM = '/opt/pw-browsers/chromium';

const t0 = Date.now();
const mark = (label) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);

await mkdir(join(OUT_DIR, 'frames'), { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: OUT_DIR, size: VIEWPORT },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
});
const page = await context.newPage();
mark(`navegando para ${URL_ARG}`);
await page.goto(URL_ARG, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => {
  console.warn(`networkidle não alcançado (${e.message}) — seguindo com load`);
});
await page.waitForTimeout(3000); // hero intro / animações de entrada

// Scroll humano: passadas suaves de ~meia viewport com pausas para as
// animações scroll-triggered dispararem e assentarem.
const total = await page.evaluate(() => Math.max(
  document.body.scrollHeight - window.innerHeight,
  document.documentElement.scrollHeight - window.innerHeight, 0));
mark(`altura rolável: ${total}px`);

const STEP = Math.round(VIEWPORT.height / 2);
for (let y = 0; y <= total; y += STEP) {
  await page.evaluate((target) => window.scrollTo({ top: target, behavior: 'smooth' }), y);
  await page.waitForTimeout(1400); // scroll suave + settle da animação
}
// volta ao topo para registrar o estado final do hero
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await page.waitForTimeout(3000);
mark('scroll completo, fechando para flush do vídeo');

const videoHandle = page.video();
await context.close();
await browser.close();

const rawPath = await videoHandle.path();
const finalPath = join(OUT_DIR, 'site.webm');
await rename(rawPath, finalPath);
const { size } = await stat(finalPath);
mark(`vídeo: ${finalPath} (${(size / 1024 / 1024).toFixed(1)}MB)`);

// Frames a 1 fps (passo "Inspect the video technically" da skill).
// PNG e `-r 1` porque o ffmpeg do Playwright é build enxuto: sem encoder
// mjpeg e sem o filtro `fps` (só pad/crop/scale).
execFileSync(FFMPEG, ['-y', '-i', finalPath, '-r', '1',
  join(OUT_DIR, 'frames', 'frame-%03d.png')], { stdio: 'pipe' });
const frames = (await readdir(join(OUT_DIR, 'frames'))).filter(f => f.endsWith('.png'));
mark(`${frames.length} frames extraídos em ${join(OUT_DIR, 'frames')}`);
