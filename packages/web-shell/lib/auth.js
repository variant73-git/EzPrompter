import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = 'uncraft_sess';

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function createToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, plan: user.plan },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Resolve the current user from either the session cookie OR an Authorization
 * Bearer header. Returns null if neither is valid.
 */
export async function getAuthUser(request) {
  let token = null;

  // Prefer cookie (used by canvas browser pages).
  const cookieHeader = request.headers.get('cookie') || '';
  const m = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`));
  if (m) token = decodeURIComponent(m[1]);

  // Fall back to Bearer (used by the Chrome extension and CLI clients).
  if (!token) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7);
  }

  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  const rows = await sql`SELECT * FROM users WHERE id = ${payload.userId}`;
  return rows[0] || null;
}

// Secure cookies in production only — localhost http dev sessions stay
// usable because Secure cookies would be rejected by the browser over
// plain http. NODE_ENV=production triggers the flag automatically; the
// reverse-proxy / Vercel runtime is always HTTPS.
const COOKIE_SECURE_FLAG = process.env.NODE_ENV === 'production' ? '; Secure' : '';

export function sessionCookieHeader(token) {
  // 30d, httpOnly, SameSite=Lax (good default for canvas SPA navigation),
  // Secure in production.
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE_FLAG}; Max-Age=${30 * 24 * 3600}`;
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE_FLAG}; Max-Age=0`;
}

/**
 * Convenience for App Router routes:
 *   const { user, error } = await requireUser(req);
 *   if (error) return error;
 */
export async function requireUser(request) {
  const user = await getAuthUser(request);
  if (!user) {
    return {
      user: null,
      error: new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    };
  }
  return { user, error: null };
}
