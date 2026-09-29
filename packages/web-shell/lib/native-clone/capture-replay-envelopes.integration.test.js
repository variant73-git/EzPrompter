/**
 * ENVELOPES DE REPLAY — o produtor REAL contra um servidor local (Astra B2, 2026-09-29).
 *
 * Três garantias, cada uma um achado da auditoria:
 *  #3 — a MESMA chamada feita duas vezes com respostas diferentes produz DOIS envelopes
 *       (`_replay/<id>` e `_replay/<id>.1`). Antes, o dedup de assets por URL descartava
 *       a 2ª ocorrência e o remendo repetia a última resposta para sempre.
 *  #2 — a mesma URL+corpo com `Authorization` diferente é OUTRA identidade.
 *  #6 — o manifesto embutido no HTML não carrega a URL da chamada (query com token
 *       apareceria literalmente no pacote).
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

let server;
let origin;
const hits = { api: 0, auth: 0 };

const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>replay</title></head>
<body><h1>Uma página que chama a mesma API duas vezes e uma vez autenticada</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>addEventListener('load', async function () {
  await fetch('/api?token=SEGREDO-NA-QUERY', { method: 'POST', body: 'q' });
  await fetch('/api?token=SEGREDO-NA-QUERY', { method: 'POST', body: 'q' });
  await fetch('/api?token=SEGREDO-NA-QUERY', { method: 'POST', body: 'q', headers: { Authorization: 'Bearer t' } });
  document.body.dataset.pronto = '1';
});</script>
</body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      let corpo = '';
      req.on('data', (c) => { corpo += c; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        if (req.headers.authorization) { hits.auth += 1; res.end('autenticado'); return; }
        hits.api += 1;
        res.end(hits.api === 1 ? 'primeira' : 'segunda');
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SITE);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${server.address().port}`;
}, 30000);

afterAll(async () => { if (server) await new Promise((d) => server.close(d)); });

describe('envelopes de replay', () => {
  it('ocorrências repetidas viram envelopes numerados; Authorization separa; a URL não vai ao HTML', async () => {
    const r = await captureNativeBundle(`${origin}/`, { viewport: { width: 800, height: 600 } });
    expect(hits.api).toBe(2);   // o cenário EXERCITOU o caminho
    expect(hits.auth).toBe(1);

    const url = `${origin}/api?token=SEGREDO-NA-QUERY`;
    const ct = { 'content-type': 'text/plain;charset=UTF-8' };
    const id = identidadeDeRequisicao('POST', url, Buffer.from('q'), ct);
    const idAuth = identidadeDeRequisicao('POST', url, Buffer.from('q'), { ...ct, authorization: 'Bearer t' });
    expect(idAuth).not.toBe(id);

    const corpo = (path) => { const a = r.bundle.assets.find((x) => x.path === path); return a && Buffer.from(a.body).toString('utf8'); };
    expect(corpo(`_replay/${id}`)).toBe('primeira');
    expect(corpo(`_replay/${id}.1`)).toBe('segunda');     // #3: a 2ª ocorrência existe
    expect(corpo(`_replay/${idAuth}`)).toBe('autenticado'); // #2: identidade própria
    expect(r.relatorio.envelopesRepetidosPerdidos).toEqual([]);

    // #6: a URL vive no <script> do PRÓPRIO site (é ele que chama); o que não pode é o
    // nosso manifesto repeti-la.
    const html = corpo(r.bundle.entryPath);
    const inicio = html.indexOf('<script data-uncraft-runtime-fetch-map>');
    expect(inicio).toBeGreaterThan(-1);
    const remendo = html.slice(inicio, html.indexOf('</script>', inicio));
    expect(remendo).toContain(id);                          // o manifesto conhece a identidade…
    expect(remendo).not.toContain('SEGREDO-NA-QUERY');      // …mas não a URL
  }, 120000);
});
