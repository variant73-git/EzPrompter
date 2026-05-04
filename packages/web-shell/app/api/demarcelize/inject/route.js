import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { inject } from '../../../../lib/demarcelize.js';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { referenceHtml, content, model } = await request.json().catch(() => ({}));
  if (!referenceHtml || !content) {
    return NextResponse.json({ error: 'referenceHtml and content required' }, { status: 400 });
  }
  try {
    const html = await inject({ referenceHtml, content, model });
    return NextResponse.json({ html });
  } catch (e) {
    console.error('inject error', e);
    return NextResponse.json({ error: 'inject_failed', detail: String(e?.message || e) }, { status: 502 });
  }
}
