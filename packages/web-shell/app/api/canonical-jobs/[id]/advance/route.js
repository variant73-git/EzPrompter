import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { advanceCanonicalJob, canonicalEditEnabled } from '../../../../../lib/canonical/job-service.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Um passo pode escrever a captura na máquina (dezenas de MB) ou registrar a cópia: cabe com folga em 300 s.
export const maxDuration = 300;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request, { params }) {
  if (!canonicalEditEnabled()) return NextResponse.json({ error: 'canonical_disabled' }, { status: 404, headers: NO_STORE });
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const sql = await db();
  const out = await advanceCanonicalJob({ sql, userId: user.id, jobId: id });
  if (out.error) {
    const { code, status } = out.error;
    return NextResponse.json({ error: code }, { status, headers: NO_STORE });
  }
  return NextResponse.json(out, { headers: NO_STORE });
}
