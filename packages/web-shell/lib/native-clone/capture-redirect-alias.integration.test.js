/**
 * A reference that REDIRECTS must point at the file the redirect led to.
 *
 * Measured on bleibtgleich.dev (2026-10-05): the page loads
 * `<script src="https://unpkg.com/@barba/core">`; unpkg answers 302 to
 * `/@barba/core@2.10.3/dist/barba.umd.js`. The capture stored the file under
 * the FINAL URL and rewrote references by exact match, so the markup kept the
 * original URL — outside the bundle. Offline (and under the gateway's CSP) the
 * script never loads, `barba is not defined`, the site's code stops and the
 * WebGL carousel is never drawn. Same for any versionless CDN reference.
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

const { captureNativeBundle } = await import('./capture-bundle.js');

let server;
let origin;
const HTML = () => `<!doctype html>
<html><head><meta charset="utf-8"><title>redirect</title>
<link rel="stylesheet" href="/css/latest">
<script src="/lib/core@2.0/dist/core.js"></script>
<script src="/lib/core"></script>
<script src="/lib/outro-apelido"></script>
</head><body><p id="alvo">x</p><p id="api">x</p><a id="ln" href="${origin}/api">api</a>
<script>window.__citado = '${origin}/lib/core';</script>
<script>window.__corpo = "<style>x{background:url(${origin}/lib/core)}y{background:url(${origin}/css/v3/site.css)}</style>";</script>
<script>document.getElementById('alvo').textContent = window.__lib || 'faltou';
fetch('${origin}/api').then((r) => r.json()).then((j) => { document.getElementById('api').textContent = j.v; });</script>
</body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/' || path === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HTML()); return; }
    if (path === '/lib/core') { res.writeHead(302, { location: '/lib/core@2.0/dist/core.js' }); res.end(); return; }
    if (path === '/lib/core@2.0/dist/core.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end("window.__lib = 'carregou';"); return; }
    if (path === '/lib/outro-apelido') { res.writeHead(302, { location: '/lib/core@2.0/dist/core.js' }); res.end(); return; }
    if (path === '/api') { res.writeHead(302, { location: '/result' }); res.end(); return; }
    if (path === '/result') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"v":"api-ok"}'); return; }
    if (path === '/css/latest') { res.writeHead(301, { location: '/css/v3/site.css' }); res.end(); return; }
    if (path === '/css/v3/site.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end('p{color:rgb(1, 2, 3)}'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${server.address().port}`;
});
afterAll(async () => { await new Promise((done) => server.close(done)); });

describe('capture: reference that redirects (real producer, real browser)', () => {
  it('the markup points at the bundled file the redirect led to, and it RUNS offline', async () => {
    const out = await captureNativeBundle(`${origin}/`, {});
    const declared = new Map(out.bundle.assets.map((a) => [a.path, a]));
    const entry = out.bundle.assets.find((a) => a.path === out.bundle.entryPath);
    const html = Buffer.from(entry.body).toString('utf8');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    const scriptSrc = scripts[1];
    const cssHref = /<link rel="stylesheet" href="([^"]+)"/.exec(html)[1];
    // resolved against the entry, each reference must be a declared asset
    const resolver = (r) => decodeURIComponent(new URL(r, `http://bundle.test/${out.bundle.entryPath}`).pathname.slice(1));
    expect(declared.has(resolver(scriptSrc)), `script ainda aponta para fora: ${scriptSrc}`).toBe(true);
    expect(declared.has(resolver(cssHref)), `css ainda aponta para fora: ${cssHref}`).toBe(true);
    expect(Buffer.from(declared.get(resolver(scriptSrc)).body).toString('utf8')).toContain("window.__lib = 'carregou'");
    // Astra r1 #2: o destino ja tinha sido guardado (carregado direto, 1o script) e DOIS apelidos convergem nele
    for (const s of scripts) expect(declared.has(resolver(s)), `script fora do pacote: ${s}`).toBe(true);
    // Astra r1 #1: o apelido NUNCA entra no codigo do script — o fetch redirecionado segue pela identidade original
    expect(html).toContain(`fetch('${origin}/api')`);
    expect(html).not.toMatch(/fetch\([^)]*result/);
    // o apelido de recurso ESTATICO tambem nao entra em script; e link para a API (salto de fetch) nao ganha apelido
    expect(html).toContain(`window.__citado = '${origin}/lib/core'`);
    expect(html).toContain(`href="${origin}/api"`);
    // Astra r2: um <style> que so existe como TEXTO dentro de um script (corpo de POST) nao e folha de estilo
    // (a URL EXATA de um recurso capturado dentro de script segue a regra antiga do produtor; o APELIDO nao entra)
    expect(html).toContain(`<style>x{background:url(${origin}/lib/core)}`);
    // e a chamada redirecionada continua no replay, pela identidade ORIGINAL (o remendo a serve sob o gateway)
    expect(out.relatorio.chamadasDeRuntimeMapeadas).toBeGreaterThan(0);

    // and it runs: serve ONLY the bundle, network blocked
    const { chromium } = await import('playwright-core');
    const b = await chromium.launch(); const p = await b.newPage();
    try {
      await p.route('**/*', (r) => {
        const path = decodeURIComponent(new URL(r.request().url()).pathname.slice(1)) || out.bundle.entryPath;
        const a = declared.get(path); if (!a) return r.abort();
        return r.fulfill({ body: Buffer.from(a.body), contentType: a.contentType || undefined });
      });
      await p.goto(`http://bundle.test/${out.bundle.entryPath}`);
      expect(await p.textContent('#alvo')).toBe('carregou');

      expect(await p.evaluate(() => getComputedStyle(document.querySelector('p')).color)).toBe('rgb(1, 2, 3)');
    } finally { await b.close(); }
  }, 120_000);
});
