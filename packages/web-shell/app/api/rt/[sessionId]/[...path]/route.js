import { db } from '../../../../../lib/db.js';
import { inertFailure, serveRuntimeAsset } from '../../../../../lib/motion-editor/runtime-gateway-core.js';
import {
  deriveLeaseNonce,
  leaseCookieName,
  runtimeRequestUsesSessionHost,
  verifyLease,
} from '../../../../../lib/motion-editor/runtime-lease.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LEASE = { corsWildcard: false };

function leaseEnabled() {
  return process.env.UNCRAFT_RUNTIME_LEASE === '1';
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function entryPrefixOf(entryPath) {
  return entryPath.includes('/') ? entryPath.slice(0, entryPath.lastIndexOf('/')) : '';
}

// ⚠️ MESMA classe de custo da rota legada: uma consulta ao banco POR ARQUIVO
// estouraria a cota (foi o que estourou o Neon). Cache {lease,row} por VALOR do
// cookie, TTL curto: 1ª consulta paga, as demais leem daqui. Revogação passa a
// valer em até TTL segundos — mesma dívida deliberada do legado.
const CACHE_TTL_MS = 20_000;
const CACHE_MAX = 64;
const cache = new Map(); // cookieValue -> { lease, row, at }
function readCache(cookieValue) {
  const hit = cache.get(cookieValue);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(cookieValue); return null; }
  return hit;
}
function writeCache(cookieValue, entry) {
  cache.set(cookieValue, { ...entry, at: Date.now() });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}
/** Só para testes: o cache é de módulo e vazaria entre casos. */
export function __clearLeaseGatewayCacheForTests() { cache.clear(); }

// Rate limit por sessão (Sol r3/r4 #6): teto de REQUESTS numa janela deslizante.
// ⚠️ DÍVIDA NOMEADA: o balde é por PROCESSO — numa implantação multi-instância
// cada uma concede o próprio orçamento (contador compartilhado = infra do
// launch, [[launch_cost_optimizations_deferred]]); o teto real interino é
// N instâncias × este teto. Um clone real abre ~370 assets UMA vez.
const RL_MAX = 600;
const RL_WINDOW_MS = 60_000;
const buckets = new Map(); // sessionId -> { count, resetAt }
function rateLimited(sessionId) {
  const now = Date.now();
  const b = buckets.get(sessionId);
  if (!b || now > b.resetAt) { buckets.set(sessionId, { count: 1, resetAt: now + RL_WINDOW_MS }); return false; }
  b.count += 1;
  return b.count > RL_MAX;
}
export function __clearLeaseRateLimitForTests() { buckets.clear(); }

async function loadBundleRow(sql, lease) {
  const rows = await sql`
    SELECT e.id AS session_id, e.node_id, e.status AS session_status, e.draft_manifest,
           nb.bundle_id, nb.schema_version, nb.storage_key, nb.content_hash,
           nb.entry_path, nb.asset_index, nb.runtime_fingerprint,
           nb.reconstruction_capabilities
      FROM native_motion_edit_sessions e
      JOIN snapshots s ON s.id = e.base_snapshot_id AND s.node_id = e.node_id
      JOIN nodes n ON n.id = e.node_id AND n.current_snapshot_id = s.id
      JOIN native_bundles nb ON nb.bundle_id = s.native_bundle_id
     WHERE e.id = ${lease.edit_session_id}
       AND e.node_id = ${lease.node_id}
       AND e.status = 'active'
       AND e.expires_at > NOW()
       AND nb.bundle_id = ${lease.bundle_id}
  `;
  return rows[0] || null;
}

export async function POST(request, { params }) {
  // Upload NÃO mora aqui — a lease autoriza só GET/HEAD (Sol r2 §3.3.2). O
  // upload atravessa o parent app-authed (Task 12).
  const { sessionId } = await params;
  return inertFailure(request, 'method_not_allowed', sessionId, 404, LEASE);
}

export async function GET(request, { params }) {
  if (!leaseEnabled()) return inertFailure(request, 'lease_disabled', null, 404, LEASE);
  const { sessionId, path } = await params;

  // Query string → 301 para o caminho canônico SEM query. O gateway resolve
  // asset por PATH (a query nunca fez parte da identidade), então isto é
  // equivalência com colapso de cache-buster (Sol r4 #6). Incondicional à
  // lease (nenhum oráculo); o destino não tem query, logo não loopa.
  const url = new URL(request.url);
  if (url.search) {
    const clean = `/api/rt/${encodeURIComponent(sessionId)}/${(Array.isArray(path) ? path : [path]).map(encodeURIComponent).join('/')}`;
    return new Response(null, {
      status: 301,
      headers: { Location: clean, 'Cache-Control': 'private, max-age=300' },
    });
  }

  if (rateLimited(sessionId)) {
    return new Response(null, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  }

  const cookieValue = readCookie(request, leaseCookieName({ secure: url.protocol === 'https:' }));
  if (!cookieValue) return inertFailure(request, 'lease_missing', null, 404, LEASE);

  let session = readCache(cookieValue);
  if (!session) {
    let sql;
    try { sql = await db(); } catch { return inertFailure(request, 'database_unavailable', cookieValue, 503, LEASE); }
    let check;
    try {
      check = await verifyLease({ sql, cookieValue, hostname: new URL(request.url).hostname, sessionId });
    } catch { return inertFailure(request, 'database_unavailable', cookieValue, 503, LEASE); }
    if (check.error) return inertFailure(request, `lease_${check.error}`, cookieValue, 404, LEASE);
    // O host da lease tem que ser o host do request (defesa em profundidade —
    // verifyLease já compara, e o guard de middleware também).
    if (!runtimeRequestUsesSessionHost(request.url, check.lease.hostname)) {
      return inertFailure(request, 'lease_host_mismatch', cookieValue, 404, LEASE);
    }
    let row;
    try { row = await loadBundleRow(sql, check.lease); } catch { return inertFailure(request, 'database_unavailable', cookieValue, 503, LEASE); }
    if (!row) return inertFailure(request, 'session_scope_mismatch', cookieValue, 404, LEASE);
    session = { lease: check.lease, row };
    writeCache(cookieValue, session);
  }

  const { lease, row } = session;
  const payload = {
    sessionId,
    nodeId: lease.node_id,
    bundleId: lease.bundle_id,
    entryPrefix: entryPrefixOf(row.entry_path),
    nonce: deriveLeaseNonce(sessionId),
    expiresAtMs: new Date(lease.expires_at).getTime(),
  };

  return serveRuntimeAsset({
    request,
    pathSegments: path,
    row,
    payload,
    runtimeBase: `/api/rt/${encodeURIComponent(sessionId)}`,
    credential: cookieValue,
    corsWildcard: false,
  });
}
