import { NextResponse } from 'next/server';

// OAuth callback stub. Full implementation needs:
// 1. Exchange the `code` for an access_token via Google's token endpoint.
// 2. Fetch the user profile (email, sub, name).
// 3. Look up or create a user row, link by oauth_provider + oauth_sub.
// 4. Issue our JWT, set session, redirect to /canvas.
// Each piece touches the existing email/password auth (lib/auth.js) and
// the users table — left as a focused next step once the secret is filled.
//
// For now this route exists so the OAuth start redirect returns somewhere
// instead of a 404, and surfaces a clear "coming next" message in the UI.

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');

  const base = process.env.OAUTH_REDIRECT_BASE || 'http://localhost:3030';
  const home = new URL('/', base);

  if (errParam) {
    home.searchParams.set('oauth_error', `Google: ${errParam}`);
    return NextResponse.redirect(home);
  }

  if (!code || !state) {
    home.searchParams.set('oauth_error', 'Missing code/state from Google.');
    return NextResponse.redirect(home);
  }

  home.searchParams.set(
    'oauth_error',
    'Google OAuth callback not wired yet. The token exchange + user-link step ships next.'
  );
  return NextResponse.redirect(home);
}
