/**
 * shots.mjs — screenshots do rebuild em N pontos de scroll (1280×720),
 * para comparação lado a lado com os frames do vídeo original.
 * Uso: node shots.mjs <url> <outDir> [n=14]
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const [url, outDir, nArg] = process.argv.slice(2);
const N = Number(nArg) || 14;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3500); // preloader + intro

const total = await page.evaluate(() => Math.max(
  document.body.scrollHeight - innerHeight,
  document.documentElement.scrollHeight - innerHeight, 0));
console.log(`altura rolável: ${total}px`);

for (let i = 0; i < N; i++) {
  const y = Math.round((total * i) / (N - 1));
  await page.evaluate((t) => scrollTo({ top: t, behavior: 'smooth' }), y);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(outDir, `shot-${String(i).padStart(2, '0')}.png`) });
  console.log(`shot ${i}/${N - 1} @ ${y}px`);
}
console.log(errors.length ? `ERROS DE CONSOLE (${errors.length}):\n` + errors.slice(0, 10).join('\n') : 'zero erros de console');
await browser.close();
