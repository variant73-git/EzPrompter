import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCanonicalPrep } from './useCanonicalPrep.js';

describe('useCanonicalPrep', () => {
  it('sem captura começa em 10, sobe com a tarefa e termina pronta', async () => {
    const api = {
      startCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'queued', progressPct: 10 } })),
      advanceCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'ready', progressPct: 100 }, result: { snapshotId: 's2' } })),
    };
    const { result } = renderHook(() => useCanonicalPrep({ api }));
    let outcome;
    await act(async () => { outcome = await result.current.run('n1'); });
    expect(outcome).toMatchObject({ ok: true, result: { snapshotId: 's2' } });
    expect(result.current.prep.get('n1')).toMatchObject({ status: 'running', pct: 100 });
    act(() => result.current.dismiss('n1'));
    expect(result.current.prep.has('n1')).toBe(false);
  });

  it('falha fica no node com o código, para as duas escolhas', async () => {
    const api = {
      startCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'queued', progressPct: 10 } })),
      advanceCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'failed', progressPct: 57, errorCode: 'recording_failed' } })),
    };
    const { result } = renderHook(() => useCanonicalPrep({ api }));
    await act(async () => { await result.current.run('n1'); });
    expect(result.current.prep.get('n1')).toMatchObject({ status: 'failed', errorCode: 'recording_failed', pct: 57 });
  });

  it('o número nunca volta, mesmo se a tarefa relatar menos', async () => {
    const api = {
      startCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'recording', progressPct: 68 } })),
      advanceCanonicalJob: vi.fn()
        .mockResolvedValueOnce({ job: { id: 'j1', status: 'recording', progressPct: 57 } })
        .mockResolvedValueOnce({ job: { id: 'j1', status: 'failed', progressPct: 57, errorCode: 'timeout' } }),
    };
    const { result } = renderHook(() => useCanonicalPrep({ api }));
    await act(async () => { await result.current.run('n1'); });
    expect(result.current.prep.get('n1').pct).toBe(68);
  });

  it('erro da captura sobe para o chamador e não deixa estado no node', async () => {
    const api = { startCanonicalJob: vi.fn(), advanceCanonicalJob: vi.fn() };
    const { result } = renderHook(() => useCanonicalPrep({ api }));
    const erro = Object.assign(new Error('challenge'), { challenge: { url: 'https://x' } });
    await act(async () => {
      await expect(result.current.run('n1', { capture: async () => { throw erro; } })).rejects.toBe(erro);
    });
    expect(result.current.prep.has('n1')).toBe(false);
    expect(api.startCanonicalJob).not.toHaveBeenCalled();
  });

  it('queda de conexão guarda a tarefa; retomar consulta a MESMA tarefa sem iniciar outra (revisão final, Codex)', async () => {
    const api = {
      startCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'queued', progressPct: 10 } })),
      advanceCanonicalJob: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    };
    const { result } = renderHook(() => useCanonicalPrep({ api }));
    await act(async () => { await result.current.run('n1'); });
    expect(result.current.prep.get('n1')).toMatchObject({ status: 'failed', errorCode: 'network', jobId: 'j1' });
    api.advanceCanonicalJob.mockReset();
    api.advanceCanonicalJob.mockResolvedValue({ job: { id: 'j1', status: 'ready', progressPct: 100 }, result: { snapshotId: 's2' } });
    let outcome;
    await act(async () => { outcome = await result.current.run('n1', { resumeJobId: 'j1' }); });
    expect(outcome).toMatchObject({ ok: true, result: { snapshotId: 's2' } });
    expect(api.startCanonicalJob).toHaveBeenCalledTimes(1);
    expect(api.advanceCanonicalJob).toHaveBeenCalledWith('j1');
  }, 20_000);
});

