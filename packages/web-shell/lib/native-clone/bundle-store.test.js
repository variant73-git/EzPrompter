import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDevelopmentFilesystemBundleStore,
  createMemoryBundleStore,
  createVercelBlobBundleStore,
} from './bundle-store.js';

const tempDirs = [];

function hash(body) {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('BundleStore', () => {
  it('stores immutable bytes by opaque key and never exposes an OS path', async () => {
    const store = createMemoryBundleStore();
    const input = new TextEncoder().encode('hello');
    const contentHash = hash(input);
    const first = await store.putImmutable({
      storageKey: 'native-bundles/v1/bundle/assets/index.html',
      body: input,
      contentType: 'text/html',
      contentHash,
    });
    const second = await store.putImmutable({
      storageKey: 'native-bundles/v1/bundle/assets/index.html',
      body: input,
      contentType: 'text/html',
      contentHash,
    });

    expect(second).toEqual(first);
    expect(first.storageKey).toBe('native-bundles/v1/bundle/assets/index.html');
    expect(first).not.toHaveProperty('path');
    expect(first).not.toHaveProperty('filePath');
    expect(new TextDecoder().decode(await store.read(first.storageKey))).toBe('hello');
  });

  it('rejects different bytes under an existing immutable key', async () => {
    const store = createMemoryBundleStore();
    await store.putImmutable({ storageKey: 'native/key', body: 'first', contentType: 'text/plain', contentHash: hash('first') });
    await expect(store.putImmutable({
      storageKey: 'native/key', body: 'second', contentType: 'text/plain', contentHash: hash('second'),
    })).rejects.toThrow(/immutable/i);
  });

  it('lists only assets declared by the validated index', async () => {
    const store = createMemoryBundleStore();
    await store.putImmutable({ storageKey: 'root/assets/index.html', body: 'html', contentType: 'text/html', contentHash: hash('html') });
    await store.putImmutable({ storageKey: 'root/assets/secret.txt', body: 'secret', contentType: 'text/plain', contentHash: hash('secret') });
    const listed = await store.listIndexedAssets({
      storageKey: 'root',
      assetIndex: [{ path: 'index.html', contentType: 'text/html', byteLength: 4, contentHash: hash('html') }],
    });
    expect(listed).toHaveLength(1);
    expect(listed[0].storageKey).toBe('root/assets/index.html');
  });

  it('keeps the filesystem adapter development-only', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'uncraft-bundle-store-'));
    tempDirs.push(rootDir);
    expect(() => createDevelopmentFilesystemBundleStore({ rootDir, environment: 'production' })).toThrow(/production/i);

    const store = createDevelopmentFilesystemBundleStore({ rootDir, environment: 'test' });
    const meta = await store.putImmutable({ storageKey: 'bundle/a.txt', body: 'a', contentType: 'text/plain', contentHash: hash('a') });
    expect(meta).not.toHaveProperty('path');
    expect(new TextDecoder().decode(await store.read('bundle/a.txt'))).toBe('a');
  });

  it('uses a private Vercel Blob store without allowing overwrite', async () => {
    const objects = new Map();
    const sdk = {
      head: vi.fn(async (key) => {
        if (!objects.has(key)) throw Object.assign(new Error('missing'), { name: 'BlobNotFoundError' });
        const item = objects.get(key);
        return { pathname: key, size: item.body.byteLength, contentType: item.contentType };
      }),
      get: vi.fn(async (key) => {
        const item = objects.get(key);
        return item ? { stream: new Blob([item.body]).stream() } : null;
      }),
      put: vi.fn(async (key, body, options) => {
        const bytes = body && typeof body.arrayBuffer === 'function'
          ? new Uint8Array(await body.arrayBuffer())
          : new Uint8Array(body);
        if (objects.has(key) && !options.allowOverwrite) throw new Error('exists');
        objects.set(key, { body: bytes, contentType: options.contentType });
        return { pathname: key, url: `https://blob.invalid/${key}` };
      }),
    };
    const store = createVercelBlobBundleStore({ token: 'test-token', sdkLoader: async () => sdk });
    await store.putImmutable({ storageKey: 'native/a.txt', body: 'hello', contentType: 'text/plain', contentHash: hash('hello') });

    expect(sdk.put).toHaveBeenCalledWith('native/a.txt', expect.anything(), expect.objectContaining({
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      token: 'test-token',
    }));
    expect(await store.head('native/a.txt')).toMatchObject({ storageKey: 'native/a.txt', byteLength: 5 });
  });
});
