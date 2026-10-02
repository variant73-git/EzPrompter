// Tocador do programa de movimento v0 no Chromium real: cada motor anima o que deve, o texto
// cortado volta INTEIRO ao desmontar, `aplicar` remonta uma ficha, ficha invalida e reportada.
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
const PROGRAMA = {
  versao: 0,
  fichas: [
    { id: 'm-titulo', alvo: '#u-titulo', dividir: 'chars', motor: { tipo: 'carga' }, de: { opacity: 0, y: 30 }, para: { opacity: 1, y: 0 }, duracao: 0.3, intervalo: 0.01 },
    { id: 'm-faixa', alvo: '#u-faixa', motor: { tipo: 'rolagem', inicio: 'top bottom', fim: 'bottom top', arrasto: true }, de: { x: 0 }, para: { x: 300 }, curva: 'none' },
    { id: 'm-pulso', alvo: '#u-pulso', motor: { tipo: 'tempo' }, de: { scale: 1 }, para: { scale: 1.5 }, duracao: 0.2, vaiVolta: true },
    { id: 'm-botao', alvo: '#u-botao', motor: { tipo: 'hover' }, para: { y: -10 }, duracao: 0.1 },
    { id: 'm-quadros', alvo: '#u-faixa2', motor: { tipo: 'tempo' }, quadros: [{ x: 0 }, { x: 20 }, { x: 0 }], duracao: 0.4 },
    { id: 'm-cor', alvo: '#u-pulso', motor: { tipo: 'carga' }, para: { backgroundColor: 'rgb(0, 128, 0)' }, duracao: 0.1 },
    { id: 'm-quebrada', alvo: '.classe-do-site', motor: { tipo: 'carga' }, para: { opacity: 1 } },
    { id: 'm-sumida', alvo: '#u-nao-existe', motor: { tipo: 'carga' }, para: { opacity: 1 } },
  ],
};
const SITE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:20px sans-serif}section{height:900px}#u-faixa{width:100px;height:40px;background:#123}#u-pulso{width:40px;height:40px;background:#c33}</style></head>
<body><section><h1 id="u-titulo">Ola mundo</h1><button id="u-botao">Botao</button><div id="u-pulso"></div><div id="u-faixa2" style="width:30px;height:10px;background:#333"></div></section>
<section></section><section><div id="u-faixa"></div></section><section></section>
<script src="/gsap.min.js"></script><script src="/ScrollTrigger.min.js"></script>
<script type="application/json" id="uncraft-motion-programa">${JSON.stringify(PROGRAMA)}</script>
<script src="/uncraft-motion.js"></script></body></html>`;

let srv; let base; let browser; let page;
beforeAll(async () => {
  srv = createServer(async (req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(SITE); return; }
    const f = ARQ[req.url]; if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(f));
  });
  await new Promise((d) => srv.listen(0, '127.0.0.1', d));
  base = `http://127.0.0.1:${srv.address().port}/`;
  browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(base, { waitUntil: 'load' }); await page.waitForTimeout(600);
}, 60000);
afterAll(async () => { if (browser) await browser.close(); if (srv) await new Promise((d) => srv.close(d)); });

describe('tocador do programa de movimento v0', () => {
  it('monta as validas e reporta as invalidas sem derrubar a pagina', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.relatorio());
    expect(r.montadas.sort()).toEqual(['m-botao', 'm-cor', 'm-faixa', 'm-pulso', 'm-quadros', 'm-titulo']);
    const ids = r.erros.map((e) => e.id).sort();
    expect(ids).toEqual(['m-quebrada', 'm-sumida']);
  });
  it('carga + dividir: o titulo foi cortado em letras e terminou visivel', async () => {
    const s = await page.evaluate(() => ({ letras: document.querySelectorAll('#u-titulo .u-letra').length, op: getComputedStyle(document.querySelector('#u-titulo .u-letra')).opacity, texto: document.getElementById('u-titulo').textContent }));
    expect(s.letras).toBe(8);   // "Ola mundo" sem o espaco
    expect(s.op).toBe('1');
    expect(s.texto).toBe('Ola mundo');
  });
  it('rolagem com arrasto: a faixa anda com a rolagem', async () => {
    const x = async () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('u-faixa')).transform).m41);
    await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(150); const a = await x();
    await page.evaluate(() => window.scrollTo(0, 1800)); await page.waitForTimeout(150); const b = await x();
    expect(b).toBeGreaterThan(a);
  });
  it('tempo: o pulso esta em laco (escala muda entre duas leituras)', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const sc = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('u-pulso')).transform).a);
    const vals = []; for (let i = 0; i < 5; i += 1) { vals.push(await sc()); await page.waitForTimeout(70); }
    expect(new Set(vals.map((v) => v.toFixed(2))).size).toBeGreaterThan(1);
  });
  it('hover: o botao sobe ao passar o mouse e volta ao sair', async () => {
    const y = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('u-botao')).transform).m42);
    expect(await y()).toBe(0);
    await page.hover('#u-botao'); await page.waitForTimeout(250); expect(await y()).toBeCloseTo(-10, 0);
    await page.mouse.move(900, 700); await page.waitForTimeout(250); expect(await y()).toBeCloseTo(0, 0);
  });
  it('aplicar: muda o valor final de uma ficha e remonta so ela; campo invalido e recusado', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.aplicar('m-botao', { para: { y: -40 } }));
    expect(r.ok).toBe(true);
    await page.hover('#u-botao'); await page.waitForTimeout(250);
    expect(await page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('u-botao')).transform).m42)).toBeCloseTo(-40, 0);
    const ruim = await page.evaluate(() => window.__uncraftMotion.aplicar('m-botao', { duracao: 'devagar' }));
    expect(ruim.ok).toBe(false);
  });
  it('fichas() continua serializavel depois de montar quadros (o GSAP nao escreve na ficha)', async () => {
    const r = await page.evaluate(() => { try { return JSON.stringify(window.__uncraftMotion.fichas()).length > 0; } catch (e) { return e.message; } });
    expect(r).toBe(true);
  });
  it('duas fichas no MESMO elemento: aplicar numa nao apaga o efeito da outra', async () => {
    await page.waitForTimeout(200);
    const cor = () => page.evaluate(() => getComputedStyle(document.getElementById('u-pulso')).backgroundColor);
    expect(await cor()).toBe('rgb(0, 128, 0)');
    const r = await page.evaluate(() => window.__uncraftMotion.aplicar('m-pulso', { duracao: 0.3 }));
    expect(r.ok).toBe(true);
    expect(await cor()).toBe('rgb(0, 128, 0)');
  });
  it('aplicar que nao monta (alvo inexistente) devolve a ficha antiga montada', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.aplicar('m-botao', { alvo: '#u-nao-existe' }));
    expect(r.ok).toBe(false);
    const s2 = await page.evaluate(() => ({ montada: window.__uncraftMotion.relatorio().montadas.includes('m-botao'), alvo: window.__uncraftMotion.fichas().find((f) => f.id === 'm-botao').alvo }));
    expect(s2).toEqual({ montada: true, alvo: '#u-botao' });
  });
  it('desmontar: o texto volta INTEIRO (sem as partes) e os estilos do autor voltam', async () => {
    const s = await page.evaluate(() => { window.__uncraftMotion.desmontar(); const t = document.getElementById('u-titulo'); return { filhos: t.children.length, texto: t.textContent, estilo: t.getAttribute('style'), montadas: window.__uncraftMotion.relatorio().montadas.length }; });
    expect(s).toEqual({ filhos: 0, texto: 'Ola mundo', estilo: null, montadas: 0 });
  });
});
