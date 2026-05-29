import { NextResponse } from 'next/server';
import { db } from '../../../lib/db.js';
import { getAuthUser } from '../../../lib/auth.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

function corsHeaders(origin) {
  const isExt = origin && /^chrome-extension:\/\//.test(origin);
  const isWebShell = origin && /^https?:\/\/(?:localhost(?::\d+)?|.*\.uncraft\.app|uncraft\.app|.*\.vercel\.app)/.test(origin);
  const allowOrigin = (isExt || isWebShell) ? origin : '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

/**
 * POST /api/asset-groups
 *
 * Persist a group asset created via Cmd+G in the widget. The group's
 * html field carries the cloned-common-ancestor snapshot (with non-
 * selected siblings stripped). Member assets — if also being saved —
 * should be POSTed to /api/assets in a SEPARATE call with their
 * group_id set to the returned group id. v1 keeps these flows
 * deliberately separate so the widget can save groups standalone OR
 * groups + members as a coordinated pair.
 *
 * Request body:
 *   {
 *     destination: { kind: 'library' } | { kind: 'project', id: '<uuid>' },
 *     group: { name, html, css?, thumb_url?, source_url?, meta? }
 *   }
 */
export async function POST(request) {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: cors });

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const destination = body.destination || { kind: 'library' };
  const g = body.group;
  if (!g || !g.html) {
    return NextResponse.json({ error: 'group.html required' }, { status: 400, headers: cors });
  }
  if (typeof g.html !== 'string' || g.html.length > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'group.html missing or too large' }, { status: 413, headers: cors });
  }

  let projectId = null;
  if (destination.kind === 'project') {
    if (!destination.id) {
      return NextResponse.json({ error: 'destination.id required for project save' }, { status: 400, headers: cors });
    }
    projectId = destination.id;
  }

  const sql = await db();

  if (projectId) {
    const [board] = await sql`SELECT id FROM boards WHERE id = ${projectId} AND user_id = ${user.id}`;
    if (!board) {
      return NextResponse.json({ error: 'board not found' }, { status: 404, headers: cors });
    }
  }

  const name = (g.name || 'Untitled group').slice(0, 250);
  const css = g.css ?? null;
  const thumb = g.thumb_url ?? null;
  const source = (g.source_url || '').slice(0, 2048) || null;
  const meta = g.meta ?? {};

  const [row] = await sql`
    INSERT INTO asset_groups
      (user_id, project_id, name, html, css, thumb_url, source_url, meta)
    VALUES
      (${user.id}, ${projectId}, ${name}, ${g.html}, ${css}, ${thumb}, ${source}, ${meta}::jsonb)
    RETURNING id, name, project_id, source_url, created_at
  `;
  return NextResponse.json({ ok: true, group: row }, { headers: cors });
}

/**
 * GET /api/asset-groups
 *
 * List the user's groups (with assets count). Used by the canvas
 * Assets tab to render groups as their own folder/section.
 */
export async function GET(request) {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: cors });

  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') || 'all';
  const projectId = url.searchParams.get('id');

  const sql = await db();
  let rows;
  if (scope === 'library') {
    rows = await sql`
      SELECT g.*, (SELECT COUNT(*) FROM assets a WHERE a.group_id = g.id)::int AS asset_count
        FROM asset_groups g
       WHERE g.user_id = ${user.id} AND g.project_id IS NULL
       ORDER BY g.created_at DESC
       LIMIT 200
    `;
  } else if (scope === 'project' && projectId) {
    rows = await sql`
      SELECT g.*, (SELECT COUNT(*) FROM assets a WHERE a.group_id = g.id)::int AS asset_count
        FROM asset_groups g
       WHERE g.user_id = ${user.id} AND g.project_id = ${projectId}
       ORDER BY g.created_at DESC
       LIMIT 200
    `;
  } else {
    rows = await sql`
      SELECT g.*, (SELECT COUNT(*) FROM assets a WHERE a.group_id = g.id)::int AS asset_count
        FROM asset_groups g
       WHERE g.user_id = ${user.id}
       ORDER BY g.created_at DESC
       LIMIT 200
    `;
  }
  return NextResponse.json({ groups: rows }, { headers: cors });
}
