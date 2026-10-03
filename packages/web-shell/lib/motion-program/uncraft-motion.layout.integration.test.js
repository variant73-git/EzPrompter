// O layout muda DEPOIS de montar (imagem que chega, conteudo que cresce): o gatilho relativo de
// rolagem tem que acompanhar. Medido no farmminerals: sem isto o gatilho do rodape ficava 1131 px
// adiantado e o caminho 2 (IX3, gatilhos relativos) era punido por um defeito do tocador.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { chromium } = await import('playwright-core');
const RAIZ = process.cwd();
const ARQ = {
  '/gsap.min.js': path.join(RAIZ, 'node_modules/gsap/dist/gsap.min.js'),
  '/ScrollTrigger.min.js': path.join(RAIZ, 'node_modules/gsap/dist/ScrollTrigger.min.js'),
  '/uncraft-motion.js': path.join(RAIZ, 'lib/motion-program/uncraft-motion.js'),
};
const PROGRAMA = { versao: 0, fichas: [{ id: 'm-rel', alvo: '#u-alvo', motor: { tipo: 'rolagem', inicio: 'top bottom', fim: 'bottom top', arrasto: true }, de: { x: 0 }, para: { x: 100 }, curva: 'none' }] };
const SITE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}#u-cresce{height:100px}#u-alvo{height:200px;background:#333}main{height:3000px}</style></head>
<body><div id="u-cresce"></div><div id="u-alvo"></div><main></main>
<script src="/gsap.min.js"></script><script src="/ScrollTrigger.min.js"></script>
<script type="application/json" id="uncraft-motion-programa">${JSON.stringify(PROGRAMA)}</script>
<script src="/uncraft-motion.js"></script></body></html>`;

let srv; let browser; let page;
beforeAll(async () => {
  srv = createServer(async (req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(SITE); return; }
    const f = ARQ[req.url]; if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(f));
  });
  await new Promise((d) => srv.listen(0, '127.0.0.1', d));
  browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' }); await page.waitForTimeout(500);
}, 60000);
afterAll(async () => { if (browser) await browser.close(); if (srv) await new Promise((d) => srv.close(d)); });

const inicio = () => page.evaluate(() => Math.round(window.ScrollTrigger.getAll()[0].start));

describe('gatilho relativo acompanha o layout', () => {
  it('antes: inicio = topo do alvo (100) menos a altura da janela (600)', async () => {
    expect(await inicio()).toBe(100 - 600);
  });
  it('o conteudo de cima cresce 1000 px DEPOIS de montar: o inicio anda junto, sem resize da janela', async () => {
    await page.evaluate(() => { document.getElementById('u-cresce').style.height = '1100px'; });
    await page.waitForTimeout(600);
    expect(await inicio()).toBe(1100 - 600);
  });
  it('desmontar para de vigiar (sem erro ao mudar o layout depois)', async () => {
    const r = await page.evaluate(async () => { window.__uncraftMotion.desmontar(); document.getElementById('u-cresce').style.height = '50px'; await new Promise((q) => setTimeout(q, 400)); return window.ScrollTrigger.getAll().length; });
    expect(r).toBe(0);
  });
});
