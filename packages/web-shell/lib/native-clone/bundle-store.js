import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { normalizeBundlePath } from './bundle-contract.js';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function toBytes(body) {
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body && typeof body.arrayBuffer === 'function') return new Uint8Array(await body.arrayBuffer());
  throw new TypeError('Bundle body must be bytes, a string, an ArrayBuffer, or a Blob');
}

function validatePut({ storageKey, contentType, contentHash }) {
  const key = normalizeBundlePath(storageKey, { label: 'storage key' });
  if (key !== storageKey) throw new TypeError('Storage key must be canonical');
  if (typeof contentType !== 'string' || !contentType.trim()) throw new TypeError('Content type is required');
  if (!/^sha256:[0-9a-f]{64}$/.test(contentHash || '')) throw new TypeError('Content hash must be sha256');
  return key;
}

function publicMetadata({ storageKey, body, contentType, contentHash }) {
  return Object.freeze({ storageKey, byteLength: body.byteLength, contentType, contentHash });
}

function immutableConflict(storageKey) {
  const error = new Error(`Immutable bundle object already exists with different bytes: ${storageKey}`);
  error.code = 'immutable_conflict';
  return error;
}

function indexedAssetKey(storageKey, assetPath) {
  return `${normalizeBundlePath(storageKey, { label: 'storage key' })}/assets/${normalizeBundlePath(assetPath, { label: 'asset path' })}`;
}

function attachIndexedListing(store) {
  return Object.freeze({
    ...store,
    async listIndexedAssets({ storageKey, assetIndex }) {
      if (!Array.isArray(assetIndex)) throw new TypeError('A validated asset index is required');
      return Promise.all(assetIndex.map(async (asset) => {
        const metadata = await store.head(indexedAssetKey(storageKey, asset.path));
        if (!metadata) throw new Error(`Declared bundle asset is missing: ${asset.path}`);
        if (metadata.byteLength !== asset.byteLength) throw new Error(`Declared bundle asset has a size mismatch: ${asset.path}`);
        if (metadata.contentHash && metadata.contentHash !== asset.contentHash) {
          throw new Error(`Declared bundle asset has a content hash mismatch: ${asset.path}`);
        }
        return metadata;
      }));
    },
  });
}

export function createMemoryBundleStore() {
  const objects = new Map();
  const store = {
    async putImmutable(input) {
      const storageKey = validatePut(input);
      const body = await toBytes(input.body);
      if (sha256(body) !== input.contentHash) throw new Error(`Bundle object content hash mismatch: ${storageKey}`);
      const existing = objects.get(storageKey);
      if (existing) {
        if (existing.contentHash !== input.contentHash || Buffer.compare(existing.body, body) !== 0) {
          throw immutableConflict(storageKey);
        }
        return publicMetadata({ storageKey, ...existing });
      }
      const record = { body, contentType: input.contentType.trim(), contentHash: input.contentHash };
      objects.set(storageKey, record);
      return publicMetadata({ storageKey, ...record });
    },
    async head(storageKey) {
      const key = normalizeBundlePath(storageKey, { label: 'storage key' });
      const record = objects.get(key);
      return record ? publicMetadata({ storageKey: key, ...record }) : null;
    },
    async read(storageKey) {
      const key = normalizeBundlePath(storageKey, { label: 'storage key' });
      const record = objects.get(key);
      if (!record) throw Object.assign(new Error(`Bundle object not found: ${key}`), { code: 'not_found' });
      return new Uint8Array(record.body);
    },
  };
  return attachIndexedListing(store);
}

function containedPath(rootDir, storageKey) {
  const key = normalizeBundlePath(storageKey, { label: 'storage key' });
  const root = resolve(rootDir);
  const target = resolve(root, ...key.split('/'));
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error('Storage key escapes bundle store root');
  return { key, target };
}

export function createDevelopmentFilesystemBundleStore({ rootDir, environment = process.env.NODE_ENV } = {}) {
  if (environment === 'production') throw new Error('Development filesystem bundle store is unavailable in production');
  if (typeof rootDir !== 'string' || !rootDir) throw new TypeError('Development bundle store requires rootDir');

  const store = {
    async putImmutable(input) {
      const storageKey = validatePut(input);
      const body = await toBytes(input.body);
      if (sha256(body) !== input.contentHash) throw new Error(`Bundle object content hash mismatch: ${storageKey}`);
      const { target } = containedPath(rootDir, storageKey);
      const metadataTarget = `${target}.uncraft-meta.json`;
      await mkdir(dirname(target), { recursive: true });
      try {
        await writeFile(target, body, { flag: 'wx' });
        await writeFile(metadataTarget, JSON.stringify({ contentType: input.contentType.trim(), contentHash: input.contentHash }), { flag: 'wx' });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await readFile(target);
        let metadata = null;
        try { metadata = JSON.parse(await readFile(metadataTarget, 'utf8')); } catch {}
        if (Buffer.compare(existing, body) !== 0 || metadata?.contentHash !== input.contentHash) {
          throw immutableConflict(storageKey);
        }
      }
      return publicMetadata({ storageKey, body, contentType: input.contentType.trim(), contentHash: input.contentHash });
    },
    async head(storageKey) {
      const { key, target } = containedPath(rootDir, storageKey);
      try {
        const [body, rawMetadata] = await Promise.all([
          readFile(target),
          readFile(`${target}.uncraft-meta.json`, 'utf8').catch(() => null),
        ]);
        const metadata = rawMetadata ? JSON.parse(rawMetadata) : {};
        return publicMetadata({
          storageKey: key,
          body,
          contentType: metadata.contentType || 'application/octet-stream',
          contentHash: metadata.contentHash || sha256(body),
        });
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    },
    async read(storageKey) {
      const { target } = containedPath(rootDir, storageKey);
      try {
        return new Uint8Array(await readFile(target));
      } catch (error) {
        if (error?.code === 'ENOENT') throw Object.assign(new Error('Bundle object not found'), { code: 'not_found' });
        throw error;
      }
    },
  };
  return attachIndexedListing(store);
}

async function streamToBytes(stream) {
  if (!stream) return null;
  if (stream instanceof Uint8Array) return stream;
  if (typeof stream.arrayBuffer === 'function') return new Uint8Array(await stream.arrayBuffer());
  if (typeof Response !== 'undefined') return new Uint8Array(await new Response(stream).arrayBuffer());
  throw new TypeError('Unsupported Vercel Blob read stream');
}

export function createVercelBlobBundleStore({ token = process.env.BLOB_READ_WRITE_TOKEN, sdkLoader = () => import('@vercel/blob') } = {}) {
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is required for the production native bundle store');
  let sdkPromise;
  const loadSdk = () => (sdkPromise ||= sdkLoader());

  const store = {
    async putImmutable(input) {
      const storageKey = validatePut(input);
      const body = await toBytes(input.body);
      if (sha256(body) !== input.contentHash) throw new Error(`Bundle object content hash mismatch: ${storageKey}`);
      const existing = await this.head(storageKey);
      if (existing) {
        const existingBody = await this.read(storageKey);
        if (Buffer.compare(existingBody, body) !== 0) throw immutableConflict(storageKey);
        return publicMetadata({ storageKey, body, contentType: existing.contentType, contentHash: input.contentHash });
      }
      const sdk = await loadSdk();
      try {
        await sdk.put(storageKey, body, {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: input.contentType.trim(),
          token,
        });
      } catch (error) {
        // A concurrent content-addressed writer may win the create race. Read
        // it back and accept only byte-identical content.
        const raced = await this.head(storageKey);
        if (!raced || Buffer.compare(await this.read(storageKey), body) !== 0) throw error;
      }
      return publicMetadata({ storageKey, body, contentType: input.contentType.trim(), contentHash: input.contentHash });
    },
    async head(storageKey) {
      const key = normalizeBundlePath(storageKey, { label: 'storage key' });
      const sdk = await loadSdk();
      try {
        const result = await sdk.head(key, { token });
        return Object.freeze({
          storageKey: key,
          byteLength: result.size,
          contentType: result.contentType || 'application/octet-stream',
          contentHash: null,
        });
      } catch (error) {
        if (error?.name === 'BlobNotFoundError' || error?.code === 'not_found') return null;
        throw error;
      }
    },
    async read(storageKey) {
      const key = normalizeBundlePath(storageKey, { label: 'storage key' });
      const sdk = await loadSdk();
      const result = await sdk.get(key, { access: 'private', token });
      if (!result) throw Object.assign(new Error(`Bundle object not found: ${key}`), { code: 'not_found' });
      const bytes = await streamToBytes(result.stream || result.body || result.blob || result);
      if (!bytes) throw Object.assign(new Error(`Bundle object not found: ${key}`), { code: 'not_found' });
      return bytes;
    },
  };
  return attachIndexedListing(store);
}

export function createConfiguredBundleStore({
  environment = process.env.NODE_ENV,
  developmentRoot = process.env.UNCRAFT_NATIVE_BUNDLE_STORE_ROOT,
  token = process.env.BLOB_READ_WRITE_TOKEN,
} = {}) {
  if (environment === 'production') return createVercelBlobBundleStore({ token });
  if (!developmentRoot) {
    throw new Error('UNCRAFT_NATIVE_BUNDLE_STORE_ROOT is required outside tests when registering native bundles');
  }
  return createDevelopmentFilesystemBundleStore({ rootDir: developmentRoot, environment });
}

export { indexedAssetKey };
