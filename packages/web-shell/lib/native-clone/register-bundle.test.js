import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundleStore } from './bundle-store.js';
import { NativeBundleDescriptorConflictError, registerNativeBundle } from './register-bundle.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function producerBundle(overrides = {}) {
  return {
    entryPath: 'index.html',
    runtimeFingerprint: HASH_A,
    assets: [
      { path: 'index.html', contentType: 'text/html; charset=utf-8', body: '<html><script src="assets/app.js"></script></html>' },
      { path: 'assets/app.js', contentType: 'text/javascript; charset=utf-8', body: 'window.live = true;' },
    ],
    reconstructionCapabilities: {
      detectedEngines: ['waapi'],
      candidateControls: [{ id: 'site-motion', evidence: { engine: 'waapi' } }],
    },
    ...overrides,
  };
}

describe('registerNativeBundle', () => {
  it('registers the same content idempotently and keeps candidate controls pending', async () => {
    const store = createMemoryBundleStore();
    const first = await registerNativeBundle(producerBundle(), { store });
    const second = await registerNativeBundle(producerBundle(), { store });

    expect(second).toEqual(first);
    expect(first.bundleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.reconstructionCapabilities.candidateControls[0]).toMatchObject({
      id: 'site-motion',
      status: 'pending',
    });
    const entry = await store.read(`${first.storageKey}/assets/index.html`);
    const script = await store.read(`${first.storageKey}/assets/assets/app.js`);
    expect(new TextDecoder().decode(entry)).toContain('assets/app.js');
    expect(new TextDecoder().decode(script)).toContain('window.live');
  });

  it('rejects producer content-hash mismatches', async () => {
    await expect(registerNativeBundle(producerBundle({ contentHash: HASH_A }), {
      store: createMemoryBundleStore(),
    })).rejects.toThrow(/content hash/i);
  });

  // ⚠️ bundleId do PRODUTOR so' entra se for exatamente o derivado do conteudo
  // — `producerOutput.bundleId ||` aceitava QUALQUER id: o mesmo conteudo
  // podia ganhar ids diferentes, e um id podia apontar para conteudos
  // diferentes (Sol). O caso "bytes diferentes sob o mesmo id" morre AQUI,
  // por construcao, antes de alcançar o store.
  it('rejects a producer bundle id that does not derive from the content', async () => {
    await expect(registerNativeBundle(producerBundle({
      bundleId: '22222222-2222-4222-8222-222222222222',
    }), { store: createMemoryBundleStore() })).rejects.toThrow(/bundle id/i);
  });

  // ⚠️ A identidade deriva dos ASSETS — entryPath/fingerprint/capabilities
  // ficam fora do hash — e o reuso comparava so' o contentHash: assets
  // identicos com entryPath ou fingerprint DIFERENTES recebiam o mesmo id e a
  // segunda chamada devolvia os metadados da primeira, em silencio (Sol
  // reproduziu: pediu other.html com outro fingerprint e recebeu index.html
  // com o fingerprint antigo). Divergencia em qualquer campo executavel e'
  // ERRO tipado, nunca troca silenciosa de descriptor.
  it('rejects same assets with a different entryPath or fingerprint — never silent reuse', async () => {
    const store = createMemoryBundleStore();
    await registerNativeBundle(producerBundle({}), { store });
    // MESMOS assets, fingerprint diferente → recusa TIPADA (classe + code)
    await expect(registerNativeBundle(producerBundle({
      runtimeFingerprint: `sha256:${'9'.repeat(64)}`,
    }), { store })).rejects.toBeInstanceOf(NativeBundleDescriptorConflictError);
    await expect(registerNativeBundle(producerBundle({
      runtimeFingerprint: `sha256:${'9'.repeat(64)}`,
    }), { store })).rejects.toMatchObject({ code: 'immutable_bundle_conflict' });
    // MESMOS assets, entryPath diferente (apontando outro arquivo ja' presente) → recusa tipada
    await expect(registerNativeBundle(producerBundle({
      entryPath: 'assets/app.js',
    }), { store })).rejects.toMatchObject({ code: 'immutable_bundle_conflict' });
  });

  it('accepts a producer bundle id when it IS the derived one (idempotent)', async () => {
    const store = createMemoryBundleStore();
    const first = await registerNativeBundle(producerBundle({}), { store });
    const second = await registerNativeBundle(producerBundle({ bundleId: first.bundleId }), { store });
    expect(second.bundleId).toBe(first.bundleId);
  });

  it('rejects assets that are missing from or added outside a producer-declared index', async () => {
    await expect(registerNativeBundle(producerBundle({
      assetIndex: [{ path: 'index.html' }],
    }), { store: createMemoryBundleStore() })).rejects.toThrow(/asset index/i);
  });

  it('rejects symlinks that escape a real producer directory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'uncraft-native-producer-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'uncraft-native-outside-'));
    tempDirs.push(rootDir, outsideDir);
    await writeFile(join(rootDir, 'index.html'), '<html></html>');
    await writeFile(join(outsideDir, 'secret.js'), 'secret');
    await symlink(join(outsideDir, 'secret.js'), join(rootDir, 'escaped.js'));

    await expect(registerNativeBundle({
      sourceRoot: rootDir,
      entryPath: 'index.html',
      runtimeFingerprint: HASH_A,
    }, { store: createMemoryBundleStore() })).rejects.toThrow(/symlink|escape/i);
  });

  it('registers and reads a real directory without UNCRAFT_NATIVE_CLONE_ROOT', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'uncraft-native-real-'));
    tempDirs.push(rootDir);
    await mkdir(join(rootDir, 'assets'));
    await writeFile(join(rootDir, 'index.html'), '<html><link href="assets/site.css"></html>');
    await writeFile(join(rootDir, 'assets/site.css'), 'body { color: tomato; }');
    const previous = process.env.UNCRAFT_NATIVE_CLONE_ROOT;
    delete process.env.UNCRAFT_NATIVE_CLONE_ROOT;
    try {
      const store = createMemoryBundleStore();
      const descriptor = await registerNativeBundle({
        sourceRoot: rootDir,
        entryPath: 'index.html',
        runtimeFingerprint: HASH_A,
      }, { store });
      expect(descriptor.assetIndex.map((asset) => asset.path)).toEqual(['assets/site.css', 'index.html']);
      expect(descriptor).not.toHaveProperty('sourceRoot');
      expect(JSON.stringify(descriptor)).not.toContain(rootDir);
      expect(await store.listIndexedAssets(descriptor)).toHaveLength(2);
    } finally {
      if (previous === undefined) delete process.env.UNCRAFT_NATIVE_CLONE_ROOT;
      else process.env.UNCRAFT_NATIVE_CLONE_ROOT = previous;
    }
  });
});
