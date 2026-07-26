import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join, relative } from 'node:path';
import {
  NATIVE_BUNDLE_SCHEMA_VERSION,
  normalizeBundlePath,
  parseNativeBundleDescriptor,
  serializeNativeBundleDescriptor,
} from './bundle-contract.js';

function sha256(body) {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

async function toBytes(body) {
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body && typeof body.arrayBuffer === 'function') return new Uint8Array(await body.arrayBuffer());
  throw new TypeError('Native bundle assets require body bytes');
}

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function inferContentType(path) {
  return CONTENT_TYPES.get(extname(path).toLowerCase()) || 'application/octet-stream';
}

function isContained(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function collectDirectoryAssets(sourceRoot) {
  if (typeof sourceRoot !== 'string' || !sourceRoot) throw new TypeError('sourceRoot must be a directory');
  const root = await realpath(sourceRoot);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new TypeError('sourceRoot must be a directory');
  const assets = [];

  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = normalizeBundlePath(prefix ? `${prefix}/${entry.name}` : entry.name, { label: 'asset path' });
      if (entry.isDirectory()) {
        await visit(absolute, path);
        continue;
      }
      if (entry.isSymbolicLink()) {
        const target = await realpath(absolute);
        if (!isContained(root, target)) throw new Error(`Native bundle symlink escapes source root: ${path}`);
        const targetStat = await lstat(target);
        if (!targetStat.isFile()) throw new Error(`Native bundle directory symlinks are unsupported: ${path}`);
      } else if (!entry.isFile()) {
        throw new Error(`Unsupported native bundle filesystem entry: ${path}`);
      }
      assets.push({ path, contentType: inferContentType(path), body: await readFile(absolute) });
    }
  }

  await visit(root);
  return assets;
}

function deterministicUuid(contentHash) {
  const hex = contentHash.slice('sha256:'.length, 'sha256:'.length + 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function computeBundleHash(assetIndex) {
  const hash = createHash('sha256');
  for (const asset of assetIndex) {
    hash.update(asset.path);
    hash.update('\0');
    hash.update(asset.contentType);
    hash.update('\0');
    hash.update(String(asset.byteLength));
    hash.update('\0');
    hash.update(asset.contentHash);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function pendingCapabilities(input = {}) {
  const controls = input.candidateControls ?? [];
  if (!Array.isArray(controls)) throw new TypeError('candidateControls must be an array');
  return {
    detectedEngines: Array.isArray(input.detectedEngines) ? input.detectedEngines : [],
    candidateControls: controls.map((control) => {
      if (!control || typeof control !== 'object' || Array.isArray(control)) {
        throw new TypeError('Candidate controls must be evidence objects');
      }
      return { ...control, status: 'pending' };
    }),
  };
}

function validateDeclaredIndex(declaredIndex, preparedAssets) {
  if (declaredIndex == null) return;
  if (!Array.isArray(declaredIndex)) throw new TypeError('Producer asset index must be an array');
  const declared = new Map();
  for (const item of declaredIndex) {
    const rawPath = typeof item === 'string' ? item : item?.path;
    const path = normalizeBundlePath(rawPath, { label: 'producer asset index path' });
    if (declared.has(path)) throw new Error(`Producer asset index contains a duplicate path: ${path}`);
    declared.set(path, item);
  }
  const actualPaths = preparedAssets.map((asset) => asset.path);
  if (declared.size !== actualPaths.length || actualPaths.some((path) => !declared.has(path))) {
    throw new Error('Producer asset index does not match the supplied bundle assets');
  }
  for (const asset of preparedAssets) {
    const item = declared.get(asset.path);
    if (item && typeof item === 'object' && item.contentHash && item.contentHash !== asset.contentHash) {
      throw new Error(`Producer asset index content hash mismatch: ${asset.path}`);
    }
  }
}

async function prepareAssets(producerOutput) {
  const rawAssets = producerOutput.sourceRoot
    ? await collectDirectoryAssets(producerOutput.sourceRoot)
    : producerOutput.assets;
  if (!Array.isArray(rawAssets) || rawAssets.length === 0) throw new TypeError('Native bundle producer returned no assets');

  const prepared = [];
  const seen = new Set();
  for (const raw of rawAssets) {
    if (!raw || typeof raw !== 'object') throw new TypeError('Native bundle assets must be objects');
    const path = normalizeBundlePath(raw.path, { label: 'asset path' });
    if (seen.has(path)) throw new Error(`Duplicate normalized asset path: ${path}`);
    seen.add(path);
    const body = await toBytes(raw.body ?? raw.bytes);
    const contentHash = sha256(body);
    if (raw.contentHash && raw.contentHash !== contentHash) throw new Error(`Asset content hash mismatch: ${path}`);
    prepared.push({
      path,
      body,
      contentType: raw.contentType || inferContentType(path),
      byteLength: body.byteLength,
      contentHash,
    });
  }
  prepared.sort((a, b) => a.path.localeCompare(b.path));
  validateDeclaredIndex(producerOutput.assetIndex, prepared);
  return prepared;
}

export async function registerNativeBundle(producerOutput, { store } = {}) {
  if (!producerOutput || typeof producerOutput !== 'object') throw new TypeError('Native bundle producer output is required');
  if (!store || typeof store.putImmutable !== 'function' || typeof store.head !== 'function' || typeof store.read !== 'function') {
    throw new TypeError('A BundleStore is required');
  }
  const preparedAssets = await prepareAssets(producerOutput);
  const assetIndex = preparedAssets.map(({ path, contentType, byteLength, contentHash }) => ({
    path, contentType, byteLength, contentHash,
  }));
  const contentHash = computeBundleHash(assetIndex);
  if (producerOutput.contentHash && producerOutput.contentHash !== contentHash) {
    throw new Error('Native bundle content hash mismatch');
  }

  const bundleId = producerOutput.bundleId || deterministicUuid(contentHash);
  const storageKey = `native-bundles/v1/${bundleId}`;
  const descriptorKey = `${storageKey}/descriptor.json`;
  const descriptor = parseNativeBundleDescriptor({
    schemaVersion: NATIVE_BUNDLE_SCHEMA_VERSION,
    bundleId,
    storageKey,
    contentHash,
    entryPath: producerOutput.entryPath,
    assetIndex,
    runtimeFingerprint: producerOutput.runtimeFingerprint,
    reconstructionCapabilities: pendingCapabilities(producerOutput.reconstructionCapabilities),
  });
  const existingMetadata = await store.head(descriptorKey);
  if (existingMetadata) {
    const existing = parseNativeBundleDescriptor(JSON.parse(new TextDecoder().decode(await store.read(descriptorKey))));
    if (existing.contentHash !== contentHash) throw new Error(`Immutable bundle ID already contains different content: ${bundleId}`);
    return existing;
  }

  for (const asset of preparedAssets) {
    await store.putImmutable({
      storageKey: `${storageKey}/assets/${asset.path}`,
      body: asset.body,
      contentType: asset.contentType,
      contentHash: asset.contentHash,
    });
  }

  const serialized = serializeNativeBundleDescriptor(descriptor);
  await store.putImmutable({
    storageKey: descriptorKey,
    body: serialized,
    contentType: 'application/json; charset=utf-8',
    contentHash: sha256(new TextEncoder().encode(serialized)),
  });
  return descriptor;
}

export { collectDirectoryAssets, computeBundleHash };
