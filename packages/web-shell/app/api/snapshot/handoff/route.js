import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { persistReferenceSnapshot } from '../../../../lib/snapshot-persist.js';
import { verifyHandoffToken } from '../../../../lib/handoff-token.js';

export const runtime = 'nodejs';
// Handoff payload is the captured DOM + a base64 screenshot — can be
// several MB on heavy sites. 60s lets a slow upload + DB write settle.
export const maxDuration = 60;

// CORS: the extension POSTs from chrome-extension://<id>, which the
// browser treats as an opaque cross-origin caller. Cookie auth doesn't
// flow naturally; we use the signed handoff token instead. The Origin
// header IS sent, so we can allow chrome extensions explicitly.
function corsHeaders(origin) {
  // Allow any chrome extension origin (we verify via token, not origin).
  // For browser pages on uncraft.app the same-origin check passes
  // without these headers; this is only for the extension's cross-origin
  // fetch from chrome-extension://<id>.
  const allowOrigin = origin && /^chrome-extension:\/\//.test(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Uncraft-Handoff-Token',
    'Access-Control-Max-Age': '600'
  };
}

export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'))
  });
}

export async function POST(request) {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);

  // Accept the token either from a dedicated header (preferred — keeps
  // it out of the JSON body) or as a field in the body (fallback). The
  // header keeps logs cleaner and avoids accidental token capture if
  // the body is logged.
  const headerToken = request.headers.get('x-uncraft-handoff-token');
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const token = headerToken || body.token;

  const { payload, error: verr } = verifyHandoffToken(token);
  if (verr) {
    return NextResponse.json({ error: verr }, { status: 401, headers: cors });
  }

  const { html, screenshotDataUrl, title } = body || {};
  if (typeof html !== 'string' || html.length < 50) {
    return NextResponse.json({ error: 'html missing or too short' }, { status: 400, headers: cors });
  }
  // Soft cap — 10MB. Bigger captures are almost always pages with
  // embedded base64 assets we should have inlined separately.
  if (html.length > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'html too large (>10MB)' }, { status: 413, headers: cors });
  }

  const sql = await db();

  const result = await persistReferenceSnapshot({
    sql, userId: payload.userId, nodeId: payload.nodeId, html, screenshotDataUrl, title,
  });
  if (result.error === 'not_found') {
    return NextResponse.json({ error: 'node not found' }, { status: 404, headers: cors });
  }
  if (result.deduped) {
    return NextResponse.json({ ok: true, snapshotId: result.snapshotId, nodeId: payload.nodeId, deduped: true }, { headers: cors });
  }
  return NextResponse.json({
    ok: true,
    snapshotId: result.snapshotId,
    nodeId: payload.nodeId,
    title: title || null
  }, { headers: cors });
}
