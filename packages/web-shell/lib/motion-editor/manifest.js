import { createHash } from 'node:crypto';

export const MOTION_MANIFEST_SCHEMA_VERSION = 2;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const PATCH_KINDS = new Set(['style', 'text', 'attribute', 'svg', 'motion']);
const TRANSACTION_SOURCES = new Set(['properties', 'motion', 'code', 'custom-control', 'responsive']);
const CONTROL_TYPES = new Set(['slider', 'number', 'toggle', 'select', 'segmented', 'color', 'text']);
const ADAPTER_KINDS = new Set(['declarative', 'custom']);
const CONTROL_STATUSES = new Set(['ready', 'disabled']);
const VALUE_TYPES = new Set(['string', 'number', 'boolean']);
const LEGACY_EPOCH = '1970-01-01T00:00:00.000Z';

function fail(message) {
  throw new TypeError(`Invalid native motion manifest: ${message}`);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value, label) {
  const seen = new Set();
  const validate = (candidate) => {
    if (candidate === null || VALUE_TYPES.has(typeof candidate)) {
      if (typeof candidate === 'number' && !Number.isFinite(candidate)) fail(`${label} contains a non-finite number`);
      return;
    }
    if (!candidate || typeof candidate !== 'object') fail(`${label} must contain JSON values only`);
    if (seen.has(candidate)) fail(`${label} must not contain cycles`);
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach(validate);
    } else {
      for (const [key, child] of Object.entries(candidate)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          fail(`${label} contains an unsafe key`);
        }
        validate(child);
      }
    }
    seen.delete(candidate);
  };
  try {
    validate(value);
    const serialized = JSON.stringify(value);
    if (serialized === undefined) fail(`${label} must be JSON serializable`);
    return JSON.parse(serialized);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('Invalid native motion manifest:')) throw error;
    fail(`${label} must be JSON serializable`);
  }
}

function assertUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail(`${label} must be a UUID`);
  return value.toLowerCase();
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail(`${label} must be a sha256 digest`);
  return value;
}

function assertIsoDate(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(`${label} must be an ISO-8601 timestamp`);
  return new Date(value).toISOString();
}

function parsePatchValue(value, label) {
  return cloneJson(value, label);
}

function parsePatch(input, { legacyIndex = null } = {}) {
  if (!isPlainObject(input)) fail('patches must be objects');
  if (!PATCH_KINDS.has(input.kind)) fail(`unsupported patch kind ${String(input.kind)}`);
  if (typeof input.elementId !== 'string' || !input.elementId.trim()) fail('patch elementId is required');

  const propertyOptional = input.kind === 'text' || input.kind === 'svg';
  if (!propertyOptional && (typeof input.property !== 'string' || !input.property.trim())) {
    fail(`patch property is required for ${input.kind}`);
  }
  if (input.kind === 'motion' && (typeof input.motionId !== 'string' || !input.motionId.trim())) {
    fail('motion patch motionId is required');
  }

  const legacySeed = legacyIndex == null ? null : canonicalJson({ index: legacyIndex, patch: input });
  const id = typeof input.id === 'string' && input.id.trim()
    ? input.id
    : `legacy-${createHash('sha256').update(legacySeed).digest('hex').slice(0, 24)}`;
  const createdAt = input.createdAt == null && legacyIndex != null
    ? LEGACY_EPOCH
    : assertIsoDate(input.createdAt, 'patch createdAt');

  const patch = {
    id,
    elementId: input.elementId,
    kind: input.kind,
    property: propertyOptional ? null : input.property,
    motionId: input.kind === 'motion' ? input.motionId : null,
    before: parsePatchValue(input.before ?? '', 'patch before'),
    value: parsePatchValue(input.value ?? '', 'patch value'),
    createdAt,
  };
  if (input.groupId != null) {
    if (typeof input.groupId !== 'string' || !input.groupId.trim()) fail('patch groupId must be a non-empty string');
    patch.groupId = input.groupId;
  }
  if (input.layoutIntent != null) {
    if (!isPlainObject(input.layoutIntent)) fail('patch layoutIntent must be an object');
    patch.layoutIntent = cloneJson(input.layoutIntent, 'patch layoutIntent');
  }
  return patch;
}

function parseControlManifest(input, runtimeFingerprint) {
  if (input == null) return {};
  if (!isPlainObject(input)) fail('controlManifest must be an object');
  if (Object.keys(input).length === 0) return {};
  if (input.schemaVersion !== 1) fail(`unsupported control manifest version ${String(input.schemaVersion)}`);
  if (input.runtimeFingerprint !== runtimeFingerprint) fail('control manifest runtime fingerprint does not match');
  if (!Array.isArray(input.controls)) fail('control manifest controls must be an array');

  for (const control of input.controls) {
    if (!isPlainObject(control) || typeof control.id !== 'string' || !control.id.trim()) {
      fail('controls require a stable id');
    }
    if (!CONTROL_TYPES.has(control.controlType)) fail(`unsupported control type ${String(control.controlType)}`);
    if (!ADAPTER_KINDS.has(control.adapterKind)) fail(`unsupported control adapter kind ${String(control.adapterKind)}`);
    if (!CONTROL_STATUSES.has(control.status)) fail(`unsupported control status ${String(control.status)}`);
  }
  return cloneJson(input, 'controlManifest');
}

function parseResponsiveManifest(input) {
  if (input == null) return {};
  if (!isPlainObject(input)) fail('responsiveManifest must be an object');
  return cloneJson(input, 'responsiveManifest');
}

function parseTransaction(input) {
  if (!isPlainObject(input)) fail('transactions must be objects');
  const id = assertUuid(input.id, 'transaction id');
  const createdAt = assertIsoDate(input.createdAt, 'transaction createdAt');
  if (!TRANSACTION_SOURCES.has(input.source)) fail(`unsupported transaction source ${String(input.source)}`);
  if (!Array.isArray(input.patches)) fail('transaction patches must be an array');
  if (!Array.isArray(input.automaticRepairs)) fail('transaction automaticRepairs must be an array');
  return {
    id,
    createdAt,
    source: input.source,
    patches: input.patches.map((patch) => parsePatch(patch)),
    automaticRepairs: input.automaticRepairs.map((patch) => parsePatch(patch)),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deterministicUuid(value) {
  const hex = createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function adaptVersionOne(input, options) {
  const legacy = Array.isArray(input) ? { patches: input } : input;
  if (!isPlainObject(legacy) || !Array.isArray(legacy.patches)) fail('version-1 patch list is invalid');
  const baseBundleId = assertUuid(legacy.baseBundleId ?? options.baseBundleId, 'baseBundleId');
  const runtimeFingerprint = assertSha256(
    legacy.runtimeFingerprint ?? options.runtimeFingerprint,
    'runtimeFingerprint',
  );
  const groups = [];
  legacy.patches.forEach((rawPatch, index) => {
    const parsedPatch = parsePatch(rawPatch, { legacyIndex: index });
    const previous = groups.at(-1);
    if (parsedPatch.groupId && previous?.groupId === parsedPatch.groupId) {
      previous.patches.push(parsedPatch);
      return;
    }
    groups.push({ index, groupId: parsedPatch.groupId ?? null, patches: [parsedPatch] });
  });
  const transactions = groups.map((group) => {
    const source = group.patches.every((patch) => patch.kind === 'motion') ? 'motion' : 'properties';
    return {
      id: deterministicUuid({ baseBundleId, index: group.index, patches: group.patches }),
      createdAt: group.patches[0].createdAt,
      source,
      patches: group.patches,
      automaticRepairs: [],
    };
  });
  return {
    schemaVersion: MOTION_MANIFEST_SCHEMA_VERSION,
    baseBundleId,
    transactions,
    controlManifest: parseControlManifest(legacy.controlManifest ?? {}, runtimeFingerprint),
    responsiveManifest: parseResponsiveManifest(legacy.responsiveManifest ?? {}),
    runtimeFingerprint,
  };
}

function parseInput(input) {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    fail('manifest must be valid JSON');
  }
}

export function parseMotionManifest(input, options = {}) {
  const parsedInput = parseInput(input);
  const manifest = Array.isArray(parsedInput) || parsedInput?.schemaVersion === 1
    ? adaptVersionOne(parsedInput, options)
    : parsedInput;
  if (!isPlainObject(manifest)) fail('manifest must be an object');
  if (manifest.schemaVersion !== MOTION_MANIFEST_SCHEMA_VERSION) {
    fail(`unsupported schema version ${String(manifest.schemaVersion)}`);
  }

  const baseBundleId = assertUuid(manifest.baseBundleId, 'baseBundleId');
  if (options.expectedBundleId && baseBundleId !== assertUuid(options.expectedBundleId, 'expected base bundle id')) {
    fail('base bundle does not match the snapshot bundle');
  }
  const runtimeFingerprint = assertSha256(manifest.runtimeFingerprint, 'runtimeFingerprint');
  if (!Array.isArray(manifest.transactions)) fail('transactions must be an array');

  return {
    schemaVersion: MOTION_MANIFEST_SCHEMA_VERSION,
    baseBundleId,
    transactions: manifest.transactions.map(parseTransaction),
    controlManifest: parseControlManifest(manifest.controlManifest, runtimeFingerprint),
    responsiveManifest: parseResponsiveManifest(manifest.responsiveManifest),
    runtimeFingerprint,
  };
}

export function createEmptyMotionManifest({ baseBundleId, runtimeFingerprint }) {
  return parseMotionManifest({
    schemaVersion: MOTION_MANIFEST_SCHEMA_VERSION,
    baseBundleId,
    transactions: [],
    controlManifest: {},
    responsiveManifest: {},
    runtimeFingerprint,
  });
}

export function serializeMotionManifest(input, options = {}) {
  return JSON.stringify(parseMotionManifest(input, options));
}
