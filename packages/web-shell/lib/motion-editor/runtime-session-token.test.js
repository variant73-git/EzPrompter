import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it } from 'vitest';
import {
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
