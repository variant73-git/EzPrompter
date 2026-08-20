/**
 * montage.mjs — monta pares lado a lado (original × rebuild) num PNG único.
 * Uso: node montage.mjs pairs.json <outDir>
 * pairs.json: [{ "left": "out-farm/frames/frame-016.png", "right": "shots/shot-00.png", "name": "hero" }, ...]
 * Caminhos relativos à pasta deste script, servida em http://localhost:4601.
 */
import { chromium } from 'playwright-core';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const [pairsFile, outDir] = process.argv.slice(2);
const pairs = JSON.parse(await readFile(pairsFile, 'utf8'));
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 2600, height: 780 } });
for (const p of pairs) {
  const html = `<!DOCTYPE html><body style="margin:0;background:#111;display:flex;gap:8px;align-items:flex-start">
    <div style="flex:1"><div style="color:#eee;font:12px monospace;padding:4px">ORIGINAL — ${p.name}</div><img src="http://localhost:4601/${p.left}" style="width:1280px;display:block"></div>
    <div style="flex:1"><div style="color:#eee;font:12px monospace;padding:4px">REBUILD — ${p.name}</div><img src="http://localhost:4601/${p.right}" style="width:1280px;display:block"></div></body>`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(outDir, `pair-${p.name}.png`) });
  console.log(`pair-${p.name}.png`);
}
await browser.close();
