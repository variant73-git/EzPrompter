import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { pruneExpiredMotionDiagnostics } from '../../../../lib/motion-editor/diagnostics.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const sql = await db();
    await pruneExpiredMotionDiagnostics(sql);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'prune_failed' }, { status: 500 });
  }
}
