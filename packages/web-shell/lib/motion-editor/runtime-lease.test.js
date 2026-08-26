import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOTSTRAP_BADGE_TTL_SECONDS,
  LEASE_TTL_SECONDS,
  createLeaseFromBadge,
  leaseCookieHeader,
  leaseCookieName,
  mintBootstrapBadge,
  reapExpiredLeases,
  renewLease,
  revokeLeasesForSession,
  verifyBootstrapBadge,
  verifyLease,
} from './runtime-lease.js';
import { issueRuntimeSessionToken, verifyRuntimeSessionToken } from './runtime-session-token.js';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const BUNDLE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const RUNTIME_SECRET = 'runtime-only-secret-with-at-least-32-characters';
const LOGIN_SECRET = 'login-only-secret-with-at-least-32-characters';
const HOSTNAME = 'a1b2c3d4e5f60718293a4b5c6d7e8f90.rt.uncraft.test';

const INPUT = Object.freeze({
  nodeId: NODE_ID,
  bundleId: BUNDLE_ID,
  sessionId: SESSION_ID,
  entryPath: 'site/index.html',
  hostname: HOSTNAME,
});

const OPTIONS = Object.freeze({
  secret: RUNTIME_SECRET,
  loginSecret: LOGIN_SECRET,
  nowSeconds: 1_800_000_000,
});

afterEach(() => {
  delete process.env.UNCRAFT_RUNTIME_SESSION_SECRET;
  delete process.env.JWT_SECRET;
});

describe('bootstrap badge (one-shot, session:bootstrap)', () => {
  it('mints with its own type, audience, scope, jti and 60s TTL', () => {
    const { badge, jti, expiresAt } = mintBootstrapBadge(INPUT, OPTIONS);
    const decoded = jwt.decode(badge);
    expect(decoded.typ).toBe('uncraft.runtime-bootstrap.v1');
    expect(decoded.aud).toBe('uncraft-runtime-bootstrap');
    expect(decoded.iss).toBe('uncraft-web-shell');
    expect(decoded.scope).toBe('session:bootstrap');
    expect(decoded.jti).toBe(jti);
    expect(jti).toMatch(/^[0-9a-f]{32}$/);
    expect(decoded.exp - decoded.iat).toBe(BOOTSTRAP_BADGE_TTL_SECONDS);
    expect(expiresAt).toBe(new Date((OPTIONS.nowSeconds + BOOTSTRAP_BADGE_TTL_SECONDS) * 1000).toISOString());
  });

  it('round-trips the payload through verification', () => {
    const { badge } = mintBootstrapBadge(INPUT, OPTIONS);
    const verified = verifyBootstrapBadge(badge, OPTIONS);
    expect(verified.error).toBeUndefined();
    expect(verified.payload).toMatchObject({
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      entryPath: 'site/index.html',
      hostname: HOSTNAME,
    });
    expect(verified.payload.jti).toMatch(/^[0-9a-f]{32}$/);
  });

  it('the legacy verifier REJECTS a bootstrap badge', () => {
    const { badge } = mintBootstrapBadge(INPUT, OPTIONS);
    expect(verifyRuntimeSessionToken(badge, { secret: RUNTIME_SECRET, loginSecret: LOGIN_SECRET }).error).toBe('invalid');
  });

  it('the badge verifier REJECTS a legacy runtime token', () => {
    const issued = issueRuntimeSessionToken({
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      entryPrefix: 'site',
    }, { secret: RUNTIME_SECRET, loginSecret: LOGIN_SECRET, nowSeconds: OPTIONS.nowSeconds });
    expect(verifyBootstrapBadge(issued.token, OPTIONS).error).toBe('invalid');
  });

  it('hostname must be a pure lowercase hostname — never an authority with a port', () => {
    expect(() => mintBootstrapBadge({ ...INPUT, hostname: `${HOSTNAME}:3030` }, OPTIONS)).toThrow();
    expect(() => mintBootstrapBadge({ ...INPUT, hostname: HOSTNAME.toUpperCase() }, OPTIONS)).toThrow();
    expect(() => mintBootstrapBadge({ ...INPUT, hostname: '' }, OPTIONS)).toThrow();
  });

  it('entryPath must be canonical', () => {
    expect(() => mintBootstrapBadge({ ...INPUT, entryPath: '../escape.html' }, OPTIONS)).toThrow();
    expect(() => mintBootstrapBadge({ ...INPUT, entryPath: '' }, OPTIONS)).toThrow();
  });

  it('expired badge -> {error:"expired"}', () => {
    const { badge } = mintBootstrapBadge(INPUT, OPTIONS);
    const later = { ...OPTIONS, nowSeconds: OPTIONS.nowSeconds + BOOTSTRAP_BADGE_TTL_SECONDS + 1 };
    expect(verifyBootstrapBadge(badge, later).error).toBe('expired');
  });

  it('missing/garbage/misconfigured secrets produce the closed vocabulary', () => {
    expect(verifyBootstrapBadge('', OPTIONS).error).toBe('missing');
    expect(verifyBootstrapBadge('not-a-jwt', OPTIONS).error).toBe('invalid');
    expect(verifyBootstrapBadge('x.y.z', { secret: 'short' }).error).toBe('server_misconfigured');
  });

  it('a badge signed for a different hostname still round-trips its OWN hostname (binding is data, checking is the route)', () => {
    const other = mintBootstrapBadge({ ...INPUT, hostname: 'ffff0000ffff0000ffff0000ffff0000.rt.uncraft.test' }, OPTIONS);
    expect(verifyBootstrapBadge(other.badge, OPTIONS).payload.hostname)
      .toBe('ffff0000ffff0000ffff0000ffff0000.rt.uncraft.test');
  });

  it('lease TTL constant matches the sliding design (4h, renewed by the app)', () => {
    expect(LEASE_TTL_SECONDS).toBe(4 * 60 * 60);
  });
});

function sha256hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createSql(results = []) {
  const calls = [];
  const sql = vi.fn((strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    calls.push({ text, values });
    return Promise.resolve(results.shift() || []);
  });
  sql.calls = calls;
  return sql;
}

function badgePayload(overrides = {}) {
  const { badge } = mintBootstrapBadge(INPUT, OPTIONS);
  return { ...verifyBootstrapBadge(badge, OPTIONS).payload, ...overrides };
}

function leaseRow(overrides = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    edit_session_id: SESSION_ID,
    node_id: NODE_ID,
    bundle_id: BUNDLE_ID,
    hostname: HOSTNAME,
    status: 'active',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe('lease CRUD', () => {
  it('createLeaseFromBadge: revoke is guarded by unconsumed jti, insert consumes atomically', async () => {
    const payload = badgePayload();
    const sql = createSql([[], [leaseRow()]]);
    const result = await createLeaseFromBadge({ sql, payload });
    expect(result.error).toBeUndefined();
    expect(result.lease).toBeTruthy();

    const revoke = sql.calls[0];
    expect(revoke.text).toMatch(/UPDATE native_runtime_leases/);
    expect(revoke.text).toMatch(/status = 'revoked'/);
    // Replay-safe por construção: o revoke SÓ acontece se o jti ainda não foi
    // consumido — senão um badge replicado revogaria a lease viva da sessão.
    expect(revoke.text).toMatch(/NOT EXISTS/);
    expect(revoke.values).toContain(payload.jti);

    const insert = sql.calls[1];
    expect(insert.text).toMatch(/INSERT INTO native_runtime_leases/);
    expect(insert.text).toMatch(/ON CONFLICT \(badge_jti\) DO NOTHING/);
    expect(insert.values).toContain(payload.jti);
  });

  it('cookieValue is 32 random bytes base64url and only its sha256 reaches the DB', async () => {
    const payload = badgePayload();
    const sql = createSql([[], [leaseRow()]]);
    const { cookieValue } = await createLeaseFromBadge({ sql, payload });
    expect(cookieValue).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const insert = sql.calls[1];
    expect(insert.values).toContain(sha256hex(cookieValue));
    expect(insert.values).not.toContain(cookieValue);
  });

  it('a consumed badge yields {error:"badge_used"} and mutates nothing', async () => {
    const payload = badgePayload();
    const sql = createSql([[], []]); // insert returns no row -> conflict
    const result = await createLeaseFromBadge({ sql, payload });
    expect(result.error).toBe('badge_used');
    expect(result.cookieValue).toBeUndefined();
  });

  it('verifyLease: happy path checks hash, host, session and expiry', async () => {
    const sql = createSql([[leaseRow()]]);
    const result = await verifyLease({ sql, cookieValue: 'v'.repeat(43), hostname: HOSTNAME, sessionId: SESSION_ID });
    expect(result.error).toBeUndefined();
    expect(result.lease.hostname).toBe(HOSTNAME);
    expect(sql.calls[0].values).toContain(sha256hex('v'.repeat(43)));
  });

  it('verifyLease: exact lowercase host equality — mismatch refuses', async () => {
    const sql = createSql([[leaseRow()]]);
    const result = await verifyLease({ sql, cookieValue: 'v'.repeat(43), hostname: 'other.rt.uncraft.test', sessionId: SESSION_ID });
    expect(result.error).toBe('host_mismatch');
  });

  it('verifyLease: session mismatch, expiry, revocation and absence are typed', async () => {
    expect((await verifyLease({ sql: createSql([[leaseRow()]]), cookieValue: 'v'.repeat(43), hostname: HOSTNAME, sessionId: NODE_ID })).error).toBe('invalid');
    expect((await verifyLease({ sql: createSql([[leaseRow({ expires_at: new Date(Date.now() - 1000).toISOString() })]]), cookieValue: 'v'.repeat(43), hostname: HOSTNAME, sessionId: SESSION_ID })).error).toBe('expired');
    expect((await verifyLease({ sql: createSql([[leaseRow({ status: 'revoked' })]]), cookieValue: 'v'.repeat(43), hostname: HOSTNAME, sessionId: SESSION_ID })).error).toBe('revoked');
    expect((await verifyLease({ sql: createSql([[]]), cookieValue: 'v'.repeat(43), hostname: HOSTNAME, sessionId: SESSION_ID })).error).toBe('invalid');
    expect((await verifyLease({ sql: createSql([[]]), cookieValue: '', hostname: HOSTNAME, sessionId: SESSION_ID })).error).toBe('missing');
  });

  it('renewLease slides expires_at ONLY on active, unexpired rows (fenced transition)', async () => {
    const sql = createSql([[{ expires_at: '2026-08-26T14:00:00.000Z' }]]);
    const result = await renewLease({ sql, sessionId: SESSION_ID });
    expect(result.renewed).toBe(true);
    const update = sql.calls[0];
    expect(update.text).toMatch(/status = 'active'/);
    expect(update.text).toMatch(/expires_at > NOW\(\)/);
    expect(update.values).toContain(SESSION_ID);
  });

  it('renewLease on a dead session renews nothing', async () => {
    const result = await renewLease({ sql: createSql([[]]), sessionId: SESSION_ID });
    expect(result.renewed).toBe(false);
  });

  it('revokeLeasesForSession revokes only active rows; reapExpiredLeases expires the overdue', async () => {
    const sqlRevoke = createSql([[]]);
    await revokeLeasesForSession({ sql: sqlRevoke, sessionId: SESSION_ID });
    expect(sqlRevoke.calls[0].text).toMatch(/SET status = 'revoked'/);
    expect(sqlRevoke.calls[0].text).toMatch(/status = 'active'/);

    const sqlReap = createSql([[]]);
    await reapExpiredLeases({ sql: sqlReap });
    expect(sqlReap.calls[0].text).toMatch(/SET status = 'expired'/);
    expect(sqlReap.calls[0].text).toMatch(/expires_at <= NOW\(\)/);
  });

  it('the lease cookie is a SESSION cookie: no Max-Age, no Expires', () => {
    const header = leaseCookieHeader('value123');
    expect(header).toBe('__Host-rt=value123; Secure; HttpOnly; SameSite=None; Partitioned; Path=/');
    expect(header).not.toMatch(/Max-Age|Expires/i);
  });

  it('dev over plain http downgrades the cookie NAME, never the semantics', () => {
    expect(leaseCookieName()).toBe('__Host-rt');
    expect(leaseCookieName({ secure: false })).toBe('uncraft_rt');
    const header = leaseCookieHeader('v', { secure: false });
    expect(header).toBe('uncraft_rt=v; HttpOnly; SameSite=Lax; Path=/');
    expect(header).not.toMatch(/Max-Age|Expires/i);
  });
});
