import { describe, it, expect, vi } from 'vitest';
import { createMemoryBundleStore } from './native-clone/bundle-store.js';

vi.mock('./reconstruct.js', () => ({
  reconstructPage: vi.fn(async () => ({ html: '<html>clone</html>', screenshotDataUrl: 'data:image/png;base64,X' })),
}));
// O produtor NATIVO abre um navegador de verdade. Estes testes são sobre o
// tratamento de snapshot, não sobre qual produtor roda — sem este mock eles
// passariam a depender da rede e do Chromium, e foi o que quebrou quando o
// padrão do Edit deixou de ser o iter9.
vi.mock('./native-clone/capture-bundle.js', () => ({
  captureNativeBundle: vi.fn(async () => ({ html: '<html>clone</html>', screenshotDataUrl: 'data:image/png;base64,X' })),
}));
vi.mock('./billing/context.js', () => ({
  runBilledOperation: vi.fn(async (_opts, fn) => ({ result: await fn(), credits: 3, balanceAfter: 100 })),
  recordUsage: vi.fn(),
}));

const {
  materializeReconstructionOutput,
  normalizeReconstructionOutput,
  reconstructSiteNode,
} = await import('./deferred-reconstruction.js');

// The helper RE-READS the current snapshot itself (never trusts the caller's
// node fields — Codex #2), so the mock drives the guard via that SELECT.
function makeSql({ currentId = null, currentSource = null } = {}) {
  const calls = [];
  const sql = (strings, ...values) => {
    const query = strings.join('?');
    calls.push({ query, values });
    if (/SELECT\s+n\.current_snapshot_id/i.test(query)) return Promise.resolve([{ id: currentId, source: currentSource }]);
    if (/SELECT meta FROM nodes/i.test(query)) return Promise.resolve([{ meta: { cloneTelemetry: { totalMs: 203_000, engine: 'native', idemKey: 'k-dedup' } } }]);
    if (/UPDATE snapshots/i.test(query)) return Promise.resolve([{ id: currentId }]);
    if (/INSERT INTO snapshots/i.test(query)) return Promise.resolve([{ id: 'snap-new' }]);
    return Promise.resolve([]);
  };
  sql._calls = calls;
  return sql;
}

describe('chooseReconstructionProducer — qual clone o produto faz', () => {
  // Compara por IDENTIDADE e não por nome: os dois módulos estão mockados neste
  // arquivo, então `.name` é 'Mock' para ambos e a asserção por nome não
  // distinguiria nada.
  it('Edit usa o produtor NATIVO, que preserva o site com os scripts vivos', async () => {
    const { chooseReconstructionProducer } = await import('./deferred-reconstruction.js');
    const { captureNativeBundle } = await import('./native-clone/capture-bundle.js');
    expect(chooseReconstructionProducer('edit')).toBe(captureNativeBundle);
  });

  // ⚠️ DOUTRINA NOVA (ordem do Adilson, 2026-08-15): "clone" e' UM — o animado.
  // Este teste prendia o desenho antigo ("tudo exceto edit fica no iter9");
  // agora razao desconhecida ou ausente cai no NATIVO, e o iter9 entra por
  // nome ou pela excecao textual (teste seguinte). Mudar isto de novo e' mudar
  // uma ordem de produto.
  it('razao desconhecida cai no clone — o animado — e o iter9 so por nome', async () => {
    const { chooseReconstructionProducer } = await import('./deferred-reconstruction.js');
    const { reconstructPage } = await import('./reconstruct.js');
    const { captureNativeBundle } = await import('./native-clone/capture-bundle.js');
    for (const reason of ['workflow', 'strict-dependency', undefined]) {
      expect(chooseReconstructionProducer(reason)).toBe(captureNativeBundle);
    }
    expect(chooseReconstructionProducer('edit', process.env, 'iter9')).toBe(reconstructPage);
    // e o interruptor de emergencia continua mandando em tudo
    expect(chooseReconstructionProducer('edit', { UNCRAFT_NATIVE_CLONE_PRODUCER: 'off' })).toBe(reconstructPage);
  });

  it('o limite de "edit" e deliberado: /run continua no iter9 porque compoe por TEXTO', async () => {
    const { chooseReconstructionProducer } = await import('./deferred-reconstruction.js');
    const { reconstructPage } = await import('./reconstruct.js');
    // Razões REAIS da rota /run (reconstruction-policy.js), não inventadas — foi
    // o que meu primeiro teste errou e o Sol pegou. Elas alimentam runCompose
    // com `reconstructed.html`; um bundle nativo é diretório e nao tem html.
    for (const reason of ['transform-target', 'runtime-source']) {
      expect(chooseReconstructionProducer(reason)).toBe(reconstructPage);
    }
  });

  it('tem interruptor de desligamento sem reverter código', async () => {
    const { chooseReconstructionProducer } = await import('./deferred-reconstruction.js');
    const { reconstructPage } = await import('./reconstruct.js');
    expect(chooseReconstructionProducer('edit', { UNCRAFT_NATIVE_CLONE_PRODUCER: 'off' })).toBe(reconstructPage);
    expect(chooseReconstructionProducer('edit', { UNCRAFT_NATIVE_CLONE_PRODUCER: 'OFF' })).toBe(reconstructPage);
  });
});

describe('reconstructSiteNode — quem e chamado no Edit', () => {
  it('chama o produtor NATIVO, nao o iter9, quando ninguem injeta produtor', async () => {
    const { captureNativeBundle } = await import('./native-clone/capture-bundle.js');
    const { reconstructPage } = await import('./reconstruct.js');
    captureNativeBundle.mockClear();
    reconstructPage.mockClear();

    const sql = makeSql({ currentId: 'snap-current', currentSource: 'capture' });
    await reconstructSiteNode({
      sql, userId: 42,
      node: { id: 'node-edit', board_id: 'b1', origin_url: 'https://x.com' },
      reason: 'edit', idemKey: 'k-edit',
    });

    // A rota /reconstruct chama exatamente assim: sem `producer`.
    expect(captureNativeBundle).toHaveBeenCalledWith('https://x.com');
    expect(reconstructPage).not.toHaveBeenCalled();
  });
});

describe('reconstructSiteNode — snapshot handling (item 3: no pre-clone history version)', () => {
  it('overwrites the plain capture IN PLACE so the clone becomes the default state, leaving no history version', async () => {
    const sql = makeSql({ currentId: 'snap-current', currentSource: 'capture' });
    // Caller node deliberately omits current_snapshot_id/source — the helper
    // must re-read them (mirrors the run route, Codex #2).
    const node = { id: 'node-1', board_id: 'b1', origin_url: 'https://x.com' };
    const out = await reconstructSiteNode({ sql, userId: 42, node, reason: 'edit', idemKey: 'k1' });

    const queries = sql._calls.map((c) => c.query);
    // A NEW snapshot row would be a spurious history version of the pre-clone state.
    expect(queries.some((q) => /INSERT INTO snapshots/i.test(q))).toBe(false);
    // The capture snapshot is upgraded in place, scoped to this node, design_md cleared.
    const upd = sql._calls.find((c) => /UPDATE snapshots/i.test(c.query));
    expect(upd).toBeTruthy();
    expect(upd.values).toContain('snap-current');
    expect(upd.values).toContain('node-1');
    expect(upd.query).toMatch(/design_md = NULL/);
    expect(out.snapshotId).toBe('snap-current');
    expect(out.html).toBe('<html>clone</html>');
  });

  it('PRESERVES a non-capture current snapshot (curated manual/handoff/replace/agent-edit/run) by INSERTing instead of overwriting — no silent data loss (F1/Codex #1)', async () => {
    for (const source of ['manual', 'handoff', 'replace-upload', 'agent-edit', 'compose']) {
      const sql = makeSql({ currentId: 'snap-user', currentSource: source });
      const node = { id: 'node-x', board_id: 'b1', origin_url: 'https://x.com' };
      const out = await reconstructSiteNode({ sql, userId: 42, node, reason: 'edit', idemKey: `k-${source}` });
      const queries = sql._calls.map((c) => c.query);
      // The user's snapshot is NEVER overwritten.
      expect(queries.some((q) => /UPDATE snapshots/i.test(q))).toBe(false);
      // A new snapshot is inserted, preserving the prior one as history — with it as parent.
      const ins = sql._calls.find((c) => /INSERT INTO snapshots/i.test(c.query));
      expect(ins).toBeTruthy();
      expect(ins.values).toContain('snap-user');
      expect(out.snapshotId).toBe('snap-new');
    }
  });

  it('falls back to INSERT when the node has no current snapshot', async () => {
    const sql = makeSql({ currentId: null, currentSource: null });
    const node = { id: 'node-2', board_id: 'b1', origin_url: 'https://x.com' };
    const out = await reconstructSiteNode({ sql, userId: 42, node, reason: 'edit', idemKey: 'k2' });

    const queries = sql._calls.map((c) => c.query);
    expect(queries.some((q) => /INSERT INTO snapshots/i.test(q))).toBe(true);
    expect(out.snapshotId).toBe('snap-new');
  });
});

describe('deferred reconstruction result kinds', () => {
  const runtimeHash = `sha256:${'a'.repeat(64)}`;

  it('keeps the existing untagged HTML result on the Iter9 path', async () => {
    const current = { html: '<html>iter9</html>', screenshotDataUrl: null };
    expect(normalizeReconstructionOutput(current)).toEqual({ kind: 'iter9', output: current });
    expect(await materializeReconstructionOutput(current)).toEqual({ kind: 'iter9', output: current });
  });

  it('registers an explicit native producer result through the bundle boundary', async () => {
    const store = createMemoryBundleStore();
    const materialized = await materializeReconstructionOutput({
      kind: 'native',
      bundle: {
        entryPath: 'index.html',
        runtimeFingerprint: runtimeHash,
        assets: [{ path: 'index.html', contentType: 'text/html', body: '<html>native</html>' }],
        reconstructionCapabilities: { detectedEngines: ['gsap'], candidateControls: [] },
      },
    }, { bundleStore: store });

    expect(materialized.kind).toBe('native');
    expect(materialized.bundleDescriptor.entryPath).toBe('index.html');
    expect(await store.listIndexedAssets(materialized.bundleDescriptor)).toHaveLength(1);
  });

  it('does not promote animation detection or malformed native output', async () => {
    expect(() => normalizeReconstructionOutput({ animatedDetected: true })).toThrow(/output/i);
    expect(() => normalizeReconstructionOutput({ kind: 'native', animatedDetected: true })).toThrow(/bundle/i);
    await expect(materializeReconstructionOutput({ kind: 'native', bundle: {} }, {
      bundleStore: createMemoryBundleStore(),
    })).rejects.toThrow();
  });

  it('clones without generated controls when no validator is configured — config absence is not a failure', async () => {
    // Production reality: captureNativeBundle emits no controlValidationTransport
    // and UNCRAFT_MOTION_CONTROL_VALIDATOR_URL is unset in deployments where the
    // sandbox validator service does not exist. The clone (native bundle + live
    // editor) is the deliverable; generated controls are an overlay that only
    // becomes part of the contract when a validator is CONFIGURED. Configured-
    // but-failing keeps hard-fail + refund (covered by the tests below).
    delete process.env.UNCRAFT_MOTION_CONTROL_VALIDATOR_URL;
    const store = createMemoryBundleStore();
    const sql = makeSql({ currentId: 'snap-native', currentSource: 'capture' });
    const generated = vi.fn();
    const producer = vi.fn(async () => ({
      kind: 'native',
      bundle: {
        entryPath: 'index.html',
        runtimeFingerprint: runtimeHash,
        assets: [{ path: 'index.html', contentType: 'text/html', body: '<html>native</html>' }],
        reconstructionCapabilities: { detectedEngines: ['gsap'], candidateControls: [] },
      },
      // no controlValidationTransport / validateControlCandidate — mirrors production
    }));

    const result = await reconstructSiteNode({
      sql,
      userId: 42,
      node: { id: 'node-native', board_id: 'board-1', origin_url: 'https://example.com' },
      reason: 'edit',
      idemKey: 'clone-native-skip-1',
      producer,
      bundleStore: store,
      persistBundle: vi.fn(async ({ descriptor }) => descriptor),
      generateControls: generated,
    });

    expect(generated).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, kind: 'native', snapshotId: 'snap-native' });
    expect(result.meta.motionControls).toMatchObject({ status: 'skipped', reason: 'validator_not_configured', acceptedControls: 0 });
    expect(result.motionManifest.controlManifest).toEqual({});
    const snapshotWrite = sql._calls.find((call) => /UPDATE snapshots/i.test(call.query));
    expect(snapshotWrite.values).toContain(JSON.stringify(result.motionManifest));
  });

  it('typeSample rides the output into meta WITHOUT touching the bundle identity — no price to pay', async () => {
    // The no-price guarantee, proven: the same bundle with and without the
    // sibling typeSample field registers with IDENTICAL descriptor identity
    // (contentHash/bundleId derive from bundle content only), and the sample
    // lands in node meta.
    const bundle = {
      entryPath: 'index.html',
      runtimeFingerprint: runtimeHash,
      assets: [{ path: 'index.html', contentType: 'text/html', body: '<html>native</html>' }],
      reconstructionCapabilities: { detectedEngines: ['gsap'], candidateControls: [] },
    };
    const typeSample = { display: { family: 'Antique Olive', size: 64, weight: 500 }, body: { family: 'Antique Olive', size: 16, weight: 400 } };
    const [plain, sampled] = await Promise.all([
      materializeReconstructionOutput({ kind: 'native', bundle }, { bundleStore: createMemoryBundleStore() }),
      materializeReconstructionOutput({ kind: 'native', bundle, typeSample }, { bundleStore: createMemoryBundleStore() }),
    ]);
    expect(sampled.bundleDescriptor.bundleId).toBe(plain.bundleDescriptor.bundleId);
    expect(sampled.bundleDescriptor.contentHash).toBe(plain.bundleDescriptor.contentHash);

    delete process.env.UNCRAFT_MOTION_CONTROL_VALIDATOR_URL;
    const store = createMemoryBundleStore();
    const sql = makeSql({ currentId: 'snap-native', currentSource: 'capture' });
    const result = await reconstructSiteNode({
      sql,
      userId: 42,
      node: { id: 'node-native', board_id: 'board-1', origin_url: 'https://example.com' },
      reason: 'edit',
      idemKey: 'clone-native-type-1',
      producer: vi.fn(async () => ({ kind: 'native', bundle, typeSample })),
      bundleStore: store,
      persistBundle: vi.fn(async ({ descriptor }) => descriptor),
      generateControls: vi.fn(),
    });
    expect(result.meta.typeSample).toEqual(typeSample);
  });

  it('persists a SANITIZED capture report in meta — counts and hosts, never full URLs (defect 1b, 2026-08-20)', async () => {
    // The producer's relatorio was assembled and then DISCARDED by this layer;
    // missing assets vanished without a trace. It now lands in meta as counts
    // plus discarded HOSTS only — a full URL can carry query strings/tokens
    // (Sol advise 2026-08-20).
    const bundle = {
      entryPath: 'index.html',
      runtimeFingerprint: runtimeHash,
      assets: [{ path: 'index.html', contentType: 'text/html', body: '<html>native</html>' }],
      reconstructionCapabilities: { detectedEngines: ['gsap'], candidateControls: [] },
    };
    const relatorio = {
      arquivos: 1,
      bytes: 19,
      entryPath: 'index.html',
      engines: { gsap: true },
      refsExtras: 7,
      descartados: [
        { u: 'https://cdn.test/a.png?token=SECRET', motivo: 'grande demais' },
        { u: 'https://cdn.test/b.png', motivo: 'limite de arquivos' },
        { u: 'https://other.test/c.png', motivo: 'host nao publico' },
      ],
      totalDescartados: 3,
    };
    delete process.env.UNCRAFT_MOTION_CONTROL_VALIDATOR_URL;
    const store = createMemoryBundleStore();
    const sql = makeSql({ currentId: 'snap-native', currentSource: 'capture' });
    const result = await reconstructSiteNode({
      sql,
      userId: 42,
      node: { id: 'node-native', board_id: 'board-1', origin_url: 'https://example.com' },
      reason: 'edit',
      idemKey: 'clone-native-report-1',
      producer: vi.fn(async () => ({ kind: 'native', bundle, relatorio })),
      bundleStore: store,
      persistBundle: vi.fn(async ({ descriptor }) => descriptor),
      generateControls: vi.fn(),
    });
    expect(result.meta.captureReport).toEqual({
      files: 1,
      bytes: 19,
      extraRefs: 7,
      discarded: 3,
      discardedHosts: ['cdn.test', 'other.test'],
    });
    expect(JSON.stringify(result.meta.captureReport)).not.toContain('SECRET');
  });

  it('hard-fails when a CONFIGURED validator yields no generation result — never mislabeled as unconfigured', async () => {
    // Sol review 2026-08-17 (v2 round): with the config gate keyed on generated's
    // truthiness, a configured-but-broken generator resolving null would settle
    // as "validator_not_configured" — a degraded paid state concealing a
    // generator regression. Configured ⇒ a valid result is REQUIRED.
    const store = createMemoryBundleStore();
    const sql = makeSql({ currentId: 'snap-native', currentSource: 'capture' });
    const generated = vi.fn(async () => null);
    const producer = vi.fn(async () => ({
      kind: 'native',
      bundle: {
        entryPath: 'index.html',
        runtimeFingerprint: runtimeHash,
        assets: [{ path: 'index.html', contentType: 'text/html', body: '<html>native</html>' }],
        reconstructionCapabilities: { detectedEngines: ['gsap'], candidateControls: [] },
      },
      controlValidationTransport: vi.fn(),
    }));

    await expect(reconstructSiteNode({
      sql,
      userId: 42,
      node: { id: 'node-native', board_id: 'board-1', origin_url: 'https://example.com' },
      reason: 'edit',
      idemKey: 'clone-native-null-gen',
      producer,
      bundleStore: store,
      persistBundle: vi.fn(async ({ descriptor }) => descriptor),
      generateControls: generated,
    })).rejects.toMatchObject({ code: 'no_output' });

    expect(generated).toHaveBeenCalledTimes(1);
    const snapshotWrite = sql._calls.find((call) => /UPDATE snapshots/i.test(call.query));
    expect(snapshotWrite).toBeUndefined();
  });

  it('automatically validates controls and persists the native snapshot before billing can settle', async () => {
    const store = createMemoryBundleStore();
    const sql = makeSql({ currentId: 'snap-native', currentSource: 'capture' });
    const generated = vi.fn(async ({ descriptor }) => ({
      manifest: {
        schemaVersion: 1,
        bundleId: descriptor.bundleId,
        runtimeFingerprint: descriptor.runtimeFingerprint,
        controls: [],
      },
      provider: { provider: 'openai', model: 'gpt-5.6-terra', repaired: false, costUsd: 0.01, usage: [] },
      diagnostics: [],
    }));
    const producer = vi.fn(async () => ({
      kind: 'native',
      bundle: {
        entryPath: 'index.html',
        runtimeFingerprint: runtimeHash,
        assets: [{ path: 'index.html', contentType: 'text/html', body: '<html>native</html>' }],
        reconstructionCapabilities: { detectedEngines: ['gsap'], candidateControls: [] },
      },
      controlValidationTransport: vi.fn(),
    }));

    const result = await reconstructSiteNode({
      sql,
      userId: 42,
      node: { id: 'node-native', board_id: 'board-1', origin_url: 'https://example.com' },
      reason: 'edit',
      idemKey: 'clone-native-1',
      producer,
      bundleStore: store,
      persistBundle: vi.fn(async ({ descriptor }) => descriptor),
      generateControls: generated,
    });

    expect(generated).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: 'native', snapshotId: 'snap-native', credits: 3 });
    expect(result.motionManifest.controlManifest).toEqual(result.controlManifest);
    const snapshotWrite = sql._calls.find((call) => /UPDATE snapshots/i.test(call.query));
    expect(snapshotWrite.query).toMatch(/native_bundle_id[\s\S]+motion_manifest[\s\S]+motion_manifest_version/i);
    expect(snapshotWrite.values).toContain(JSON.stringify(result.motionManifest));
  });

  it('does not return a partially valid native result when persistence fails after generation', async () => {
    const store = createMemoryBundleStore();
    const baseSql = makeSql({ currentId: 'snap-native', currentSource: 'capture' });
    const sql = (strings, ...values) => {
      const query = strings.join('?');
      if (/UPDATE snapshots/i.test(query)) throw new Error('persistence unavailable');
      return baseSql(strings, ...values);
    };
    const generateControls = vi.fn(async ({ descriptor }) => ({
      manifest: { schemaVersion: 1, bundleId: descriptor.bundleId, runtimeFingerprint: descriptor.runtimeFingerprint, controls: [] },
      provider: { provider: 'openai', model: 'gpt-5.6-terra', repaired: false, costUsd: 0.01, usage: [] },
      diagnostics: [],
    }));

    await expect(reconstructSiteNode({
      sql,
      userId: 42,
      node: { id: 'node-native', board_id: 'board-1', origin_url: 'https://example.com' },
      reason: 'edit',
      idemKey: 'clone-native-fail',
      producer: vi.fn(async () => ({
        kind: 'native',
        bundle: {
          entryPath: 'index.html', runtimeFingerprint: runtimeHash,
          assets: [{ path: 'index.html', contentType: 'text/html', body: '<html>native</html>' }],
          reconstructionCapabilities: { detectedEngines: [], candidateControls: [] },
        },
        // validator configured — this test is about persistence failing AFTER
        // generation ran, so generation must actually run under the config gate
        controlValidationTransport: vi.fn(),
      })),
      bundleStore: store,
      persistBundle: vi.fn(async ({ descriptor }) => descriptor),
      generateControls,
    })).rejects.toThrow('persistence unavailable');
    expect(generateControls).toHaveBeenCalledTimes(1);
  });
});

describe('conversion deadline per lane (conversion_timeout fix 2026-08-18)', () => {
  it('gives the iter9 vision producer its measured ceiling and keeps native tight', async () => {
    const { conversionDeadlineMs } = await import('./deferred-reconstruction.js');
    const { captureNativeBundle } = await import('./native-clone/capture-bundle.js');
    const { reconstructPage } = await import('./reconstruct.js');
    // iter9 measures ~150s ±40% — 90s timed out most nominal runs. The wide
    // ceiling is scoped to the single-item 'edit' lane; /run lanes chain
    // several reconstructions under one 300s route and keep 90s each (Sol).
    expect(conversionDeadlineMs(reconstructPage, 'edit')).toBe(240_000);
    expect(conversionDeadlineMs(captureNativeBundle, 'edit')).toBe(90_000);
    expect(conversionDeadlineMs(reconstructPage, 'transform-target')).toBe(90_000);
    expect(conversionDeadlineMs(reconstructPage, 'runtime-source')).toBe(90_000);
    // Route ceiling must stay above the biggest lane (maxDuration 300s).
    expect(conversionDeadlineMs(reconstructPage, 'edit')).toBeLessThan(300_000);
  });
});

// ── Telemetria de clone: achados do Sol ─────────────────────────────────────

describe('reconstructSiteNode — telemetria (auditoria do Sol)', () => {
  // #2: `deduped` e' IRMAO de `result` no retorno de runBilledOperation, nao
  // propriedade dele. Ler `result.deduped` da' sempre undefined, entao o replay
  // — que nao clonou nada — regravaria um relatorio de milissegundos POR CIMA
  // da medicao do clone lento que de fato aconteceu.
  it('nao regrava telemetria no replay idempotente', async () => {
    const billing = await import('./billing/context.js');
    billing.runBilledOperation.mockImplementationOnce(async () => ({
      result: { snapshotId: 'snap-antigo', html: '<html>guardado</html>' },
      credits: 3, balanceAfter: 100, deduped: true,
    }));
    const sql = makeSql({ currentId: 'snap-current', currentSource: 'capture' });
    const out = await reconstructSiteNode({
      sql, userId: 42, node: { id: 'node-d', board_id: 'b1', origin_url: 'https://x.com' },
      reason: 'edit', idemKey: 'k-dedup',
    });
    const gravou = sql._calls.some((c) => /UPDATE nodes/i.test(c.query) && /cloneTelemetry/.test(JSON.stringify(c.values)));
    expect(gravou).toBe(false);
    // ...e devolve a medicao GUARDADA pelo clone original, nao null: e' ela que
    // conta por que o pedido demorou (Sol, segunda metade do achado #2).
    expect(out.cloneTelemetry).toEqual({ totalMs: 203_000, engine: 'native', idemKey: 'k-dedup' });
  });

  // #3: `captura` embrulhava produtor + gravacao dos assets do bundle. Um
  // produtor de 24s com 100 uploads de 100s aparecia como "captura: 124s" e
  // fazia o MOTOR parecer o lento — apagando justamente a separacao que este
  // instrumento existe para mostrar.
  it('separa o motor da gravacao do bundle', async () => {
    const sql = makeSql({ currentId: 'snap-current', currentSource: 'capture' });
    const out = await reconstructSiteNode({
      sql, userId: 42, node: { id: 'node-e', board_id: 'b1', origin_url: 'https://x.com' },
      reason: 'edit', idemKey: 'k-etapas',
    });
    const etapas = Object.keys(out.cloneTelemetry?.stages || {});
    expect(etapas).toContain('motor');
    expect(etapas).toContain('bundle');
    expect(etapas).not.toContain('captura');
  });
});
