import { NextResponse } from 'next/server';
import { clearSessionCookieHeader } from '../../../../lib/auth.js';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('set-cookie', clearSessionCookieHeader());
  return res;
}
