/**
 * NAVEGACAO 204 NAO TROCA O DOCUMENTO — o produtor REAL (Astra B69, 2026-09-30).
 *
 * O documento chama `/api` (FIRST), tenta navegar para `/noop` (204 No Content — o
 * navegador fica no documento atual, por norma HTML) e depois chama `/api` de novo
 * (SECOND). As duas chamadas sao do MESMO documento sobrevivente: avancar a geracao na
 * resposta 204 descartava FIRST e servia SECOND como 1a ocorrencia. A geracao so avanca
 * quando o frame principal NAVEGA de fato para um documento novo.
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
const hits = { api: 0, noop: 0 };

const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>204</title></head>
<body><h1>Documento que tenta navegar para um 204 e continua vivo</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>addEventListener('load', async function () {
  const a = await (await fetch('/api')).text();
  location.href = '/noop';
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
    if (req.url.startsWith('/noop')) { hits.noop += 1; res.writeHead(204); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SITE);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${server.address().port}`;
}, 30000);

afterAll(async () => { if (server) await new Promise((d) => server.close(d)); });

describe('navegacao 204 e a sequencia de replay', () => {
  it('as duas chamadas do documento sobrevivente ficam na lista, na ordem [FIRST, SECOND]', async () => {
    const r = await captureNativeBundle(`${origin}/`, { viewport: { width: 800, height: 600 } });
    expect(hits.noop).toBe(1);                     // o cenario EXERCITOU a navegacao 204
    expect(hits.api).toBeGreaterThanOrEqual(2);    // e as duas chamadas

    const id = identidadeDeRequisicao('GET', `${origin}/api`, Buffer.alloc(0), {});
    const corpo = (path) => { const a = r.bundle.assets.find((x) => x.path === path); return a && Buffer.from(a.body).toString('utf8'); };
    expect(corpo(`_replay/${id}`)).toBe('FIRST');
    expect(corpo(`_replay/${id}.1`)).toBe('SECOND');
    expect(r.relatorio.envelopesPerdidos).toEqual([]);
  }, 120000);
});
