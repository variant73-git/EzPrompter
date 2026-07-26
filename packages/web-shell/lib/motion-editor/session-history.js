const NON_USER_SOURCES = new Set(['replay', 'restore', 'repair', 'autosave']);

function cloneTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object' || typeof transaction.id !== 'string' || !transaction.id) {
    throw new TypeError('An acknowledged transaction requires an ID');
  }
  if (!Array.isArray(transaction.patches) || transaction.patches.length === 0) {
    throw new TypeError('An acknowledged transaction requires patches');
  }
  const { repairs: _repairs, ...base } = transaction;
  return {
    ...base,
    patches: transaction.patches.map((patch) => ({ ...patch })),
  };
}

function entry(transaction, repairs = transaction?.repairs || []) {
  return {
    transaction: cloneTransaction(transaction),
    repairs: Array.isArray(repairs) ? repairs.map((patch) => ({ ...patch })) : [],
  };
}

export function createSessionHistory({ sessionId = null, transactions = [] } = {}) {
  return {
    sessionId,
    past: transactions.map((value) => (
      value?.transaction ? entry(value.transaction, value.repairs) : entry(value, value?.repairs)
    )),
    future: [],
  };
}

export function scopeSessionHistory(history, sessionId) {
  if (history?.sessionId === sessionId) return history;
  return createSessionHistory({ sessionId });
}

export function acknowledgeSessionTransaction(history, transaction, { sessionId = history?.sessionId ?? null, repairs = [] } = {}) {
  if (!history || history.sessionId !== sessionId || NON_USER_SOURCES.has(transaction?.source)) return history;
  if (!Array.isArray(transaction?.patches) || transaction.patches.length === 0) return history;
  if (history.past.some((item) => item.transaction.id === transaction.id)) return history;
  return {
    ...history,
    past: [...history.past, entry(transaction, repairs)],
    future: [],
  };
}

export function undoSessionHistory(history) {
  const latest = history?.past?.at(-1) || null;
  if (!latest) return { history, transaction: null, repairs: [] };
  return {
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [latest, ...history.future],
    },
    transaction: latest.transaction,
    repairs: latest.repairs,
  };
}

export function redoSessionHistory(history) {
  const next = history?.future?.[0] || null;
  if (!next) return { history, transaction: null, repairs: [] };
  return {
    history: {
      ...history,
      past: [...history.past, next],
      future: history.future.slice(1),
    },
    transaction: next.transaction,
    repairs: next.repairs,
  };
}

export function sessionHistoryPatches(history) {
  return (history?.past || []).flatMap((item) => [...item.transaction.patches, ...item.repairs]);
}

export function sessionHistoryCount(history) {
  return history?.past?.length || 0;
}

export function sessionHistoryFromPatches(patches, { sessionId = null } = {}) {
  if (!Array.isArray(patches) || patches.length === 0) return createSessionHistory({ sessionId });
  const transactions = [];
  let current = [];
  let currentGroup = null;

  function flush() {
    if (!current.length) return;
    const first = current[0];
    transactions.push({
      id: `legacy:${first.groupId || first.id || transactions.length}`,
      requestId: `legacy-request:${first.groupId || first.id || transactions.length}`,
      source: 'legacy-lab',
      createdAt: first.createdAt || new Date(0).toISOString(),
      patches: current,
    });
    current = [];
    currentGroup = null;
  }

  patches.forEach((patch) => {
    const groupId = patch?.groupId || null;
    if (current.length && (!groupId || groupId !== currentGroup)) flush();
    current.push({ ...patch });
    currentGroup = groupId;
    if (!groupId) flush();
  });
  flush();
  return createSessionHistory({ sessionId, transactions });
}
