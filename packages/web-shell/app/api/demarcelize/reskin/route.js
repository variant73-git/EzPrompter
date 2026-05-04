import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { reskin } from '../../../../lib/demarcelize.js';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { targetHtml, referenceHtml, model } = await request.json().catch(() => ({}));
  if (!targetHtml || !referenceHtml) {
    return NextResponse.json({ error: 'targetHtml and referenceHtml required' }, { status: 400 });
  }
  try {
    const html = await reskin({ targetHtml, referenceHtml, model });
    return NextResponse.json({ html });
  } catch (e) {
    console.error('reskin error', e);
    return NextResponse.json({ error: 'reskin_failed', detail: String(e?.message || e) }, { status: 502 });
  }
}
