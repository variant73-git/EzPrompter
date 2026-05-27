/**
 * Handoff tokens — short-lived signed payloads that bind a pending capture
 * to a specific user + node + URL. Minted by the snapshot route when a
 * bot-protection challenge is detected; consumed by /api/snapshot/handoff
 * when the Uncraft extension ships back the user-verified DOM.
 *
 * Auth model: the token IS the auth. The /handoff endpoint does NOT
 * require the session cookie — the extension runs in a different origin
 * (chrome-extension://…) and cookies don't flow naturally. Token signature
 * + node-ownership check is enough because:
 *   - The token includes userId — the endpoint trusts it after sig verify.
 *   - The token is bound to nodeId — only that node can be written to.
 *   - Single-use enforcement: we reject if the node already has a
 *     snapshot from this token (idempotency).
 *   - Short TTL (5 min) bounds leak impact.
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const HANDOFF_TTL_SECONDS = 5 * 60;
const TOKEN_TYPE = 'uncraft.handoff.v1';

/**
 * Sign a handoff token for a freshly-created (or existing) node awaiting
 * a user-verified DOM capture. Caller must have already created/verified
 * the node belongs to the user.
 */
export function signHandoffToken({ userId, nodeId, url }) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not configured');
  if (!userId || !nodeId || !url) throw new Error('userId, nodeId, url all required');
  return jwt.sign(
    { typ: TOKEN_TYPE, userId, nodeId, url },
    JWT_SECRET,
    { expiresIn: HANDOFF_TTL_SECONDS }
  );
}

/**
 * Verify a handoff token. Returns the payload on success, or an object
 * with `error` set. We don't throw — callers want to return a structured
 * 4xx response, not crash the request.
 */
export function verifyHandoffToken(token) {
  if (!JWT_SECRET) return { error: 'server_misconfigured' };
  if (!token || typeof token !== 'string') return { error: 'missing_token' };
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload?.typ !== TOKEN_TYPE) return { error: 'wrong_token_type' };
    if (!payload.userId || !payload.nodeId || !payload.url) {
      return { error: 'malformed_token' };
    }
    return { payload };
  } catch (e) {
    if (e.name === 'TokenExpiredError') return { error: 'expired' };
    return { error: 'invalid_signature' };
  }
}

export const HANDOFF_TTL_MS = HANDOFF_TTL_SECONDS * 1000;
