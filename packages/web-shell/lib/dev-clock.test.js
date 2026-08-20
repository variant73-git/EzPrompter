import { describe, it, expect, vi } from 'vitest';
import { devClockAll, devClockRecord, devClockTime, onDevClock } from './dev-clock.js';

describe('dev-clock', () => {
  it('registra wall-clock e nodeId no sucesso', async () => {
    const out = await devClockTime('capture', 'x.com', async () => ({ node: { id: 'n9' } }));
    expect(out.node.id).toBe('n9');
    const rec = devClockAll()[0];
    expect(rec.kind).toBe('capture');
    expect(rec.ok).toBe(true);
    expect(rec.nodeId).toBe('n9');
    expect(typeof rec.wallMs).toBe('number');
  });
  it('registra falha SEM engolir o erro', async () => {
    await expect(devClockTime('reconstruct', 'y', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(devClockAll()[0].ok).toBe(false);
    expect(devClockAll()[0].error).toContain('boom');
  });
  it('notifica assinantes a cada registro', () => {
    const spy = vi.fn();
    const off = onDevClock(spy);
    devClockRecord({ kind: 'capture', wallMs: 1 });
    expect(spy).toHaveBeenCalled();
    off();
  });
});
