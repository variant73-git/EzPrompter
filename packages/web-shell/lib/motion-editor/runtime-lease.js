import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { normalizeBundlePath } from '../native-clone/bundle-contract.js';

// ── Badge de bootstrap (one-shot) ────────────────────────────────────────────
// NÃO é o token legado de sessão: tipo/audience/escopo PRÓPRIOS (o legado é
// `bundle:read` e também autoriza upload — Sol r1 §6). O badge só compra UMA
// coisa: o consumo atômico que cria a lease e grava o cookie. O `jti` é a
// chave desse consumo (UNIQUE no banco); o verificador legado recusa este
// `typ` por construção, e vice-versa.
const BADGE_TYPE = 'uncraft.runtime-bootstrap.v1';
const BADGE_AUDIENCE = 'uncraft-runtime-bootstrap';
const BADGE_ISSUER = 'uncraft-web-shell';
const BADGE_SCOPE = 'session:bootstrap';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Hostname PURO: identidade validada nunca carrega porta nem maiúscula — a
// porta pertence à authority da URL, construída em outro lugar (Sol r3 #4).
const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/;

export const BOOTSTRAP_BADGE_TTL_SECONDS = 60;
// Sliding NO BANCO: o cookie da lease é de SESSÃO (sem Max-Age/Expires — um
// cookie com idade pararia de ser enviado às 4h e mataria a renovação, Sol
// r3 #1); esta constante governa o `expires_at` da linha, que a renovação
// estende.
export const LEASE_TTL_SECONDS = 4 * 60 * 60;
export const LEASE_RENEW_INTERVAL_MS = 10 * 60 * 1000;

function configuredSecret(secret, loginSecret) {
  const value = secret ?? process.env.UNCRAFT_RUNTIME_SESSION_SECRET;
  const appSecret = loginSecret ?? process.env.JWT_SECRET;
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error('UNCRAFT_RUNTIME_SESSION_SECRET must contain at least 32 characters');
  }
  if (appSecret && value === appSecret) {
    throw new Error('Runtime bootstrap badges require a dedicated signing secret');
  }
  return value;
}

function uuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError(`${label} must be a UUID`);
  return value.toLowerCase();
}

function entryPath(value) {
  const normalized = normalizeBundlePath(value, { label: 'runtime entry path' });
  if (normalized !== value || normalized.endsWith('/')) throw new TypeError('Runtime entry path must be canonical');
  return normalized;
}

function hostname(value) {
  if (typeof value !== 'string' || !HOSTNAME_PATTERN.test(value)) {
    throw new TypeError('Runtime hostname must be a pure lowercase hostname without port');
  }
  return value;
}

export function mintBootstrapBadge(input, options = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Bootstrap badge input is required');
  const secret = configuredSecret(options.secret, options.loginSecret);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new TypeError('nowSeconds must be a Unix timestamp');
  const jti = randomBytes(16).toString('hex');
  const sessionId = uuid(input.sessionId, 'sessionId');
  const payload = {
    typ: BADGE_TYPE,
    scope: BADGE_SCOPE,
    nodeId: uuid(input.nodeId, 'nodeId'),
    bundleId: uuid(input.bundleId, 'bundleId'),
    sessionId,
    entryPath: entryPath(input.entryPath),
    hostname: hostname(input.hostname),
    iat: nowSeconds,
  };
  const badge = jwt.sign(payload, secret, {
    algorithm: 'HS256',
    audience: BADGE_AUDIENCE,
    issuer: BADGE_ISSUER,
    subject: sessionId,
    jwtid: jti,
    expiresIn: BOOTSTRAP_BADGE_TTL_SECONDS,
  });
  const expiresAtMs = (nowSeconds + BOOTSTRAP_BADGE_TTL_SECONDS) * 1000;
  return { badge, jti, expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs };
}

/** Vocabulário FECHADO — mesma disciplina do token legado: toda recusa nasce aqui. */
export const BADGE_VERIFICATION_ERRORS = Object.freeze(['missing', 'server_misconfigured', 'invalid', 'expired']);

function badgeVerificationFailure(motivo) {
  if (BADGE_VERIFICATION_ERRORS.includes(motivo)) return { error: motivo };
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`motivo de recusa de badge fora do vocabulario: ${String(motivo)}`);
  }
  // eslint-disable-next-line no-console
  console.error('motivo de recusa de badge fora do vocabulario', { motivo: String(motivo) });
  return { error: 'invalid' };
}

export function verifyBootstrapBadge(badge, options = {}) {
  if (typeof badge !== 'string' || !badge) return badgeVerificationFailure('missing');
  let secret;
  try {
    secret = configuredSecret(options.secret, options.loginSecret);
  } catch {
    return badgeVerificationFailure('server_misconfigured');
  }
  try {
    const payload = jwt.verify(badge, secret, {
      algorithms: ['HS256'],
      audience: BADGE_AUDIENCE,
      issuer: BADGE_ISSUER,
      clockTimestamp: options.nowSeconds,
    });
    if (!payload || typeof payload !== 'object'
      || payload.typ !== BADGE_TYPE
      || payload.scope !== BADGE_SCOPE
      || payload.sub !== payload.sessionId
      || typeof payload.jti !== 'string' || !/^[0-9a-f]{32}$/.test(payload.jti)
      || !Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || payload.exp <= payload.iat
      || payload.exp - payload.iat > BOOTSTRAP_BADGE_TTL_SECONDS) {
      return badgeVerificationFailure('invalid');
    }
    const parsed = {
      nodeId: uuid(payload.nodeId, 'nodeId'),
      bundleId: uuid(payload.bundleId, 'bundleId'),
      sessionId: uuid(payload.sessionId, 'sessionId'),
      entryPath: entryPath(payload.entryPath),
      hostname: hostname(payload.hostname),
      jti: payload.jti,
      scope: BADGE_SCOPE,
      issuedAtMs: payload.iat * 1000,
      expiresAtMs: payload.exp * 1000,
    };
    return { payload: Object.freeze(parsed) };
  } catch (error) {
    if (error?.name === 'TokenExpiredError') return badgeVerificationFailure('expired');
    return badgeVerificationFailure('invalid');
  }
}
