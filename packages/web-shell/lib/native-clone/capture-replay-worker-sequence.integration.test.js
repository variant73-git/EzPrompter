/**
 * WORKER DEDICADO NAO CONTAMINA A SEQUENCIA DO DOCUMENTO — o produtor REAL (Astra B71, 2026-09-30).
 *
 * O Playwright atribui os pedidos de um worker dedicado ao frame dono; um worker do frame
 * principal passava pela guarda por frame. Worker chama `/api` primeiro (WORKER), a pagina
 * depois (MAIN): a lista ficava [WORKER, MAIN] e a pagina recebia WORKER no replay, porque
 * o worker nao tem interceptor. Ocorrencia = chamada que o REMENDO da entrada intercepta:
 * a captura anuncia as chamadas de `window.fetch` do documento de entrada pelo MESMO ponto
 * de interceptacao e so reserva vaga para elas.
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

let server; let origin; let outro;
const hits = { api: 0, worker: 0, post: 0 };

// U e CROSS-ORIGIN para a pagina (2o servidor em localhost, outra porta — um IP literal cairia
// na guarda de host publico da captura e nunca viraria envelope) — Astra B74: a
// pagina chama U com mode 'same-origin' (rejeita ANTES de despachar), o worker chama U por
// CORS e a pagina chama U depois. O anuncio da chamada rejeitada nao pode sobrar para o worker.
let U = '';
const WORKER = () => `fetch(${JSON.stringify(U)}).then(r => r.text()).then(t => postMessage({ worker: t }));`;
const SITE = () => `<!doctype html>
<html><head><meta charset="utf-8"><title>worker</title></head>
<body><h1>Documento principal com um worker que chama a API primeiro</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>
const U = ${JSON.stringify(U)};
// Astra B72: uma chamada JA ABORTADA rejeita antes de despachar pedido algum — um anuncio
// que nunca casa. O worker vem em seguida e nao pode herdar esse anuncio.
fetch('/api', { signal: AbortSignal.abort() }).catch(function () { document.body.dataset.abortada = '1'; });
// Astra B73: construcao do Request que FALHA (getter com estado lanca na 1a leitura) tem que
// rejeitar com o erro original — nunca reavaliar os argumentos e despachar um POST sem anuncio.
var leituras = 0;
fetch('/api', { body: 'payload', get method() { if (++leituras === 1) throw new TypeError('invalid'); return 'POST'; } })
  .catch(function (e) { document.body.dataset.getter = e.message; });
// Astra B74: 'same-origin' para outra origem rejeita antes de qualquer pedido — sem anuncio
// pendente para o worker herdar. A sequencia e estritamente sequencial: rejeicao -> worker -> pagina.
fetch(U, { mode: 'same-origin' }).catch(function (e) { document.body.dataset.sameOrigin = e.message; }).then(function () {
  const w = new Worker('/w.js');
  w.onmessage = async function (ev) {
    const r = await fetch(U);
    document.body.dataset.principal = await r.text();
    document.body.dataset.worker = ev.data.worker;
    document.body.dataset.pronto = '1';
  };
});
</script>
</body></html>`;

beforeAll(async () => {
  const handler = (req, res) => {
    if (req.url.startsWith('/api')) {
      if (req.method === 'POST') { hits.post += 1; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('POSTED'); return; }
      hits.api += 1; res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end(hits.api === 1 ? 'WORKER' : 'MAIN'); return;
    }
    if (req.url.startsWith('/w.js')) { hits.worker += 1; res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(WORKER()); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SITE());
  };
  server = createServer(handler);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${server.address().port}`;
  outro = createServer(handler);
  await new Promise((done) => outro.listen(0, '127.0.0.1', done));
  U = `http://localhost:${outro.address().port}/api`;   // outra ORIGEM (porta), mesmo handler e mesmos contadores
}, 30000);

afterAll(async () => { for (const s of [server, outro]) if (s) await new Promise((d) => s.close(d)); });

describe('worker dedicado e a sequencia de replay do documento de entrada', () => {
  it('a chamada do worker (primeira) nao entra na lista, nem herda o anuncio de uma chamada pre-abortada: o documento recebe MAIN como 1a e unica', async () => {
    const r = await captureNativeBundle(`${origin}/`, { viewport: { width: 800, height: 600 } });
    expect(hits.worker).toBeGreaterThanOrEqual(1);   // o cenario EXERCITOU o worker
    expect(hits.api).toBe(2);                          // worker -> principal
    expect(hits.post).toBe(0);                         // a construcao que falhou NAO despachou nada (Astra B73)

    const id = identidadeDeRequisicao('GET', U, Buffer.alloc(0), {});
    const corpo = (path) => { const a = r.bundle.assets.find((x) => x.path === path); return a && Buffer.from(a.body).toString('utf8'); };
    expect(corpo(`_replay/${id}`)).toBe('MAIN');
    expect(corpo(`_replay/${id}.1`)).toBeUndefined();
    expect(r.relatorio.envelopesPerdidos).toEqual([]);
  }, 120000);
});
