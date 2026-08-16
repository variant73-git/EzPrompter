import { posix } from 'node:path';

export const NATIVE_BUNDLE_SCHEMA_VERSION = 1;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOWS_DRIVE_PATTERN = /^[a-z]:[\\/]/i;

function fail(message) {
  throw new TypeError(`Invalid native bundle descriptor: ${message}`);
}

function decodePath(value, label) {
  let decoded = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      fail(`${label} contains invalid URL encoding`);
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function normalizeBundlePath(value, { label = 'path' } = {}) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`);
  if (value.includes('\0')) fail(`${label} contains a null byte`);
  if (/^file:/i.test(value) || value.startsWith('/') || value.startsWith('\\') || WINDOWS_DRIVE_PATTERN.test(value)) {
    fail(`${label} must be relative and provider-owned`);
  }

  const decoded = decodePath(value, label);
  if (decoded.includes('\0')) fail(`${label} contains a null byte`);
  if (decoded.startsWith('/') || decoded.startsWith('\\') || WINDOWS_DRIVE_PATTERN.test(decoded)) {
    fail(`${label} must be relative`);
  }

  const slashPath = decoded.replaceAll('\\', '/');
  const rawSegments = slashPath.split('/');
  if (rawSegments.some((segment) => segment === '..')) fail(`${label} contains traversal`);

  const normalized = posix.normalize(slashPath).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    fail(`${label} is not contained by the bundle`);
  }
  if (normalized.split('/').some((segment) => segment === '..' || !segment)) {
    fail(`${label} is not canonical`);
  }
  return normalized;
}

export function assertSha256(value, label = 'hash') {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail(`${label} must be a sha256 digest`);
  return value;
}

function cloneJson(value, label) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) fail(`${label} must be JSON serializable`);
    return JSON.parse(serialized);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('Invalid native bundle descriptor:')) throw error;
    fail(`${label} must be JSON serializable`);
  }
}

function parseCapabilities(value) {
  const input = value ?? {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('reconstructionCapabilities must be an object');
  const detectedEngines = input.detectedEngines ?? [];
  const candidateControls = input.candidateControls ?? [];
  if (!Array.isArray(detectedEngines) || detectedEngines.some((engine) => typeof engine !== 'string' || !engine.trim())) {
    fail('detectedEngines must contain non-empty strings');
  }
  if (!Array.isArray(candidateControls)) fail('candidateControls must be an array');
  return {
    detectedEngines: [...new Set(detectedEngines.map((engine) => engine.trim()))],
    candidateControls: cloneJson(candidateControls, 'candidateControls'),
  };
}

function parseAsset(asset) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) fail('assetIndex entries must be objects');
  const path = normalizeBundlePath(asset.path, { label: 'asset path' });
  if (typeof asset.contentType !== 'string' || !asset.contentType.trim()) fail(`asset ${path} requires a content type`);
  if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 0) fail(`asset ${path} has an invalid byte length`);
  return {
    path,
    contentType: asset.contentType.trim(),
    byteLength: asset.byteLength,
    contentHash: assertSha256(asset.contentHash, `asset ${path} content hash`),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function parseNativeBundleDescriptor(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('descriptor must be an object');
  if (input.schemaVersion !== NATIVE_BUNDLE_SCHEMA_VERSION) {
    fail(`unsupported schema version ${String(input.schemaVersion)}`);
  }
  if (typeof input.bundleId !== 'string' || !UUID_PATTERN.test(input.bundleId)) fail('bundleId must be a UUID');

  const storageKey = normalizeBundlePath(input.storageKey, { label: 'storage key' });
  if (storageKey !== input.storageKey || /^[a-z][a-z0-9+.-]*:/i.test(input.storageKey)) {
    fail('storage key must be canonical and opaque');
  }
  const entryPath = normalizeBundlePath(input.entryPath, { label: 'entry path' });
  const contentHash = assertSha256(input.contentHash, 'content hash');
  const runtimeFingerprint = assertSha256(input.runtimeFingerprint, 'runtime fingerprint');
  if (!Array.isArray(input.assetIndex) || input.assetIndex.length === 0) fail('assetIndex must not be empty');

  const assetIndex = input.assetIndex.map(parseAsset);
  const seen = new Set();
  for (const asset of assetIndex) {
    if (seen.has(asset.path)) fail(`duplicate normalized asset path: ${asset.path}`);
    seen.add(asset.path);
  }
  if (!seen.has(entryPath)) fail('entry path is missing from the declared asset index');

  return deepFreeze({
    schemaVersion: NATIVE_BUNDLE_SCHEMA_VERSION,
    bundleId: input.bundleId.toLowerCase(),
    storageKey,
    contentHash,
    entryPath,
    assetIndex,
    runtimeFingerprint,
    reconstructionCapabilities: parseCapabilities(input.reconstructionCapabilities),
  });
}

export function serializeNativeBundleDescriptor(input) {
  return JSON.stringify(parseNativeBundleDescriptor(input));
}

export function isNativeBundleSnapshotEligible(snapshot) {
  const candidate = snapshot?.nativeBundle ?? snapshot?.native_bundle ?? snapshot?.nativeBundleDescriptor;
  if (!candidate) return false;
  try {
    parseNativeBundleDescriptor(candidate);
    return true;
  } catch {
    return false;
  }
}
