/**
 * RECARGA QUE RESPONDE 204 NA MESMA URL NAO DESTROI O HTML CAPTURADO — o produtor REAL
 * (Astra B70, 2026-09-30).
 *
 * `/` serve o HTML na 1a vez e 204 nas seguintes. O documento chama `/api` (FIRST), faz
 * `location.reload()` (recebe 204 — o documento sobrevive, por norma HTML) e chama `/api`
 * de novo (SECOND). A resposta 204 de documento principal entrava no caminho "documento
 * recarregado substitui o anterior" e anulava o HTML ja capturado: o pacote perdia a
 * entrada executavel. Um documento so e substituido quando um substituto pode COMMITAR.
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

let server; let origin;
const hits = { api: 0, doc: 0 };

const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>204 na mesma URL</title></head>
<body><h1>Documento que recarrega a propria URL e recebe 204</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>addEventListener('load', async function () {
  const a = await (await fetch('/api')).text();
  location.reload();
  setTimeout(async function () {
    const b = await (await fetch('/api')).text();
    document.body.dataset.a = a; document.body.dataset.b = b;
    document.body.dataset.pronto = '1';
  }, 800);
});</script>
</body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url.startsWith('/api')) { hits.api += 1; res.writeHead(200, { 'content-type': 'text/plain' }); res.end(hits.api === 1 ? 'FIRST' : 'SECOND'); return; }
    hits.doc += 1;
    if (hits.doc > 1) { res.writeHead(204); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SITE);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${server.address().port}`;
}, 30000);

afterAll(async () => { if (server) await new Promise((d) => server.close(d)); });

describe('recarga 204 na mesma URL', () => {
  it('o HTML capturado da entrada sobrevive e a lista fica [FIRST, SECOND]', async () => {
    const r = await captureNativeBundle(`${origin}/`, { viewport: { width: 800, height: 600 } });
    expect(hits.doc).toBeGreaterThanOrEqual(2);    // o cenario EXERCITOU a recarga com 204
    expect(hits.api).toBeGreaterThanOrEqual(2);

    const corpo = (path) => { const a = r.bundle.assets.find((x) => x.path === path); return a && Buffer.from(a.body).toString('utf8'); };
    const html = corpo(r.bundle.entryPath);
    expect(html).toContain('Documento que recarrega a propria URL e recebe 204');   // a entrada executavel sobreviveu
    expect(html).toContain('<script data-uncraft-runtime-fetch-map>');
    const id = identidadeDeRequisicao('GET', `${origin}/api`, Buffer.alloc(0), {});
    expect(corpo(`_replay/${id}`)).toBe('FIRST');
    expect(corpo(`_replay/${id}.1`)).toBe('SECOND');
    expect(r.relatorio.envelopesPerdidos).toEqual([]);
  }, 120000);
});
