import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { getAuthUser } from '../../../../lib/auth.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

// CORS for the extension. Cookie-authed — the extension must send the
// uncraft_sess cookie via credentials:'include'. Chrome only honours
// that when Access-Control-Allow-Credentials is true AND the response
// Origin echoes the exact request Origin (no wildcard).
function corsHeaders(origin) {
  const isExt = origin && /^chrome-extension:\/\//.test(origin);
  const isWebShell = origin && /^https?:\/\/(?:localhost(?::\d+)?|.*\.uncraft\.app|uncraft\.app)/.test(origin);
  const allowOrigin = (isExt || isWebShell) ? origin : '';
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  };
  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }
  return headers;
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

  // Use getAuthUser directly so we can return CORS headers on the 401.
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: cors });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const {
    boardId, url, html, screenshotDataUrl, title,
    posX = null, posY = null,
    width = 1280, height = 720
  } = body || {};

  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400, headers: cors });
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'valid http(s) url required' }, { status: 400, headers: cors });
  }
  if (typeof html !== 'string' || html.length < 50) {
    return NextResponse.json({ error: 'html missing or too short' }, { status: 400, headers: cors });
  }
  if (html.length > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'html too large (>10MB)' }, { status: 413, headers: cors });
  }

  const sql = await db();
  const [board] = await sql`
    SELECT id FROM boards WHERE id = ${boardId} AND user_id = ${user.id}
  `;
  if (!board) return NextResponse.json({ error: 'board not found' }, { status: 404, headers: cors });

  // Auto-place: if caller didn't specify a position, drop the node at
  // a sensible spot near the last node on this board. Simple grid for
  // now — refine later if the canvas layout becomes board-aware.
  let pos_x = posX, pos_y = posY;
  if (pos_x === null || pos_y === null) {
    const [last] = await sql`
      SELECT pos_x, pos_y FROM nodes WHERE board_id = ${boardId}
       ORDER BY created_at DESC LIMIT 1
    `;
    pos_x = last ? Math.round(last.pos_x + 1400) : 200;
    pos_y = last ? Math.round(last.pos_y) : 200;
  }

  const meta = { source: 'extension_manual', title: title || null };

  const [node] = await sql`
    INSERT INTO nodes (board_id, kind, origin_url, pos_x, pos_y, width, height, meta)
    VALUES (${boardId}, 'site', ${url}, ${pos_x}, ${pos_y}, ${width}, ${height}, ${meta}::jsonb)
    RETURNING *
  `;
  const [snap] = await sql`
    INSERT INTO snapshots (node_id, html, screenshot_url, source)
    VALUES (${node.id}, ${html}, ${screenshotDataUrl || null}, 'manual')
    RETURNING id, created_at
  `;
  await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;
  node.current_snapshot_id = snap.id;

  return NextResponse.json({
    ok: true, node, snapshotId: snap.id, title: title || null
  }, { headers: cors });
}
