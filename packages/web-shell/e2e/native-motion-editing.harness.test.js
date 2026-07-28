// Guards the runner's importable seam: the harness helpers must be exported AND the
// module must NOT auto-run main() (start a server) when imported. Pure, no DB.
import { describe, it, expect } from 'vitest';

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
