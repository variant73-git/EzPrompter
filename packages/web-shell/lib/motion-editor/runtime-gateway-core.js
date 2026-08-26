import { createHash } from 'node:crypto';
import {
  normalizeBundlePath,
  parseNativeBundleDescriptor,
} from '../native-clone/bundle-contract.js';
import {
  createConfiguredBundleStore,
  indexedAssetKey,
} from '../native-clone/bundle-store.js';
import { parseByteRange, rangeHeaders } from '../native-clone/byte-range.js';
import { parseMotionManifest } from './manifest.js';
import { injectRuntimeBridge, rewriteRuntimePaths } from './native-clone-gateway.js';
import { MOTIVOS_DE_FALHA } from './runtime-failure-reasons.js';
import {
  translateRuntimeOrigins,
  translateRuntimeOriginsInHtml,
  translateRuntimeOriginsInJson,
  origensDoBundle,
} from '../native-clone/translate-runtime-origins.js';

// CORE do gateway de runtime, extraído VERBATIM da rota legada
// (app/api/runtime/[token]/[...path]/route.js) para servir DOIS caminhos de
// autorização — token-no-path (legado, origem opaca) e lease-em-cookie (B) —
// sem duplicar a matriz de cache, range/206, reescrita, tradução de origens e
// injeção do bridge. A prova do refactor é a suíte da rota legada intocada,
// com a MESMA contagem (lição 178).

export function tokenDigest(token) {
  return createHash('sha256').update(String(token || '')).digest('hex').slice(0, 12);
}

function recordFailure(reason, credential) {
  if (process.env.NODE_ENV === 'test') return;
  console.warn('Native runtime gateway load failed', { reason, tokenDigest: tokenDigest(credential) });
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

export function commonHeaders(request, { corsWildcard = true } = {}) {
  const headers = new Headers({
    'Content-Security-Policy': contentSecurityPolicy(request),
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
  });
  // O caminho lease é same-origin por construção: não precisa de CORS, e
  // `*` combinado com cookie seria veneno — só o legado (origem opaca) o leva.
  if (corsWildcard) headers.set('Access-Control-Allow-Origin', '*');
  return headers;
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

export function inertFailure(request, reason, credential, status = 404, options = {}) {
  recordFailure(reason, credential);
  const headers = commonHeaders(request, options);
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

export function descriptorFromRow(row) {
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

export const UPLOAD_MIME_POR_EXT = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
});

export const uploadStorageKey = (nodeId, nome) => `native-node-uploads/v1/${nodeId}/${nome}`;

async function storeUploadsRead(nodeId, nome) {
  const store = createConfiguredBundleStore();
  return Buffer.from(await store.read(uploadStorageKey(nodeId, nome)));
}

/**
 * Serve UM asset do bundle para uma sessão JÁ AUTORIZADA.
 *
 * Quem chama decide a autorização (token legado no path, ou lease em cookie) e
 * entrega: a linha do banco (sessão+bundle), o `payload` da credencial
 * (`sessionId`/`nodeId`/`entryPrefix`/`expiresAtMs`/`nonce`), a base das URLs
 * reescritas e a política de CORS. Daqui para baixo o comportamento é UM só.
 */
export async function serveRuntimeAsset({
  request,
  pathSegments,
  row,
  payload,
  runtimeBase,
  credential,
  corsWildcard = true,
}) {
  const corsOptions = { corsWildcard };

  // Upload do nó: caminho reservado `_uploads/<hash>.<ext>`, servido do store
  // por nó — nunca colide com o bundle (o produtor não emite `_uploads/`).
  const caminhoPedido = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');
  if (/^_uploads\/[0-9a-f]{16,64}\.(?:png|jpe?g|gif|webp|avif)$/.test(caminhoPedido)) {
    const nomeUp = caminhoPedido.slice('_uploads/'.length);
    let corpoUp;
    try {
      corpoUp = await storeUploadsRead(row.node_id, nomeUp);
    } catch {
      return inertFailure(request, 'asset_unavailable', credential, 404, corsOptions);
    }
    const headersUp = commonHeaders(request, corsOptions);
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
    assetPath = canonicalRequestedPath(pathSegments, descriptor);
  } catch {
    return inertFailure(request, 'invalid_runtime_contract', credential, 404, corsOptions);
  }

  const expectedPrefix = descriptor.entryPath.includes('/')
    ? descriptor.entryPath.slice(0, descriptor.entryPath.lastIndexOf('/'))
    : '';
  if (payload.entryPrefix !== expectedPrefix) {
    return inertFailure(request, 'entry_prefix_mismatch', credential, 404, corsOptions);
  }
  const asset = descriptor.assetIndex.find((candidate) => candidate.path === assetPath);
  if (!asset) return inertFailure(request, 'undeclared_asset', credential, 404, corsOptions);

  let bytes;
  try {
    const store = createConfiguredBundleStore();
    bytes = await store.read(indexedAssetKey(descriptor.storageKey, asset.path));
  } catch {
    return inertFailure(request, 'asset_unavailable', credential, 404, corsOptions);
  }

  const headers = commonHeaders(request, corsOptions);
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
