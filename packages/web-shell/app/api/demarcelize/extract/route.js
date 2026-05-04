import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { extractContent } from '../../../../lib/demarcelize.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { html, model } = await request.json().catch(() => ({}));
  if (!html) return NextResponse.json({ error: 'html required' }, { status: 400 });
  try {
    const content = await extractContent({ html, model });
    return NextResponse.json({ content });
  } catch (e) {
    console.error('extract error', e);
    return NextResponse.json({ error: 'extract_failed', detail: String(e?.message || e) }, { status: 502 });
  }
}
