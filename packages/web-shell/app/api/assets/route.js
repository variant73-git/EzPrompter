import { NextResponse } from 'next/server';
import { db } from '../../../lib/db.js';
import { getAuthUser } from '../../../lib/auth.js';

export const runtime = 'nodejs';
// Asset HTML can include inline data URLs for fonts (up to ~1MB each
// per the widget's cap), so batches push memory. 60s gives room for a
// moderate group save without bumping into the default 30s.
export const maxDuration = 60;

const VALID_TYPES = new Set([
  'image', 'svg', 'icon', 'background-image', 'video',
  'component', 'section', 'text', 'font', 'group'
]);

// CORS — same posture as /api/snapshot/manual: chrome-extension origins
// are allowed (cookie-authed, credentials must echo the exact Origin).
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
 * POST /api/assets
 *
 * Batch-create assets from the widget's Collect Assets stage. Accepts
 * a single item or an array. Items can target either the global library
 * (project_id omitted) or a specific board (project_id required).
 *
 * Request body:
 *   {
 *     destination: { kind: 'library' } | { kind: 'project', id: '<uuid>' },
 *     items: [
 *       { type, name, source_url, html?, css?, blob_url?, thumb_url?, meta? },
 *       ...
 *     ],
 *     dedup?: boolean   // when true (default), reuse existing assets
 *                       // that match (user_id, source_url, type) in the
 *                       // global library; per-project saves never dedup
 *   }
 *
 * Response:
 *   { ok: true, created: [...], reused: [...] }
 */
export async function POST(request) {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: cors });

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const items = Array.isArray(body.items) ? body.items : [];
  const destination = body.destination || { kind: 'library' };
  const dedup = body.dedup !== false;

  if (items.length === 0) {
    return NextResponse.json({ error: 'no items' }, { status: 400, headers: cors });
  }
  if (items.length > 100) {
    return NextResponse.json({ error: 'batch too large (max 100)' }, { status: 413, headers: cors });
  }

  let projectId = null;
  if (destination.kind === 'project') {
    if (!destination.id) {
      return NextResponse.json({ error: 'destination.id required for project save' }, { status: 400, headers: cors });
    }
    projectId = destination.id;
  }

  const sql = await db();

  // Validate ownership of the target board, if any.
  if (projectId) {
    const [board] = await sql`SELECT id FROM boards WHERE id = ${projectId} AND user_id = ${user.id}`;
    if (!board) {
      return NextResponse.json({ error: 'board not found' }, { status: 404, headers: cors });
    }
  }

  const created = [];
  const reused = [];

  for (const raw of items) {
    if (!raw || !VALID_TYPES.has(raw.type)) {
      created.push({ error: 'invalid type', skipped: true });
      continue;
    }
    const name = (raw.name || 'Untitled').slice(0, 250);
    const sourceUrl = (raw.source_url || '').slice(0, 2048) || null;
    const html = raw.html ?? null;
    const css = raw.css ?? null;
    const blobUrl = raw.blob_url ?? null;
    const thumbUrl = raw.thumb_url ?? null;
    const meta = raw.meta ?? {};

    // Dedup — only when saving to global library AND we have a stable
    // source_url to match against.
    if (dedup && !projectId && sourceUrl) {
      const [existing] = await sql`
        SELECT id FROM assets
         WHERE user_id = ${user.id}
           AND project_id IS NULL
           AND source_url = ${sourceUrl}
           AND type = ${raw.type}
         LIMIT 1
      `;
      if (existing) { reused.push(existing.id); continue; }
    }

    const [row] = await sql`
      INSERT INTO assets
        (user_id, project_id, type, name, source_url, html, css, blob_url, thumb_url, meta)
      VALUES
        (${user.id}, ${projectId}, ${raw.type}, ${name}, ${sourceUrl}, ${html}, ${css}, ${blobUrl}, ${thumbUrl}, ${meta}::jsonb)
      RETURNING id, type, name, project_id, group_id, source_url, created_at
    `;
    created.push(row);
  }

  return NextResponse.json({
    ok: true,
    created,
    reused
  }, { headers: cors });
}

/**
 * GET /api/assets
 *
 * List the user's assets. Supports filtering by:
 *   ?scope=library      — only assets with project_id IS NULL
 *   ?scope=project&id=… — only assets pinned to that project
 *   ?scope=all          — default; everything
 *   ?type=image,font    — comma-separated list of types
 *
 * Used by the canvas-side layers Assets tab in the next slice.
 */
export async function GET(request) {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: cors });

  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') || 'all';
  const projectId = url.searchParams.get('id');
  const typeFilter = (url.searchParams.get('type') || '').split(',').filter(Boolean);

  const sql = await db();
  let rows;
  if (scope === 'library') {
    rows = typeFilter.length
      ? await sql`SELECT * FROM assets WHERE user_id = ${user.id} AND project_id IS NULL AND type = ANY(${typeFilter}) ORDER BY created_at DESC LIMIT 500`
      : await sql`SELECT * FROM assets WHERE user_id = ${user.id} AND project_id IS NULL ORDER BY created_at DESC LIMIT 500`;
  } else if (scope === 'project' && projectId) {
    rows = typeFilter.length
      ? await sql`SELECT * FROM assets WHERE user_id = ${user.id} AND project_id = ${projectId} AND type = ANY(${typeFilter}) ORDER BY created_at DESC LIMIT 500`
      : await sql`SELECT * FROM assets WHERE user_id = ${user.id} AND project_id = ${projectId} ORDER BY created_at DESC LIMIT 500`;
  } else {
    rows = typeFilter.length
      ? await sql`SELECT * FROM assets WHERE user_id = ${user.id} AND type = ANY(${typeFilter}) ORDER BY created_at DESC LIMIT 500`
      : await sql`SELECT * FROM assets WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 500`;
  }
  return NextResponse.json({ assets: rows }, { headers: cors });
}
