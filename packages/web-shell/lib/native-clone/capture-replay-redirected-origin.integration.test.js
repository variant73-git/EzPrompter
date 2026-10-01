/**
 * REDIRECT DE NAVEGACAO ENTRE ORIGENS — o produtor REAL (Astra B66, 2026-09-30).
 *
 * `https://example.com` redireciona para `https://www.example.com`; o documento FINAL faz
 * `fetch('/api')` same-origin e a resposta nao traz ACAO (nao precisa). Comparar com a
 * origem INICIAL classificava a chamada como cross-origin e descartava o corpo como
 * opaco — o replay perdia uma API que funcionava. A origem que decide e a do DOCUMENTO
 * que fez o pedido.
 */
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...(actual.default || {}), lookup: async () => [{ address: '93.184.216.34', family: 4 }] },
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  };
});

const { captureNativeBundle, identidadeDeRequisicao } = await import('./capture-bundle.js');

let inicial; let canonico; let origemInicial; let origemCanonica;
const hits = { api: 0, redirect: 0 };

const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>canonico</title></head>
<body><h1>Documento servido pela origem canonica depois do redirect</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>addEventListener('load', async function () {
  const r = await fetch('/api');
  document.body.dataset.api = await r.text();
  document.body.dataset.pronto = '1';
});</script>
</body></html>`;

beforeAll(async () => {
  canonico = createServer((req, res) => {
    if (req.url.startsWith('/api')) { hits.api += 1; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('API_OK'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SITE);
  });
  await new Promise((done) => canonico.listen(0, '127.0.0.1', done));
  origemCanonica = `http://localhost:${canonico.address().port}`;
  inicial = createServer((req, res) => { hits.redirect += 1; res.writeHead(302, { location: `${origemCanonica}${req.url}` }); res.end(); });
  await new Promise((done) => inicial.listen(0, '127.0.0.1', done));
  origemInicial = `http://localhost:${inicial.address().port}`;
}, 30000);

afterAll(async () => { for (const s of [inicial, canonico]) if (s) await new Promise((d) => s.close(d)); });

describe('redirect de navegacao entre origens', () => {
  it('o fetch same-origin do documento FINAL (sem ACAO) vira envelope legivel, nao marcador opaco', async () => {
    const r = await captureNativeBundle(`${origemInicial}/`, { viewport: { width: 800, height: 600 } });
    expect(hits.redirect).toBeGreaterThan(0);   // o cenario EXERCITOU o redirect
    expect(hits.api).toBe(1);                   // e a chamada same-origin do documento final
    expect(origemInicial).not.toBe(origemCanonica);

    const id = identidadeDeRequisicao('GET', `${origemCanonica}/api`, Buffer.alloc(0), {});
    const corpo = (path) => { const a = r.bundle.assets.find((x) => x.path === path); return a && Buffer.from(a.body).toString('utf8'); };
    expect(r.relatorio.envelopesPerdidos).toEqual([]);
    expect(corpo(`_replay/${id}`)).toBe('API_OK');   // envelope COM corpo, sob a identidade da origem canonica
    // e a resposta nao ficou fora do pacote como "opaca"
    expect((r.relatorio.descartados || []).map((d) => d.motivo)).not.toContain('resposta opaca (fetch cross-origin sem CORS)');
    const html = corpo(r.bundle.entryPath);
    const inicio = html.indexOf('<script data-uncraft-runtime-fetch-map>');
    expect(inicio).toBeGreaterThan(-1);
    expect(html.slice(inicio, html.indexOf('</script>', inicio))).toContain(id);
  }, 120000);
});
