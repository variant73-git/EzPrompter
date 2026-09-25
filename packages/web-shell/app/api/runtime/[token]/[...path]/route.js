import { createHash } from 'node:crypto';
import { db } from '../../../../../lib/db.js';
import { createConfiguredBundleStore } from '../../../../../lib/native-clone/bundle-store.js';
import {
  inertFailure,
  serveRuntimeAsset,
  uploadStorageKey,
} from '../../../../../lib/motion-editor/runtime-gateway-core.js';
import {
  runtimeRequestUsesConfiguredOrigin,
  verifyRuntimeSessionToken,
} from '../../../../../lib/motion-editor/runtime-session-token.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Rota LEGADA (token-no-path, origem opaca): autoriza pelo JWT do caminho e
// delega o serviço do asset ao core compartilhado (runtime-gateway-core.js).
// O caminho lease-em-cookie vive em /api/rt e usa o MESMO core.

// ── UPLOAD de imagem NOVA, por nó ────────────────────────────────────────────
// O editor vive numa origem opaca sem cookies: a única credencial dele é o
// token da sessão no caminho — o mesmo que autoriza cada GET. O upload é
// guardado POR NÓ (sobrevive à rotação de sessão e ao re-clone), com nome por
// HASH do conteúdo, e só raster FAREJADO pelos bytes mágicos: o content-type
// do cliente é desejo, não fato; SVG fica fora (carrega script).
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
const UPLOAD_TIPOS = [
  { ext: 'png', mime: 'image/png', magica: (b2) => b2.length > 7 && b2[0] === 0x89 && b2[1] === 0x50 && b2[2] === 0x4e && b2[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', magica: (b2) => b2.length > 2 && b2[0] === 0xff && b2[1] === 0xd8 && b2[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', magica: (b2) => b2.length > 5 && b2[0] === 0x47 && b2[1] === 0x49 && b2[2] === 0x46 && b2[3] === 0x38 },
  { ext: 'webp', mime: 'image/webp', magica: (b2) => b2.length > 11 && b2[0] === 0x52 && b2[1] === 0x49 && b2[2] === 0x46 && b2[3] === 0x46 && b2[8] === 0x57 && b2[9] === 0x45 && b2[10] === 0x42 && b2[11] === 0x50 },
  { ext: 'avif', mime: 'image/avif', magica: (b2) => b2.length > 11 && b2[4] === 0x66 && b2[5] === 0x74 && b2[6] === 0x79 && b2[7] === 0x70 && b2[8] === 0x61 && b2[9] === 0x76 && b2[10] === 0x69 && b2[11] === 0x66 },
];

async function autorizarPorToken(request, resolved) {
  const token = resolved?.token;
  if (!runtimeRequestUsesConfiguredOrigin(request.url)) {
    return { falha: inertFailure(request, 'wrong_runtime_origin', token) };
  }
  const verification = verifyRuntimeSessionToken(token);
  if (verification.error) return { falha: inertFailure(request, `token_${verification.error}`, token) };
  return { token, payload: verification.payload };
}

// A origem do editor é OPACA: todo fetch dele chega com Origin: null, e um
// POST de Blob image/* dispara preflight. Sem OPTIONS + ACAO a resposta nem é
// LEGÍVEL do lado de lá (o upload cairia sempre no fallback). Sem credencial
// em cabeçalho — a capacidade É o token no caminho — ACAO '*' é seguro.
const CORS_UPLOADS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
function comCors(resposta) {
  for (const [k, v] of Object.entries(CORS_UPLOADS)) resposta.headers.set(k, v);
  return resposta;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_UPLOADS });
}

export async function POST(request, { params }) {
  const resolved = await params;
  const auth = await autorizarPorToken(request, resolved);
  if (auth.falha) return auth.falha;
  const { token, payload } = auth;
  const caminho = Array.isArray(resolved?.path) ? resolved.path.join('/') : String(resolved?.path || '');
  if (caminho !== '_uploads') return inertFailure(request, 'asset_unavailable', token);

  let sql;
  try { sql = await db(); } catch { return inertFailure(request, 'database_unavailable', token, 503); }
  let rows;
  try {
    rows = await sql`
      SELECT e.id AS session_id, e.node_id
        FROM native_motion_edit_sessions e
       WHERE e.id = ${payload.sessionId}
         AND e.node_id = ${payload.nodeId}
         AND e.status = 'active'
         AND e.expires_at > NOW()
    `;
  } catch { return inertFailure(request, 'database_unavailable', token, 503); }
  if (!rows[0]) return inertFailure(request, 'session_scope_mismatch', token);

  // Teto ANTES de materializar quando o cabeçalho existe; e sempre depois.
  const declarado = Number(request.headers.get('content-length') || 0);
  if (declarado > UPLOAD_MAX_BYTES) return comCors(new Response(null, { status: 413 }));
  let corpo;
  try { corpo = new Uint8Array(await request.arrayBuffer()); } catch { return comCors(new Response(null, { status: 400 })); }
  if (!corpo.length) return comCors(new Response(null, { status: 400 }));
  if (corpo.length > UPLOAD_MAX_BYTES) return comCors(new Response(null, { status: 413 }));
  const tipo = UPLOAD_TIPOS.find((t) => t.magica(corpo));
  if (!tipo) return comCors(new Response(JSON.stringify({ error: 'unsupported_image' }), { status: 415, headers: { 'content-type': 'application/json' } }));

  const hash = createHash('sha256').update(corpo).digest('hex').slice(0, 32);
  const nome = `${hash}.${tipo.ext}`;
  const store = createConfiguredBundleStore();
  try {
    // putImmutable: mesmo conteúdo sob o mesmo nome é no-op idempotente (e o
    // nome É o hash do conteúdo, então colisão de nome com bytes diferentes
    // não existe por construção).
    await store.putImmutable({
      storageKey: uploadStorageKey(payload.nodeId, nome),
      body: corpo,
      contentType: tipo.mime,
      contentHash: `sha256:${createHash('sha256').update(corpo).digest('hex')}`,
    });
  } catch (e) {
    return comCors(new Response(null, { status: 500 }));
  }
  return comCors(new Response(JSON.stringify({ path: `./_uploads/${nome}` }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
}

// ⚠️ O CUSTO DO PORTÃO: uma consulta ao banco POR ARQUIVO — e a resposta
// carregava a linha INTEIRA (asset_index de centenas de itens + manifesto)
// toda vez. Um clone aberto ≈ 370 consultas ≈ dezenas de MB de tráfego POR
// ABERTURA; foi isso que estourou a cota do Neon em dois dias de provas.
// Cache por TOKEN com TTL curto: a 1ª consulta paga, as demais leem daqui.
//
// TRADEOFF DECLARADO: a revogação (status/expires na LINHA, decisão de
// 2026-08-20) passa a valer em até TTL segundos — 20s contra um token de 4h,
// na mesma classe do cache do navegador que já não a via. Falha NÃO entra no
// cache (miss recusado volta ao banco no pedido seguinte).
const CACHE_SESSAO_TTL_MS = 20_000;
const CACHE_SESSAO_MAX = 64;
const cacheDeSessao = new Map();   // token -> { row, at }
function lerSessaoDoCache(token) {
  const hit = cacheDeSessao.get(token);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_SESSAO_TTL_MS) { cacheDeSessao.delete(token); return null; }
  return hit.row;
}
/** Só para testes: o cache é de módulo e vazaria entre casos. */
export function __limparCacheDeSessaoParaTestes() {
  cacheDeSessao.clear();
}
/** Só para testes: prova do teto sem expor o Map. */
export function __tamanhoDoCacheParaTestes() {
  return cacheDeSessao.size;
}

function guardarSessaoNoCache(token, row) {
  cacheDeSessao.set(token, { row, at: Date.now() });
  if (cacheDeSessao.size > CACHE_SESSAO_MAX) {
    cacheDeSessao.delete(cacheDeSessao.keys().next().value);
  }
}

export async function GET(request, { params }) {
  const resolved = await params;
  const token = resolved?.token;
  if (!runtimeRequestUsesConfiguredOrigin(request.url)) {
    return inertFailure(request, 'wrong_runtime_origin', token);
  }
  const verification = verifyRuntimeSessionToken(token);
  if (verification.error) return inertFailure(request, `token_${verification.error}`, token);
  const payload = verification.payload;

  const emCache = lerSessaoDoCache(token);
  // Hit no cache NÃO toca o banco — nem o handle: pegar `db()` no hit fazia
  // um hit falhar 503 com banco fora, e o cache existe exatamente para o
  // pedido não depender do banco (Sol).
  let rows;
  try {
    let sql;
    if (!emCache) sql = await db();
    rows = emCache ? [emCache] : await sql`
      SELECT e.id AS session_id, e.node_id, e.status AS session_status, e.draft_manifest,
             nb.bundle_id, nb.schema_version, nb.storage_key, nb.content_hash,
             nb.entry_path, nb.asset_index, nb.runtime_fingerprint,
             nb.reconstruction_capabilities
        FROM native_motion_edit_sessions e
        JOIN snapshots s ON s.id = e.base_snapshot_id AND s.node_id = e.node_id
        JOIN nodes n ON n.id = e.node_id AND n.current_snapshot_id = s.id
        JOIN native_bundles nb ON nb.bundle_id = s.native_bundle_id
       WHERE e.id = ${payload.sessionId}
         AND e.node_id = ${payload.nodeId}
         AND e.status = 'active'
         AND e.expires_at > NOW()
         AND nb.bundle_id = ${payload.bundleId}
    `;
  } catch {
    return inertFailure(request, 'database_unavailable', token, 503);
  }
  const row = rows[0];
  if (!row) return inertFailure(request, 'session_scope_mismatch', token);
  if (!emCache) guardarSessaoNoCache(token, row);

  return serveRuntimeAsset({
    request,
    pathSegments: resolved?.path,
    row,
    payload,
    runtimeBase: `/api/runtime/${encodeURIComponent(token)}`,
    credential: token,
    corsWildcard: true,
  });
}
