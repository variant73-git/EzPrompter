import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { db } from '../../../../lib/db.js';
import { getOwnedJob } from '../../../../lib/challenge/job-store.js';
import { liveViewFor, publicJobView } from '../../../../lib/challenge/job-service.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const sql = await db();
  const job = await getOwnedJob({ sql, userId: user.id, jobId: id });
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const liveView = await liveViewFor({ job });
  // A URL do visualizador é segredo portador: no-store + sem referrer.
  return NextResponse.json(
    { job: publicJobView(job), ...(liveView ? { liveView } : {}) },
    { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
  );
}
