import { describe, expect, it } from 'vitest';
import {
  decideHostRouting,
  isRuntimeHost,
  runtimeSuffixSharesRegistrableDomain,
} from './runtime-host-guard.js';

const SUFFIX = 'rt.uncraft.test';

describe('isRuntimeHost', () => {
  it('matches exactly one nonce label under the suffix, ignoring the port', () => {
    expect(isRuntimeHost('a1b2.rt.uncraft.test', SUFFIX)).toBe(true);
    expect(isRuntimeHost('a1b2.rt.uncraft.test:3030', SUFFIX)).toBe(true);
    expect(isRuntimeHost('A1B2.RT.UNCRAFT.TEST', SUFFIX)).toBe(true);
  });

  it('never matches the bare suffix, deeper labels, look-alikes or empty config', () => {
    expect(isRuntimeHost('rt.uncraft.test', SUFFIX)).toBe(false);
    expect(isRuntimeHost('x.y.rt.uncraft.test', SUFFIX)).toBe(false);
    expect(isRuntimeHost('evil-rt.uncraft.test', SUFFIX)).toBe(false);
    expect(isRuntimeHost('a.rt.uncraft.test.evil.com', SUFFIX)).toBe(false);
    expect(isRuntimeHost('a.rt.uncraft.test', '')).toBe(false);
  });
});

describe('decideHostRouting', () => {
  const base = { suffix: SUFFIX, production: true };

  it('without a configured suffix everything passes (current behavior intact)', () => {
    expect(decideHostRouting({ host: 'anything.example', pathname: '/canvas', suffix: '', production: true })).toBe('allow');
  });

  it('a runtime host serves ONLY runtime routes — no app API on the runtime host', () => {
    const host = 'abc123.rt.uncraft.test';
    expect(decideHostRouting({ ...base, host, pathname: '/api/rt/sess/index.html' })).toBe('allow');
    expect(decideHostRouting({ ...base, host, pathname: '/api/runtime-bootstrap/badge' })).toBe('allow');
    expect(decideHostRouting({ ...base, host, pathname: '/api/runtime/token/index.html' })).toBe('allow');
    expect(decideHostRouting({ ...base, host, pathname: '/canvas' })).toBe('block');
    expect(decideHostRouting({ ...base, host, pathname: '/api/nodes/x/runtime-session' })).toBe('block');
    expect(decideHostRouting({ ...base, host, pathname: '/api/auth/login' })).toBe('block');
  });

  it('in production the APP host refuses the runtime-only routes', () => {
    expect(decideHostRouting({ ...base, host: 'app.uncraft.test', pathname: '/api/rt/sess/x' })).toBe('block');
    expect(decideHostRouting({ ...base, host: 'app.uncraft.test', pathname: '/api/runtime-bootstrap/b' })).toBe('block');
    expect(decideHostRouting({ ...base, host: 'app.uncraft.test', pathname: '/canvas' })).toBe('allow');
  });

  it('in dev the app host may serve runtime routes (single-host development)', () => {
    expect(decideHostRouting({ host: 'localhost:3030', pathname: '/api/rt/sess/x', suffix: SUFFIX, production: false })).toBe('allow');
  });
});

describe('runtimeSuffixSharesRegistrableDomain (startup separation check)', () => {
  it('flags a runtime suffix under the same registrable domain as the app', () => {
    expect(runtimeSuffixSharesRegistrableDomain('rt.uncraft.app', 'https://www.uncraft.app')).toBe(true);
    expect(runtimeSuffixSharesRegistrableDomain('rt.uncraft.app', 'https://uncraft.app')).toBe(true);
  });

  it('accepts a separate registrable domain', () => {
    expect(runtimeSuffixSharesRegistrableDomain('rt.uncraftusercontent.com', 'https://uncraft.app')).toBe(false);
  });

  it('fails closed on garbage app URLs', () => {
    expect(runtimeSuffixSharesRegistrableDomain('rt.uncraft.app', 'not a url')).toBe(true);
  });
});
