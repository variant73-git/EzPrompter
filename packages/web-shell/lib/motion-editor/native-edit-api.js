const MANIFEST_SCHEMA_VERSION = 2;
const COMMIT_REASONS = new Set(['exit', 'save-version', 'before-structural-operation']);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSource(source) {
  if (source === 'runtime-inline-text' || source === 'runtime-layout') return 'properties';
  return source;
}

function manifestTransaction(value) {
  const transaction = value?.transaction || value;
  const repairs = value?.repairs || transaction?.repairs || transaction?.automaticRepairs || [];
  return {
    id: transaction.id,
    createdAt: transaction.createdAt,
    source: normalizeSource(transaction.source),
    patches: cloneJson(transaction.patches || []),
    automaticRepairs: cloneJson(repairs),
  };
}

function draftFromHistory(base, transactions) {
  return {
    ...cloneJson(base),
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    transactions: (transactions || []).map(manifestTransaction),
  };
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (response.ok) return body;
  const error = new Error(body?.error || body?.message || 'native_edit_request_failed');
  error.code = body?.error || 'native_edit_request_failed';
  error.status = response.status;
  if (body?.currentRevision != null) error.currentRevision = Number(body.currentRevision);
  throw error;
}

function publicSession(input) {
  if (!input || typeof input !== 'object' || !input.id) {
    throw new Error('native_edit_session_unavailable');
  }
  return cloneJson(input);
}

export function applyNativeCommitSnapshot(node, result) {
  if (!node || !result?.snapshot?.id) return node;
  return {
    ...node,
    current_snapshot_id: result.snapshot.id,
    current_native_bundle_id: result.snapshot.nativeBundleId,
    current_motion_manifest_version: result.snapshot.motionManifestVersion,
    current_snapshot_source: 'native-edit',
    _resetTick: (node._resetTick || 0) + 1,
  };
}

export function createNativeEditApi({
  nodeId,
  fetcher = (...args) => globalThis.fetch(...args),
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearSchedule = (token) => globalThis.clearTimeout(token),
  debounceMs = 180,
  retryBaseMs = 500,
  retryMaxMs = 8000,
} = {}) {
  if (typeof nodeId !== 'string' || !nodeId) throw new TypeError('A nodeId is required');
  const root = `/api/nodes/${encodeURIComponent(nodeId)}/motion-session`;
  const subscribers = new Set();
  let session = null;
  let openPromise = null;
  let desiredManifest = null;
  let localVersion = 0;
  let savedVersion = 0;
  let inFlight = null;
  let debounceTimer = null;
  let retryTimer = null;
  let retryAttempt = 0;
  let status = 'idle';
  let lastError = null;
  let closed = false;
  let closing = false;
  let disposed = false;

  function getState() {
    return {
      sessionId: session?.id || null,
      baseSnapshotId: session?.baseSnapshotId || null,
      baseBundleId: session?.baseBundleId || desiredManifest?.baseBundleId || null,
      revision: session?.revision ?? null,
      pending: localVersion > savedVersion,
      retryAttempt,
      status,
      lastError,
      closed,
    };
  }

  function publish() {
    const next = getState();
    subscribers.forEach((subscriber) => subscriber(next));
  }

  function setStatus(next, error = null) {
    status = next;
    lastError = error;
    publish();
  }

  function request(url, method, body, { keepalive = false } = {}) {
    return fetcher(url, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      keepalive,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).then(responseJson);
  }

  async function open() {
    if (session && !closed) return session;
    if (openPromise) return openPromise;
    openPromise = request(root, 'POST').then((body) => {
      session = publicSession(body.session);
      desiredManifest = cloneJson(session.draftManifest);
      localVersion = 0;
      savedVersion = 0;
      retryAttempt = 0;
      closed = false;
      setStatus('idle');
      return session;
    }).finally(() => {
      openPromise = null;
    });
    return openPromise;
  }

  function clearTimer(kind) {
    const token = kind === 'retry' ? retryTimer : debounceTimer;
    if (token != null) clearSchedule(token);
    if (kind === 'retry') retryTimer = null;
    else debounceTimer = null;
  }

  function scheduleRetry() {
    if (closed || closing || disposed) return;
    clearTimer('retry');
    const delay = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.max(0, retryAttempt - 1)));
    retryTimer = schedule(() => {
      retryTimer = null;
      return flush().catch(() => null);
    }, delay);
  }

  function scheduleAutosave() {
    if (debounceTimer != null || closed || closing || disposed) return;
    debounceTimer = schedule(() => {
      debounceTimer = null;
      return flush().catch(() => null);
    }, debounceMs);
  }

  async function save({ transactions = [] } = {}) {
    const current = await open();
    desiredManifest = draftFromHistory(desiredManifest || current.draftManifest, transactions);
    localVersion += 1;
    if (status === 'saved') status = 'idle';
    publish();
    scheduleAutosave();
    return desiredManifest;
  }

  async function flush({ keepalive = false } = {}) {
    clearTimer('debounce');
    clearTimer('retry');
    await open();
    if (closed || savedVersion >= localVersion) return session;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      while (!closed && savedVersion < localVersion) {
        const targetVersion = localVersion;
        const manifest = cloneJson(desiredManifest);
        setStatus('saving');
        try {
          const body = await request(root, 'PATCH', {
            sessionId: session.id,
            expectedRevision: session.revision,
            draftManifest: manifest,
          }, { keepalive });
          session = publicSession(body.session);
          desiredManifest = localVersion === targetVersion
            ? cloneJson(session.draftManifest)
            : desiredManifest;
          savedVersion = targetVersion;
          retryAttempt = 0;
        } catch (error) {
          retryAttempt += 1;
          setStatus('error', error);
          if (!error.status || error.status >= 500) scheduleRetry();
          throw error;
        }
      }
      setStatus('saved');
      return session;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function commit({ reason = 'exit' } = {}) {
    if (!COMMIT_REASONS.has(reason)) throw new TypeError('Unsupported native edit commit reason');
    await flush();
    const body = await request(`${root}/commit`, 'POST', {
      sessionId: session.id,
      expectedRevision: session.revision,
      reason,
    });
    session = publicSession(body.session);
    closed = session.status !== 'active';
    localVersion = 0;
    savedVersion = 0;
    retryAttempt = 0;
    setStatus('saved');
    return body;
  }

  async function discard() {
    closing = true;
    clearTimer('debounce');
    clearTimer('retry');
    if (inFlight) await inFlight.catch(() => null);
    clearTimer('retry');
    try {
      await open();
      const body = await request(`${root}/discard`, 'POST', { sessionId: session.id });
      session = publicSession(body.session);
      closed = true;
      localVersion = savedVersion;
      retryAttempt = 0;
      setStatus('idle');
      return body;
    } catch (error) {
      setStatus('error', error);
      throw error;
    } finally {
      closing = false;
      if (!closed && localVersion > savedVersion) scheduleRetry();
    }
  }

  function subscribe(subscriber) {
    if (typeof subscriber !== 'function') return () => {};
    subscribers.add(subscriber);
    subscriber(getState());
    return () => subscribers.delete(subscriber);
  }

  function dispose({ flushPending = true } = {}) {
    clearTimer('debounce');
    clearTimer('retry');
    disposed = true;
    if (flushPending && !closed && localVersion > savedVersion) {
      void flush({ keepalive: true }).catch(() => null);
    }
    subscribers.clear();
  }

  return {
    autosave: true,
    open,
    load: async () => {
      const current = await open();
      return {
        manifest: cloneJson(current.draftManifest),
        transactions: cloneJson(current.draftManifest.transactions || []),
        session: cloneJson(current),
      };
    },
    save,
    flush,
    commit,
    discard,
    subscribe,
    getState,
    dispose,
  };
}
