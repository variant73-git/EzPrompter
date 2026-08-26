import { createHash, randomBytes } from 'node:crypto';
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

// ── Lease opaca revogável ────────────────────────────────────────────────────
// O banco guarda SÓ o sha256 do valor do cookie: um vazamento de banco não
// vira cookie vivo. A validade mora 100% na linha (`expires_at`, sliding);
// o cookie é de sessão de browser, sem idade própria.

function assertSql(sql) {
  if (typeof sql !== 'function') throw new TypeError('A tagged SQL client is required');
}

function sha256hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

const LEASE_ERRORS = Object.freeze(['missing', 'invalid', 'expired', 'revoked', 'host_mismatch', 'badge_used', 'conflict']);

function leaseFailure(motivo) {
  if (LEASE_ERRORS.includes(motivo)) return { error: motivo };
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`motivo de recusa de lease fora do vocabulario: ${String(motivo)}`);
  }
  // eslint-disable-next-line no-console
  console.error('motivo de recusa de lease fora do vocabulario', { motivo: String(motivo) });
  return { error: 'invalid' };
}

/**
 * Consome o badge e cria a lease — replay-safe POR ORDEM, não por transação:
 *
 * 1. O revoke da lease ativa anterior é GUARDADO por "este jti ainda não foi
 *    consumido" (`NOT EXISTS`). Um badge replicado não revoga nada.
 * 2. O INSERT com `ON CONFLICT (badge_jti) DO NOTHING` é o consumo atômico:
 *    zero linhas de volta = badge já usado = nada foi mutado nesta chamada.
 *
 * Invariante de lease ÚNICA ativa por sessão (Sol r4 #1): o passo 1 abre
 * espaço, o índice parcial do banco é o cinto; dois badges FRESCOS diferentes
 * correndo para a mesma sessão = o segundo perde no índice → 'conflict'
 * (um runtime vivo por sessão é o modelo — o outro lado cai na máscara).
 */
export async function createLeaseFromBadge({ sql, payload }) {
  assertSql(sql);
  if (!payload || typeof payload !== 'object') throw new TypeError('A verified badge payload is required');
  const cookieValue = randomBytes(32).toString('base64url');
  const leaseHash = sha256hex(cookieValue);
  try {
    await sql`
      UPDATE native_runtime_leases SET status = 'revoked'
       WHERE edit_session_id = ${payload.sessionId}
         AND status = 'active'
         AND NOT EXISTS (SELECT 1 FROM native_runtime_leases WHERE badge_jti = ${payload.jti})
    `;
    const rows = await sql`
      INSERT INTO native_runtime_leases
        (lease_hash, badge_jti, edit_session_id, node_id, bundle_id, hostname, expires_at)
      VALUES (${leaseHash}, ${payload.jti}, ${payload.sessionId}, ${payload.nodeId},
              ${payload.bundleId}, ${payload.hostname},
              NOW() + make_interval(secs => ${LEASE_TTL_SECONDS}))
      ON CONFLICT (badge_jti) DO NOTHING
      RETURNING id, edit_session_id, node_id, bundle_id, hostname, status, expires_at
    `;
    if (!rows[0]) return leaseFailure('badge_used');
    return { cookieValue, lease: rows[0] };
  } catch (error) {
    if (error?.code === '23505') return leaseFailure('conflict');
    throw error;
  }
}

export async function verifyLease({ sql, cookieValue, hostname: requestHostname, sessionId }) {
  assertSql(sql);
  if (typeof cookieValue !== 'string' || !cookieValue) return leaseFailure('missing');
  const rows = await sql`
    SELECT id, edit_session_id, node_id, bundle_id, hostname, status, expires_at
      FROM native_runtime_leases
     WHERE lease_hash = ${sha256hex(cookieValue)}
  `;
  const lease = rows[0];
  if (!lease) return leaseFailure('invalid');
  if (lease.status === 'revoked' || lease.status === 'expired') return leaseFailure('revoked');
  if (new Date(lease.expires_at).getTime() <= Date.now()) return leaseFailure('expired');
  // Igualdade EXATA, minúscula dos dois lados — nunca sufixo/endsWith.
  if (typeof requestHostname !== 'string'
    || requestHostname.toLowerCase() !== String(lease.hostname).toLowerCase()) {
    return leaseFailure('host_mismatch');
  }
  if (sessionId && String(lease.edit_session_id) !== String(sessionId)) return leaseFailure('invalid');
  return { lease };
}

/** Sliding CERCADO (lição 162): linha morta ou vencida NUNCA ressuscita. */
export async function renewLease({ sql, sessionId }) {
  assertSql(sql);
  const rows = await sql`
    UPDATE native_runtime_leases
       SET expires_at = NOW() + make_interval(secs => ${LEASE_TTL_SECONDS}),
           renewed_at = NOW()
     WHERE edit_session_id = ${sessionId}
       AND status = 'active'
       AND expires_at > NOW()
    RETURNING expires_at
  `;
  if (!rows[0]) return { renewed: false };
  return { renewed: true, expiresAt: rows[0].expires_at };
}

export async function revokeLeasesForSession({ sql, sessionId }) {
  assertSql(sql);
  await sql`
    UPDATE native_runtime_leases SET status = 'revoked'
     WHERE edit_session_id = ${sessionId} AND status = 'active'
  `;
}

/** GC: ativa vencida vira 'expired' — chamado pelo cron de reconciliação. */
export async function reapExpiredLeases({ sql }) {
  assertSql(sql);
  await sql`
    UPDATE native_runtime_leases SET status = 'expired'
     WHERE status = 'active' AND expires_at <= NOW()
  `;
}

// ── Cookie ───────────────────────────────────────────────────────────────────
// SEM Max-Age/Expires — cookie de sessão de browser; a expiração é 100%
// server-side na linha da lease (Sol r3 #1: idade no cookie faria o browser
// parar de enviá-lo às 4h, e o app não pode reemitir __Host- de outro host).
// CHIPS (`Partitioned`): Safari ganhou em 18.4 e há relato de desativação em
// 18.5 — capacidade por browser fica registrada no finding de aceite, não
// aqui como piso de versão. Dev http puro rebaixa o NOME (__Host- exige
// Secure), nunca a semântica; o witness/aceite roda em https local.
export function leaseCookieName({ secure = true } = {}) {
  return secure ? '__Host-rt' : 'uncraft_rt';
}

export function leaseCookieHeader(cookieValue, { secure = true } = {}) {
  if (typeof cookieValue !== 'string' || !cookieValue) throw new TypeError('A cookie value is required');
  if (!secure) return `uncraft_rt=${cookieValue}; HttpOnly; SameSite=Lax; Path=/`;
  return `__Host-rt=${cookieValue}; Secure; HttpOnly; SameSite=None; Partitioned; Path=/`;
}

// ── Hostname por sessão ──────────────────────────────────────────────────────
// 32 hex = 128 bits: reuso por colisão é desprezível POR CONSTRUÇÃO (o UNIQUE
// do banco é cinto, com retry de unique_violation no chamador). Mintado UMA
// vez por sessão de edição e PERSISTIDO nela — resume/F5 reusa o mesmo host,
// senão cada reabertura mudaria a partição e destruiria o cache (Sol r3 #2).
export function mintRuntimeHostname({ suffix } = {}) {
  if (typeof suffix !== 'string' || !HOSTNAME_PATTERN.test(suffix)) {
    throw new TypeError('Runtime host suffix must be a pure lowercase hostname without port');
  }
  return `${randomBytes(16).toString('hex')}.${suffix}`;
}

/** Igualdade de HOSTNAME puro (minúsculo, sem porta) — nunca sufixo/endsWith. */
export function runtimeRequestUsesSessionHost(requestUrl, expectedHostname) {
  try {
    return new URL(requestUrl).hostname.toLowerCase() === String(expectedHostname || '').toLowerCase();
  } catch {
    return false;
  }
}
