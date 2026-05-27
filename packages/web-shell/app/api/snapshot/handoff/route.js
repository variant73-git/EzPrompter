import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
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

  // Verify the node still exists AND belongs to the same user the token
  // was issued for (defense in depth — the token already binds userId,
  // but we re-check at write time to catch a node that was deleted
  // mid-handoff or transferred between users).
  const [node] = await sql`
    SELECT n.id, n.board_id, n.current_snapshot_id, n.meta
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${payload.nodeId} AND b.user_id = ${payload.userId}
  `;
  if (!node) {
    return NextResponse.json({ error: 'node not found' }, { status: 404, headers: cors });
  }

  // Idempotency — if the node already has a snapshot from a previous
  // handoff (same nodeId, same source), short-circuit successfully.
  // Avoids double-writes from a re-fired banner click.
  if (node.current_snapshot_id) {
    const [existing] = await sql`
      SELECT id, source FROM snapshots WHERE id = ${node.current_snapshot_id}
    `;
    if (existing?.source === 'handoff') {
      return NextResponse.json({
        ok: true, snapshotId: existing.id, nodeId: node.id, deduped: true
      }, { headers: cors });
    }
  }

  const [snap] = await sql`
    INSERT INTO snapshots (node_id, html, screenshot_url, source)
    VALUES (${node.id}, ${html}, ${screenshotDataUrl || null}, 'handoff')
    RETURNING id, created_at
  `;
  // Clear the awaiting_handoff flag in meta so the canvas UI knows the
  // placeholder is done; keep other meta keys intact via JSONB merge.
  await sql`
    UPDATE nodes
       SET current_snapshot_id = ${snap.id},
           meta = COALESCE(meta, '{}'::jsonb) - 'awaiting_handoff' - 'handoff_started_at'
     WHERE id = ${node.id}
  `;

  return NextResponse.json({
    ok: true,
    snapshotId: snap.id,
    nodeId: node.id,
    title: title || null
  }, { headers: cors });
}
