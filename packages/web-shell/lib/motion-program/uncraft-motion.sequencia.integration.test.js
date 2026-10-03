// Ficha `sequencia` (caminho 3) no Chromium real: tres quadros de cores diferentes desenhados num
// <canvas> conforme a rolagem; os pontos MEDIDOS mandam (o trecho do meio fica parado no quadro 1);
// ficha sem imagens e recusada; uma imagem so e quadro fixo; desmontar limpa o canvas.
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
const COR = { '/q0.svg': '#ff0000', '/q1.svg': '#00ff00', '/q2.svg': '#0000ff' };
const svg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${c}"/></svg>`;
const PROGRAMA = {
  versao: 0,
  fichas: [
    // progresso 0..0.3 -> quadro 0..1; 0.3..0.7 parado no 1; 0.7..1 -> 1..2 (a curva medida manda)
    { id: 'm-seq', tipo: 'sequencia', alvo: '#u-tela', imagens: ['/q0.svg', '/q1.svg', '/q2.svg'], ajuste: 'cobrir', pontos: [[0, 0], [0.3, 1], [0.7, 1], [1, 2]], motor: { tipo: 'rolagem', inicio: 0, fim: 1000, arrasto: true } },
    { id: 'm-seq-vazia', tipo: 'sequencia', alvo: '#u-tela', imagens: [], motor: { tipo: 'rolagem' } },
    { id: 'm-fixo', tipo: 'sequencia', alvo: '#u-fixo', imagens: ['/q2.svg'], motor: { tipo: 'carga' } },
  ],
};
const SITE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}#u-tela{position:fixed;top:0;left:0;width:200px;height:100px}main{height:3000px}</style></head>
<body><canvas id="u-tela"></canvas><canvas id="u-fixo" style="position:fixed;top:200px;left:0;width:50px;height:50px"></canvas><main></main>
<script src="/gsap.min.js"></script><script src="/ScrollTrigger.min.js"></script>
<script type="application/json" id="uncraft-motion-programa">${JSON.stringify(PROGRAMA)}</script>
<script src="/uncraft-motion.js"></script></body></html>`;

let srv; let browser; let page;
beforeAll(async () => {
  srv = createServer(async (req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(SITE); return; }
    if (COR[req.url]) { res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end(svg(COR[req.url])); return; }
    const f = ARQ[req.url]; if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(f));
  });
  await new Promise((d) => srv.listen(0, '127.0.0.1', d));
  browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' }); await page.waitForTimeout(800);
}, 60000);
afterAll(async () => { if (browser) await browser.close(); if (srv) await new Promise((d) => srv.close(d)); });

const corEm = (y) => page.evaluate(async (v) => {
  window.scrollTo(0, v); await new Promise((r) => setTimeout(r, 400));
  const c = document.getElementById('u-tela'); const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}, y);

describe('ficha sequencia', () => {
  it('monta as validas e recusa a sem imagens', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.relatorio());
    expect(r.montadas.sort()).toEqual(['m-fixo', 'm-seq']);
    expect(r.erros.map((e) => e.id)).toEqual(['m-seq-vazia']);
  });
  it('quadro fixo: uma imagem so fica desenhada', async () => {
    const px = await page.evaluate(() => { const c = document.getElementById('u-fixo'); return Array.from(c.getContext('2d').getImageData(25, 25, 1, 1).data); });
    expect(px).toEqual([0, 0, 255, 255]);
  });
  it('desenha o quadro que a rolagem pede, seguindo os pontos medidos', async () => {
    expect(await corEm(0)).toEqual([255, 0, 0, 255]);
    expect(await corEm(500)).toEqual([0, 255, 0, 255]);    // trecho parado no quadro 1
    expect(await corEm(650)).toEqual([0, 255, 0, 255]);
    expect(await corEm(800)).toEqual([0, 255, 0, 255]);    // pontos: 0.8 -> 1.33 -> quadro 1 (a RETA daria 1.6 -> 2)
    expect(await corEm(1000)).toEqual([0, 0, 255, 255]);
    expect(await corEm(100)).toEqual([255, 0, 0, 255]);    // volta: 0.1 -> indice 0.33 -> quadro 0
  });
  it('o canvas acompanha o tamanho do elemento (pixels do aparelho)', async () => {
    const t = await page.evaluate(() => { const c = document.getElementById('u-tela'); return [c.width, c.height]; });
    expect(t).toEqual([200, 100]);
  });
  it('desmontar limpa o desenho', async () => {
    const px = await page.evaluate(() => { window.__uncraftMotion.desmontar(); const c = document.getElementById('u-tela'); return Array.from(c.getContext('2d').getImageData(100, 50, 1, 1).data); });
    expect(px).toEqual([0, 0, 0, 0]);
  });
});
