import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { normalizeBundlePath } from '../native-clone/bundle-contract.js';

const TOKEN_TYPE = 'uncraft.runtime-session.v1';
const TOKEN_AUDIENCE = 'uncraft-native-runtime';
const TOKEN_ISSUER = 'uncraft-web-shell';
const TOKEN_SCOPE = 'bundle:read';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_PATTERN = /^[a-zA-Z0-9_-]{12,128}$/;

// DEBT (Sol advise 2026-08-20): the long-lived edit token is a bearer in the
// URL path with CORS *. Revocation is REAL — the gateway checks the edit
// session row (status='active', node/bundle/current-snapshot scope, and
// expires_at) on every request, and commit/discard/expiry close it — but the
// target design is a short entry token + a separate revocable asset lease.
// Do not extend this TTL further without building the lease. Known residuals
// of this interim design (Claude review 2026-08-20 #4/#5): (a) revocation
// only reaches NEW requests — assets already in the browser's private cache
// (max-age up to 4h) never re-consult the server; (b) the session lifetime is
// ABSOLUTE — drafts/commits don't extend expires_at (the JWT in every asset
// URL can't rotate mid-session anyway), so an editor left open >4h loses
// lazy asset serving until reopened; saves keep working (cookie-authed).
export const RUNTIME_SESSION_MAX_TTL_SECONDS = 4 * 60 * 60;
export const RUNTIME_SESSION_DEFAULT_TTL_SECONDS = 2 * 60;
// Edit sessions need assets alive for the WHOLE session: lazy-loaded images
// are fetched on scroll, long after a 2-minute token dies (defect: every
// farmminerals image 404'd mid-edit). The token cannot rotate mid-session —
// it lives in the PATH of every asset URL, so a swap would reload the iframe.
export const RUNTIME_SESSION_EDIT_TTL_SECONDS = 4 * 60 * 60;

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

/**
 * Todo motivo de recusa que `verifyRuntimeSessionToken` sabe devolver.
 *
 * Existe para que o gateway derive o vocabulário dele daqui em vez de repetir a
 * lista à mão — foi assim que `server_misconfigured` ficou de fora e viraria
 * omissão silenciosa no diagnóstico.
 */
export const TOKEN_VERIFICATION_ERRORS = Object.freeze(['missing', 'server_misconfigured', 'invalid', 'expired']);

/**
 * A fronteira: TODA recusa que sai daqui passa pelo vocabulário.
 *
 * O helper abaixo só checa quem o chama — um caminho novo escrevendo
 * `return { error: 'revoked' }` direto escaparia dele, que é a classe inteira
 * (Sol). Filtrar na SAÍDA não depende de como a recusa foi escrita lá dentro:
 * qualquer forma passa por aqui no caminho de volta.
 */
export function verifyRuntimeSessionToken(token, options = {}) {
  return normalizeTokenVerification(verificarToken(token, options));
}

/**
 * A fronteira, separada para poder ser testada de frente.
 *
 * Olha a PRESENÇA da chave, não a verdade do valor: `{ error: undefined }` é uma
 * recusa disfarçada de sucesso — quem consome lê `if (result.error)`, vê falso,
 * e segue como se houvesse payload (Sol).
 */
export function normalizeTokenVerification(resultado) {
  if (resultado && Object.hasOwn(resultado, 'error')) return tokenVerificationFailure(resultado.error);
  return resultado;
}

/**
 * A porta usada por dentro.
 *
 * Guardar o vocabulário por leitura da fonte prova a sintaxe escolhida, não a
 * classe: `return { error: \`x\` }`, `return { error: motivo }` ou um objeto
 * montado antes do `return` passariam batido (Sol). Aqui a checagem é sobre o
 * VALOR, no momento em que ele nasce, então nenhuma forma de escrita escapa.
 *
 * Fora de produção isso ESTOURA — quem acrescentou o motivo descobre na hora.
 * Em produção não: derrubar a verificação de um token seria trocar uma recusa
 * correta por um erro de servidor. Degrada para a recusa mais conservadora e
 * grita no log, que é ruidoso sem ser destrutivo.
 */
export function tokenVerificationFailure(motivo) {
  if (TOKEN_VERIFICATION_ERRORS.includes(motivo)) return { error: motivo };
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`motivo de recusa de token fora do vocabulario: ${String(motivo)}`);
  }
  // eslint-disable-next-line no-console
  console.error('motivo de recusa de token fora do vocabulario', { motivo: String(motivo) });
  return { error: 'invalid' };
}

function verificarToken(token, options = {}) {
  if (typeof token !== 'string' || !token) return tokenVerificationFailure('missing');
  let secret;
  try {
    secret = configuredSecret(options.secret, options.loginSecret);
  } catch {
    return tokenVerificationFailure('server_misconfigured');
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
      return tokenVerificationFailure('invalid');
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
    if (error?.name === 'TokenExpiredError') return tokenVerificationFailure('expired');
    return tokenVerificationFailure('invalid');
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
