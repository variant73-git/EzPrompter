// Client-side fetchers for canvas API. All requests use credentials:'include'
// so the session cookie travels.
const COMMON = { credentials: 'include', headers: { 'content-type': 'application/json' } };

async function jsonOrThrow(r) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.detail || j?.error || `${r.status} ${r.statusText}`);
  return j;
}

export const api = {
  listBoards: () => fetch('/api/boards', COMMON).then(jsonOrThrow),
  createBoard: (name = 'Untitled') => fetch('/api/boards', { ...COMMON, method: 'POST', body: JSON.stringify({ name }) }).then(jsonOrThrow),
  getBoard: (id) => fetch(`/api/boards/${id}`, COMMON).then(jsonOrThrow),
  renameBoard: (id, name) => fetch(`/api/boards/${id}`, { ...COMMON, method: 'PATCH', body: JSON.stringify({ name }) }).then(jsonOrThrow),
  deleteBoard: (id) => fetch(`/api/boards/${id}`, { ...COMMON, method: 'DELETE' }).then(jsonOrThrow),

  createNode: (body) => fetch('/api/nodes', { ...COMMON, method: 'POST', body: JSON.stringify(body) }).then(jsonOrThrow),
  updateNode: (id, body) => fetch(`/api/nodes/${id}`, { ...COMMON, method: 'PATCH', body: JSON.stringify(body) }).then(jsonOrThrow),
  resetNode: (id) => fetch(`/api/nodes/${id}/reset`, { ...COMMON, method: 'POST' }).then(jsonOrThrow),
  deleteNode: (id) => fetch(`/api/nodes/${id}`, { ...COMMON, method: 'DELETE' }).then(jsonOrThrow),

  createEdge: (body) => fetch('/api/edges', { ...COMMON, method: 'POST', body: JSON.stringify(body) }).then(jsonOrThrow),
  updateEdge: (id, body) => fetch(`/api/edges/${id}`, { ...COMMON, method: 'PATCH', body: JSON.stringify(body) }).then(jsonOrThrow),
  deleteEdge: (id) => fetch(`/api/edges/${id}`, { ...COMMON, method: 'DELETE' }).then(jsonOrThrow),
  applyEdge: (id) => fetch(`/api/edges/${id}/apply`, { ...COMMON, method: 'POST' }).then(jsonOrThrow),

  captureUrl: (url, nodeId = null) => fetch('/api/snapshot/capture', { ...COMMON, method: 'POST', body: JSON.stringify({ url, nodeId }) }).then(jsonOrThrow),
  saveNodeEdit: (nodeId, html) => fetch(`/api/nodes/${nodeId}/save-edit`, { ...COMMON, method: 'POST', body: JSON.stringify({ html }) }).then(jsonOrThrow),
  runNode: (nodeId) => fetch(`/api/nodes/${nodeId}/run`, { ...COMMON, method: 'POST' }).then(jsonOrThrow),

  logout: () => fetch('/api/auth/logout', { ...COMMON, method: 'POST' }).then(jsonOrThrow)
};
