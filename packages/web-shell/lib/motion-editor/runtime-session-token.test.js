import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RUNTIME_SESSION_DEFAULT_TTL_SECONDS,
  RUNTIME_SESSION_EDIT_TTL_SECONDS,
  RUNTIME_SESSION_MAX_TTL_SECONDS,
  issueRuntimeSessionToken,
  resolveRuntimeOrigin,
  runtimeRequestUsesConfiguredOrigin,
  verifyRuntimeSessionToken,
} from './runtime-session-token.js';
import { sessionCookieHeader } from '../auth.js';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const BUNDLE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const RUNTIME_SECRET = 'runtime-only-secret-with-at-least-32-characters';
const LOGIN_SECRET = 'login-only-secret-with-at-least-32-characters';

afterEach(() => {
  delete process.env.UNCRAFT_RUNTIME_SESSION_SECRET;
  delete process.env.UNCRAFT_RUNTIME_ORIGIN;
  delete process.env.JWT_SECRET;
});

describe('runtime session tokens', () => {
  it('issues a compact, read-only token scoped to one node, bundle, session, and entry prefix', () => {
    const issued = issueRuntimeSessionToken({
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      entryPrefix: 'site',
      nonce: 'nonce-1234567890',
    }, {
      secret: RUNTIME_SECRET,
      nowSeconds: 1_800_000_000,
      ttlSeconds: 120,
      loginSecret: LOGIN_SECRET,
    });

    const verified = verifyRuntimeSessionToken(issued.token, {
      secret: RUNTIME_SECRET,
      nowSeconds: 1_800_000_060,
      loginSecret: LOGIN_SECRET,
    });

    expect(verified.error).toBeUndefined();
    expect(verified.payload).toMatchObject({
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      entryPrefix: 'site',
      nonce: 'nonce-1234567890',
      scope: 'bundle:read',
    });
    expect(verified.payload.expiresAt).toBe(issued.expiresAt);
    expect(verified.payload.expiresAtMs - 1_800_000_000_000).toBe(120_000);
    expect(issued.token).not.toContain(BUNDLE_ID);
    expect(issued.token).not.toContain('storageKey');
  });

  it('rejects expired, altered, wrong-secret, login, and overlong tokens', () => {
    const issued = issueRuntimeSessionToken({
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      nonce: 'nonce-1234567890',
    }, {
      secret: RUNTIME_SECRET,
      nowSeconds: 1_800_000_000,
      ttlSeconds: 60,
      loginSecret: LOGIN_SECRET,
    });

    expect(verifyRuntimeSessionToken(issued.token, {
      secret: RUNTIME_SECRET,
      nowSeconds: 1_800_000_061,
      loginSecret: LOGIN_SECRET,
    })).toMatchObject({ error: 'expired' });
    expect(verifyRuntimeSessionToken(`${issued.token.slice(0, -1)}x`, {
      secret: RUNTIME_SECRET,
      nowSeconds: 1_800_000_010,
      loginSecret: LOGIN_SECRET,
    })).toMatchObject({ error: 'invalid' });
    expect(verifyRuntimeSessionToken(issued.token, {
      secret: LOGIN_SECRET,
      nowSeconds: 1_800_000_010,
      loginSecret: 'another-login-secret-with-at-least-32-characters',
    })).toMatchObject({ error: 'invalid' });

    const loginToken = jwt.sign({ userId: 42 }, LOGIN_SECRET, { expiresIn: 60 });
    expect(verifyRuntimeSessionToken(loginToken, {
      secret: RUNTIME_SECRET,
      loginSecret: LOGIN_SECRET,
    })).toMatchObject({ error: 'invalid' });

    expect(() => issueRuntimeSessionToken({
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      nonce: 'nonce-1234567890',
    }, {
      secret: RUNTIME_SECRET,
      loginSecret: LOGIN_SECRET,
      ttlSeconds: RUNTIME_SESSION_MAX_TTL_SECONDS + 1,
    })).toThrow(/ttl/i);
  });

  it('supports a session-long edit TTL (4h) while keeping the short default (defect 1, 2026-08-20)', () => {
    // All 70 farmminerals <img> are loading=lazy: they are fetched on scroll,
    // AFTER the old 120s token died — every image 404'd mid-session. The edit
    // token now lives the session; revocation stays REAL because the gateway
    // checks the edit-session row (status='active') on every asset request.
    expect(RUNTIME_SESSION_EDIT_TTL_SECONDS).toBe(4 * 60 * 60);
    expect(RUNTIME_SESSION_MAX_TTL_SECONDS).toBe(4 * 60 * 60);
    expect(RUNTIME_SESSION_DEFAULT_TTL_SECONDS).toBe(2 * 60);

    const issued = issueRuntimeSessionToken({
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      nonce: 'nonce-1234567890',
    }, {
      secret: RUNTIME_SECRET,
      nowSeconds: 1_800_000_000,
      ttlSeconds: RUNTIME_SESSION_EDIT_TTL_SECONDS,
      loginSecret: LOGIN_SECRET,
    });
    // Alive well past the old 2-minute ceiling…
    const lateVerify = verifyRuntimeSessionToken(issued.token, {
      secret: RUNTIME_SECRET,
      nowSeconds: 1_800_000_000 + 3 * 60 * 60,
      loginSecret: LOGIN_SECRET,
    });
    expect(lateVerify.error).toBeUndefined();
    expect(lateVerify.payload.expiresAtMs - 1_800_000_000_000).toBe(RUNTIME_SESSION_EDIT_TTL_SECONDS * 1000);
    // …and the ceiling is still enforced on BOTH sides.
    const forged = jwt.sign({
      type: 'uncraft.runtime-session.v1',
      scope: 'bundle:read',
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      nonce: 'nonce-1234567890',
      entryPrefix: '',
      iat: 1_800_000_000,
      exp: 1_800_000_000 + RUNTIME_SESSION_MAX_TTL_SECONDS + 60,
    }, RUNTIME_SECRET, { audience: 'uncraft-native-runtime', issuer: 'uncraft-web-shell' });
    expect(verifyRuntimeSessionToken(forged, {
      secret: RUNTIME_SECRET,
      nowSeconds: 1_800_000_010,
      loginSecret: LOGIN_SECRET,
    })).toMatchObject({ error: 'invalid' });
  });

  it('refuses to reuse the Uncraft login secret', () => {
    expect(() => issueRuntimeSessionToken({
      nodeId: NODE_ID,
      bundleId: BUNDLE_ID,
      sessionId: SESSION_ID,
      nonce: 'nonce-1234567890',
    }, {
      secret: LOGIN_SECRET,
      loginSecret: LOGIN_SECRET,
    })).toThrow(/dedicated/i);
  });

  it('requires an isolated HTTPS runtime origin in production and pins runtime requests to it', () => {
    expect(resolveRuntimeOrigin('https://app.uncraft.test/api/nodes/x/runtime-session', {
      environment: 'production',
      configuredOrigin: 'https://runtime.uncraft-cdn.test',
    })).toBe('https://runtime.uncraft-cdn.test');
    expect(() => resolveRuntimeOrigin('https://app.uncraft.test/api/nodes/x/runtime-session', {
      environment: 'production',
      configuredOrigin: 'https://app.uncraft.test',
    })).toThrow(/isolated/i);
    expect(() => resolveRuntimeOrigin('https://app.uncraft.test/api/nodes/x/runtime-session', {
      environment: 'production',
      configuredOrigin: '',
    })).toThrow(/runtime origin/i);
    expect(() => resolveRuntimeOrigin('https://app.uncraft.test/api/nodes/x/runtime-session', {
      environment: 'production',
      configuredOrigin: 'http://runtime.uncraft-cdn.test',
    })).toThrow(/https/i);

    expect(runtimeRequestUsesConfiguredOrigin('https://runtime.uncraft-cdn.test/api/runtime/token/index.html', {
      environment: 'production',
      configuredOrigin: 'https://runtime.uncraft-cdn.test',
    })).toBe(true);
    expect(runtimeRequestUsesConfiguredOrigin('https://app.uncraft.test/api/runtime/token/index.html', {
      environment: 'production',
      configuredOrigin: 'https://runtime.uncraft-cdn.test',
    })).toBe(false);
    expect(runtimeRequestUsesConfiguredOrigin('https://app.uncraft.test/api/runtime/token/index.html', {
      environment: 'production',
      configuredOrigin: 'https://app.uncraft.test',
      appOrigin: 'https://app.uncraft.test',
    })).toBe(false);
    expect(runtimeRequestUsesConfiguredOrigin('http://localhost:3030/api/runtime/token/index.html', {
      environment: 'test',
      configuredOrigin: '',
    })).toBe(true);
  });

  it('keeps the Uncraft login cookie host-only so it is not scoped to the runtime origin', () => {
    const cookie = sessionCookieHeader('login-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toMatch(/(?:^|;)\s*Domain=/i);
  });
});
