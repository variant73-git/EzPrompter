import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { normalizeBundlePath } from '../native-clone/bundle-contract.js';

const TOKEN_TYPE = 'uncraft.runtime-session.v1';
const TOKEN_AUDIENCE = 'uncraft-native-runtime';
const TOKEN_ISSUER = 'uncraft-web-shell';
const TOKEN_SCOPE = 'bundle:read';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_PATTERN = /^[a-zA-Z0-9_-]{12,128}$/;

export const RUNTIME_SESSION_MAX_TTL_SECONDS = 5 * 60;
export const RUNTIME_SESSION_DEFAULT_TTL_SECONDS = 2 * 60;

function configuredSecret(secret, loginSecret) {
  const value = secret ?? process.env.UNCRAFT_RUNTIME_SESSION_SECRET;
  const appSecret = loginSecret ?? process.env.JWT_SECRET;
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error('UNCRAFT_RUNTIME_SESSION_SECRET must contain at least 32 characters');
  }
  if (appSecret && value === appSecret) {
    throw new Error('Runtime session tokens require a dedicated signing secret');
  }
  return value;
}

export function assertRuntimeSessionSigningConfiguration(options = {}) {
  configuredSecret(options.secret, options.loginSecret);
  return true;
}

function uuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError(`${label} must be a UUID`);
  return value.toLowerCase();
}

function entryPrefix(value = '') {
  if (value === '') return '';
  const normalized = normalizeBundlePath(value, { label: 'runtime entry prefix' });
  if (normalized !== value || normalized.endsWith('/')) throw new TypeError('Runtime entry prefix must be canonical');
  return normalized;
}

function nonce(value) {
  const result = value || randomBytes(18).toString('base64url');
  if (!NONCE_PATTERN.test(result)) throw new TypeError('Runtime session nonce must be URL-safe and unpredictable');
  return result;
}

function ttlSeconds(value) {
  const ttl = value ?? RUNTIME_SESSION_DEFAULT_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > RUNTIME_SESSION_MAX_TTL_SECONDS) {
    throw new TypeError(`Runtime session TTL must be between 1 and ${RUNTIME_SESSION_MAX_TTL_SECONDS} seconds`);
  }
  return ttl;
}

export function issueRuntimeSessionToken(input, options = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Runtime session token input is required');
  const secret = configuredSecret(options.secret, options.loginSecret);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new TypeError('nowSeconds must be a Unix timestamp');
  const ttl = ttlSeconds(options.ttlSeconds);
  const sessionNonce = nonce(input.nonce);
  const sessionId = uuid(input.sessionId, 'sessionId');
  const payload = {
    typ: TOKEN_TYPE,
    scope: TOKEN_SCOPE,
    nodeId: uuid(input.nodeId, 'nodeId'),
    bundleId: uuid(input.bundleId, 'bundleId'),
    sessionId,
    entryPrefix: entryPrefix(input.entryPrefix),
    nonce: sessionNonce,
    iat: nowSeconds,
  };
  const token = jwt.sign(payload, secret, {
    algorithm: 'HS256',
    audience: TOKEN_AUDIENCE,
    issuer: TOKEN_ISSUER,
    subject: sessionId,
    expiresIn: ttl,
  });
  const expiresAtMs = (nowSeconds + ttl) * 1000;
  return {
    token,
    nonce: sessionNonce,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };
}

export function verifyRuntimeSessionToken(token, options = {}) {
  if (typeof token !== 'string' || !token) return { error: 'missing' };
  let secret;
  try {
    secret = configuredSecret(options.secret, options.loginSecret);
  } catch {
    return { error: 'server_misconfigured' };
  }
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      audience: TOKEN_AUDIENCE,
      issuer: TOKEN_ISSUER,
      clockTimestamp: options.nowSeconds,
    });
    if (!payload || typeof payload !== 'object'
      || payload.typ !== TOKEN_TYPE
      || payload.scope !== TOKEN_SCOPE
      || payload.sub !== payload.sessionId
      || !Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || payload.exp <= payload.iat
      || payload.exp - payload.iat > RUNTIME_SESSION_MAX_TTL_SECONDS) {
      return { error: 'invalid' };
    }
    const parsed = {
      nodeId: uuid(payload.nodeId, 'nodeId'),
      bundleId: uuid(payload.bundleId, 'bundleId'),
      sessionId: uuid(payload.sessionId, 'sessionId'),
      entryPrefix: entryPrefix(payload.entryPrefix),
      nonce: nonce(payload.nonce),
      scope: TOKEN_SCOPE,
      issuedAtMs: payload.iat * 1000,
      expiresAtMs: payload.exp * 1000,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
    return { payload: Object.freeze(parsed) };
  } catch (error) {
    if (error?.name === 'TokenExpiredError') return { error: 'expired' };
    return { error: 'invalid' };
  }
}

function parsedOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL`);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must contain only an origin`);
  }
  return url.origin;
}

export function resolveRuntimeOrigin(requestUrl, {
  environment = process.env.NODE_ENV,
  configuredOrigin = process.env.UNCRAFT_RUNTIME_ORIGIN,
} = {}) {
  const appOrigin = new URL(requestUrl).origin;
  if (!configuredOrigin) {
    if (environment === 'production') throw new Error('A dedicated runtime origin is required in production');
    return appOrigin;
  }
  const runtimeOrigin = parsedOrigin(configuredOrigin, 'UNCRAFT_RUNTIME_ORIGIN');
  if (environment === 'production') {
    if (!runtimeOrigin.startsWith('https://')) throw new Error('Production runtime origin must use HTTPS');
    if (runtimeOrigin === appOrigin) throw new Error('Production runtime origin must be isolated from the Uncraft app origin');
  }
  return runtimeOrigin;
}

export function runtimeRequestUsesConfiguredOrigin(requestUrl, {
  environment = process.env.NODE_ENV,
  configuredOrigin = process.env.UNCRAFT_RUNTIME_ORIGIN,
  appOrigin = process.env.NEXT_PUBLIC_APP_URL,
} = {}) {
  if (!configuredOrigin) return environment !== 'production';
  try {
    const expected = parsedOrigin(configuredOrigin, 'UNCRAFT_RUNTIME_ORIGIN');
    if (environment === 'production' && !expected.startsWith('https://')) return false;
    if (environment === 'production' && appOrigin
      && expected === parsedOrigin(appOrigin, 'NEXT_PUBLIC_APP_URL')) return false;
    return new URL(requestUrl).origin === expected;
  } catch {
    return false;
  }
}
