import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { checkJob, publicJobView } from '../../../../../lib/challenge/job-service.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const sql = await db();
  try {
    const { job } = await checkJob({ sql, userId: user.id, jobId: id });
    return NextResponse.json({ job: publicJobView(job) });
  } catch (e) {
    if (e?.code && e?.status) return NextResponse.json({ error: e.code }, { status: e.status });
    console.error('challenge check error', e?.message);
    return NextResponse.json({ error: 'check_failed' }, { status: 502 });
  }
}
