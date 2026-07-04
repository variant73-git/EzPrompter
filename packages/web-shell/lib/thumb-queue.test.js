import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchThumb, _resetThumbQueue } from './thumb-queue.js';

function deferredFetch() {
  const calls = [];
  const impl = vi.fn(() => new Promise((resolve) => {
    calls.push((dataUrl) => resolve({
      ok: true,
      json: async () => ({ dataUrl }),
    }));
  }));
  return { impl, calls };
}

beforeEach(() => _resetThumbQueue());
afterEach(() => vi.unstubAllGlobals());

describe('fetchThumb', () => {
  it('resolves with the dataUrl from the endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ dataUrl: 'data:image/png;base64,abc' }),
    })));
    const url = await fetchThumb('n1:s1', '/api/nodes/n1/thumbnail');
    expect(url).toBe('data:image/png;base64,abc');
  });

  it('resolves null on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    expect(await fetchThumb('n2:s1', '/x')).toBe(null);
  });

  it('resolves null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    expect(await fetchThumb('n3:s1', '/x')).toBe(null);
  });

  it('dedups concurrent requests for the same key', async () => {
    const { impl, calls } = deferredFetch();
    vi.stubGlobal('fetch', impl);
    const a = fetchThumb('same:s1', '/x');
    const b = fetchThumb('same:s1', '/x');
    expect(a).toBe(b);
    expect(impl).toHaveBeenCalledTimes(1);
    calls[0]('data:done');
    expect(await a).toBe('data:done');
  });

  it('runs at most 2 fetches at a time and drains the queue', async () => {
    const { impl, calls } = deferredFetch();
    vi.stubGlobal('fetch', impl);
    const p1 = fetchThumb('k1', '/1');
    const p2 = fetchThumb('k2', '/2');
    const p3 = fetchThumb('k3', '/3');
    expect(impl).toHaveBeenCalledTimes(2); // third waits
    calls[0]('d1');
    await p1;
    expect(impl).toHaveBeenCalledTimes(3); // slot freed → third started
    calls[1]('d2');
    calls[2]('d3');
    expect(await p2).toBe('d2');
    expect(await p3).toBe('d3');
  });
});
