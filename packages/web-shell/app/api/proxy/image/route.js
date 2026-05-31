import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../lib/auth.js';

export const runtime = 'nodejs';
// Image fetches can be slow on cold CDN edges; give them room without
// timing out the user's drop interaction.
export const maxDuration = 30;

// Hard cap on response size — keep node meta blobs manageable.
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// SSRF guard — block private + link-local + loopback so the proxy isn't a
// vector for reading internal services. Public DNS still works.
function isPrivateHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '0.0.0.0') return true;
  // IPv4 private ranges
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;       // AWS metadata + link-local
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true; // CGNAT
  // IPv6 loopback + unique-local + link-local
  if (h === '::1') return true;
  if (/^fc[0-9a-f]{2}:/.test(h)) return true;
  if (/^fd[0-9a-f]{2}:/.test(h)) return true;
  if (/^fe80:/.test(h)) return true;
  return false;
}

/**
 * GET /api/proxy/image?url=<encoded URL>
 *
 * Fetches the target image with a synthesized Referer matching the
 * target's own origin — defeats most hotlink protection (Etsy / Shopify
 * CDNs / cloud-hosted product shots) that returns 403 to cross-origin
 * fetches without an originating Referer.
 *
 * Auth-required so the endpoint isn't an open SSRF / bandwidth-amp
 * vector. Response is cacheable for 1h so a single asset drop and any
 * re-renders share the same fetch.
 */
export async function GET(request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const target = new URL(request.url).searchParams.get('url');
  if (!target) return NextResponse.json({ error: 'url required' }, { status: 400 });

  let u;
  try { u = new URL(target); } catch { return NextResponse.json({ error: 'invalid url' }, { status: 400 }); }
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    return NextResponse.json({ error: 'protocol not allowed' }, { status: 400 });
  }
  if (isPrivateHost(u.hostname)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 });
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Referer': u.origin + '/',
    'Accept-Encoding': 'identity'
  };

  let res;
  try {
    res = await fetch(u.toString(), { headers, redirect: 'follow' });
  } catch (err) {
    return NextResponse.json({ error: 'fetch failed', detail: String((err && err.message) || err) }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: 'upstream ' + res.status }, { status: res.status === 404 ? 404 : 502 });
  }

  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  // Be strict about image MIME — refuse to proxy arbitrary content so the
  // endpoint stays narrow.
  if (!/^image\//.test(contentType)) {
    return NextResponse.json({ error: 'not an image', contentType }, { status: 415 });
  }

  // Stream into a buffer with the size cap so a hostile / huge response
  // can't OOM the server.
  if (!res.body) {
    return NextResponse.json({ error: 'empty body' }, { status: 502 });
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      try { reader.cancel(); } catch {}
      return NextResponse.json({ error: 'image too large' }, { status: 413 });
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks);

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'Cache-Control': 'private, max-age=3600',
      'X-Uncraft-Proxy': '1'
    }
  });
}
