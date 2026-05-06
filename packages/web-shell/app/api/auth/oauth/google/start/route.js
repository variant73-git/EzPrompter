import { NextResponse } from 'next/server';
import crypto from 'crypto';

// OAuth start: builds Google's auth URL and redirects.
// The full handshake (token exchange + user create/link + JWT) lives in
// the matching /callback route — that's the next implementation step.
//
// If the env secrets are missing, we redirect back to the home page with
// an inline error so the UI can communicate the gap clearly instead of
// silently 500-ing.

export async function GET() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const base = process.env.OAUTH_REDIRECT_BASE || 'http://localhost:3030';

  if (!clientId || !secret || secret.startsWith('PASTE_')) {
    const url = new URL('/', base);
    url.searchParams.set(
      'oauth_error',
      'Google OAuth not configured. Add GOOGLE_OAUTH_CLIENT_SECRET to .env.local.'
    );
    return NextResponse.redirect(url);
  }

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${base}/api/auth/oauth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent'
  });

  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
  // Persist state for callback verification.
  res.cookies.set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10,
    path: '/'
  });
  return res;
}
