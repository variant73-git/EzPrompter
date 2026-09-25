import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyLease = vi.fn();
vi.mock('../../../../../lib/motion-editor/runtime-lease.js', async (original) => ({
  ...(await original()),
  verifyLease,
}));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock.mockImplementation(() => Promise.resolve(sqlMock._results.shift() || []));
vi.mock('../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const store = { read: vi.fn() };
vi.mock('../../../../../lib/native-clone/bundle-store.js', () => ({
  createConfiguredBundleStore: () => store,
  indexedAssetKey: (root, path) => `${root}/assets/${path}`,
}));

const { GET, POST, __clearLeaseGatewayCacheForTests, __clearLeaseRateLimitForTests, __leaseRateLimitSizeForTests, __setLeaseRateLimitForTests } = await import('./route.js');

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const BUNDLE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'runtime-only-secret-with-at-least-32-characters';
const HOST = 'a1b2c3d4e5f60718293a4b5c6d7e8f90.rt.uncraft.test';
const FINGERPRINT = `sha256:${'a'.repeat(64)}`;
const HTML_HASH = `sha256:${'b'.repeat(64)}`;
const JS_HASH = `sha256:${'c'.repeat(64)}`;

const manifest = {
  schemaVersion: 2, baseBundleId: BUNDLE_ID, transactions: [], controlManifest: {},
  responsiveManifest: {}, runtimeFingerprint: FINGERPRINT,
};

function bundleRow(overrides = {}) {
  return {
    session_id: SESSION_ID, node_id: NODE_ID, session_status: 'active',
    draft_manifest: { ...manifest, baseBundleId: BUNDLE_ID },
    bundle_id: BUNDLE_ID, schema_version: 1,
    storage_key: `native-bundles/v1/${BUNDLE_ID}`, content_hash: `sha256:${'d'.repeat(64)}`,
    entry_path: 'index.html',
    asset_index: [
      { path: 'index.html', contentType: 'text/html; charset=utf-8', byteLength: 1, contentHash: HTML_HASH },
      { path: 'media/a.webp', contentType: 'image/webp', byteLength: 1, contentHash: JS_HASH },
    ],
    runtime_fingerprint: FINGERPRINT,
    reconstruction_capabilities: { detectedEngines: ['waapi'], candidateControls: [] },
    ...overrides,
  };
}

function leaseOk() {
  return { lease: { edit_session_id: SESSION_ID, node_id: NODE_ID, bundle_id: BUNDLE_ID, hostname: HOST, status: 'active', expires_at: new Date(Date.now() + 3.6e6).toISOString() } };
}

function req(path = 'index.html', { cookie = '__Host-rt=COOKIEVAL', headers = {}, search = '' } = {}) {
  return new Request(`https://${HOST}/api/rt/${SESSION_ID}/${path}${search}`, {
    headers: { host: HOST, ...(cookie ? { cookie } : {}), ...headers },
  });
}
const ctx = (path = ['index.html'], sessionId = SESSION_ID) => ({ params: Promise.resolve({ sessionId, path }) });

beforeEach(() => {
  process.env.UNCRAFT_RUNTIME_LEASE = '1';
  process.env.UNCRAFT_RUNTIME_SESSION_SECRET = SECRET;
  verifyLease.mockReset();
  verifyLease.mockResolvedValue(leaseOk());
  sqlMock._results = [[bundleRow()]];
  store.read.mockReset();
  __clearLeaseGatewayCacheForTests();
  __clearLeaseRateLimitForTests();
  __setLeaseRateLimitForTests({ max: 600, windowMs: 60_000, maxKeys: 64 });
});
afterEach(() => {
  delete process.env.UNCRAFT_RUNTIME_LEASE;
  delete process.env.UNCRAFT_RUNTIME_SESSION_SECRET;
});

describe('GET /api/rt/[sessionId]/[...path]', () => {
  it('serves a cookie-authed asset embeddable cross-origin: no ACAO, CORP cross-origin, Origin-Agent-Cluster ?1, clean rewrite base', async () => {
    store.read.mockResolvedValue(new TextEncoder().encode('<html><body><img src="/media/a.webp"></body></html>'));
    const res = await GET(req(), ctx());
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    // O app embute o runtime de OUTRA origem: CORP tem que permitir o embed
    // (same-origin bloqueava — ERR_BLOCKED_BY_RESPONSE medido ao vivo). A
    // fronteira de leitura é o cookie particionado + ausência de ACAO.
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('origin-agent-cluster')).toBe('?1');
    expect(body).toContain(`/api/rt/${SESSION_ID}/`);
    expect(body).toContain('data-uncraft-runtime-bridge');
    expect(res.headers.get('cache-control')).toBe('no-store'); // HTML entry never cached
  });

  it('frame-ancestors names the APP origin from the Host header, not next-dev\'s localhost request.url (lição 167)', async () => {
    // Em dev `request.url` reporta sempre localhost → sem ler o Host, o runtime
    // "parecia" ser o app e o CSP caía em 'self', bloqueando o embed do app.
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3031';
    try {
      store.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
      const res = await GET(new Request(`http://localhost:3031/api/rt/${SESSION_ID}/media/a.webp`, {
        headers: { host: `${HOST}:3444`, 'x-forwarded-proto': 'https', cookie: '__Host-rt=COOKIEVAL' },
      }), ctx(['media', 'a.webp']));
      expect(res.headers.get('content-security-policy')).toContain('frame-ancestors http://localhost:3031');
      expect(res.headers.get('content-security-policy')).not.toContain("frame-ancestors 'self'");
    } finally {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  });

  it('a binary asset carries the immutable lease cache-control and an ETag', async () => {
    store.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const res = await GET(req('media/a.webp'), ctx(['media', 'a.webp']));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/^private, max-age=\d+, immutable$/);
    expect(res.headers.get('etag')).toBeTruthy();
  });

  it('refusal matrix is inert and identical (no cookie / invalid / expired / revoked / host / session mismatch)', async () => {
    for (const arm of [
      { cookie: null },
      { lease: { error: 'invalid' } },
      { lease: { error: 'expired' } },
      { lease: { error: 'revoked' } },
      { lease: { error: 'host_mismatch' } },
    ]) {
      __clearLeaseGatewayCacheForTests();
      if (arm.lease) verifyLease.mockResolvedValue(arm.lease);
      else verifyLease.mockResolvedValue(leaseOk());
      sqlMock._results = [[bundleRow()]];
      const res = await GET(req('index.html', { cookie: arm.cookie === null ? '' : '__Host-rt=X' }), ctx());
      const body = await res.text();
      expect(res.status).toBe(404);
      expect(body).toBe('<!doctype html><meta charset="utf-8"><title>Unavailable</title><p>This website couldn\'t be opened.</p>');
    }
  });

  it('a revoked lease refuses the NEXT asset, and the entry HTML never came from cache', async () => {
    verifyLease.mockResolvedValue({ error: 'revoked' });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('a query string 301-redirects to the canonical path (collapses cache-buster variants, no loop)', async () => {
    const res = await GET(req('media/a.webp', { search: '?v=12345' }), ctx(['media', 'a.webp']));
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`/api/rt/${SESSION_ID}/media/a.webp`);
    expect(res.headers.get('cache-control')).toMatch(/private/);
    expect(res.headers.get('location')).not.toContain('?');
  });

  it('POST is refused — uploads do not live on the lease gateway', async () => {
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('flag off -> inert 404 without touching the lease', async () => {
    delete process.env.UNCRAFT_RUNTIME_LEASE;
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(verifyLease).not.toHaveBeenCalled();
  });

  it('Service-Worker: script is refused with 403 (enforcement reaches the lease path too)', async () => {
    store.read.mockResolvedValue(new TextEncoder().encode('// sw'));
    const res = await GET(req('media/a.webp', { headers: { 'service-worker': 'script' } }), ctx(['media', 'a.webp']));
    expect(res.status).toBe(403);
  });

  it('a request WITHOUT a cookie never seeds a rate-limit bucket (P1 DoS guard)', async () => {
    for (let i = 0; i < 50; i += 1) {
      await GET(req('index.html', { cookie: '' }), ctx(['index.html'], `forged-${i}`));
    }
    expect(__leaseRateLimitSizeForTests()).toBe(0);
  });

  it('the rate-limit map is bounded — distinct cookies cannot grow it without limit (P1 DoS guard)', async () => {
    __setLeaseRateLimitForTests({ max: 600, windowMs: 60_000, maxKeys: 8 });
    store.read.mockResolvedValue(new TextEncoder().encode('<html></html>'));
    for (let i = 0; i < 100; i += 1) {
      __clearLeaseGatewayCacheForTests();
      verifyLease.mockResolvedValue(leaseOk());
      sqlMock._results = [[bundleRow()]];
      await GET(req('index.html', { cookie: `__Host-rt=distinct-${i}` }), ctx());
    }
    expect(__leaseRateLimitSizeForTests()).toBeLessThanOrEqual(8);
  });

  it('exceeding the per-cookie request cap returns 429 no-store', async () => {
    __setLeaseRateLimitForTests({ max: 3, windowMs: 60_000, maxKeys: 64 });
    store.read.mockResolvedValue(new TextEncoder().encode('<html></html>'));
    let last;
    for (let i = 0; i < 5; i += 1) {
      __clearLeaseGatewayCacheForTests();
      verifyLease.mockResolvedValue(leaseOk());
      sqlMock._results = [[bundleRow()]];
      last = await GET(req('index.html'), ctx());
    }
    expect(last.status).toBe(429);
    expect(last.headers.get('cache-control')).toBe('no-store');
  });

  it('a cache hit still refuses a URL sessionId that does not match the cached lease (P2a re-validation)', async () => {
    store.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
    // First request seeds the cache for this cookie under the real session.
    await GET(req('media/a.webp'), ctx(['media', 'a.webp']));
    // Same cookie, but the URL now claims a different session → inert, not served.
    const res = await GET(
      new Request(`https://${HOST}/api/rt/99999999-9999-4999-8999-999999999999/media/a.webp`, { headers: { host: HOST, cookie: '__Host-rt=COOKIEVAL' } }),
      ctx(['media', 'a.webp'], '99999999-9999-4999-8999-999999999999'),
    );
    expect(res.status).toBe(404);
  });
});

describe('dev shape: request.url is localhost, the Host header is the session host (lição 167)', () => {
  it('serves the asset — the lease host check reads the HEADER, not request.url', async () => {
    process.env.UNCRAFT_RUNTIME_LEASE = '1';
    process.env.UNCRAFT_RUNTIME_SESSION_SECRET = SECRET;
    __clearLeaseGatewayCacheForTests();
    verifyLease.mockResolvedValue(leaseOk());
    sqlMock._results = [[bundleRow()]];
    store.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const res = await GET(new Request(`http://localhost:3031/api/rt/${SESSION_ID}/media/a.webp`, {
      headers: { host: `${HOST}:3444`, 'x-forwarded-proto': 'https', cookie: '__Host-rt=COOKIEVAL' },
    }), ctx(['media', 'a.webp']));
    expect(res.status).toBe(200);
    // and verifyLease was asked about the HEADER host, not 'localhost'
    expect(verifyLease.mock.calls.at(-1)[0].hostname).toBe(HOST);
  });
});
