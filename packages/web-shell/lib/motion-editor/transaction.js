export const TRANSACTION_LIMITS = Object.freeze({
  maxPatches: 100,
  maxBytes: 256 * 1024,
  maxPreviewUpdates: 120,
  maxExecutionMs: 2_000,
});

function id(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function jsonBytes(value) {
  const serialized = JSON.stringify(value);
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(serialized).byteLength;
  return serialized.length;
}

function assertPatch(patch) {
  if (!patch || typeof patch !== 'object') throw new TypeError('Every transaction patch must be an object');
  if (typeof patch.elementId !== 'string' || !patch.elementId) throw new TypeError('Every transaction patch requires an element ID');
  if (typeof patch.kind !== 'string' || !patch.kind) throw new TypeError('Every transaction patch requires a kind');
}

export function createTransaction({ id: transactionId, requestId, patches, createdAt, source = 'motion-lab' }) {
  if (!Array.isArray(patches) || patches.length === 0) throw new TypeError('A transaction requires at least one patch');
  if (patches.length > TRANSACTION_LIMITS.maxPatches) throw new RangeError('The transaction exceeds the patch limit');
  patches.forEach(assertPatch);
  const transaction = {
    id: transactionId || id('transaction'),
    requestId: requestId || id('request'),
    source,
    patches: patches.map((patch) => ({ ...patch })),
    createdAt: createdAt || new Date().toISOString(),
  };
  if (jsonBytes(transaction) > TRANSACTION_LIMITS.maxBytes) throw new RangeError('The transaction exceeds the message size limit');
  return transaction;
}

export function createTransactionLedger() {
  let nextSequence = 0;
  let nextToRelease = 0;
  const entriesById = new Map();
  const entriesBySequence = new Map();
  const completedIds = new Set();

  return {
    stage(transaction, meta = {}) {
      if (!transaction?.id) throw new TypeError('A transaction ID is required');
      if (entriesById.has(transaction.id) || completedIds.has(transaction.id)) return false;
      const entry = { sequence: nextSequence, transaction, meta, settlement: null };
      nextSequence += 1;
      entriesById.set(transaction.id, entry);
      entriesBySequence.set(entry.sequence, entry);
      return true;
    },

    settle(transactionId, status, payload = {}) {
      const entry = entriesById.get(transactionId);
      if (!entry || entry.settlement || completedIds.has(transactionId)) return [];
      entry.settlement = { status, payload };
      const released = [];
      while (true) {
        const next = entriesBySequence.get(nextToRelease);
        if (!next?.settlement) break;
        entriesBySequence.delete(nextToRelease);
        entriesById.delete(next.transaction.id);
        completedIds.add(next.transaction.id);
        released.push({
          transaction: next.transaction,
          meta: next.meta,
          status: next.settlement.status,
          payload: next.settlement.payload,
        });
        nextToRelease += 1;
      }
      return released;
    },

    has(transactionId) {
      return entriesById.has(transactionId);
    },

    get size() {
      return entriesById.size;
    },
  };
}

export function beginGesture({ id: gestureId, patch }) {
  assertPatch(patch);
  return {
    id: gestureId || id('gesture'),
    patch: { ...patch },
    before: patch.before,
    value: patch.value,
    previewUpdates: 0,
  };
}

export function updateGesture(gesture, value) {
  if (!gesture?.patch) throw new TypeError('An active gesture is required');
  if (gesture.previewUpdates >= TRANSACTION_LIMITS.maxPreviewUpdates) {
    throw new RangeError('The gesture exceeds the preview update limit');
  }
  return {
    ...gesture,
    value,
    previewUpdates: gesture.previewUpdates + 1,
  };
}

export function commitGesture(gesture, options = {}) {
  if (!gesture?.patch) throw new TypeError('An active gesture is required');
  return createTransaction({
    ...options,
    patches: [{ ...gesture.patch, before: gesture.before, value: gesture.value }],
  });
}

export function cancelGesture(gesture) {
  if (!gesture?.patch) throw new TypeError('An active gesture is required');
  return {
    ...gesture.patch,
    id: `${gesture.patch.id || gesture.id}:restore`,
    before: gesture.value,
    value: gesture.before,
  };
}
