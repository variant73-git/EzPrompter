/**
 * Does the capture actually close its image references — for ANY site?
 *
 * The unit test covers the srcset parser in isolation; it cannot tell whether
 * a real page's references end up inside the bundle. This one serves a page
 * that uses every way a site references an image and drives the REAL producer
 * against it, then asserts the bundle keeps no absolute image URL behind (the
 * gateway's CSP blocks those, so a leftover is a broken image forever).
 */
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The SSRF guard correctly refuses a loopback target, so the fixture is
// reached through a hostname whose RESOLUTION is stubbed to a public address.
// Only DNS is faked — the guard itself, the browser and the whole producer
// pipeline run for real.
vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...(actual.default || {}), lookup: async () => [{ address: '93.184.216.34', family: 4 }] },
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  };
});

const { captureNativeBundle } = await import('./capture-bundle.js');
const { rewriteRuntimePaths } = await import('../motion-editor/native-clone-gateway.js');

// 1x1 PNG and GIF payloads — distinct bytes so a mixed-up mapping shows up.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

let server;
let origin;

const HTML = () => `<!doctype html>
<html><head><meta charset="utf-8"><title>closure</title>
<link rel="stylesheet" href="/site.css">
<link rel="preload" as="image" imagesrcset="/preload-a.png 1x, /preload-b.png 2x">
</head>
<body>
  <!-- the viewport picks ONE candidate; the others used to stay absolute -->
  <img src="/hero.png" srcset="/hero-500.png 500w, /hero-1500.png 1500w" sizes="100vw" width="40" height="40">
  <picture>
    <source srcset="/art-wide.png 900w, /art-narrow.png 400w" type="image/png">
    <img src="/art-fallback.png" width="40" height="40">
  </picture>
  <div class="bg-used" style="width:20px;height:20px"></div>
  <!-- a rule no element matches: never requested during the visit -->
  <div class="bg-unused-marker"></div>
  <img data-srcset="/lazy-a.png 1x, /lazy-b.png 2x" src="/lazy-placeholder.gif" width="10" height="10">
</body></html>`;

const CSS = `
.bg-used { background-image: url('/bg-used.png'); }
.bg-never-matched { background-image: url("/bg-unused.png"); }
`;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HTML());
      return;
    }
    if (path === '/site.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(CSS);
      return;
    }
    if (path.endsWith('.png')) {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length });
      res.end(PNG);
      return;
    }
    if (path.endsWith('.gif')) {
      res.writeHead(200, { 'content-type': 'image/gif', 'content-length': GIF.length });
      res.end(GIF);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${server.address().port}`;
});

afterAll(async () => { await new Promise((done) => server.close(done)); });

describe('capture reference closure (real producer, real browser)', () => {
  it('captures every referenced image and leaves no absolute image URL behind', async () => {
    const out = await captureNativeBundle(`${origin}/`, {});
    const paths = out.bundle.assets.map((a) => a.path);
    const entry = out.bundle.assets.find((a) => a.path === out.bundle.entryPath);
    const html = Buffer.from(entry.body).toString('utf8');
    const css = Buffer.from(
      out.bundle.assets.find((a) => a.path.endsWith('site.css')).body,
    ).toString('utf8');

    // Every image the page can reach is in the bundle — including the srcset
    // candidates the capture viewport never chose and the CSS rule that no
    // element matched during the visit.
    for (const name of [
      'hero.png', 'hero-500.png', 'hero-1500.png',
      'art-wide.png', 'art-narrow.png', 'art-fallback.png',
      'preload-a.png', 'preload-b.png',
      'lazy-a.png', 'lazy-b.png',
      'bg-used.png', 'bg-unused.png',
    ]) {
      expect(paths.some((p) => p.endsWith(name)), `missing from bundle: ${name}`).toBe(true);
    }

    // And nothing still points at the origin: an absolute URL survives as a
    // permanently broken image under the runtime gateway's img-src 'self'.
    expect(html).not.toContain(origin);
    expect(css).not.toContain(origin);
  }, 120_000);

  it('every image reference RESOLVES to a declared asset once the gateway serves it', async () => {
    // The real question is not "was it captured" but "does the browser find
    // it". The gateway serves the entry under /api/runtime/<token>/<entry>
    // and translates root-absolute paths whose first segment is a bundle
    // DIRECTORY. A file living at the domain root has no directory, so its
    // reference escapes the token path and 404s — a broken image on any site
    // that serves images from its own root.
    const out = await captureNativeBundle(`${origin}/`, {});
    const declared = new Set(out.bundle.assets.map((a) => a.path));
    const entry = out.bundle.assets.find((a) => a.path === out.bundle.entryPath);
    const prefixes = [...new Set(out.bundle.assets
      .map((a) => a.path.split('/'))
      .filter((seg) => seg.length > 1)
      .map(([p]) => p))];
    const base = '/api/runtime/TOKEN';
    const servedHtml = rewriteRuntimePaths(
      Buffer.from(entry.body).toString('utf8'), prefixes, base,
    );
    const docUrl = new URL(`${base}/${out.bundle.entryPath}`, 'http://runtime.test');

    const refs = [...servedHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
      .filter((u) => !u.startsWith('data:'));
    const unresolved = [];
    for (const ref of refs) {
      const abs = new URL(ref, docUrl);
      if (!abs.pathname.startsWith(`${base}/`)) { unresolved.push(ref); continue; }
      const assetPath = abs.pathname.slice(base.length + 1);
      if (!declared.has(decodeURIComponent(assetPath))) unresolved.push(ref);
    }
    expect(unresolved, `references that would 404 in the editor: ${unresolved.join(', ')}`).toEqual([]);
  }, 120_000);
});
