import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChallengeJob } from './useChallengeJob.js';

// script = sequence of statuses GET/check returns after start.
function fakeApi(startStatus, followStatuses = []) {
  const follow = [...followStatuses];
  return {
    startChallenge: vi.fn(async () => ({ job: { id: 'j1', status: startStatus }, ...(startStatus === 'needs_human' ? { liveView: { url: 'https://live/p' } } : {}) })),
    getChallengeJob: vi.fn(async () => ({ job: { id: 'j1', status: follow[0] ?? 'succeeded' } })),
    checkChallengeJob: vi.fn(async () => { const s = follow.shift(); return { job: { id: 'j1', status: s ?? 'ready' }, ...(s === 'needs_human' ? { liveView: { url: 'https://live/p' } } : {}) }; }),
    captureChallengeJob: vi.fn(async () => ({ job: { id: 'j1', status: 'succeeded' }, result: { ok: true, kind: 'native', credits: 275 } })),
    cancelChallengeJob: vi.fn(async () => ({ job: { id: 'j1', status: 'cancelled' } })),
  };
}

describe('useChallengeJob', () => {
  it('ready right away → captures → onSucceeded', async () => {
    const api = fakeApi('ready');
    const onSucceeded = vi.fn();
    const { result } = renderHook(() => useChallengeJob({ api, onSucceeded, onFailed: vi.fn(), onNodeState: vi.fn() }));
    await act(async () => { await result.current.start('n1', 'edit'); });
    expect(api.captureChallengeJob).toHaveBeenCalledWith('j1');
    expect(onSucceeded).toHaveBeenCalledWith('n1', 'edit', expect.objectContaining({ credits: 275 }));
  });

  it('unsupported → onFailed with the typed code and no capture', async () => {
    const api = fakeApi('unsupported');
    const onFailed = vi.fn();
    const { result } = renderHook(() => useChallengeJob({ api, onSucceeded: vi.fn(), onFailed, onNodeState: vi.fn() }));
    await act(async () => { await result.current.start('n1', 'edit'); });
    expect(onFailed).toHaveBeenCalledWith('n1', 'unsupported');
    expect(api.captureChallengeJob).not.toHaveBeenCalled();
  });

  it('needs_human → surfaces the live view and keeps checking, then captures when ready', async () => {
    vi.useFakeTimers();
    try {
      const api = fakeApi('needs_human', ['needs_human', 'ready']);
      const { result } = renderHook(() => useChallengeJob({ api, onSucceeded: vi.fn(), onFailed: vi.fn(), onNodeState: vi.fn() }));
      await act(async () => { await result.current.start('n1', 'reference'); });
      expect(result.current.jobs.get('n1')).toMatchObject({ status: 'needs_human', liveView: 'https://live/p' });
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); }); // check → still needs_human
      expect(api.checkChallengeJob).toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); }); // check → ready → capture
      expect(api.captureChallengeJob).toHaveBeenCalledWith('j1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel stops polling and drops the job', async () => {
    const api = fakeApi('needs_human', ['needs_human']);
    const { result } = renderHook(() => useChallengeJob({ api, onSucceeded: vi.fn(), onFailed: vi.fn(), onNodeState: vi.fn() }));
    await act(async () => { await result.current.start('n1', 'reference'); });
    await act(async () => { await result.current.cancel('n1'); });
    expect(api.cancelChallengeJob).toHaveBeenCalledWith('j1');
    expect(result.current.jobs.get('n1')).toBeUndefined();
  });
});
