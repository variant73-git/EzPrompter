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

  it('as demais razões continuam no iter9, intacto como o plano pedia', async () => {
    const { chooseReconstructionProducer } = await import('./deferred-reconstruction.js');
    const { reconstructPage } = await import('./reconstruct.js');
    for (const reason of ['workflow', 'strict-dependency', undefined]) {
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
