// Guards the runner's importable seam: the harness helpers must be exported AND the
// module must NOT auto-run main() (start a server) when imported. Pure, no DB.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('native-motion runner harness exports', () => {
  it('exports the harness helpers without auto-running main()', async () => {
    const mod = await import('./native-motion-editing.spec.js');
    expect(typeof mod.createRecorder).toBe('function');
    const record = mod.createRecorder({ checks: [] });
    expect(typeof record).toBe('function');
    expect(Array.isArray(mod.DEVICES)).toBe(true);
    expect(mod.DEVICES).toHaveLength(3);
    expect(typeof mod.computedTargetState).toBe('function');
    expect(typeof mod.waitForTargetState).toBe('function');
  });

  it('createRecorder records a passed check', async () => {
    const mod = await import('./native-motion-editing.spec.js');
    const report = { checks: [] };
    const record = mod.createRecorder(report);
    await record('demo.ok', async () => ({ value: 1 }));
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ name: 'demo.ok', status: 'passed' });
  });
});

describe('ensureFixtureEnv (seed hook)', () => {
  const KEYS = [
    'E2E_NATIVE_MOTION_BOARD_URL',
    'E2E_NATIVE_MOTION_PRIMARY_NODE_ID',
    'E2E_NATIVE_MOTION_SECONDARY_NODE_ID',
    'E2E_NATIVE_MOTION_SESSION_COOKIE',
    'E2E_NATIVE_MOTION_ALLOW_MUTATIONS',
  ];
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('seeds and populates the four env vars when mutations are approved', async () => {
    const mod = await import('./native-motion-editing.spec.js');
    process.env.E2E_NATIVE_MOTION_ALLOW_MUTATIONS = '1';
    const seed = async () => ({
      boardPath: '/canvas/board-1', primaryNodeId: 'p1', secondaryNodeId: 's1', sessionCookie: 'cookie-1',
    });
    await mod.ensureFixtureEnv({ baseUrl: 'http://127.0.0.1:34316', seed, sql: 'stub' });
    expect(process.env.E2E_NATIVE_MOTION_BOARD_URL).toBe('http://127.0.0.1:34316/canvas/board-1');
    expect(process.env.E2E_NATIVE_MOTION_PRIMARY_NODE_ID).toBe('p1');
    expect(process.env.E2E_NATIVE_MOTION_SECONDARY_NODE_ID).toBe('s1');
    expect(process.env.E2E_NATIVE_MOTION_SESSION_COOKIE).toBe('cookie-1');
  });

  it('is a no-op (never seeds) when mutations are NOT approved', async () => {
    const mod = await import('./native-motion-editing.spec.js');
    let called = false;
    const seed = async () => { called = true; return {}; };
    await mod.ensureFixtureEnv({ baseUrl: 'http://x', seed, sql: 'stub' });
    expect(called).toBe(false);
    expect(process.env.E2E_NATIVE_MOTION_BOARD_URL).toBeUndefined();
  });

  it('does not re-seed when the four env vars are already present', async () => {
    const mod = await import('./native-motion-editing.spec.js');
    process.env.E2E_NATIVE_MOTION_ALLOW_MUTATIONS = '1';
    process.env.E2E_NATIVE_MOTION_BOARD_URL = 'http://preset/canvas/x';
    process.env.E2E_NATIVE_MOTION_PRIMARY_NODE_ID = 'preP';
    process.env.E2E_NATIVE_MOTION_SECONDARY_NODE_ID = 'preS';
    process.env.E2E_NATIVE_MOTION_SESSION_COOKIE = 'preC';
    let called = false;
    const seed = async () => { called = true; return {}; };
    await mod.ensureFixtureEnv({ baseUrl: 'http://x', seed, sql: 'stub' });
    expect(called).toBe(false);
    expect(process.env.E2E_NATIVE_MOTION_BOARD_URL).toBe('http://preset/canvas/x');
  });
});
