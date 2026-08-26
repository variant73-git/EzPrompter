import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_BADGE_TTL_SECONDS,
  LEASE_TTL_SECONDS,
  mintBootstrapBadge,
  verifyBootstrapBadge,
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
