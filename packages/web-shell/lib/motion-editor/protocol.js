export const MOTION_EDITOR_PROTOCOL = 'uncraft-motion-editor/v1';
export const MOTION_EDITOR_PROTOCOL_V2 = 'uncraft-motion-editor/v2';
export const SUPPORTED_MOTION_EDITOR_PROTOCOLS = Object.freeze([
  MOTION_EDITOR_PROTOCOL_V2,
  MOTION_EDITOR_PROTOCOL,
]);

const PATCH_KINDS = new Set(['style', 'text', 'attribute', 'svg', 'motion', 'control']);

export function isRuntimeMessage(value) {
  if (!value || typeof value !== 'object' || value.source !== 'runtime' || typeof value.type !== 'string') {
    return false;
  }
  if (value.protocol === MOTION_EDITOR_PROTOCOL) return true;
  return Boolean(
    value.protocol === MOTION_EDITOR_PROTOCOL_V2 &&
    value.protocolVersion === MOTION_EDITOR_PROTOCOL_V2 &&
    Array.isArray(value.supportedProtocols) &&
    value.supportedProtocols.includes(MOTION_EDITOR_PROTOCOL_V2) &&
    typeof value.sessionNonce === 'string' && value.sessionNonce.length >= 8 &&
    typeof value.requestId === 'string' && value.requestId.length > 0 &&
    Number.isInteger(value.runtimeGeneration) && value.runtimeGeneration > 0 &&
    typeof value.bundleId === 'string' && value.bundleId.length > 0 &&
    typeof value.sessionId === 'string' && value.sessionId.length > 0
  );
}

export function matchesRuntimeContext(value, expected, eventOrigin) {
  if (!isRuntimeMessage(value) || value.protocol !== MOTION_EDITOR_PROTOCOL_V2) return false;
  if (!expected || typeof expected !== 'object') return false;
  return value.sessionNonce === expected.sessionNonce &&
    value.runtimeGeneration === expected.runtimeGeneration &&
    value.bundleId === expected.bundleId &&
    value.sessionId === expected.sessionId &&
    (!expected.origin || eventOrigin === expected.origin);
}

export function createPatch({ elementId, kind, property = null, before = '', value = '', motionId = null }) {
  if (!elementId || typeof elementId !== 'string') throw new Error('elementId is required');
  if (!PATCH_KINDS.has(kind)) throw new Error(`Unsupported patch kind: ${kind}`);
  if (!['text', 'svg'].includes(kind) && (!property || typeof property !== 'string')) {
    throw new Error('property is required for style, attribute, motion and control patches');
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

export function commandV2(type, payload = {}, context = {}) {
  const {
    sessionNonce,
    requestId,
    runtimeGeneration,
    bundleId,
    sessionId,
  } = context;
  if (typeof sessionNonce !== 'string' || sessionNonce.length < 8) throw new TypeError('A session nonce is required');
  if (typeof requestId !== 'string' || !requestId) throw new TypeError('A request ID is required');
  if (!Number.isInteger(runtimeGeneration) || runtimeGeneration < 1) throw new TypeError('A runtime generation is required');
  if (typeof bundleId !== 'string' || !bundleId) throw new TypeError('A bundle ID is required');
  if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('A session ID is required');
  return {
    protocol: MOTION_EDITOR_PROTOCOL_V2,
    protocolVersion: MOTION_EDITOR_PROTOCOL_V2,
    supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
    source: 'host',
    type,
    sessionNonce,
    requestId,
    runtimeGeneration,
    bundleId,
    sessionId,
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
