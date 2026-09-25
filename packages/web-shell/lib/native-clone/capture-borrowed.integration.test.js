/**
 * Producers with a BORROWED session (spec 2026-09-08 §4.4): the capture runs
 * on the verified page it is handed, never closes a browser it does not own,
 * and its retry lane goes THROUGH the browser (same cookie jar + egress as the
 * verification — a Node fetch has neither).
 */
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal();
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  return { ...actual, default: { ...(actual.default || {}), lookup }, lookup };
});
const { captureNativeBundle } = await import('./capture-bundle.js');
const { captureSnapshot } = await import('../snapshot.js');
const { withBorrowedSession } = await import('../challenge/borrowed-session.js');

let server, origin, browserServer;
const seen = { partialHits: 0, cookieOnRetry: null };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const HTML = '<!doctype html><html><head><title>site</title></head><body><h1>Real site with text enough to be real and not an interstitial</h1><p>lorem ipsum dolor sit amet</p><img src="/partial.png" width="8" height="8"></body></html>';

beforeAll(async () => {
  server = createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'clearance=yes; Path=/' });
      return res.end(HTML);
    }
    if (p === '/partial.png') {
      seen.partialHits += 1;
      if (seen.partialHits === 1) {
        // The browser's own request gets a PARTIAL body: the interception keeps
        // the slot null (206 not covering the file) → retry lane must fetch it.
        res.writeHead(206, { 'content-type': 'image/png', 'content-range': `bytes 0-3/${PNG.length}`, 'content-length': 4 });
        return res.end(PNG.subarray(0, 4));
      }
      seen.cookieOnRetry = req.headers.cookie || null;
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length });
      return res.end(PNG);
    }
    res.writeHead(404); res.end();
  });
  await new Promise((d) => server.listen(0, '127.0.0.1', d));
  origin = `http://localhost:${server.address().port}`;
  browserServer = await chromium.launchServer({ headless: true });
});
afterAll(async () => { await browserServer.close(); await new Promise((d) => server.close(d)); });

const connect = (ws) => chromium.connect(ws);

describe('producers with a borrowed session', () => {
  it('captureNativeBundle: uses the given page, retries with the SESSION cookie jar, leaves the browser alive', async () => {
    seen.partialHits = 0; seen.cookieOnRetry = null;
    const etapas = [];
    const out = await withBorrowedSession(browserServer.wsEndpoint(), (session) =>
      captureNativeBundle(`${origin}/`, { session, onProgress: (p) => etapas.push(p.etapa) }), { connect });
    const diag = `hits=${seen.partialHits} cookie=${seen.cookieOnRetry} etapas=${etapas.join('>')} descartes=${JSON.stringify(out.relatorio.descartados)}`;
    expect(out.bundle.entryPath, diag).toMatch(/index\.html$/);
    expect(etapas, diag).toContain('retrying');
    // The retry carried the SESSION's cookie jar (context.request shares the
    // context cookies). NOTE: this local topology cannot assert EGRESS — on a
    // CDP-connected Browserbase session the retry uses OUR process's egress,
    // a NAMED residual in capture-bundle.js (Astra 2026-09-08 #2).
    expect(seen.cookieOnRetry, diag).toContain('clearance=yes');
    const png = out.bundle.assets.find((a) => a.path.endsWith('partial.png'));
    expect(png, diag).toBeTruthy();
    expect(Buffer.from(png.body).equals(PNG), diag).toBe(true);
    // Browser still alive after the producer returned (it did not own it).
    const alive = await withBorrowedSession(browserServer.wsEndpoint(), async ({ page }) => { await page.goto(`${origin}/`); return page.title(); }, { connect });
    expect(alive).toBe('site');
  }, 90_000);

  it('captureSnapshot: uses the borrowed page and leaves the browser alive', async () => {
    let requestsOnBorrowedContext = 0;
    const snap = await withBorrowedSession(browserServer.wsEndpoint(), (session) => {
      session.page.on('request', () => { requestsOnBorrowedContext += 1; });
      return captureSnapshot(`${origin}/`, { session });
    }, { connect });
    expect(snap.html).toContain('Real site');
    // Discriminator: the capture navigated THE BORROWED page (not a browser of its own).
    expect(requestsOnBorrowedContext).toBeGreaterThan(0);
    const alive = await withBorrowedSession(browserServer.wsEndpoint(), async ({ page }) => { await page.goto(`${origin}/`); return page.title(); }, { connect });
    expect(alive).toBe('site');
  }, 60_000);
});
