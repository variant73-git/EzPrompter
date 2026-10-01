/**
 * POLITICA DE REFERRER POR <meta> INSERIDA E REMOVIDA NA MESMA TAREFA — captura REAL +
 * replay em Chromium (Astra B137, 2026-09-30).
 *
 * A politica do documento muda na INSERCAO da meta e remover nao a desfaz. Quando o
 * MutationObserver entrega o lote, a meta ja saiu: o valor que a politica tomou nao e
 * reconstruivel. Os dois lados marcam a politica como DESCONHECIDA, que nunca casa.
 *
 * Fonte: /api duas vezes sem meta (PRIVATE), insere+remove no-referrer, controle nativo
 * (/ctl sem Referer) e /api2 (capturado sob politica desconhecida).
 * Clone: /api2 com politica conhecida -> miss (captura desconhecida); /api -> PRIVATE
 * (controle positivo); insere+remove -> /api nunca recebe o PRIVATE.
 * Duas formas (Astra B138): a meta inserida direto, e a meta dentro de uma subarvore montada
 * antes (o lote so mostra a div ja vazia e a meta removida).
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

let fonte; let fonteOrigin; let clone; let cloneOrigin;
let hits;
const PREFIXO = '/api/runtime/tok/';

const TRANSITORIAS = {
  direta: "function transitoria() { var m = document.createElement('meta'); m.name = 'referrer'; m.content = 'no-referrer'; document.head.appendChild(m); m.remove(); }",
  // Astra B139: valor legado que o Chromium reconhece como no-referrer (a meta FICA)
  none: "function transitoria() { var m = document.createElement('meta'); m.name = 'referrer'; m.content = 'none'; document.head.appendChild(m); }",
  subarvore: "function transitoria() { var box = document.createElement('div'); box.innerHTML = '<meta name=\"referrer\" content=\"no-referrer\">'; document.head.appendChild(box); box.firstChild.remove(); }",
};
const site = (variante) => `<!doctype html>
<html><head><meta charset="utf-8"><title>meta referrer transitoria</title></head>
<body><h1>Politica de referrer por meta inserida e removida</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>
${TRANSITORIAS[variante]}
addEventListener('load', async function () {
  var r = {};
  var ler = async function (u) { try { var o = await fetch(u); return o.status + ':' + (await o.text()); } catch (e) { return 'ERRO ' + e.message; } };
  if (!location.pathname.startsWith('${PREFIXO}')) {
    r.a1 = await ler('/api'); r.a2 = await ler('/api');
    transitoria();
    r.ctl = await ler('/ctl');
    r.b = await ler('/api2');
  } else {
    r.b = await ler('/api2');
    r.a1 = await ler('/api');
    transitoria();
    r.a2 = await ler('/api');
  }
  window.__r = r; document.body.dataset.pronto = '1';
});
</script>
</body></html>`;

async function subirFonte(variante, htmlPronto) {
  hits = { api: 0, api2: 0, ctl: [] };
  const html = htmlPronto || site(variante);
  fonte = createServer((req, res) => {
    const semCache = { 'content-type': 'text/plain', 'cache-control': 'no-store' };
    if (req.url === '/api') { hits.api += 1; res.writeHead(200, semCache); res.end(req.headers.referer ? 'PRIVATE' : 'DENIED'); return; }
    if (req.url === '/api2') { hits.api2 += 1; res.writeHead(200, semCache); res.end(req.headers.referer ? 'PRIVATE' : 'DENIED'); return; }
    if (req.url === '/ctl') { hits.ctl.push(req.headers.referer ? 'com' : 'sem'); res.writeHead(200, semCache); res.end('ok'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  });
  await new Promise((d) => fonte.listen(0, '127.0.0.1', d));
  fonteOrigin = `http://localhost:${fonte.address().port}`;
}
async function fechar() {
  if (fonte) await new Promise((d) => fonte.close(d));
  if (clone) await new Promise((d) => clone.close(d));
  fonte = null; clone = null;
}
afterAll(fechar);

describe('politica de referrer por meta transitoria', () => {
  it.each(['direta', 'subarvore', 'none'])('%s: captura e replay tratam a politica como desconhecida, que nunca casa', async (variante) => {
    await fechar(); await subirFonte(variante);
    const r = await captureNativeBundle(`${fonteOrigin}/`, { viewport: { width: 800, height: 600 } });
    // premissa NATIVA: inserir e remover a meta na mesma tarefa deixou a politica em no-referrer
    expect(hits.ctl, 'o navegador real aplicou a meta transitoria').toEqual(['sem']);
    expect(hits.api).toBe(2); expect(hits.api2).toBe(1);
    const arquivos = new Map(r.bundle.assets.map((a) => [a.path, a]));
    clone = createServer((req, res) => {
      const caminho = req.url.split('?')[0];
      if (!caminho.startsWith(PREFIXO)) { res.writeHead(404); res.end('nao existe'); return; }
      const rel = decodeURIComponent(caminho.slice(PREFIXO.length)) || r.bundle.entryPath;
      const a = arquivos.get(rel);
      if (!a) { res.writeHead(404); res.end('nao existe'); return; }
      res.writeHead(200, { 'content-type': a.contentType || 'application/octet-stream' });
      res.end(Buffer.from(a.body));
    });
    await new Promise((d) => clone.listen(0, '127.0.0.1', d));
    cloneOrigin = `http://localhost:${clone.address().port}`;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${cloneOrigin}${PREFIXO}${r.bundle.entryPath}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-pronto="1"]', { timeout: 20000 });
      const res = await page.evaluate(() => window.__r);
      expect(res.a1, 'politica conhecida e igual casa (controle positivo)').toBe('200:PRIVATE');
      expect(res.b, 'captura sob politica desconhecida nunca casa').not.toMatch(/PRIVATE|DENIED/);
      expect(res.a2, 'replay sob politica desconhecida nunca recebe o PRIVATE').not.toMatch(/PRIVATE/);
      expect(hits.api).toBe(2); expect(hits.api2).toBe(1);   // o clone nunca tocou a fonte
    } finally { await browser.close(); }
  }, 120000);
});

// Astra B140: o Chromium REAPLICA a politica de uma meta quando o `media` dela muda. A fonte
// captura as duas chamadas sob unsafe-url (A no-referrer, depois B unsafe-url); no clone a troca
// do media de A vem ANTES da 2a chamada.
const SITE_MEDIA = `<!doctype html>
<html><head><meta charset="utf-8"><title>media reaplica</title></head>
<body><h1>Mudanca de media numa meta de referrer antiga</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>
addEventListener('load', async function () {
  var r = {};
  var ler = async function (u) { try { var o = await fetch(u); return o.status + ':' + (await o.text()); } catch (e) { return 'ERRO ' + e.message; } };
  var a = document.createElement('meta'); a.name = 'referrer'; a.content = 'no-referrer'; document.head.appendChild(a);
  await new Promise(function (d) { setTimeout(d, 0); });
  var b = document.createElement('meta'); b.name = 'referrer'; b.content = 'unsafe-url'; document.head.appendChild(b);
  await new Promise(function (d) { setTimeout(d, 0); });
  if (!location.pathname.startsWith('${PREFIXO}')) {
    r.a1 = await ler('/api'); r.a2 = await ler('/api');
    a.setAttribute('media', 'all');
    r.ctl = await ler('/ctl');
  } else {
    r.a1 = await ler('/api');
    a.setAttribute('media', 'all');
    r.a2 = await ler('/api');
  }
  window.__r = r; document.body.dataset.pronto = '1';
});
</script>
</body></html>`;

describe('politica de referrer reaplicada por media', () => {
  it('a troca de media de uma meta antiga reaplica a politica dela nos dois lados', async () => {
    await fechar(); await subirFonte('media', SITE_MEDIA);
    const r = await captureNativeBundle(`${fonteOrigin}/`, { viewport: { width: 800, height: 600 } });
    expect(hits.ctl, 'o navegador real reaplicou no-referrer ao mudar o media').toEqual(['sem']);
    expect(hits.api).toBe(2);
    const arquivos = new Map(r.bundle.assets.map((x) => [x.path, x]));
    clone = createServer((req, res) => {
      const caminho = req.url.split('?')[0];
      if (!caminho.startsWith(PREFIXO)) { res.writeHead(404); res.end('nao existe'); return; }
      const rel = decodeURIComponent(caminho.slice(PREFIXO.length)) || r.bundle.entryPath;
      const x = arquivos.get(rel);
      if (!x) { res.writeHead(404); res.end('nao existe'); return; }
      res.writeHead(200, { 'content-type': x.contentType || 'application/octet-stream' }); res.end(Buffer.from(x.body));
    });
    await new Promise((d) => clone.listen(0, '127.0.0.1', d));
    cloneOrigin = `http://localhost:${clone.address().port}`;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${cloneOrigin}${PREFIXO}${r.bundle.entryPath}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-pronto="1"]', { timeout: 20000 });
      const res = await page.evaluate(() => window.__r);
      expect(res.a1, 'mesma politica (unsafe-url) casa (controle positivo)').toBe('200:PRIVATE');
      expect(res.a2, 'depois da troca de media nunca recebe o PRIVATE').not.toMatch(/PRIVATE/);
      expect(hits.api).toBe(2);
    } finally { await browser.close(); }
  }, 120000);
});
