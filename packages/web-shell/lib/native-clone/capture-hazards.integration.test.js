/**
 * Two hazards measured on a REAL site (amigosecreto.curriculum.com.br,
 * 2026-09-06), reproduced here against a local server with the REAL producer:
 *
 * 1. A response that never terminates. The site fired a beacon to
 *    `challenges.cloudflare.com` whose `finished()` never resolved (45s+
 *    measured). The producer awaited EVERY in-flight body with no ceiling, so
 *    one stuck response held the whole capture hostage until the route's 90s
 *    deadline: 504 + refund, for a page that was otherwise fully captured.
 *
 * 2. A bot-challenge interstitial. The reference capture (`captureSnapshot`)
 *    detects "Just a moment…" and raises `ChallengeRequiredError`; the native
 *    producer did not, so it would have bundled the interstitial AS the site.
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

// The race test needs a SHORT collect cap; the producer reads the env at
// import time, so it must be set BEFORE the import (Astra r2 #4: assigning
// it below the import made the constant stay at 20s and the test vacuous).
process.env.UNCRAFT_CAPTURE_COLLECT_CAP_MS = '700';
const { captureNativeBundle } = await import('./capture-bundle.js');
const { ChallengeRequiredError } = await import('../snapshot.js');

let server;
let origin;
const heldOpen = new Set();
const gateHits = { count: 0 };
const slowHits = { count: 0 };
const gate2Hits = { count: 0 };

const REAL_AFTER_GATE = `<!doctype html>
<html><head><meta charset="utf-8"><title>the real site</title></head>
<body><h1>REAL PAGE served after the interstitial cleared and reloaded the same URL</h1>
<p>Enough text here to be a real page and not a tiny challenge interstitial at all.</p>
</body></html>`;

// First hit: interstitial that clears itself and RELOADS THE SAME URL.
const GATE_INTERSTITIAL = `<!doctype html>
<html><head><meta charset="utf-8"><title>Just a moment...</title></head>
<body><div id="challenge-running">Checking your browser</div>
<script>setTimeout(function(){ location.reload(); }, 300);</script></body></html>`;

// The slow asset is requested AFTER `load` (an <img> in the markup would hold
// the load event and finish before collection — Astra r2 #4), and its body
// only completes well after the 700ms collect cap.
const SLOW_SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>slow body</title></head>
<body><h1>A real page whose one asset has a body that finishes late, after the collect cap</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>addEventListener('load', function () { var i = new Image(); i.src = '/slow.png'; });</script>
</body></html>`;
// A challenge that reloads itself forever (every hit is an interstitial): the
// tolerance loop must NOT mistake a destroyed evaluation context for clearance.
const GATE2_FOREVER = `<!doctype html>
<html><head><meta charset="utf-8"><title>Just a moment...</title></head>
<body><div id="challenge-running">Checking your browser</div>
<script>setTimeout(function(){ location.reload(); }, 250);</script></body></html>`;
const SLOW_BODY = Buffer.from('slow-body-bytes-'.repeat(64));

const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>real site</title></head>
<body><h1>A real page with enough text to be a real page and not a challenge interstitial</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>fetch('/beacon').catch(function(){});</script>
</body></html>`;

const INTERSTITIAL = `<!doctype html>
<html><head><meta charset="utf-8"><title>Just a moment...</title></head>
<body><div id="challenge-running">Checking your browser</div></body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/site') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SITE); return; }
    if (path === '/challenge') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(INTERSTITIAL); return; }
    if (path === '/beacon') {
      // Headers + a first chunk, then NEVER end: the browser sees a response
      // (the producer's handler fires) whose body never finishes.
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('x');
      heldOpen.add(res);
      return;
    }
    if (path === '/beacon204') {
      // The measured real shape: a 204 whose socket is never closed.
      res.writeHead(204); res.flushHeaders();
      heldOpen.add(res);
      return;
    }
    if (path === '/site204') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(SITE.replace("fetch('/beacon')", "fetch('/beacon204')"));
      return;
    }
    if (path === '/gate') {
      gateHits.count += 1;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(gateHits.count === 1 ? GATE_INTERSTITIAL : REAL_AFTER_GATE);
      return;
    }
    if (path === '/slow-site') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SLOW_SITE); return; }
    if (path === '/slow.png') {
      slowHits.count += 1;
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': SLOW_BODY.length });
      // Headers go out NOW (Node only flushes them on the first write/end —
      // without this the browser has no response at all and the producer has
      // nothing to see or name). The browser's request (1st) then finishes
      // long AFTER the collect cap; a retry fetch (2nd) would be served at once.
      res.flushHeaders();
      if (slowHits.count === 1) setTimeout(() => res.end(SLOW_BODY), 7000);
      else res.end(SLOW_BODY);
      return;
    }
    if (path === '/gate2') {
      gate2Hits.count += 1;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(GATE2_FOREVER);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  for (const res of heldOpen) { try { res.destroy(); } catch { /* already gone */ } }
  await new Promise((done) => server.close(done));
});

describe('native capture hazards (real browser, real producer)', () => {
  it('a response that never terminates cannot hold the capture hostage — it is bounded and NAMED', async () => {
    const t0 = Date.now();
    const out = await captureNativeBundle(`${origin}/site`, { onProgress: () => {} });
    const elapsed = Date.now() - t0;
    // The page itself is captured…
    expect(out.bundle.entryPath).toMatch(/index\.html$/);
    // …the stuck beacon is named in the report, not silently lost…
    const stuck = out.relatorio.descartados.find((d) => d.u.endsWith('/beacon'));
    expect(stuck, 'the never-ending response must appear in the report').toBeTruthy();
    expect(stuck.motivo).toBe('corpo nao chegou');
    // …and the wait is bounded well under the route's 90s deadline.
    expect(elapsed).toBeLessThan(60_000);
  }, 70_000);

  it('the measured shape too: a 204 whose socket never closes is bounded', async () => {
    const t0 = Date.now();
    const out = await captureNativeBundle(`${origin}/site204`, { onProgress: () => {} });
    expect(out.bundle.entryPath).toMatch(/index\.html$/);
    expect(Date.now() - t0).toBeLessThan(60_000);
  }, 70_000);

  it('an interstitial that clears and reloads the SAME URL is superseded: the bundle carries the real page (Astra r1 #1)', async () => {
    const etapas = [];
    let out;
    try {
      out = await captureNativeBundle(`${origin}/gate`, { onProgress: (p) => etapas.push(p.etapa) });
    } catch (e) {
      throw new Error(`capture threw ${e?.name} ${e?.message} | gateHits=${gateHits.count} etapas=${etapas.join('>')}`);
    }
    const entry = out.bundle.assets.find((a) => a.path === out.bundle.entryPath);
    const html = Buffer.from(entry.body).toString('utf8');
    const diag = `gateHits=${gateHits.count} etapas=${etapas.join('>')} head=${JSON.stringify(html.slice(0, 90))} descartes=${JSON.stringify(out.relatorio.motivosDescartados)}`;
    expect(gateHits.count, diag).toBeGreaterThanOrEqual(2);
    expect(html, diag).toContain('REAL PAGE served after the interstitial');
    expect(html, diag).not.toContain('Just a moment');
  }, 60_000);

  it('a body still in flight at the collect cap is NOT re-fetched by the retry lane, is named once, and its late arrival is inert (Claude r1 #3 / Astra r1 #3, r2 #4)', async () => {
    const etapas = [];
    const out = await captureNativeBundle(`${origin}/slow-site`, { onProgress: (p) => etapas.push(p.etapa) });
    const diag = `slowHits=${slowHits.count} etapas=${etapas.join('>')} descartes=${JSON.stringify(out.relatorio.descartados)} bytes=${out.relatorio.bytes}`;
    // Only the browser's request reached the server: the retry lane skipped the URL that was still reading.
    expect(slowHits.count, diag).toBe(1);
    // Not in the bundle (it had not arrived), named EXACTLY once with the honest reason…
    expect(out.bundle.assets.filter((a) => a.path.endsWith('slow.png')), diag).toHaveLength(0);
    const named = out.relatorio.descartados.filter((d) => d.u.endsWith('/slow.png'));
    expect(named, diag).toHaveLength(1);
    expect(named[0].motivo, diag).toBe('corpo nao chegou');
    // …and never as a fabricated "too large".
    expect(out.relatorio.motivosDescartados['grande demais'], diag).toBeUndefined();
    // Ledger holds only the html: the late body neither counted nor entered.
    expect(out.relatorio.bytes, diag).toBe(Buffer.byteLength(SLOW_SITE));
    // Give the late body time to arrive after the return, then confirm nothing leaked into the returned report.
    await new Promise((r) => setTimeout(r, 1500));
    expect(out.relatorio.totalDescartados, diag).toBe(1);
  }, 60_000);

  it('an interstitial that keeps reloading itself is still refused — a destroyed evaluation context is not clearance (Astra r2 #1)', async () => {
    const t0 = Date.now();
    await expect(captureNativeBundle(`${origin}/gate2`, { onProgress: () => {} }))
      .rejects.toMatchObject({ code: 'challenge_required' });
    expect(gate2Hits.count).toBeGreaterThanOrEqual(2);
    expect(Date.now() - t0).toBeLessThan(30_000);
  }, 60_000);

  it('a bot-challenge interstitial is refused with ChallengeRequiredError, never bundled as the site', async () => {
    await expect(captureNativeBundle(`${origin}/challenge`, { onProgress: () => {} }))
      .rejects.toBeInstanceOf(ChallengeRequiredError);
    await expect(captureNativeBundle(`${origin}/challenge`, { onProgress: () => {} }))
      .rejects.toMatchObject({ code: 'challenge_required', kind: 'cloudflare' });
  }, 60_000);
});
