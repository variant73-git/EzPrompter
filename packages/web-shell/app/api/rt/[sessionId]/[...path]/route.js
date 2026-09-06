import { db } from '../../../../../lib/db.js';
import { requestHostname, requestOrigin } from '../../../../../lib/runtime-host-guard.js';
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

// Rate limit (Sol r3/r4 #6): teto de REQUESTS numa janela deslizante.
// ⚠️ DÍVIDA NOMEADA: o balde é por PROCESSO — numa implantação multi-instância
// cada uma concede o próprio orçamento (contador compartilhado = infra do
// launch, [[launch_cost_optimizations_deferred]]); o teto real interino é
// N instâncias × este teto. Um clone real abre ~370 assets UMA vez.
//
// ⭐ A CHAVE é o COOKIE, não o sessionId da URL, e SÓ depois do cookie existir
// (P1, audit 2026-09-02): um sessionId cru e ilimitado no path deixava um
// atacante SEM cookie semear um bucket permanente por valor distinto → OOM.
// Agora: sem cookie não semeia nada, e o Map tem TETO com evicção FIFO como o
// cache — o cookie também é atacante-controlado, então o teto é a trava real.
let RL_MAX = 600;
let RL_WINDOW_MS = 60_000;
let RL_MAX_KEYS = 4096;
const buckets = new Map(); // cookieValue -> { count, resetAt }
function rateLimited(cookieValue) {
  const now = Date.now();
  const b = buckets.get(cookieValue);
  if (!b || now > b.resetAt) {
    buckets.set(cookieValue, { count: 1, resetAt: now + RL_WINDOW_MS });
    if (buckets.size > RL_MAX_KEYS) buckets.delete(buckets.keys().next().value);
    return false;
  }
  b.count += 1;
  return b.count > RL_MAX;
}
export function __clearLeaseRateLimitForTests() { buckets.clear(); }
export function __leaseRateLimitSizeForTests() { return buckets.size; }
export function __setLeaseRateLimitForTests({ max, windowMs, maxKeys } = {}) {
  if (Number.isFinite(max)) RL_MAX = max;
  if (Number.isFinite(windowMs)) RL_WINDOW_MS = windowMs;
  if (Number.isFinite(maxKeys)) RL_MAX_KEYS = maxKeys;
}

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

  // Sem cookie: falha inerte ANTES do rate limit — um pedido sem credencial
  // não pode semear bucket (P1). O rate limit é por COOKIE, com teto de chaves.
  // `secure` pela MESMA fonte que o bootstrap usa ao gravar o cookie
  // (x-forwarded-proto → request.url): decidir pelo request.url aqui e pelo
  // proxy lá faria a rota procurar `uncraft_rt` onde o bootstrap gravou
  // `__Host-rt` → lease_missing.
  const cookieValue = readCookie(request, leaseCookieName({ secure: requestOrigin(request).startsWith('https://') }));
  if (!cookieValue) return inertFailure(request, 'lease_missing', null, 404, LEASE);
  if (rateLimited(cookieValue)) {
    return new Response(null, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  }

  let session = readCache(cookieValue);
  // P2a (audit 2026-09-02): no HIT do cache, o sessionId da URL e o host ainda
  // têm que casar com a lease atada ao cookie — senão as duas guardas de
  // defesa em profundidade lapsariam por 20s. É auto-conteúdo (cache por
  // cookie), mas o descasamento é anômalo → recusa inerte.
  if (session && (String(session.lease.edit_session_id) !== String(sessionId)
    || !runtimeRequestUsesSessionHost(request,session.lease.hostname))) {
    return inertFailure(request, 'lease_scope_mismatch', cookieValue, 404, LEASE);
  }
  if (!session) {
    let sql;
    try { sql = await db(); } catch { return inertFailure(request, 'database_unavailable', cookieValue, 503, LEASE); }
    let check;
    try {
      // Host pelo HEADER: `request.url` é localhost em dev (lição 167) e
      // comparava `localhost` com o host da sessão → host_mismatch inerte.
      check = await verifyLease({ sql, cookieValue, hostname: requestHostname(request), sessionId });
    } catch { return inertFailure(request, 'database_unavailable', cookieValue, 503, LEASE); }
    if (check.error) return inertFailure(request, `lease_${check.error}`, cookieValue, 404, LEASE);
    // O host da lease tem que ser o host do request (defesa em profundidade —
    // verifyLease já compara, e o guard de middleware também).
    if (!runtimeRequestUsesSessionHost(request,check.lease.hostname)) {
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
