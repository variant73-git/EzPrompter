import { db } from '../../../../lib/db.js';
import { inertFailure } from '../../../../lib/motion-editor/runtime-gateway-core.js';
import {
  createLeaseFromBadge,
  leaseCookieHeader,
  leaseCookieName,
  runtimeRequestUsesSessionHost,
  verifyBootstrapBadge,
  verifyLease,
} from '../../../../lib/motion-editor/runtime-lease.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function leaseEnabled() {
  return process.env.UNCRAFT_RUNTIME_LEASE === '1';
}

function isSecure(request) {
  return new URL(request.url).protocol === 'https:';
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

function cleanEntryUrl(sessionId, entryPath) {
  const encodedEntry = entryPath.split('/').map(encodeURIComponent).join('/');
  return `/api/rt/${encodeURIComponent(sessionId)}/${encodedEntry}`;
}

function redirect(location, cookie) {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

// Bootstrap one-shot → cookie → 303 (plano lease B, Task 7). O badge é a ÚNICA
// credencial que autoriza criar a lease; ele é consumido atomicamente
// (createLeaseFromBadge grava o jti UNIQUE). Cookie-first: um badge repetido só
// passa se o request já traz o cookie da MESMA lease — remount incidental
// (StrictMode/bfcache/reload) não pune nem reabre janela de replay para outro
// jar. A resposta nunca leva a credencial na URL de destino.
export async function GET(request, { params }) {
  if (!leaseEnabled()) return inertFailure(request, 'lease_disabled', null);
  const { badge } = await params;

  const verification = verifyBootstrapBadge(badge);
  if (verification.error) return inertFailure(request, `badge_${verification.error}`, badge);
  const payload = verification.payload;

  // O host DEVE ser o hostname da sessão — nunca cria lease para outro host.
  if (!runtimeRequestUsesSessionHost(request.url, payload.hostname)) {
    return inertFailure(request, 'bootstrap_host_mismatch', badge);
  }

  const secure = isSecure(request);
  let sql;
  try { sql = await db(); } catch { return inertFailure(request, 'database_unavailable', badge, 503); }

  // Cookie-first: já há lease válida para esta sessão neste jar? Redireciona
  // SEM consumir o badge nem reemitir cookie.
  const existing = readCookie(request, leaseCookieName({ secure }));
  if (existing) {
    let check;
    try {
      check = await verifyLease({ sql, cookieValue: existing, hostname: payload.hostname, sessionId: payload.sessionId });
    } catch { return inertFailure(request, 'database_unavailable', badge, 503); }
    if (!check.error) return redirect(cleanEntryUrl(payload.sessionId, payload.entryPath), null);
  }

  // Consumo atômico do badge → lease + cookie.
  let created;
  try {
    created = await createLeaseFromBadge({ sql, payload });
  } catch { return inertFailure(request, 'database_unavailable', badge, 503); }
  if (created.error) return inertFailure(request, `lease_${created.error}`, badge);

  const cookie = leaseCookieHeader(created.cookieValue, { secure });
  return redirect(cleanEntryUrl(payload.sessionId, payload.entryPath), cookie);
}
