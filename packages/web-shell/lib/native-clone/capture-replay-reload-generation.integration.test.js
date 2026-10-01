/**
 * RECARGA NA MESMA URL NAO CONTAMINA A SEQUENCIA — o produtor REAL (Astra B68, 2026-09-30).
 *
 * O documento inicial chama `/api` (OLD) e recarrega a mesma URL; o documento substituto
 * chama `/api` (MAIN). O frame principal e o MESMO nos dois — a guarda por frame deixava
 * as duas ocorrencias na lista e o replay do documento final recebia OLD. Ocorrencias
 * pertencem a uma GERACAO de documento; so a geracao cujo HTML virou a entrada e emitida.
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

// Pagina ALTA que se recarrega DURANTE a fase de rolagem da captura (Astra B78 colateral,
// visto na suite completa sob carga): o `page.evaluate` da rolagem morria com "Execution
// context was destroyed" e a captura inteira falhava. Uma recarga iniciada pelo site no meio
// da captura tem que ser tolerada: o documento novo e o dono, e a rolagem recomeca nele.
const SITE_ALTO = `<!doctype html>
<html><head><meta charset="utf-8"><title>reload tardio</title></head>
<body><h1>Documento alto que recarrega a si mesmo no meio da rolagem</h1>
${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.</p>\n'.repeat(400)}
<script>addEventListener('load', async function () {
  const r = await fetch('/api');
  const t = await r.text();
  if (!sessionStorage.getItem('recarregou')) {
    sessionStorage.setItem('recarregou', '1');
    // A recarga dispara DE DENTRO da leitura que a fase de rolagem faz (deterministico: o
    // contexto morre durante o proprio evaluate). Um site real faz isso por tempo; sob carga
    // a suite completa caiu exatamente aqui.
    Object.defineProperty(document.body, 'scrollHeight', { configurable: true, get: function () { location.reload(); return 12000; } });
    return;
  }
  document.body.dataset.api = t;
  document.body.dataset.pronto = '1';
});</script>
</body></html>`;

const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>reload</title></head>
<body><h1>Documento que chama a API e recarrega a si mesmo uma vez</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>addEventListener('load', async function () {
  const r = await fetch('/api');
  const t = await r.text();
  if (!sessionStorage.getItem('recarregou')) { sessionStorage.setItem('recarregou', '1'); location.reload(); return; }
  document.body.dataset.api = t;
  document.body.dataset.pronto = '1';
});</script>
</body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url.startsWith('/api')) { hits.api += 1; res.writeHead(200, { 'content-type': 'text/plain' }); res.end(hits.api === 1 ? 'OLD' : 'MAIN'); return; }
    hits.doc += 1;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url.startsWith('/alto') ? SITE_ALTO : SITE);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${server.address().port}`;
}, 30000);

afterAll(async () => { if (server) await new Promise((d) => server.close(d)); });

describe('recarga na mesma URL e a sequencia de replay', () => {
  it('a ocorrencia do documento substituido nao entra: o documento final recebe MAIN como 1a e unica', async () => {
    const r = await captureNativeBundle(`${origin}/`, { viewport: { width: 800, height: 600 } });
    expect(hits.doc).toBeGreaterThanOrEqual(2);   // o cenario EXERCITOU a recarga (a captura pode pedir o documento por conta propria)
    expect(hits.api).toBeGreaterThanOrEqual(2);   // e as duas chamadas (OLD no documento antigo, MAIN no novo)

    const id = identidadeDeRequisicao('GET', `${origin}/api`, Buffer.alloc(0), {});
    const corpo = (path) => { const a = r.bundle.assets.find((x) => x.path === path); return a && Buffer.from(a.body).toString('utf8'); };
    expect(corpo(`_replay/${id}`)).toBe('MAIN');
    expect(corpo(`_replay/${id}.1`)).toBeUndefined();
    expect(r.relatorio.envelopesPerdidos).toEqual([]);
  }, 120000);

  it('recarga iniciada pelo site DURANTE a rolagem nao derruba a captura: o documento novo e a entrada, MAIN e a 1a e unica', async () => {
    hits.api = 0; hits.doc = 0;
    const r = await captureNativeBundle(`${origin}/alto`, { viewport: { width: 800, height: 600 } });
    expect(hits.doc).toBeGreaterThanOrEqual(2);
    expect(hits.api).toBeGreaterThanOrEqual(2);
    const id = identidadeDeRequisicao('GET', `${origin}/api`, Buffer.alloc(0), {});
    const corpo = (path) => { const a = r.bundle.assets.find((x) => x.path === path); return a && Buffer.from(a.body).toString('utf8'); };
    expect(corpo(r.bundle.entryPath)).toContain('Documento alto que recarrega a si mesmo');
    expect(corpo(`_replay/${id}`)).toBe('MAIN');
    expect(corpo(`_replay/${id}.1`)).toBeUndefined();
    expect(r.relatorio.envelopesPerdidos).toEqual([]);
  }, 120000);
});
