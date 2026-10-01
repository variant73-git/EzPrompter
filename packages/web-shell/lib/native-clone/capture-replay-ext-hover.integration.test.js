/**
 * FETCH DE HOVER A UM ASSET DE OUTRA ORIGEM CAPTURADO SO PELO MARKUP — captura REAL +
 * replay em Chromium (Astra B144, 2026-09-30).
 *
 * `<img src="http://cdn/sprite.svg?v=2">` vira `_ext/<host>/sprite.<hash>.svg` no pacote. Um
 * fetch desse caminho no clone (hover: a captura nao passa o mouse, nunca ha envelope) vai a
 * URL ORIGINAL — que antes era reconstruida do NOME do arquivo (com hash, sem a query) e dava
 * 404. Agora vai a URL exata.
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
let fonte; let cdn; let clone;
const pedidosCdn = [];

afterAll(async () => {
  for (const s of [fonte, cdn, clone]) if (s) await new Promise((d) => s.close(d));
});

describe('fetch de hover a asset de outra origem so de markup', () => {
  it('vai a URL original exata (com a query), nunca a um endereco reconstruido do nome', async () => {
    cdn = createServer((req, res) => {
      pedidosCdn.push(req.url);
      if (req.url === '/sprite.svg?v=2') { res.writeHead(200, { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' }); res.end(SVG); return; }
      res.writeHead(404); res.end('nao existe');
    });
    await new Promise((d) => cdn.listen(0, '127.0.0.1', d));
    const cdnOrigin = `http://localhost:${cdn.address().port}`;
    const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>sprite de cdn</title></head>
<body><h1>Sprite versionado de outra origem</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<img id="s" src="${cdnOrigin}/sprite.svg?v=2" alt="sprite">
<script>
addEventListener('load', async function () {
  var r = {};
  if (location.pathname.startsWith('${PREFIXO}')) {
    var local = document.getElementById('s').getAttribute('src');
    r.local = local;
    try { var o = await fetch(local, { mode: 'no-cors' }); r.hover = o.type + ':' + o.status; } catch (e) { r.hover = 'ERRO ' + e.message; }
  }
  window.__r = r; document.body.dataset.pronto = '1';
});
</script>
</body></html>`;
    fonte = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SITE); });
    await new Promise((d) => fonte.listen(0, '127.0.0.1', d));
    const fonteOrigin = `http://localhost:${fonte.address().port}`;
    const r = await captureNativeBundle(`${fonteOrigin}/`, { viewport: { width: 800, height: 600 } });
    const arquivos = new Map(r.bundle.assets.map((x) => [x.path, x]));
    const caminhoExt = [...arquivos.keys()].find((k) => k.startsWith('_ext/') && /sprite/.test(k));
    expect(caminhoExt, 'o sprite virou _ext/ no pacote').toBeTruthy();
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
    pedidosCdn.length = 0;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${cloneOrigin}${PREFIXO}${r.bundle.entryPath}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-pronto="1"]', { timeout: 20000 });
      const res = await page.evaluate(() => window.__r);
      expect(res.local, 'o markup do clone aponta para a copia local').toMatch(/_ext\//);
      expect(pedidosCdn, 'o fetch de hover chegou a URL original exata').toContain('/sprite.svg?v=2');
      expect(pedidosCdn.some((u) => u !== '/sprite.svg?v=2'), 'nenhum endereco reconstruido do nome').toBe(false);
      expect(res.hover).toBe('opaque:0');
    } finally { await browser.close(); }
  }, 120000);
});
