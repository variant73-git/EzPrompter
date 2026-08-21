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
import { parseMotionManifest } from '../../../../../lib/motion-editor/manifest.js';
import {
  injectRuntimeBridge,
  rewriteRuntimePaths,
} from '../../../../../lib/motion-editor/native-clone-gateway.js';
import {
  runtimeRequestUsesConfiguredOrigin,
  verifyRuntimeSessionToken,
} from '../../../../../lib/motion-editor/runtime-session-token.js';

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

// Escapa o motivo antes de escrevê-lo no HTML de diagnóstico: ele contém um
// valor derivado do token, e a página não pode virar veículo de injeção nem
// em desenvolvimento.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function inertFailure(request, reason, token, status = 404) {
  recordFailure(reason, token);
  const headers = commonHeaders(request);
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'text/html; charset=utf-8');

  // ⚠️ EM PRODUÇÃO a página é inerte E não-enquadrável de propósito: não conta
  // ao mundo POR QUE recusou. Em DESENVOLVIMENTO isso custa horas — o Chrome
  // recusa renderizar a página (`frame-ancestors 'none'`) e o programador vê
  // só "localhost is blocked", sem nenhuma pista. Então, fora de produção, a
  // página é enquadrável pela própria app e DIZ o motivo, que é a única coisa
  // que o programador precisa saber. Adicionado em 2026-08-21, depois de o
  // sintoma custar duas rodadas de investigação às cegas.
  // Só `development` afrouxa. Em `test` a recusa segue idêntica à de produção —
  // a suíte codifica o contrato "recusa é opaca" e ela tem que continuar
  // guardando isso; foi ela que pegou o afrouxamento amplo demais desta função.
  const desenvolvimento = process.env.NODE_ENV === 'development';
  if (!desenvolvimento) {
    headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    return new Response('<!doctype html><meta charset="utf-8"><title>Unavailable</title><p>This website couldn\'t be opened.</p>', { status, headers });
  }

  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
  headers.set('X-Uncraft-Runtime-Failure', String(reason));
  const corpo = `<!doctype html><meta charset="utf-8"><title>Runtime unavailable</title>`
    + `<style>body{margin:0;padding:24px;font:13px/1.5 ui-monospace,Menlo,monospace;`
    + `background:#1a1a18;color:#ece9e2}b{color:#f0913d}code{color:#a8a49a}</style>`
    + `<p><b>Runtime não abriu</b> — motivo: <b>${escapeHtml(reason)}</b> (HTTP ${status}).</p>`
    + `<p><code>Esta página só aparece fora de produção. Em produção a recusa é opaca.</code></p>`;
  return new Response(corpo, { status, headers });
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

function immutableCacheControl(expiresAtMs) {
  const remainingSeconds = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
    : 0;
  return `private, max-age=${remainingSeconds}, immutable`;
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

  let sql;
  try {
    sql = await db();
  } catch {
    return inertFailure(request, 'database_unavailable', token, 503);
  }
  let rows;
  try {
    rows = await sql`
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
         AND nb.bundle_id = ${payload.bundleId}
    `;
  } catch {
    return inertFailure(request, 'database_unavailable', token, 503);
  }
  const row = rows[0];
  if (!row) return inertFailure(request, 'session_scope_mismatch', token);

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
    return new Response(bytes, { headers });
  }

  const runtimeBase = `/api/runtime/${encodeURIComponent(token)}`;
  const rewritten = rewriteRuntimePaths(
    new TextDecoder().decode(bytes),
    topLevelPrefixes(descriptor),
    runtimeBase,
  );
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
