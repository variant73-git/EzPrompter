import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundleStore } from './bundle-store.js';
import { registerNativeBundle } from './register-bundle.js';

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

  it('rejects different bytes under an existing immutable bundle ID', async () => {
    const store = createMemoryBundleStore();
    const bundleId = '22222222-2222-4222-8222-222222222222';
    await registerNativeBundle(producerBundle({ bundleId }), { store });
    await expect(registerNativeBundle(producerBundle({
      bundleId,
      assets: [{ path: 'index.html', contentType: 'text/html', body: '<html>different</html>' }],
    }), { store })).rejects.toThrow(/immutable bundle/i);
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
