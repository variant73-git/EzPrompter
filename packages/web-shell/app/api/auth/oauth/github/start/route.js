import { NextResponse } from 'next/server';
import crypto from 'crypto';

// See google/start/route.js for the design rationale. Same shape, different
// provider URLs and scopes.

export async function GET() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const secret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const base = process.env.OAUTH_REDIRECT_BASE || 'http://localhost:3030';

  if (!clientId || !secret || secret.startsWith('PASTE_')) {
    const url = new URL('/', base);
    url.searchParams.set(
      'oauth_error',
      'GitHub OAuth not configured. Add GITHUB_OAUTH_CLIENT_SECRET to .env.local.'
    );
    return NextResponse.redirect(url);
  }

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${base}/api/auth/oauth/github/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state
  });

  const res = NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`
  );
  res.cookies.set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10,
    path: '/'
  });
  return res;
}
