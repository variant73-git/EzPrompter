import { createHash } from 'node:crypto';
import { db } from '../../../../../lib/db.js';
import {
  normalizeBundlePath,
  parseNativeBundleDescriptor,
} from '../../../../../lib/native-clone/bundle-contract.js';
import {
  createConfiguredBundleStore,
  indexedAssetKey,
} from '../../../../../lib/native-clone/bundle-store.js';
import { parseByteRange, rangeHeaders } from '../../../../../lib/native-clone/byte-range.js';
import { parseMotionManifest } from '../../../../../lib/motion-editor/manifest.js';
import {
  injectRuntimeBridge,
  rewriteRuntimePaths,
} from '../../../../../lib/motion-editor/native-clone-gateway.js';
import {
  runtimeRequestUsesConfiguredOrigin,
  verifyRuntimeSessionToken,
} from '../../../../../lib/motion-editor/runtime-session-token.js';
import { MOTIVOS_DE_FALHA } from '../../../../../lib/motion-editor/runtime-failure-reasons.js';
import { translateRuntimeOrigins, translateRuntimeOriginsInHtml, translateRuntimeOriginsInJson, origensDoBundle } from '../../../../../lib/native-clone/translate-runtime-origins.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function tokenDigest(token) {
  return createHash('sha256').update(String(token || '')).digest('hex').slice(0, 12);
}

function recordFailure(reason, token) {
  if (process.env.NODE_ENV === 'test') return;
  console.warn('Native runtime gateway load failed', { reason, tokenDigest: tokenDigest(token) });
}

function appFrameAncestor(request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return new URL(request.url).origin;
  try {
    return new URL(configured).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

function contentSecurityPolicy(request) {
  const runtimeOrigin = new URL(request.url).origin;
  const appOrigin = appFrameAncestor(request);
  const frameAncestor = runtimeOrigin === appOrigin ? "'self'" : appOrigin;
  return [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "form-action 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    `frame-ancestors ${frameAncestor}`,
  ].join('; ');
}

function commonHeaders(request) {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Content-Security-Policy': contentSecurityPolicy(request),
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
  });
}



/**
 * Politica PROPRIA da falha — inerte como antes, mas nao invisivel.
 *
 * ⭐ O caminho de sucesso permite que o editor emoldure a pagina; o de falha
 * dizia `frame-ancestors 'none'`, entao a pagina se proibia de aparecer
 * justamente na unica tela onde alguem leria a mensagem. O usuario via um quadro
 * branco, sem motivo, ate o batimento de 3,5s desistir.
 *
 * Do sucesso vem SO' o resolvedor de ancestral. Nada da CSP permissiva dele
 * ('unsafe-inline'/'unsafe-eval') entra aqui: esta pagina nao executa nada.
 */
function failureContentSecurityPolicy(request) {
  const runtimeOrigin = new URL(request.url).origin;
  const appOrigin = appFrameAncestor(request);
  const frameAncestor = runtimeOrigin === appOrigin ? "'self'" : appOrigin;
  return [
    "default-src 'none'", "script-src 'none'", "style-src 'none'",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'",
    `frame-ancestors ${frameAncestor}`,
  ].join('; ');
}

function inertFailure(request, reason, token, status = 404) {
  recordFailure(reason, token);
  const headers = commonHeaders(request);
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Content-Security-Policy', failureContentSecurityPolicy(request));
  // O motivo e' vocabulario interno. Em producao fica so' no log; fora dela,
  // exige opt-in EXPLICITO — "nao e' producao" sozinho pegaria staging publico.
  if (process.env.NODE_ENV !== 'production'
    && process.env.UNCRAFT_RUNTIME_DEBUG_FAILURES === '1'
    && MOTIVOS_DE_FALHA.has(reason)) {
    headers.set('X-Uncraft-Runtime-Failure', reason);
  }
  // Corpo e status IDENTICOS entre motivos: a pagina nao ensina nada sobre o
  // gateway a quem a le.
  return new Response('<!doctype html><meta charset="utf-8"><title>Unavailable</title><p>This website couldn\'t be opened.</p>', {
    status,
    headers,
  });
}

function descriptorFromRow(row) {
  return parseNativeBundleDescriptor({
    schemaVersion: Number(row.schema_version),
    bundleId: row.bundle_id,
    storageKey: row.storage_key,
    contentHash: row.content_hash,
    entryPath: row.entry_path,
    assetIndex: typeof row.asset_index === 'string' ? JSON.parse(row.asset_index) : row.asset_index,
    runtimeFingerprint: row.runtime_fingerprint,
    reconstructionCapabilities: typeof row.reconstruction_capabilities === 'string'
      ? JSON.parse(row.reconstruction_capabilities)
      : row.reconstruction_capabilities,
  });
}

function canonicalRequestedPath(segments, descriptor) {
  if (!Array.isArray(segments) || segments.length === 0) return descriptor.entryPath;
  if (segments.some((segment) => typeof segment !== 'string' || !segment || segment.includes('\0'))) {
    throw new TypeError('Invalid runtime asset path');
  }
  const raw = segments.join('/');
  const normalized = normalizeBundlePath(raw, { label: 'runtime asset path' });
  if (normalized !== raw) throw new TypeError('Runtime asset path must be canonical');
  return normalized;
}

function topLevelPrefixes(descriptor) {
  return [...new Set(descriptor.assetIndex
    .map((asset) => asset.path.split('/'))
    .filter((segments) => segments.length > 1)
    .map(([prefix]) => prefix))];
}

function isRewriteableText(contentType) {
  return /^(?:text\/|application\/(?:javascript|json)(?:;|$)|image\/svg\+xml(?:;|$))/i.test(contentType);
}

function responseEtag(body) {
  return `"sha256:${createHash('sha256').update(body).digest('hex')}"`;
}

/**
 * Cache imutável com vida ≤ sessão — e o RESIDUAL exato disso, nomeado.
 *
 * `private` mantém cache compartilhado (proxy/CDN) fora: o token de acesso
 * vive no CAMINHO destas URLs, e um cache público as tornaria conteúdo
 * endereçável por qualquer um. `max-age` é o tempo RESTANTE da sessão, nunca
 * mais.
 *
 * O que sobra (dívida deliberada de 2026-08-20, não escondida): uma sessão
 * REVOGADA antes de expirar não alcança o cache do navegador — o mesmo perfil
 * que já teve acesso pode reler do disco o que já baixou, até o expiry.
 * Alcance real: mesmo perfil, mesmo browser, só o que já foi baixado, teto de
 * 4h. Rotacionar o token não fecha isso (mudaria toda URL no meio da sessão,
 * decisão de 2026-08-20); encurtar o max-age só move o teto, cobrando
 * revalidação de ~70 assets por página no caminho feliz.
 */
function immutableCacheControl(expiresAtMs) {
  const remainingSeconds = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
    : 0;
  return `private, max-age=${remainingSeconds}, immutable`;
}

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
const UPLOAD_MIME_POR_EXT = Object.fromEntries(UPLOAD_TIPOS.map((t) => [t.ext, t.mime]));
const uploadStorageKey = (nodeId, nome) => `native-node-uploads/v1/${nodeId}/${nome}`;

async function autorizarPorToken(request, resolved) {
  const token = resolved?.token;
  if (!runtimeRequestUsesConfiguredOrigin(request.url)) {
    return { falha: inertFailure(request, 'wrong_runtime_origin', token) };
  }
  const verification = verifyRuntimeSessionToken(token);
  if (verification.error) return { falha: inertFailure(request, `token_${verification.error}`, token) };
  return { token, payload: verification.payload };
}


async function store_uploads_read(nodeId, nome) {
  const store = createConfiguredBundleStore();
  return Buffer.from(await store.read(uploadStorageKey(nodeId, nome)));
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

  // Upload do nó: caminho reservado `_uploads/<hash>.<ext>`, servido do store
  // por nó — nunca colide com o bundle (o produtor não emite `_uploads/`).
  const caminhoPedido = Array.isArray(resolved?.path) ? resolved.path.join('/') : String(resolved?.path || '');
  if (/^_uploads\/[0-9a-f]{16,64}\.(?:png|jpe?g|gif|webp|avif)$/.test(caminhoPedido)) {
    const nomeUp = caminhoPedido.slice('_uploads/'.length);
    let corpoUp;
    try {
      corpoUp = await store_uploads_read(row.node_id, nomeUp);
    } catch {
      return inertFailure(request, 'asset_unavailable', token);
    }
    const headersUp = commonHeaders(request);
    headersUp.set('Content-Type', UPLOAD_MIME_POR_EXT[nomeUp.split('.').pop() === 'jpeg' ? 'jpg' : nomeUp.split('.').pop()] || 'application/octet-stream');
    headersUp.set('Cache-Control', immutableCacheControl(payload.expiresAtMs));
    headersUp.set('Accept-Ranges', 'bytes');
    return new Response(corpoUp, { headers: headersUp });
  }

  let descriptor;
  let manifest;
  let assetPath;
  try {
    descriptor = descriptorFromRow(row);
    manifest = parseMotionManifest(
      typeof row.draft_manifest === 'string' ? JSON.parse(row.draft_manifest) : row.draft_manifest,
      { expectedBundleId: descriptor.bundleId, runtimeFingerprint: descriptor.runtimeFingerprint },
    );
    assetPath = canonicalRequestedPath(resolved?.path, descriptor);
  } catch {
    return inertFailure(request, 'invalid_runtime_contract', token);
  }

  const expectedPrefix = descriptor.entryPath.includes('/')
    ? descriptor.entryPath.slice(0, descriptor.entryPath.lastIndexOf('/'))
    : '';
  if (payload.entryPrefix !== expectedPrefix) {
    return inertFailure(request, 'entry_prefix_mismatch', token);
  }
  const asset = descriptor.assetIndex.find((candidate) => candidate.path === assetPath);
  if (!asset) return inertFailure(request, 'undeclared_asset', token);

  let bytes;
  try {
    const store = createConfiguredBundleStore();
    bytes = await store.read(indexedAssetKey(descriptor.storageKey, asset.path));
  } catch {
    return inertFailure(request, 'asset_unavailable', token);
  }

  const headers = commonHeaders(request);
  headers.set('Content-Type', asset.contentType);
  const isHtml = /^text\/html(?:;|$)/i.test(asset.contentType);
  if (!isHtml && !isRewriteableText(asset.contentType)) {
    headers.set('Cache-Control', immutableCacheControl(payload.expiresAtMs));
    headers.set('ETag', `"${asset.contentHash}"`);
    // ⚠️ FAIXA DE BYTES. Sem isto o <video> até toca — o navegador baixa o
    // arquivo inteiro e reproduz do começo — mas não PROCURA: pedir
    // `currentTime = 2` deixa o tempo em zero, medido no clone real. E o site
    // clonado tem um `<video class="scroll-video">` cuja animação inteira é o
    // quadro seguindo a rolagem, então essa coreografia some.
    //
    // Anunciar `Accept-Ranges` faz parte da correção: sem o anúncio o
    // navegador nem tenta. Só corpo binário entra aqui; texto é reescrito e
    // muda de tamanho, e faixa sobre o original apontaria para bytes errados.
    headers.set('Accept-Ranges', 'bytes');
    // `If-Range` que não casa com a etiqueta significa "a representação mudou":
    // a faixa tem que ser IGNORADA e o arquivo inteiro devolvido, senão o
    // cliente remonta bytes de versões diferentes (RFC 9110 §13.1.5). Aqui as
    // etiquetas são hash do conteúdo, então a comparação é forte por natureza.
    const ifRange = request.headers.get('if-range');
    const etiqueta = `"${asset.contentHash}"`;
    const faixaVale = !ifRange || ifRange.trim() === etiqueta;
    const faixa = faixaVale ? parseByteRange(request.headers.get('range'), bytes.byteLength) : null;
    const cab = rangeHeaders(faixa);
    if (cab) {
      headers.set('Content-Range', cab['Content-Range']);
      if (cab.status === 416) return new Response(null, { status: 416, headers });
      headers.set('Content-Length', cab['Content-Length']);
      return new Response(bytes.slice(faixa.inicio, faixa.fim + 1), { status: 206, headers });
    }
    return new Response(bytes, { headers });
  }

  const runtimeBase = `/api/runtime/${encodeURIComponent(token)}`;
  let rewritten = rewriteRuntimePaths(
    new TextDecoder().decode(bytes),
    topLevelPrefixes(descriptor),
    runtimeBase,
  );

  // ⭐ A ORIGEM QUE O SITE MONTA EM RUNTIME. Reescrever referências alcança o
  // que está escrito no documento; não alcança a URL que só existe depois que o
  // código roda. Medido no clone real: 145 imagens de uma sequência de rolagem
  // morriam assim, com os arquivos já dentro do bundle.
  //
  // Só JavaScript, só string de verdade com a origem no primeiro caractere, e
  // só origem que o bundle CONTÉM. Leitura insegura deixa o arquivo intocado e
  // registra a cobertura incompleta — servir o original é melhor que corromper
  // o script que faz o site se mexer.
  const hostsDoBundle = origensDoBundle(descriptor.assetIndex);
  if (/^(?:text|application)\/javascript(?:;|$)/i.test(asset.contentType)) {
    const traducao = translateRuntimeOrigins(rewritten, { hosts: hostsDoBundle, runtimeBase });
    rewritten = traducao.texto;
    if (!traducao.completo) {
      // eslint-disable-next-line no-console
      console.warn('[runtime] traducao nao aplicada num script', { motivo: traducao.motivo });
    }
  } else if (/^application\/json(?:;|$)/i.test(asset.contentType)) {
    // Lottie e manifestos de mídia guardam URL absoluta, e o código do site as
    // usa direto — medido: um SVG que existe no bundle continuava sendo pedido
    // ao CDN porque vinha de um Lottie.
    const traducao = translateRuntimeOriginsInJson(rewritten, { hosts: hostsDoBundle, runtimeBase });
    rewritten = traducao.texto;
    if (!traducao.completo) {
      // eslint-disable-next-line no-console
      console.warn('[runtime] traducao nao aplicada num json', { motivo: traducao.motivo });
    }
  } else if (isHtml) {
    // Medido: a origem aparece 164 vezes no documento de entrada e o DOM tem 4
    // atributos apontando para lá — o resto vive em script EMBUTIDO, que monta
    // a sequência de frames com `Image()`.
    const traducao = translateRuntimeOriginsInHtml(rewritten, { hosts: hostsDoBundle, runtimeBase });
    rewritten = traducao.texto;
    if (traducao.incompletos > 0) {
      // eslint-disable-next-line no-console
      console.warn('[runtime] blocos de script sem traducao', {
        incompletos: traducao.incompletos, de: traducao.blocos,
      });
    }
  }
  if (!isHtml) {
    headers.set('Cache-Control', immutableCacheControl(payload.expiresAtMs));
    headers.set('ETag', responseEtag(rewritten));
    return new Response(rewritten, { headers });
  }

  headers.set('Cache-Control', 'no-store');
  const body = injectRuntimeBridge(rewritten, {
    initialManifest: manifest,
    bundleId: descriptor.bundleId,
    runtimeSessionId: row.session_id,
    runtimeFingerprint: descriptor.runtimeFingerprint,
    sessionNonce: payload.nonce,
  });
  return new Response(body, { headers });
}
