export const MOTION_EDITOR_PROTOCOL = 'uncraft-motion-editor/v1';

const PATCH_KINDS = new Set(['style', 'text', 'attribute']);

export function isRuntimeMessage(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.protocol === MOTION_EDITOR_PROTOCOL &&
    value.source === 'runtime' &&
    typeof value.type === 'string'
  );
}

export function createPatch({ elementId, kind, property = null, before = '', value = '' }) {
  if (!elementId || typeof elementId !== 'string') throw new Error('elementId is required');
  if (!PATCH_KINDS.has(kind)) throw new Error(`Unsupported patch kind: ${kind}`);
  if (kind !== 'text' && (!property || typeof property !== 'string')) {
    throw new Error('property is required for style and attribute patches');
  }

  return {
    id: globalThis.crypto?.randomUUID?.() || `patch-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    elementId,
    kind,
    property: kind === 'text' ? null : property,
    before: before ?? '',
    value: value ?? '',
    createdAt: new Date().toISOString(),
  };
}

export function invertPatch(patch) {
  return {
    ...patch,
    id: `${patch.id}:inverse`,
    before: patch.value,
    value: patch.before,
    createdAt: new Date().toISOString(),
  };
}

export function command(type, payload = {}) {
  return {
    protocol: MOTION_EDITOR_PROTOCOL,
    source: 'host',
    type,
    payload,
  };
}

export function storageKey(source) {
  return `uncraft:native-motion-patches:v1:${source || 'default'}`;
}
