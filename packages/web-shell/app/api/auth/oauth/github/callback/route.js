import { NextResponse } from 'next/server';

// See google/callback/route.js for the design rationale. Stub for now —
// real token exchange + user link ships once GITHUB_OAUTH_CLIENT_SECRET
// is filled.

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');

  const base = process.env.OAUTH_REDIRECT_BASE || 'http://localhost:3030';
  const home = new URL('/', base);

  if (errParam) {
    home.searchParams.set('oauth_error', `GitHub: ${errParam}`);
    return NextResponse.redirect(home);
  }

  if (!code || !state) {
    home.searchParams.set('oauth_error', 'Missing code/state from GitHub.');
    return NextResponse.redirect(home);
  }

  home.searchParams.set(
    'oauth_error',
    'GitHub OAuth callback not wired yet. The token exchange + user-link step ships next.'
  );
  return NextResponse.redirect(home);
}
