// Client-side fetchers for canvas API. All requests use credentials:'include'
// so the session cookie travels.
const COMMON = { credentials: 'include', headers: { 'content-type': 'application/json' } };

async function jsonOrThrow(r) {
  const j = await r.json().catch(() => ({}));
  if (r.status === 402) {
    // Billing block — typed so callers can open the insufficient-credits modal.
    const err = new Error(j?.error || 'insufficient_credits');
    err.code = 'insufficient_credits';
    err.estimate = j?.estimate;
    err.balance = j?.balance;
    throw err;
  }
  // Surface the server's clean message (e.g. the extract route's timeout text)
  // — not only the generic `error` code — so a route-deadline timeout reads as
  // "timed out", not an opaque "extract_failed".
  if (!r.ok) throw new Error(j?.detail || j?.message || j?.error || `${r.status} ${r.statusText}`);
  if (j?.balanceAfter != null && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('uncraft:balance', { detail: { balance: j.balanceAfter } }));
  }
  return j;
}

// Extract runs a full LLM pass server-side; bound it client-side so a stuck
// backend call surfaces a clear timeout instead of an indefinite loader. Kept
// well ABOVE the server's route deadline (extract route
// EXTRACT_ROUTE_DEADLINE_MS, default 150s, clamped ≤170s — which bounds the
// WHOLE multi-call extract absolutely from handler entry, not just one call),
// leaving ~30s headroom for pre-work + persistence so the server's own clean,
// refunded error always wins and the client never aborts a still-billing
// request. Raise both together if you raise the route deadline.
const EXTRACT_TIMEOUT_MS = 200_000;

async function fetchWithTimeout(url, opts = {}, ms = EXTRACT_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error(`Request timed out after ${Math.round(ms / 1000)}s — the extraction did not finish. Try again.`);
      err.code = 'client_timeout';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  listBoards: () => fetch('/api/boards', COMMON).then(jsonOrThrow),
  createBoard: (name = 'Untitled') => fetch('/api/boards', { ...COMMON, method: 'POST', body: JSON.stringify({ name }) }).then(jsonOrThrow),
  // `light:true` skips the snapshot JOIN — nodes come back without
  // current_html/current_design_md/current_screenshot. Use when only
  // metadata is needed (e.g. post-agent-mutation refetch).
  getBoard: (id, { light = false } = {}) =>
    fetch(`/api/boards/${id}${light ? '?light=1' : ''}`, COMMON).then(jsonOrThrow),
  renameBoard: (id, name) => fetch(`/api/boards/${id}`, { ...COMMON, method: 'PATCH', body: JSON.stringify({ name }) }).then(jsonOrThrow),
  deleteBoard: (id) => fetch(`/api/boards/${id}`, { ...COMMON, method: 'DELETE' }).then(jsonOrThrow),

  listWorkflows: () => fetch('/api/workflows', COMMON).then(jsonOrThrow),
  saveWorkflow: (boardId, name, description) => fetch('/api/workflows', {
    ...COMMON,
    method: 'POST',
    body: JSON.stringify({ boardId, name, description })
  }).then(jsonOrThrow),

  createNode: (body) => fetch('/api/nodes', { ...COMMON, method: 'POST', body: JSON.stringify(body) }).then(jsonOrThrow),
  updateNode: (id, body) => fetch(`/api/nodes/${id}`, { ...COMMON, method: 'PATCH', body: JSON.stringify(body) }).then(jsonOrThrow),
  resetNode: (id) => fetch(`/api/nodes/${id}/reset`, { ...COMMON, method: 'POST' }).then(jsonOrThrow),
  deleteNode: (id) => fetch(`/api/nodes/${id}`, { ...COMMON, method: 'DELETE' }).then(jsonOrThrow),

  createEdge: (body) => fetch('/api/edges', { ...COMMON, method: 'POST', body: JSON.stringify(body) }).then(jsonOrThrow),
  updateEdge: (id, body) => fetch(`/api/edges/${id}`, { ...COMMON, method: 'PATCH', body: JSON.stringify(body) }).then(jsonOrThrow),
  deleteEdge: (id) => fetch(`/api/edges/${id}`, { ...COMMON, method: 'DELETE' }).then(jsonOrThrow),
  applyEdge: (id) => fetch(`/api/edges/${id}/apply`, { ...COMMON, method: 'POST' }).then(jsonOrThrow),

  captureUrl: (url, nodeId = null) => fetch('/api/snapshot/capture', { ...COMMON, method: 'POST', body: JSON.stringify({ url, nodeId }) }).then(jsonOrThrow),

  /**
   * Streaming capture: emits progress events as the snapshot/reconstruction
   * runs through stages. Final payload identical to captureUrl().
   * @param {string} url
   * @param {string|null} nodeId
   * @param {(step: string) => void} onProgress — called with stage names
   *   like 'navigating', 'capturing', 'thinking', 'finalizing'.
   */
  /**
   * @param {string} url
   * @param {string|null} nodeId
   * @param {(step: string) => void} onProgress
   * @param {{boardId, posX, posY, width, height, isMain}|null} placement
   *   When set, server pre-creates a placeholder node on bot-challenge so
   *   the handoff flow has a persisted target.
   */
  captureUrlStream: async (url, nodeId = null, onProgress, placement = null) => {
    const res = await fetch('/api/snapshot/capture', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ url, nodeId, placement })
    });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.detail || j?.error || `${res.status} ${res.statusText}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames separated by blank line.
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const eventLine = /^event:\s*(\S+)/m.exec(frame);
        const dataLine = /^data:\s*(.+)$/m.exec(frame);
        if (!dataLine) continue;
        let data;
        try { data = JSON.parse(dataLine[1]); } catch { continue; }
        const event = eventLine?.[1] || 'message';
        if (event === 'progress') { try { onProgress?.(data.step); } catch (e) {} }
        else if (event === 'done') return data;
        else if (event === 'challenge') {
          // Bot-protection interstitial. Surface as a typed error the
          // caller catches and routes to the ChallengeModal handoff flow.
          // We attach the payload so the modal knows kind, url, signals.
          const err = new Error(`challenge_required:${data.kind}`);
          err.challenge = data;
          throw err;
        }
        else if (event === 'error') throw new Error(data.detail || data.error || 'capture failed');
      }
    }
    throw new Error('Stream ended without a done event');
  },
  saveNodeEdit: (nodeId, html) => fetch(`/api/nodes/${nodeId}/save-edit`, { ...COMMON, method: 'POST', body: JSON.stringify({ html }) }).then(jsonOrThrow),
  // Same route, content-shaped body — used by the unpopulated-node upload
  // flow to seed { html } or { designMd } into an existing node.
  saveNodeContent: (nodeId, body) => fetch(`/api/nodes/${nodeId}/save-edit`, { ...COMMON, method: 'POST', body: JSON.stringify(body) }).then(jsonOrThrow),
  // `signal` lets the caller abort an in-flight run (the Stop button). The
  // client stops waiting immediately and never applies the result, so the
  // node keeps its pre-run state. (The server may still finish the compose;
  // true server-side cancellation is a separate backend concern.)
  runNode: (nodeId, opts = {}, signal) => fetch(`/api/nodes/${nodeId}/run`, { ...COMMON, method: 'POST', body: JSON.stringify(opts), signal }).then(jsonOrThrow),
  // Deferred billed upgrade of an animated free capture. Called when Edit
  // needs an editable runtime; strict workflow dependencies invoke the same
  // reconstruction service inside the server-side run route.
  reconstructNode: (nodeId) => fetch(`/api/nodes/${nodeId}/reconstruct`, { ...COMMON, method: 'POST' }).then(jsonOrThrow),
  // Default: node row + current snapshot html (one round-trip when caller
  // actually wants content). `readyCheck:true`: tiny `{ready, snapshotId}`
  // probe used by the handoff poller — avoids transferring snapshot.html
  // on every 3s tick.
  getNode: (nodeId, { readyCheck = false } = {}) =>
    fetch(
      `/api/nodes/${nodeId}${readyCheck ? '?ready_check=1' : ''}`,
      { ...COMMON, method: 'GET' }
    ).then(jsonOrThrow),

  extractNode: (id, { to, posX, posY }) => fetchWithTimeout(`/api/nodes/${id}/extract`, { ...COMMON, method: 'POST', body: JSON.stringify({ to, posX, posY }) }).then(jsonOrThrow),

  // Version history (site nodes). listSnapshots = light metadata only; getSnapshot
  // pulls one version's html/screenshot on demand (preview + thumbnail);
  // restoreVersion moves current_snapshot_id to a chosen version.
  listSnapshots: (nodeId) => fetch(`/api/nodes/${nodeId}/snapshots`, { ...COMMON, method: 'GET' }).then(jsonOrThrow),
  getSnapshot: (nodeId, snapId) => fetch(`/api/nodes/${nodeId}/snapshots/${snapId}`, { ...COMMON, method: 'GET' }).then(jsonOrThrow),
  restoreVersion: (nodeId, snapshotId) => fetch(`/api/nodes/${nodeId}/restore-version`, { ...COMMON, method: 'POST', body: JSON.stringify({ snapshotId }) }).then(jsonOrThrow),
  deleteSnapshot: (nodeId, snapId) => fetch(`/api/nodes/${nodeId}/snapshots/${snapId}`, { ...COMMON, method: 'DELETE' }).then(jsonOrThrow),

  logout: () => fetch('/api/auth/logout', { ...COMMON, method: 'POST' }).then(jsonOrThrow)
};
