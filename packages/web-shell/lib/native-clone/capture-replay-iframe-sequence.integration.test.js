/**
 * IFRAME NAO CONTAMINA A SEQUENCIA DO DOCUMENTO DE ENTRADA — o produtor REAL (Astra B67, 2026-09-30).
 *
 * Um iframe same-origin chama `/api` PRIMEIRO e recebe CHILD; depois o documento principal
 * faz a chamada identica e recebe MAIN. A identidade nao carrega documento, e o remendo so e
 * injetado no documento de entrada: se a ocorrencia do iframe entrasse na lista, no replay
 * ninguem a consumiria e o principal receberia CHILD em vez de MAIN. So o documento de
 * entrada reserva ocorrencias; o iframe segue contando para os assets.
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
const hits = { api: 0 };

const FRAME = `<!doctype html><html><body><script>
fetch('/api').then(r => r.text()).then(t => parent.postMessage({ filho: t }, '*'));
</script></body></html>`;
const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>iframe</title></head>
<body><h1>Documento principal com um iframe que chama a API primeiro</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<iframe src="/frame.html"></iframe>
<script>addEventListener('message', async function (ev) {
  if (!ev.data || !ev.data.filho) return;
  const r = await fetch('/api');
  document.body.dataset.principal = await r.text();
  document.body.dataset.filho = ev.data.filho;
  document.body.dataset.pronto = '1';
});</script>
</body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url.startsWith('/api')) { hits.api += 1; res.writeHead(200, { 'content-type': 'text/plain' }); res.end(hits.api === 1 ? 'CHILD' : 'MAIN'); return; }
    if (req.url.startsWith('/frame.html')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(FRAME); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SITE);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${server.address().port}`;
}, 30000);

afterAll(async () => { if (server) await new Promise((d) => server.close(d)); });

describe('iframe e a sequencia de replay do documento de entrada', () => {
  it('a chamada do iframe (primeira) nao entra na lista: o documento de entrada recebe MAIN, nao CHILD', async () => {
    const r = await captureNativeBundle(`${origin}/`, { viewport: { width: 800, height: 600 } });
    expect(hits.api).toBe(2);   // o cenario EXERCITOU as duas chamadas, na ordem iframe -> principal

    const id = identidadeDeRequisicao('GET', `${origin}/api`, Buffer.alloc(0), {});
    const corpo = (path) => { const a = r.bundle.assets.find((x) => x.path === path); return a && Buffer.from(a.body).toString('utf8'); };
    expect(corpo(`_replay/${id}`)).toBe('MAIN');        // a 1a ocorrencia da LISTA e a do documento de entrada
    expect(corpo(`_replay/${id}.1`)).toBeUndefined();   // a do iframe nao entrou
    expect(r.relatorio.envelopesPerdidos).toEqual([]);
  }, 120000);
});
