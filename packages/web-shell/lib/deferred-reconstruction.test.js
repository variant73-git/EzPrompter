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
      })),
      bundleStore: store,
      persistBundle: vi.fn(async ({ descriptor }) => descriptor),
      generateControls,
    })).rejects.toThrow('persistence unavailable');
    expect(generateControls).toHaveBeenCalledTimes(1);
  });
});

describe('reconstructSiteNode — telemetria por clone (pedido 2026-08-20)', () => {
  it('grava meta.cloneTelemetry após o settle: engine, stages, credits e retorna .telemetry', async () => {
    const sql = makeSql({ currentId: 'snap-current', currentSource: 'capture' });
    const node = { id: 'node-t1', board_id: 'b1', origin_url: 'https://x.com' };
    const out = await reconstructSiteNode({ sql, userId: 42, node, reason: 'edit', idemKey: 'k-t1' });

    const telUpd = sql._calls.find((c) => /UPDATE nodes SET meta/i.test(c.query) && JSON.stringify(c.values).includes('cloneTelemetry'));
    expect(telUpd).toBeTruthy();
    const payload = JSON.parse(telUpd.values.find((v) => typeof v === 'string' && v.includes('cloneTelemetry')));
    expect(payload.cloneTelemetry.engine).toBe('iter9'); // o mock devolve html → normaliza como iter9
    expect(payload.cloneTelemetry.url).toBe('https://x.com');
    expect(payload.cloneTelemetry.reason).toBe('edit');
    expect(payload.cloneTelemetry.credits).toBe(3); // do mock de billing
    expect(payload.cloneTelemetry.stages).toHaveProperty('capture');
    expect(payload.cloneTelemetry.stages).toHaveProperty('persist');
    expect(typeof payload.cloneTelemetry.totalMs).toBe('number');
    // e o chamador recebe o mesmo registro sem reler o banco
    expect(out.telemetry).toEqual(payload.cloneTelemetry);
  });

  it('replay de dedup NÃO grava telemetria (não é um clone novo)', async () => {
    const { runBilledOperation } = await import('./billing/context.js');
    runBilledOperation.mockImplementationOnce(async () => ({
      result: { ok: true, nodeId: 'node-t2', snapshotId: 's', html: '<html>x</html>', meta: {} },
      credits: 0, balanceAfter: 100, deduped: true, usageMicrocents: 0,
    }));
    const sql = makeSql({ currentId: 'snap-current', currentSource: 'capture' });
    const node = { id: 'node-t2', board_id: 'b1', origin_url: 'https://x.com' };
    const out = await reconstructSiteNode({ sql, userId: 42, node, reason: 'edit', idemKey: 'k-t2' });

    const telUpd = sql._calls.find((c) => JSON.stringify(c.values || []).includes('cloneTelemetry'));
    expect(telUpd).toBeUndefined();
    expect(out.telemetry).toBe(null);
  });

  it('usageMicrocents do billing vira costUsd no registro', async () => {
    const { runBilledOperation } = await import('./billing/context.js');
    runBilledOperation.mockImplementationOnce(async (_opts, fn) => ({
      result: await fn(), credits: 215, balanceAfter: 100, deduped: false, usageMicrocents: 530_000,
    }));
    const sql = makeSql({ currentId: 'snap-current', currentSource: 'capture' });
    const node = { id: 'node-t3', board_id: 'b1', origin_url: 'https://x.com' };
    const out = await reconstructSiteNode({ sql, userId: 42, node, reason: 'edit', idemKey: 'k-t3' });
    expect(out.telemetry.usageMicrocents).toBe(530_000);
    expect(out.telemetry.costUsd).toBeCloseTo(0.53, 4);
  });
});
