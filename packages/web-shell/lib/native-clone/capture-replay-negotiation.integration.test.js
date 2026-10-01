/**
 * NEGOCIACAO POR CABECALHO NUM ASSET SO DE MARKUP — captura REAL + replay em Chromium
 * (Astra B143, 2026-09-30).
 *
 * `<img src="visual">` captura o SVG. No clone, um fetch do MESMO caminho com
 * `Accept: application/json` (o que a fonte responderia com JSON) nunca pode receber o SVG
 * capturado: recusa. O fetch SIMPLES do mesmo caminho recebe o arquivo (controle positivo:
 * e o que mantem o hover funcionando, ja que a captura nao passa o mouse). O pacote nao tem
 * nenhum envelope — o remendo e emitido mesmo assim.
 */
import { createServer } from 'node:http';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...(actual.default || {}), lookup: async () => [{ address: '93.184.216.34', family: 4 }] },
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  };
});

const { captureNativeBundle } = await import('./capture-bundle.js');
const { chromium } = await import('playwright-core');

const PREFIXO = '/api/runtime/tok/';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
let fonte; let clone;

const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>negociacao</title></head>
<body><h1>Asset que o servidor negocia pelo Accept</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<img src="visual" alt="visual">
<script>
addEventListener('load', async function () {
  var r = {};
  if (location.pathname.startsWith('${PREFIXO}')) {
    try { var o = await fetch('visual', { headers: { accept: 'application/json' } }); r.json = o.status + ':' + (o.headers.get('content-type') || ''); } catch (e) { r.json = 'ERRO ' + e.message; }
    try { var p = await fetch('visual'); r.simples = p.status + ':' + (await p.text()).slice(0, 4); } catch (e) { r.simples = 'ERRO ' + e.message; }
  }
  window.__r = r; document.body.dataset.pronto = '1';
});
</script>
</body></html>`;

afterAll(async () => {
  if (fonte) await new Promise((d) => fonte.close(d));
  if (clone) await new Promise((d) => clone.close(d));
});

describe('negociacao por cabecalho num asset so de markup', () => {
  it('fetch com Accept diferente nunca recebe o SVG capturado; o fetch simples recebe', async () => {
    fonte = createServer((req, res) => {
      if (req.url === '/visual') {
        if (/application\/json/.test(req.headers.accept || '')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"frames":[]}'); return; }
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' }); res.end(SVG); return;   // estatico reaproveitavel do cache (Astra B147)
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SITE);
    });
    await new Promise((d) => fonte.listen(0, '127.0.0.1', d));
    const fonteOrigin = `http://localhost:${fonte.address().port}`;
    const r = await captureNativeBundle(`${fonteOrigin}/`, { viewport: { width: 800, height: 600 } });
    const arquivos = new Map(r.bundle.assets.map((x) => [x.path, x]));
    const caminhoSvg = [...arquivos.keys()].find((k) => /visual/.test(k));
    expect(caminhoSvg, 'o SVG foi capturado pelo markup').toBeTruthy();
    expect([...arquivos.keys()].some((k) => k.startsWith('_replay/')), 'nenhum envelope: pacote so de markup').toBe(false);
    const html = Buffer.from(arquivos.get(r.bundle.entryPath).body).toString('utf8');
    expect(html, 'o remendo e emitido mesmo sem envelope').toContain('data-uncraft-runtime-fetch-map');
    clone = createServer((req, res) => {
      const caminho = req.url.split('?')[0];
      if (!caminho.startsWith(PREFIXO)) { res.writeHead(404); res.end('nao existe'); return; }
      const rel = decodeURIComponent(caminho.slice(PREFIXO.length)) || r.bundle.entryPath;
      const x = arquivos.get(rel);
      if (!x) { res.writeHead(404); res.end('nao existe'); return; }
      res.writeHead(200, { 'content-type': x.contentType || 'application/octet-stream' }); res.end(Buffer.from(x.body));
    });
    await new Promise((d) => clone.listen(0, '127.0.0.1', d));
    const cloneOrigin = `http://localhost:${clone.address().port}`;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${cloneOrigin}${PREFIXO}${r.bundle.entryPath}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-pronto="1"]', { timeout: 20000 });
      const res = await page.evaluate(() => window.__r);
      expect(res.json, 'Accept: application/json nunca recebe o SVG capturado').not.toMatch(/svg/);
      expect(res.simples, 'o fetch simples recebe o arquivo (hover funciona)').toBe('200:<svg');
    } finally { await browser.close(); }
  }, 120000);
});

// Astra B145: o servidor negocia pelo Accept do NAVEGADOR (imagem x */*) e declara `Vary: Accept`.
// O cabecalho do script esta vazio, mas o fetch simples pediria OUTRA representacao na fonte.
describe('negociacao pelo Accept default (Vary: Accept) num asset so de markup', () => {
  let fonte2; let clone2;
  afterAll(async () => { for (const x of [fonte2, clone2]) if (x) await new Promise((d) => x.close(d)); });
  it('o fetch simples nunca recebe o SVG capturado quando a resposta variava pelo Accept', async () => {
    const SITE2 = SITE.replace('<script>', '<script>window.__variante = 2;');
    const pedidos = [];
    fonte2 = createServer((req, res) => {
      if (req.url === '/visual') {
        pedidos.push(req.headers.accept || '');
        if (/image\//.test(req.headers.accept || '')) { res.writeHead(200, { 'content-type': 'image/svg+xml', vary: 'Accept' }); res.end(SVG); return; }
        res.writeHead(200, { 'content-type': 'application/json', vary: 'Accept' }); res.end('{"frames":[]}'); return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SITE2);
    });
    await new Promise((d) => fonte2.listen(0, '127.0.0.1', d));
    const fonteOrigin = `http://localhost:${fonte2.address().port}`;
    const r = await captureNativeBundle(`${fonteOrigin}/`, { viewport: { width: 800, height: 600 } });
    expect(pedidos.some((a) => /image\//.test(a)), 'a captura pediu com o Accept de imagem').toBe(true);
    const arquivos = new Map(r.bundle.assets.map((x) => [x.path, x]));
    clone2 = createServer((req, res) => {
      const caminho = req.url.split('?')[0];
      if (!caminho.startsWith(PREFIXO)) { res.writeHead(404); res.end('nao existe'); return; }
      const rel = decodeURIComponent(caminho.slice(PREFIXO.length)) || r.bundle.entryPath;
      const x = arquivos.get(rel);
      if (!x) { res.writeHead(404); res.end('nao existe'); return; }
      res.writeHead(200, { 'content-type': x.contentType || 'application/octet-stream' }); res.end(Buffer.from(x.body));
    });
    await new Promise((d) => clone2.listen(0, '127.0.0.1', d));
    const cloneOrigin = `http://localhost:${clone2.address().port}`;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${cloneOrigin}${PREFIXO}${r.bundle.entryPath}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-pronto="1"]', { timeout: 20000 });
      const res = await page.evaluate(() => window.__r);
      expect(res.simples, 'o fetch simples nunca recebe o SVG de uma resposta que variava pelo Accept').not.toMatch(/svg/);
    } finally { await browser.close(); }
  }, 120000);
});

// Astra B146: a variante esta na QUERY (sem Vary). O gateway serve pelo caminho e ignora a query.
describe('variante por query num asset so de markup', () => {
  let fonte3; let clone3;
  afterAll(async () => { for (const x of [fonte3, clone3]) if (x) await new Promise((d) => x.close(d)); });
  it('fetch com query nunca recebe o SVG capturado; o mesmo caminho sem query recebe', async () => {
    const SITE3 = SITE.replace("fetch('visual', { headers: { accept: 'application/json' } })", "fetch('visual?format=json')");
    expect(SITE3).not.toBe(SITE);
    fonte3 = createServer((req, res) => {
      if (req.url === '/visual?format=json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"frames":[]}'); return; }
      if (req.url === '/visual') { res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' }); res.end(SVG); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SITE3);
    });
    await new Promise((d) => fonte3.listen(0, '127.0.0.1', d));
    const r = await captureNativeBundle(`http://localhost:${fonte3.address().port}/`, { viewport: { width: 800, height: 600 } });
    const arquivos = new Map(r.bundle.assets.map((x) => [x.path, x]));
    clone3 = createServer((req, res) => {
      const caminho = req.url.split('?')[0];
      if (!caminho.startsWith(PREFIXO)) { res.writeHead(404); res.end('nao existe'); return; }
      const rel = decodeURIComponent(caminho.slice(PREFIXO.length)) || r.bundle.entryPath;
      const x = arquivos.get(rel);
      if (!x) { res.writeHead(404); res.end('nao existe'); return; }
      res.writeHead(200, { 'content-type': x.contentType || 'application/octet-stream' }); res.end(Buffer.from(x.body));
    });
    await new Promise((d) => clone3.listen(0, '127.0.0.1', d));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${clone3.address().port}${PREFIXO}${r.bundle.entryPath}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-pronto="1"]', { timeout: 20000 });
      const res = await page.evaluate(() => window.__r);
      expect(res.json, 'fetch com query nunca recebe o SVG capturado').not.toMatch(/svg/);
      expect(res.simples, 'o mesmo caminho sem query recebe o arquivo (hover)').toBe('200:<svg');
    } finally { await browser.close(); }
  }, 120000);
});

// Revisao Claude (2026-09-30): o padrao da Vercel/Netlify (max-age=0, must-revalidate) NAO pode
// proteger o asset — o hover que busca o arquivo do markup tem que recebe-lo (controle positivo).
describe('asset com max-age=0, must-revalidate (padrao Vercel/Netlify) so de markup', () => {
  let fonte4; let clone4;
  afterAll(async () => { for (const x of [fonte4, clone4]) if (x) await new Promise((d) => x.close(d)); });
  it('o fetch simples de hover recebe o arquivo capturado', async () => {
    fonte4 = createServer((req, res) => {
      if (req.url === '/visual') { res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=0, must-revalidate' }); res.end(SVG); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SITE);
    });
    await new Promise((d) => fonte4.listen(0, '127.0.0.1', d));
    const r = await captureNativeBundle(`http://localhost:${fonte4.address().port}/`, { viewport: { width: 800, height: 600 } });
    const arquivos = new Map(r.bundle.assets.map((x) => [x.path, x]));
    clone4 = createServer((req, res) => {
      const caminho = req.url.split('?')[0];
      if (!caminho.startsWith(PREFIXO)) { res.writeHead(404); res.end('nao existe'); return; }
      const rel = decodeURIComponent(caminho.slice(PREFIXO.length)) || r.bundle.entryPath;
      const x = arquivos.get(rel);
      if (!x) { res.writeHead(404); res.end('nao existe'); return; }
      res.writeHead(200, { 'content-type': x.contentType || 'application/octet-stream' }); res.end(Buffer.from(x.body));
    });
    await new Promise((d) => clone4.listen(0, '127.0.0.1', d));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${clone4.address().port}${PREFIXO}${r.bundle.entryPath}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-pronto="1"]', { timeout: 20000 });
      const res = await page.evaluate(() => window.__r);
      expect(res.simples, 'o hover recebe o arquivo do markup').toBe('200:<svg');
    } finally { await browser.close(); }
  }, 120000);
});

// Revisao Claude (2026-09-30): cabecalhos de RASTREIO (Sentry/OTel) levam um id aleatorio por
// pedido. A fonte captura o dado de movimento com um id; o clone pede com OUTRO e tem que recebe-lo.
describe('cabecalhos de rastreio com id aleatorio', () => {
  let fonte5; let clone5;
  afterAll(async () => { for (const x of [fonte5, clone5]) if (x) await new Promise((d) => x.close(d)); });
  it('o replay casa apesar de sentry-trace/baggage/traceparent diferentes', async () => {
    const SITE5 = `<!doctype html>
<html><head><meta charset="utf-8"><title>rastreio</title></head>
<body><h1>Dado de movimento carregado com rastreio</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>
addEventListener('load', async function () {
  var id = Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32);
  var h = { 'sentry-trace': id + '-' + id.slice(0, 16) + '-1', baggage: 'sentry-trace_id=' + id, traceparent: '00-' + id + '-' + id.slice(0, 16) + '-01' };
  var r = {};
  try { r.anim = await (await fetch('/anim.json', { headers: h })).text(); } catch (e) { r.anim = 'ERRO ' + e.message; }
  window.__r = r; document.body.dataset.pronto = '1';
});
</script>
</body></html>`;
    let hits = 0;
    fonte5 = createServer((req, res) => {
      if (req.url === '/anim.json') { hits += 1; res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end('{"frames":[1,2,3]}'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SITE5);
    });
    await new Promise((d) => fonte5.listen(0, '127.0.0.1', d));
    const r = await captureNativeBundle(`http://localhost:${fonte5.address().port}/`, { viewport: { width: 800, height: 600 } });
    expect(hits).toBe(1);
    const arquivos = new Map(r.bundle.assets.map((x) => [x.path, x]));
    clone5 = createServer((req, res) => {
      const caminho = req.url.split('?')[0];
      if (!caminho.startsWith(PREFIXO)) { res.writeHead(404); res.end('nao existe'); return; }
      const rel = decodeURIComponent(caminho.slice(PREFIXO.length)) || r.bundle.entryPath;
      const x = arquivos.get(rel);
      if (!x) { res.writeHead(404); res.end('nao existe'); return; }
      res.writeHead(200, { 'content-type': x.contentType || 'application/octet-stream' }); res.end(Buffer.from(x.body));
    });
    await new Promise((d) => clone5.listen(0, '127.0.0.1', d));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${clone5.address().port}${PREFIXO}${r.bundle.entryPath}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-pronto="1"]', { timeout: 20000 });
      const res = await page.evaluate(() => window.__r);
      expect(res.anim, 'o dado capturado chega apesar do id de rastreio novo').toBe('{"frames":[1,2,3]}');
      expect(hits).toBe(1);   // veio do replay, nao da fonte
    } finally { await browser.close(); }
  }, 120000);
});
