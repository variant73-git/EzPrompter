export const MOTION_EDITOR_PROTOCOL = 'uncraft-motion-editor/v1';

const PATCH_KINDS = new Set(['style', 'text', 'attribute', 'svg', 'motion']);

export function isRuntimeMessage(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.protocol === MOTION_EDITOR_PROTOCOL &&
    value.source === 'runtime' &&
    typeof value.type === 'string'
  );
}

export function createPatch({ elementId, kind, property = null, before = '', value = '', motionId = null }) {
  if (!elementId || typeof elementId !== 'string') throw new Error('elementId is required');
  if (!PATCH_KINDS.has(kind)) throw new Error(`Unsupported patch kind: ${kind}`);
  if (!['text', 'svg'].includes(kind) && (!property || typeof property !== 'string')) {
    throw new Error('property is required for style, attribute and motion patches');
  }
  if (kind === 'motion' && (!motionId || typeof motionId !== 'string')) {
    throw new Error('motionId is required for motion patches');
  }

  return {
    id: globalThis.crypto?.randomUUID?.() || `patch-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    elementId,
    kind,
    property: ['text', 'svg'].includes(kind) ? null : property,
    motionId: kind === 'motion' ? motionId : null,
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

// A patch the runtime refused must leave history: undo and save would replay a
// write that is known to fail, silently, on every reload.
export function removeRejectedPatch(history, rejected) {
  if (!rejected?.id) return history;
  return history.filter((patch) => patch.id !== rejected.id);
}
