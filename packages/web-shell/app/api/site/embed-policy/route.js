import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { iframeBlockReason } from '../../../../lib/embed-policy.js';

export const runtime = 'nodejs';
export const maxDuration = 15;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function POST(request) {
  const { error } = await requireUser(request);
  if (error) return error;

  const { url } = await request.json().catch(() => ({}));
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'valid http(s) url required' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      // GET is intentional: some CDNs omit framing headers from HEAD even
      // though the browser receives them on the real document response.
      headers: { 'user-agent': UA, range: 'bytes=0-512' },
    });
    const reason = iframeBlockReason(response.headers, {
      pageUrl: response.url || url,
      appOrigin: request.nextUrl.origin,
    });
    await response.body?.cancel().catch(() => {});
    return NextResponse.json({
      embeddable: !reason,
      reason,
      finalUrl: response.url || url,
      confidence: 'headers',
    });
  } catch {
    // A failed preflight is not proof of an iframe blocker. Preserve the fast
    // path and let the live preview try instead of forcing every uncertain
    // site through a capture.
    return NextResponse.json({
      embeddable: true,
      reason: null,
      finalUrl: url,
      confidence: 'unknown',
    });
  } finally {
    clearTimeout(timeout);
  }
}
