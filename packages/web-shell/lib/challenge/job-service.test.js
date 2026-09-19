import { describe, expect, it, vi } from 'vitest';
vi.mock('./quotas.js', () => ({ checkChallengeQuota: vi.fn(async () => ({ ok: true })) }));
vi.mock('./job-store.js', async (orig) => {
  const actual = await orig();
  return { ...actual, createJob: vi.fn(), getOwnedJob: vi.fn(), transition: vi.fn(), acquireLease: vi.fn(async () => true), releaseLease: vi.fn(), listExpired: vi.fn(async () => []) };
});
const store = await import('./job-store.js');
const { checkChallengeQuota } = await import('./quotas.js');
const { startJob, captureJob, checkJob, liveViewFor, sweepExpiredJobs } = await import('./job-service.js');

const node = { id: 'n1', board_id: 'b1', origin_url: 'https://site.example/' };
function deps(over = {}) {
  return {
    browserbase: {
      createSession: vi.fn(async () => ({ id: 'sess', connectUrl: 'wss://c', expiresAt: '2030-01-01T00:00:00Z' })),
      releaseSession: vi.fn(async () => {}),
      liveUrls: vi.fn(async () => ({ pages: [{ id: 'p', url: 'https://site.example/', debuggerFullscreenUrl: 'https://live/p' }] })),
    },
    withSession: vi.fn(async (_ws, fn) => fn({ browser: {}, context: {}, page: { title: async () => 't' }, owned: false })),
    verify: vi.fn(async () => ({ verdict: 'clean' })),
    captureNative: vi.fn(async () => ({ kind: 'native', bundle: {}, relatorio: {} })),
    reconstruct: vi.fn(async ({ producer }) => { await producer('https://site.example/', {}); return { ok: true, kind: 'native', credits: 275 }; }),
    captureSnap: vi.fn(async () => ({ html: '<html>x</html>', screenshotDataUrl: null, title: 'T' })),
    persistReference: vi.fn(async () => ({ snapshotId: 's1' })),
    now: () => new Date('2026-09-08T12:00:00Z'),
    ...over,
  };
}

describe('job service', () => {
  it('startJob: clean → ready, session kept alive (not released)', async () => {
    store.createJob.mockResolvedValue({ id: 'j1', status: 'verifying', generation: 1, purpose: 'edit', target_url: node.origin_url });
    store.transition.mockImplementation(async ({ to }) => ({ id: 'j1', status: to, generation: 1 }));
    const d = deps();
    const r = await startJob({ sql: {}, userId: 1, node, purpose: 'edit', idemKey: 'k', env: {}, deps: d });
    expect(r.job.status).toBe('ready');
    expect(d.browserbase.createSession).toHaveBeenCalledWith(expect.objectContaining({ targetUrl: node.origin_url, jobId: 'j1' }));
    expect(d.browserbase.releaseSession).not.toHaveBeenCalled();
  });

  it('startJob: needs_human sets a 5-minute human deadline; unsupported releases the session', async () => {
    store.createJob.mockResolvedValue({ id: 'j2', status: 'verifying', generation: 1, purpose: 'reference', target_url: node.origin_url });
    const patches = [];
    store.transition.mockImplementation(async ({ to, patch }) => { patches.push({ to, patch }); return { id: 'j2', status: to, generation: 1 }; });
    const d = deps({ verify: vi.fn(async () => ({ verdict: 'needs_human', kind: 'cloudflare', signals: [] })) });
    expect((await startJob({ sql: {}, userId: 1, node, purpose: 'reference', env: {}, deps: d })).job.status).toBe('needs_human');
    expect(patches.at(-1).patch.human_deadline_at).toBe('2026-09-08T12:05:00.000Z');
    const d2 = deps({ verify: vi.fn(async () => ({ verdict: 'unsupported', kind: 'akamai', signals: [] })) });
    expect((await startJob({ sql: {}, userId: 1, node, purpose: 'reference', env: {}, deps: d2 })).job.status).toBe('unsupported');
    expect(d2.browserbase.releaseSession).toHaveBeenCalledWith('sess');
  });

  it('startJob: quota failure creates NO job and NO session', async () => {
    checkChallengeQuota.mockResolvedValueOnce({ ok: false, code: 'verification_busy', status: 429 });
    store.createJob.mockClear();
    const d = deps();
    const r = await startJob({ sql: {}, userId: 1, node, purpose: 'edit', idemKey: 'k', env: {}, deps: d });
    expect(r).toMatchObject({ error: { code: 'verification_busy', status: 429 } });
    expect(store.createJob).not.toHaveBeenCalled();
    expect(d.browserbase.createSession).not.toHaveBeenCalled();
  });

  it('startJob: a cancel race that loses the session-id write releases the session (Astra #1)', async () => {
    store.createJob.mockResolvedValue({ id: 'j3', status: 'verifying', generation: 1, purpose: 'reference', target_url: node.origin_url });
    // First transition (save id) returns null: the job left 'verifying' (cancelled).
    store.transition.mockResolvedValueOnce(null);
    store.getOwnedJob.mockResolvedValue({ id: 'j3', status: 'cancelled', generation: 1 });
    const d = deps();
    const r = await startJob({ sql: {}, userId: 1, node, purpose: 'reference', env: {}, deps: d });
    expect(d.browserbase.releaseSession).toHaveBeenCalledWith('sess');
    expect(r.job.status).toBe('cancelled');
    expect(d.verify).not.toHaveBeenCalled();
  });

  it('captureJob (edit): fences ready→capturing, runs reconstruct with the borrowed producer under the job idemKey, succeeds, releases', async () => {
    store.getOwnedJob.mockResolvedValue({ id: 'j1', status: 'ready', generation: 1, purpose: 'edit', node_id: 'n1', board_id: 'b1', target_url: node.origin_url, idem_key: 'k', bb_session_id: 'sess', user_id: 1 });
    const seq = [];
    store.transition.mockImplementation(async ({ from, to }) => { seq.push(`${from}>${to}`); return { id: 'j1', status: to, generation: 1 }; });
    const d = deps();
    const r = await captureJob({ sql: {}, userId: 1, jobId: 'j1', env: {}, deps: d, loadNode: async () => node, connectUrlFor: async () => 'wss://c' });
    expect(seq).toEqual(['ready>capturing', 'capturing>committing', 'committing>succeeded']);
    expect(d.reconstruct).toHaveBeenCalledWith(expect.objectContaining({ idemKey: 'k', op: 'clone.edit', reason: 'edit', userId: 1 }));
    expect(d.captureNative).toHaveBeenCalledWith('https://site.example/', expect.objectContaining({ session: expect.objectContaining({ owned: false }), challengeToleranceMs: 40000 }));
    expect(d.browserbase.releaseSession).toHaveBeenCalledWith('sess');
    expect(r.result.credits).toBe(275);
  });

  it('captureJob: lost fence is a typed conflict, nothing runs', async () => {
    store.getOwnedJob.mockResolvedValue({ id: 'j1', status: 'ready', generation: 1, purpose: 'edit', bb_session_id: 'sess', user_id: 1 });
    store.transition.mockResolvedValueOnce(null);
    const d = deps();
    await expect(captureJob({ sql: {}, userId: 1, jobId: 'j1', env: {}, deps: d, loadNode: async () => node, connectUrlFor: async () => 'wss://c' })).rejects.toMatchObject({ code: 'job_conflict' });
    expect(d.reconstruct).not.toHaveBeenCalled();
  });

  it('captureJob: producer failure → failed + release', async () => {
    store.getOwnedJob.mockResolvedValue({ id: 'j1', status: 'ready', generation: 1, purpose: 'edit', bb_session_id: 'sess', user_id: 1, target_url: node.origin_url, idem_key: 'k' });
    const seq = [];
    store.transition.mockImplementation(async ({ from, to, patch }) => { seq.push(`${from}>${to}${patch?.error_code ? ':' + patch.error_code : ''}`); return { id: 'j1', status: to, generation: 1 }; });
    const d = deps({ reconstruct: vi.fn(async () => { throw Object.assign(new Error('boom'), { code: 'no_output' }); }) });
    await expect(captureJob({ sql: {}, userId: 1, jobId: 'j1', env: {}, deps: d, loadNode: async () => node, connectUrlFor: async () => 'wss://c' })).rejects.toMatchObject({ code: 'no_output' });
    expect(seq.at(-1)).toBe('capturing>failed:no_output');
    expect(d.browserbase.releaseSession).toHaveBeenCalledWith('sess');
  });

  it('liveViewFor: only needs_human AND the human flag; never the session-wide URL', async () => {
    const d = deps();
    expect(await liveViewFor({ job: { status: 'needs_human', bb_session_id: 'sess', bb_page_id: 'p' }, env: { UNCRAFT_CHALLENGE_HUMAN: '1' }, deps: d })).toEqual({ url: 'https://live/p' });
    expect(await liveViewFor({ job: { status: 'needs_human', bb_session_id: 'sess', bb_page_id: 'p' }, env: {}, deps: d })).toBeNull();
    expect(await liveViewFor({ job: { status: 'ready', bb_session_id: 'sess' }, env: { UNCRAFT_CHALLENGE_HUMAN: '1' }, deps: d })).toBeNull();
  });

  it('sweepExpiredJobs releases vendor sessions and marks expired', async () => {
    store.listExpired.mockResolvedValue([{ id: 'j9', status: 'needs_human', generation: 2, bb_session_id: 'sess9' }]);
    store.transition.mockImplementation(async ({ to }) => ({ id: 'j9', status: to }));
    const d = deps();
    expect(await sweepExpiredJobs({ sql: {}, deps: d })).toEqual({ expired: 1 });
    expect(d.browserbase.releaseSession).toHaveBeenCalledWith('sess9');
    expect(store.transition).toHaveBeenCalledWith(expect.objectContaining({ from: 'needs_human', to: 'expired', generation: 2 }));
  });
});
