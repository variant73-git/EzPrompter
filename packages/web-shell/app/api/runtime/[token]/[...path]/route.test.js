import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyRuntimeSessionToken = vi.fn();
const runtimeRequestUsesConfiguredOrigin = vi.fn();
vi.mock('../../../../../lib/motion-editor/runtime-session-token.js', async (original) => ({
  verifyRuntimeSessionToken,
  runtimeRequestUsesConfiguredOrigin,
  // O vocabulario de erros do token e' REAL, nao dublado: o gateway deriva os
  // motivos dele, e dublar aqui faria a guarda comparar copia com copia.
  TOKEN_VERIFICATION_ERRORS: (await original()).TOKEN_VERIFICATION_ERRORS,
}));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock.mockImplementation(() => Promise.resolve(sqlMock._results.shift() || []));
vi.mock('../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const store = { read: vi.fn() };
const createConfiguredBundleStore = vi.fn(() => store);
vi.mock('../../../../../lib/native-clone/bundle-store.js', () => ({
  createConfiguredBundleStore,
  indexedAssetKey: (root, path) => `${root}/assets/${path}`,
}));

const { GET } = await import('./route.js');

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const BUNDLE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const FINGERPRINT = `sha256:${'a'.repeat(64)}`;
const HTML_HASH = `sha256:${'b'.repeat(64)}`;
const JS_HASH = `sha256:${'c'.repeat(64)}`;

const manifest = {
  schemaVersion: 2,
  baseBundleId: BUNDLE_ID,
  transactions: [],
  controlManifest: {},
  responsiveManifest: {},
  runtimeFingerprint: FINGERPRINT,
};

function runtimeRow(overrides = {}) {
  const bundleId = overrides.bundle_id || BUNDLE_ID;
  return {
    session_id: SESSION_ID,
    node_id: NODE_ID,
    session_status: 'active',
    draft_manifest: { ...manifest, baseBundleId: bundleId },
    bundle_id: bundleId,
    schema_version: 1,
    storage_key: `native-bundles/v1/${bundleId}`,
    content_hash: `sha256:${'d'.repeat(64)}`,
    entry_path: 'index.html',
    asset_index: [
      { path: 'index.html', contentType: 'text/html; charset=utf-8', byteLength: 1, contentHash: HTML_HASH },
      { path: 'assets/app.js', contentType: 'text/javascript; charset=utf-8', byteLength: 1, contentHash: JS_HASH },
      { path: 'assets/app.css', contentType: 'text/css; charset=utf-8', byteLength: 1, contentHash: JS_HASH },
      { path: 'vendor/chunk.js', contentType: 'text/javascript; charset=utf-8', byteLength: 1, contentHash: JS_HASH },
      { path: 'media/a.webp', contentType: 'image/webp', byteLength: 1, contentHash: JS_HASH },
      { path: 'media/b.webp', contentType: 'image/webp', byteLength: 1, contentHash: JS_HASH },
      { path: 'media/v.mp4', contentType: 'video/mp4', byteLength: 20, contentHash: JS_HASH },
    ],
    runtime_fingerprint: FINGERPRINT,
    reconstruction_capabilities: { detectedEngines: ['waapi'], candidateControls: [] },
    ...overrides,
  };
}

function request(path = 'index.html', headers) {
  return new Request(`http://runtime.test/api/runtime/signed-token/${path}`, { headers });
}

function context(path = ['index.html'], token = 'signed-token') {
  return { params: Promise.resolve({ token, path }) };
}

beforeEach(() => {
  verifyRuntimeSessionToken.mockReset();
  verifyRuntimeSessionToken.mockReturnValue({
    payload: {
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      entryPrefix: '',
      nonce: 'nonce-123',
      scope: 'bundle:read',
      expiresAtMs: Date.now() + 120_000,
    },
  });
  runtimeRequestUsesConfiguredOrigin.mockReset();
  runtimeRequestUsesConfiguredOrigin.mockReturnValue(true);
  sqlMock.mockClear();
  sqlMock._results = [];
  store.read.mockReset();
  createConfiguredBundleStore.mockClear();
});

describe('GET /api/runtime/[token]/[...path]', () => {
  it('serves signed HTML, rewrites all bundle-root references, and injects bridge/config once', async () => {
    sqlMock._results = [[runtimeRow()]];
    store.read.mockResolvedValue(new TextEncoder().encode([
      '<html><head><link href="/assets/app.css"></head><body>',
      '<script type="module" src="/assets/app.js"></script>',
      '<script type="module">import("/vendor/chunk.js")</script>',
      '<img srcset="/media/a.webp 1x, /media/b.webp 2x">',
      '</body></html>',
    ].join('')));

    const response = await GET(request(), context());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body.match(/\/api\/runtime\/signed-token\//g)).toHaveLength(5);
    expect(body.match(/data-uncraft-runtime-bridge/g)).toHaveLength(1);
    expect(body.match(/data-uncraft-runtime-config/g)).toHaveLength(1);
    expect(body).toContain(FINGERPRINT);
    expect(body).toContain('nonce-123');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("form-action 'none'");
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
    expect(response.headers.get('strict-transport-security')).toContain('includeSubDomains');
  });

  it('only serves sessions that have not expired server-side (defect 1, 2026-08-20)', async () => {
    // The runtime token now lives 4h; the session row is the revocation
    // authority, so the gateway query must also enforce expires_at.
    sqlMock._results = [[runtimeRow()]];
    store.read.mockResolvedValue(new TextEncoder().encode('<html></html>'));
    await GET(request(), context());
    const sqlText = sqlMock.mock.calls[0][0].join('?');
    expect(sqlText).toMatch(/expires_at\s*>\s*NOW\(\)/i);
  });

  it('returns declared binary bytes unchanged with immutable hash caching', async () => {
    const bytes = new TextEncoder().encode('binary-like-/assets/must-not-be-rewritten');
    sqlMock._results = [[runtimeRow()]];
    store.read.mockResolvedValue(bytes);

    const response = await GET(request('media/a.webp'), context(['media', 'a.webp']));
    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(bytes));
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('etag')).toContain(JS_HASH);
    expect(response.headers.get('content-type')).toContain('image/webp');
  });

  // ⚠️ Sem faixa de bytes o <video> ATE' toca (baixa tudo e reproduz do
  // comeco) mas nao PROCURA: `currentTime = 2` fica em zero — medido no clone
  // real. E o site clonado tem um <video class="scroll-video"> cuja animacao
  // inteira e' o quadro seguindo a rolagem, entao a coreografia some.
  it('serve faixa de bytes, que e o que faz video buscar quadro', async () => {
    const bytes = new TextEncoder().encode('0123456789abcdefghij');   // 20 bytes
    sqlMock._results = [[runtimeRow()]];
    store.read.mockResolvedValue(bytes);
    const r = await GET(request('media/v.mp4', { range: 'bytes=5-9' }), context(['media', 'v.mp4']));
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 5-9/20');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(new TextDecoder().decode(await r.arrayBuffer())).toBe('56789');
  });

  it('anuncia faixas mesmo sem pedido, e recusa a insatisfazivel com 416', async () => {
    const bytes = new TextEncoder().encode('0123456789');
    sqlMock._results = [[runtimeRow()]];
    store.read.mockResolvedValue(bytes);
    const inteiro = await GET(request('media/v.mp4'), context(['media', 'v.mp4']));
    // Sem `Accept-Ranges` o navegador nem TENTA procurar: anunciar e' parte
    // da correcao, nao enfeite.
    expect(inteiro.status).toBe(200);
    expect(inteiro.headers.get('accept-ranges')).toBe('bytes');

    sqlMock._results = [[runtimeRow()]];
    store.read.mockResolvedValue(bytes);
    const fora = await GET(request('media/v.mp4', { range: 'bytes=50-60' }), context(['media', 'v.mp4']));
    expect(fora.status).toBe(416);
    expect(fora.headers.get('content-range')).toBe('bytes */10');
  });

  // `If-Range` que nao casa com a etiqueta significa que a representacao mudou:
  // servir a faixa faria o cliente remontar bytes de versoes diferentes.
  it('ignora a faixa quando If-Range nao casa com a etiqueta', async () => {
    const bytes = new TextEncoder().encode('0123456789');
    sqlMock._results = [[runtimeRow()]];
    store.read.mockResolvedValue(bytes);
    const velho = await GET(request('media/v.mp4', { range: 'bytes=2-4', 'if-range': '"sha256:outro"' }), context(['media', 'v.mp4']));
    expect(velho.status).toBe(200);
    expect(new TextDecoder().decode(await velho.arrayBuffer())).toBe('0123456789');

    sqlMock._results = [[runtimeRow()]];
    store.read.mockResolvedValue(bytes);
    const certo = await GET(request('media/v.mp4', { range: 'bytes=2-4', 'if-range': `"${JS_HASH}"` }), context(['media', 'v.mp4']));
    expect(certo.status).toBe(206);
    expect(new TextDecoder().decode(await certo.arrayBuffer())).toBe('234');
  });

  it('rebases stylesheet and module dependencies without injecting the bridge into them', async () => {
    sqlMock._results = [[runtimeRow()]];
    store.read.mockResolvedValue(new TextEncoder().encode('@font-face{src:url(/assets/font.woff)}'));

    const response = await GET(request('assets/app.css'), context(['assets', 'app.css']));
    const body = await response.text();
    expect(body).toContain('/api/runtime/signed-token/assets/font.woff');
    expect(body).not.toContain('data-uncraft-runtime-bridge');
    expect(body).not.toContain('data-uncraft-runtime-config');
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  it.each([
    [['..', 'secret.txt']],
    [['%2e%2e', 'secret.txt']],
    [['assets', '..%252fsecret.txt']],
    [['assets', 'bad\0.js']],
    [['assets', '', 'app.js']],
    [['assets', 'undeclared.js']],
  ])('rejects confused, traversing, null, or undeclared path %j', async (path) => {
    sqlMock._results = [[runtimeRow()]];
    const response = await GET(request(path.join('/')), context(path));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain("This website couldn't be opened.");
    expect(store.read).not.toHaveBeenCalled();
  });

  it('returns the same inert response for expired, altered, cross-node, and cross-bundle tokens', async () => {
    verifyRuntimeSessionToken.mockReturnValueOnce({ error: 'expired' });
    let response = await GET(request(), context());
    expect(response.status).toBe(404);
    expect(sqlMock).not.toHaveBeenCalled();

    verifyRuntimeSessionToken.mockReturnValueOnce({ payload: {
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      entryPrefix: '',
      nonce: 'nonce-123',
      expiresAtMs: Date.now() + 120_000,
    } });
    sqlMock._results = [[]];
    response = await GET(request(), context());
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("This website couldn't be opened.");
  });

  it('ignores ambient Uncraft cookies and refuses the app origin in production', async () => {
    sqlMock._results = [[runtimeRow()]];
    store.read.mockResolvedValue(new TextEncoder().encode('<html><head></head><body>ok</body></html>'));
    const withCookie = await GET(request('index.html', { cookie: 'uncraft_sess=login-token' }), context());
    expect(withCookie.status).toBe(200);

    runtimeRequestUsesConfiguredOrigin.mockReturnValue(false);
    const wrongOrigin = await GET(request(), context());
    expect(wrongOrigin.status).toBe(404);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('keeps two bundle sessions isolated even when their asset paths match', async () => {
    const otherBundleId = '55555555-5555-4555-8555-555555555555';
    const otherSessionId = '66666666-6666-4666-8666-666666666666';
    sqlMock._results = [
      [runtimeRow()],
      [runtimeRow({ bundle_id: otherBundleId, session_id: otherSessionId })],
    ];
    store.read.mockResolvedValueOnce(new TextEncoder().encode('bundle-a'));
    store.read.mockResolvedValueOnce(new TextEncoder().encode('bundle-b'));

    const first = await GET(request('assets/app.js'), context(['assets', 'app.js']));
    verifyRuntimeSessionToken.mockReturnValue({ payload: {
      nodeId: NODE_ID,
      bundleId: otherBundleId,
      sessionId: otherSessionId,
      entryPrefix: '',
      nonce: 'nonce-456',
      expiresAtMs: Date.now() + 120_000,
    } });
    const second = await GET(
      new Request('http://runtime.test/api/runtime/other-token/assets/app.js'),
      context(['assets', 'app.js'], 'other-token'),
    );

    expect(await first.text()).toBe('bundle-a');
    expect(await second.text()).toBe('bundle-b');
    expect(store.read.mock.calls[0][0]).toContain(BUNDLE_ID);
    expect(store.read.mock.calls[1][0]).toContain(otherBundleId);
  });
});

describe('a falha deixa de ser muda', () => {
  // O caminho de SUCESSO permite que o editor emoldure a pagina; o de falha
  // dizia `frame-ancestors 'none'`, entao a unica tela onde alguem leria a
  // mensagem era justamente a que o navegador se recusava a desenhar. Quadro
  // branco, sem motivo, ate o batimento desistir. A pagina segue INERTE
  // (`default-src 'none'`) — so' deixa de ser invisivel.
  it('a pagina de erro pode ser desenhada dentro do app', async () => {
    verifyRuntimeSessionToken.mockReturnValueOnce({ error: 'expired' });
    const response = await GET(request(), context());
    const csp = response.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/frame-ancestors (?:'self'|https?:\/\/)/);
  });

  // O motivo e' vocabulario interno: em producao fica so' no log. Fora dela,
  // exige opt-in EXPLICITO — nao basta "nao e' producao", que pegaria staging
  // publico (Sol).
  it('o motivo so viaja com opt-in explicito, e nunca em producao', async () => {
    const anterior = process.env.UNCRAFT_RUNTIME_DEBUG_FAILURES;
    try {
      delete process.env.UNCRAFT_RUNTIME_DEBUG_FAILURES;
      verifyRuntimeSessionToken.mockReturnValueOnce({ error: 'expired' });
      let r = await GET(request(), context());
      expect(r.headers.get('x-uncraft-runtime-failure')).toBe(null);

      process.env.UNCRAFT_RUNTIME_DEBUG_FAILURES = '1';
      verifyRuntimeSessionToken.mockReturnValueOnce({ error: 'expired' });
      r = await GET(request(), context());
      expect(r.headers.get('x-uncraft-runtime-failure')).toBe('token_expired');
    } finally {
      if (anterior == null) delete process.env.UNCRAFT_RUNTIME_DEBUG_FAILURES;
      else process.env.UNCRAFT_RUNTIME_DEBUG_FAILURES = anterior;
    }
  });

  // Corpo e status identicos entre motivos: quem le a pagina nao aprende nada
  // sobre o gateway (Sol).
  it('o corpo nao carrega o motivo', async () => {
    process.env.UNCRAFT_RUNTIME_DEBUG_FAILURES = '1';
    verifyRuntimeSessionToken.mockReturnValueOnce({ error: 'expired' });
    const corpo = await (await GET(request(), context())).text();
    expect(corpo).not.toContain('token_expired');
    expect(corpo).toContain("This website couldn't be opened.");
    delete process.env.UNCRAFT_RUNTIME_DEBUG_FAILURES;
  });
});

// Guarda: um motivo novo no codigo nao pode ficar fora do vocabulario sem que
// alguem perceba — a omissao seria silenciosa, que e' o defeito que o motivo
// veio curar.
it('todo motivo escrito na rota esta no vocabulario fechado', async () => {
  const { readFileSync } = await import('node:fs');
  const { MOTIVOS_DE_FALHA } = await import('../../../../../lib/motion-editor/runtime-failure-reasons.js');
  const fonte = readFileSync('app/api/runtime/[token]/[...path]/route.js', 'utf8');
  const literais = [...fonte.matchAll(/inertFailure\(request,\s*'([a-z_]+)'/g)].map((m) => m[1]);
  expect(literais.length).toBeGreaterThan(4);
  for (const motivo of literais) expect(MOTIVOS_DE_FALHA.has(motivo)).toBe(true);
  // E o ramo derivado: `token_${erro}` cobre TODO erro que o verificador emite.
  const { TOKEN_VERIFICATION_ERRORS } = await import('../../../../../lib/motion-editor/runtime-session-token.js');
  for (const e of TOKEN_VERIFICATION_ERRORS) expect(MOTIVOS_DE_FALHA.has(`token_${e}`)).toBe(true);
});
