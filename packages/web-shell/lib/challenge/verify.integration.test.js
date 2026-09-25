import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { withBorrowedSession } from './borrowed-session.js';
import { verifyTarget } from './verify.js';

let server, origin, browserServer;
const hits = { gate: 0 };
const CLEAN = '<!doctype html><title>real</title><body><h1>Real page with enough text to be real and not an interstitial</h1><p>Lorem ipsum dolor sit amet consectetur.</p></body>';
const GATE = '<!doctype html><title>Just a moment...</title><body><div id="challenge-running">x</div><script>setTimeout(()=>location.reload(),300)</script></body>';
const DENIED = '<!doctype html><title>Access denied</title><body>Access denied — reference #123</body>';

beforeAll(async () => {
  server = createServer((req, res) => {
    const p = req.url.split('?')[0];
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (p === '/clean') return res.end(CLEAN);
    if (p === '/gate-clears') { hits.gate += 1; return res.end(hits.gate < 3 ? GATE : CLEAN); }
    if (p === '/gate-forever') return res.end(GATE);
    if (p === '/denied') return res.end(DENIED);
    res.end(CLEAN);
  });
  await new Promise((d) => server.listen(0, '127.0.0.1', d));
  origin = `http://127.0.0.1:${server.address().port}`;
  browserServer = await chromium.launchServer({ headless: true });
});
afterAll(async () => { await browserServer.close(); await new Promise((d) => server.close(d)); });

const connect = (ws) => chromium.connect(ws);

describe('borrowed session + verifyTarget', () => {
  it('uses the session page, and does not kill the browser on return', async () => {
    const r = await withBorrowedSession(browserServer.wsEndpoint(), async ({ page, owned }) => {
      expect(owned).toBe(false);
      await page.goto(`${origin}/clean`);
      return page.title();
    }, { connect });
    expect(r).toBe('real');
    const again = await withBorrowedSession(browserServer.wsEndpoint(), async ({ page }) => { await page.goto(`${origin}/clean`); return page.title(); }, { connect });
    expect(again).toBe('real');
  });

  it('clean page → clean; self-clearing interstitial within tolerance → clean', async () => {
    await withBorrowedSession(browserServer.wsEndpoint(), async ({ page }) => {
      expect((await verifyTarget({ page, url: `${origin}/clean`, toleranceMs: 3000 })).verdict).toBe('clean');
      expect((await verifyTarget({ page, url: `${origin}/gate-clears`, toleranceMs: 6000 })).verdict).toBe('clean');
    }, { connect });
  }, 40_000);

  it('interstitial that never clears → needs_human; hard denial → unsupported', async () => {
    await withBorrowedSession(browserServer.wsEndpoint(), async ({ page }) => {
      const v = await verifyTarget({ page, url: `${origin}/gate-forever`, toleranceMs: 2500 });
      expect(v).toMatchObject({ verdict: 'needs_human', kind: 'cloudflare' });
      expect((await verifyTarget({ page, url: `${origin}/denied`, toleranceMs: 1500 })).verdict).toBe('unsupported');
    }, { connect });
  }, 30_000);
});
