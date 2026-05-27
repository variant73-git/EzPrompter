import { NextResponse } from 'next/server';
import { db } from '../../../lib/db.js';
import { requireUser, getAuthUser } from '../../../lib/auth.js';

// CORS for the Uncraft extension popup (chrome-extension:// origin).
// Cookie-authed, so we cannot use a wildcard origin — must echo the
// exact request Origin and set Allow-Credentials.
function corsHeaders(origin) {
  const isExt = origin && /^chrome-extension:\/\//.test(origin);
  const isWebShell = origin && /^https?:\/\/(?:localhost(?::\d+)?|.*\.uncraft\.app|uncraft\.app)/.test(origin);
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

export async function GET(request) {
  const cors = corsHeaders(request.headers.get('origin'));
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: cors });
  const sql = await db();
  const rows = await sql`
    SELECT id, name, created_at, updated_at
      FROM boards
     WHERE user_id = ${user.id}
     ORDER BY updated_at DESC
  `;
  return NextResponse.json({ boards: rows }, { headers: cors });
}

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const name = (body?.name || 'Untitled').slice(0, 120);
  const sql = await db();
  const [board] = await sql`
    INSERT INTO boards (user_id, name)
    VALUES (${user.id}, ${name})
    RETURNING id, name, created_at, updated_at
  `;
  return NextResponse.json({ board });
}
