import { NextResponse } from 'next/server';
import { db } from '../../../lib/db.js';
import { requireUser } from '../../../lib/auth.js';

export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const rows = await sql`
    SELECT id, name, created_at, updated_at
      FROM boards
     WHERE user_id = ${user.id}
     ORDER BY updated_at DESC
  `;
  return NextResponse.json({ boards: rows });
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
