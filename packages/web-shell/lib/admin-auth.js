import { requireUser } from './auth.js';

export const ADMIN_ROLE = 'admin';

export function isAdmin(user) {
  return user?.role === ADMIN_ROLE;
}

function forbidden() {
  return new Response(JSON.stringify({ error: 'forbidden' }), {
    status: 403,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export async function requireAdmin(request) {
  const { user, error } = await requireUser(request);
  if (error) return { user: null, error };
  if (!isAdmin(user)) return { user: null, error: forbidden() };
  return { user, error: null };
}
