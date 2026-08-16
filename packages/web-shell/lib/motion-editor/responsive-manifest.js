export const RESPONSIVE_MANIFEST_SCHEMA_VERSION = 1;

const DEVICES = Object.freeze(['desktop', 'tablet', 'mobile']);
const DEVICE_SET = new Set(DEVICES);
const MODES = new Set(['shared', 'per-device', 'computed']);
const PROVENANCE = new Set(['author', 'inferred', 'runtime']);
const BINDING_KINDS = new Set(['style', 'text', 'attribute', 'svg', 'motion']);

function fail(message) {
  throw new TypeError(`Invalid responsive manifest: ${message}`);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value, label = 'value') {
  const seen = new Set();
  const visit = (candidate) => {
    if (candidate === null || ['string', 'boolean'].includes(typeof candidate)) return;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) fail(`${label} contains a non-finite number`);
      return;
    }
    if (!candidate || typeof candidate !== 'object') fail(`${label} must contain JSON values only`);
    if (seen.has(candidate)) fail(`${label} must not contain cycles`);
    seen.add(candidate);
    if (Array.isArray(candidate)) candidate.forEach(visit);
    else {
      Object.entries(candidate).forEach(([key, child]) => {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          fail(`${label} contains an unsafe key`);
        }
        visit(child);
      });
    }
    seen.delete(candidate);
  };
  visit(value);
  return JSON.parse(JSON.stringify(value));
}

function assertDevice(deviceId) {
  if (!DEVICE_SET.has(deviceId)) fail(`unsupported device ${String(deviceId)}`);
  return deviceId;
}

function parseBinding(binding) {
  if (binding == null) return null;
  if (!isPlainObject(binding)) fail('property binding must be an object');
  if (typeof binding.elementId !== 'string' || !binding.elementId.trim()) fail('property binding requires an elementId');
  if (!BINDING_KINDS.has(binding.kind)) fail(`unsupported binding kind ${String(binding.kind)}`);
  if (!['text', 'svg'].includes(binding.kind) && (typeof binding.property !== 'string' || !binding.property.trim())) {
    fail('property binding requires a property');
  }
  if (binding.kind === 'motion' && (typeof binding.motionId !== 'string' || !binding.motionId.trim())) {
    fail('motion binding requires a motionId');
  }
  return cloneJson(binding, 'property binding');
}

function parseProperty(input, propertyKey = 'property') {
  if (!isPlainObject(input)) fail(`${propertyKey} must be an object`);
  if (!MODES.has(input.mode)) fail(`${propertyKey} has an unsupported mode`);
  const provenance = input.provenance ?? (input.mode === 'computed' ? 'runtime' : 'inferred');
  if (!PROVENANCE.has(provenance)) fail(`${propertyKey} has unsupported provenance`);
  if (!isPlainObject(input.overrides ?? {})) fail(`${propertyKey} overrides must be an object`);
  const overrides = {};
  Object.entries(input.overrides ?? {}).forEach(([deviceId, value]) => {
    assertDevice(deviceId);
    overrides[deviceId] = cloneJson(value, `${propertyKey} ${deviceId} override`);
  });
  if (input.devices != null && !Array.isArray(input.devices)) {
    fail(`${propertyKey} devices must be a unique array`);
  }
  const devices = input.devices == null ? null : input.devices.map(assertDevice);
  if (devices && new Set(devices).size !== devices.length) {
    fail(`${propertyKey} devices must be a unique array`);
  }
  const result = {
    mode: input.mode,
    sharedValue: cloneJson(input.sharedValue ?? null, `${propertyKey} shared value`),
    overrides,
    provenance,
  };
  const binding = parseBinding(input.binding);
  if (binding) result.binding = binding;
  if (devices) result.devices = devices;
  return result;
}

function propertiesOf(manifest) {
  if (!manifest || Object.keys(manifest).length === 0) return {};
  return parseResponsiveManifest(manifest).properties;
}

function manifestWith(properties) {
  return parseResponsiveManifest({
    schemaVersion: RESPONSIVE_MANIFEST_SCHEMA_VERSION,
    properties,
  });
}

function runtimeValue(binding, effectiveValue) {
  if (binding?.kind === 'motion' && binding.property === 'retarget.final' && isPlainObject(binding.valueTemplate)) {
    return { ...cloneJson(binding.valueTemplate), value: effectiveValue };
  }
  if (binding?.kind === 'style' && binding.property === 'transform' && isPlainObject(effectiveValue)) {
    return effectiveValue.runtimeValue ?? effectiveValue.visibleValue ?? '';
  }
  if (isPlainObject(effectiveValue) && Object.hasOwn(effectiveValue, 'runtimeValue')) {
    return effectiveValue.runtimeValue;
  }
  return effectiveValue;
}

function visibleValue(value) {
  if (isPlainObject(value) && Object.hasOwn(value, 'visibleValue')) return value.visibleValue;
  return value;
}

export function responsivePropertyKey(elementId, property) {
  if (typeof elementId !== 'string' || !elementId.trim()) fail('property key requires an elementId');
  if (typeof property !== 'string' || !property.trim()) fail('property key requires a property');
  return `${elementId}:${property}`;
}

export function createResponsiveManifest() {
  return {
    schemaVersion: RESPONSIVE_MANIFEST_SCHEMA_VERSION,
    properties: {},
  };
}

export function parseResponsiveManifest(input) {
  if (input == null || (isPlainObject(input) && Object.keys(input).length === 0)) return {};
  if (!isPlainObject(input)) fail('manifest must be an object');
  const candidate = cloneJson(input, 'responsive manifest');
  if (candidate.schemaVersion !== RESPONSIVE_MANIFEST_SCHEMA_VERSION) {
    fail(`unsupported schema version ${String(candidate.schemaVersion)}`);
  }
  if (!isPlainObject(candidate.properties)) fail('properties must be an object');
  const properties = {};
  Object.entries(candidate.properties).forEach(([propertyKey, value]) => {
    if (!propertyKey.trim() || ['__proto__', 'prototype', 'constructor'].includes(propertyKey)) {
      fail('property keys must be safe non-empty strings');
    }
    properties[propertyKey] = parseProperty(value, propertyKey);
  });
  return {
    schemaVersion: RESPONSIVE_MANIFEST_SCHEMA_VERSION,
    properties,
  };
}

export function resolveResponsiveProperty(manifest, {
  propertyKey,
  deviceId,
  fallbackValue = null,
  descriptor = null,
} = {}) {
  assertDevice(deviceId);
  const properties = propertiesOf(manifest);
  const stored = properties[propertyKey] || null;
  const descriptorMode = descriptor?.mode && MODES.has(descriptor.mode) ? descriptor.mode : 'shared';
  const mode = stored?.mode || descriptorMode;
  const overrides = stored?.overrides || {};
  const sharedValue = stored ? stored.sharedValue : fallbackValue;
  const effectiveValue = mode === 'per-device' && Object.hasOwn(overrides, deviceId)
    ? overrides[deviceId]
    : sharedValue;
  const relevantDevices = stored?.devices || descriptor?.devices || null;
  return {
    propertyKey,
    mode,
    sharedValue,
    overrides: cloneJson(overrides),
    effectiveValue: visibleValue(effectiveValue ?? fallbackValue),
    runtimeValue: runtimeValue(stored?.binding, effectiveValue ?? fallbackValue),
    provenance: stored?.provenance || descriptor?.provenance || (mode === 'computed' ? 'runtime' : 'inferred'),
    binding: stored?.binding || null,
    relevant: !relevantDevices || relevantDevices.includes(deviceId),
    devices: relevantDevices ? [...relevantDevices] : [...DEVICES],
  };
}

export function setResponsivePropertyMode(manifest, {
  propertyKey,
  mode,
  deviceId,
  visibleValue: nextVisibleValue,
  binding = null,
  descriptor = null,
  provenance = null,
} = {}) {
  assertDevice(deviceId);
  if (!['shared', 'per-device'].includes(mode)) fail(`unsupported editable mode ${String(mode)}`);
  if (descriptor?.mode === 'computed') fail('computed properties cannot change scope');
  const properties = propertiesOf(manifest);
  const current = properties[propertyKey] || null;
  if (current?.mode === 'computed') fail('computed properties cannot change scope');
  const value = cloneJson(nextVisibleValue ?? current?.sharedValue ?? null, `${propertyKey} visible value`);
  const next = mode === 'per-device'
    ? {
      mode,
      sharedValue: current?.sharedValue ?? value,
      overrides: { ...(current?.overrides || {}), [deviceId]: value },
      provenance: provenance || current?.provenance || descriptor?.provenance || 'inferred',
      ...(binding || current?.binding ? { binding: parseBinding(binding || current.binding) } : {}),
      ...(current?.devices || descriptor?.devices ? { devices: [...(current?.devices || descriptor.devices)] } : {}),
    }
    : {
      mode,
      sharedValue: value,
      overrides: {},
      provenance: provenance || current?.provenance || descriptor?.provenance || 'inferred',
      ...(binding || current?.binding ? { binding: parseBinding(binding || current.binding) } : {}),
      ...(current?.devices || descriptor?.devices ? { devices: [...(current?.devices || descriptor.devices)] } : {}),
    };
  return manifestWith({ ...properties, [propertyKey]: next });
}

export function setResponsivePropertyValue(manifest, {
  propertyKey,
  deviceId,
  value,
  binding = null,
  descriptor = null,
  provenance = null,
} = {}) {
  assertDevice(deviceId);
  const properties = propertiesOf(manifest);
  const current = properties[propertyKey] || null;
  const mode = current?.mode || descriptor?.mode || 'shared';
  if (mode === 'computed') fail('computed properties cannot be edited');
  const nextValue = cloneJson(value ?? null, `${propertyKey} value`);
  const next = {
    mode,
    sharedValue: mode === 'per-device' ? (current?.sharedValue ?? nextValue) : nextValue,
    overrides: mode === 'per-device'
      ? { ...(current?.overrides || {}), [deviceId]: nextValue }
      : {},
    provenance: provenance || current?.provenance || descriptor?.provenance || 'inferred',
    ...(binding || current?.binding ? { binding: parseBinding(binding || current.binding) } : {}),
    ...(current?.devices || descriptor?.devices ? { devices: [...(current?.devices || descriptor.devices)] } : {}),
  };
  return manifestWith({ ...properties, [propertyKey]: next });
}

export function createResponsiveManifestPatch({
  id = null,
  elementId,
  propertyKey,
  before = null,
  value = null,
  createdAt = null,
} = {}) {
  if (typeof propertyKey !== 'string' || !propertyKey.trim()) fail('responsive patch requires a property key');
  return {
    id: id || globalThis.crypto?.randomUUID?.() || `responsive-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    elementId,
    kind: 'responsive',
    property: propertyKey,
    motionId: null,
    before: before == null ? null : parseProperty(before, propertyKey),
    value: value == null ? null : parseProperty(value, propertyKey),
    createdAt: createdAt || new Date().toISOString(),
  };
}

export function applyResponsiveManifestPatch(manifest, patch, direction = 'forward') {
  if (patch?.kind !== 'responsive' || typeof patch.property !== 'string') return parseResponsiveManifest(manifest);
  const properties = propertiesOf(manifest);
  const value = direction === 'backward' ? patch.before : patch.value;
  if (value == null) delete properties[patch.property];
  else properties[patch.property] = parseProperty(value, patch.property);
  return manifestWith(properties);
}

export function responsiveManifestAfterPatches(manifest, patches, direction = 'forward') {
  let next = parseResponsiveManifest(manifest);
  const seen = new Set();
  const ordered = direction === 'backward' ? [...(patches || [])].reverse() : (patches || []);
  ordered.forEach((patch) => {
    const metadata = patch?.responsive;
    const propertyKey = patch?.kind === 'responsive' ? patch.property : metadata?.propertyKey;
    if (!propertyKey || seen.has(propertyKey)) return;
    seen.add(propertyKey);
    const value = patch?.kind === 'responsive'
      ? (direction === 'backward' ? patch.before : patch.value)
      : (direction === 'backward' ? metadata.beforeEntry : metadata.afterEntry);
    next = applyResponsiveManifestPatch(next, {
      kind: 'responsive',
      property: propertyKey,
      value,
    });
  });
  return next;
}

export function withResponsiveMetadata(patch, {
  propertyKey,
  mode,
  deviceId,
  beforeEntry,
  afterEntry,
} = {}) {
  return {
    ...patch,
    responsive: {
      propertyKey,
      mode,
      deviceId: mode === 'per-device' ? assertDevice(deviceId) : null,
      beforeEntry: beforeEntry == null ? null : parseProperty(beforeEntry, propertyKey),
      afterEntry: afterEntry == null ? null : parseProperty(afterEntry, propertyKey),
    },
  };
}

export function responsivePatchAppliesToDevice(patch, deviceId) {
  assertDevice(deviceId);
  if (patch?.kind === 'responsive') return false;
  if (!patch?.responsive || patch.responsive.mode === 'shared') return true;
  return patch.responsive.deviceId === deviceId;
}

export function responsiveRuntimePatches(manifest, deviceId) {
  assertDevice(deviceId);
  const properties = propertiesOf(manifest);
  return Object.entries(properties).flatMap(([propertyKey, property]) => {
    if (property.mode === 'computed' || !property.binding || (property.devices && !property.devices.includes(deviceId))) return [];
    const effective = property.mode === 'per-device' && Object.hasOwn(property.overrides, deviceId)
      ? property.overrides[deviceId]
      : property.sharedValue;
    if (effective == null) return [];
    const binding = property.binding;
    return [{
      id: globalThis.crypto?.randomUUID?.() || `responsive-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      elementId: binding.elementId,
      kind: binding.kind,
      property: ['text', 'svg'].includes(binding.kind) ? null : binding.property,
      motionId: binding.kind === 'motion' ? binding.motionId : null,
      before: '',
      value: runtimeValue(binding, effective),
      createdAt: new Date().toISOString(),
      responsive: { propertyKey, mode: property.mode, deviceId },
    }];
  });
}
