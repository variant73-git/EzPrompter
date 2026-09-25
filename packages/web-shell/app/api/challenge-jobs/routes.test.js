import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ user: { id: 42, plan: 'pro' } })) }));
const sqlMock = vi.fn(async () => []);
vi.mock('../../../lib/db.js', () => ({ db: vi.fn(async () => sqlMock) }));
vi.mock('../../../lib/challenge/job-service.js', () => ({
  startJob: vi.fn(), checkJob: vi.fn(), captureJob: vi.fn(), cancelJob: vi.fn(), liveViewFor: vi.fn(async () => null),
  publicJobView: (j) => ({ id: j.id, status: j.status }),
}));
vi.mock('../../../lib/challenge/job-store.js', () => ({ getOwnedJob: vi.fn() }));
const svc = await import('../../../lib/challenge/job-service.js');
const store = await import('../../../lib/challenge/job-store.js');
const { POST: start } = await import('../nodes/[id]/challenge/route.js');
const { GET: get } = await import('./[id]/route.js');
const { POST: capture } = await import('./[id]/capture/route.js');

const req = (url, body) => new Request(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'ticket-1' }, body: body === undefined ? undefined : JSON.stringify(body) });
const P = (id) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { vi.clearAllMocks(); sqlMock.mockResolvedValue([{ id: 'n1', board_id: 'b1', origin_url: 'https://site.example/', kind: 'site' }]); });

describe('challenge routes', () => {
  it('POST /nodes/:id/challenge starts a job for the owned node with the idempotency ticket', async () => {
    svc.startJob.mockResolvedValue({ job: { id: 'j1', status: 'ready' } });
    const res = await start(req('http://t/api/nodes/n1/challenge', { purpose: 'edit' }), P('n1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job: { id: 'j1', status: 'ready' } });
    expect(svc.startJob).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, purpose: 'edit', idemKey: 'ticket-1', node: expect.objectContaining({ id: 'n1' }) }));
  });
  it('maps quota/balance errors to their typed status', async () => {
    svc.startJob.mockResolvedValue({ error: { code: 'insufficient_credits', status: 402, estimate: 275, balance: 5 } });
    const res = await start(req('http://t/api/nodes/n1/challenge', { purpose: 'edit' }), P('n1'));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'insufficient_credits', estimate: 275, balance: 5 });
  });
  it('rejects an unknown purpose before touching the service', async () => {
    const res = await start(req('http://t/api/nodes/n1/challenge', { purpose: 'other' }), P('n1'));
    expect(res.status).toBe(400); expect(svc.startJob).not.toHaveBeenCalled();
  });
  it('404 when the node is not owned', async () => {
    sqlMock.mockResolvedValue([]);
    const res = await start(req('http://t/api/nodes/n1/challenge', { purpose: 'reference' }), P('n1'));
    expect(res.status).toBe(404); expect(svc.startJob).not.toHaveBeenCalled();
  });
  it('GET is no-store and only adds liveView when the service allows', async () => {
    store.getOwnedJob.mockResolvedValue({ id: 'j1', status: 'needs_human', user_id: 42 });
    svc.liveViewFor.mockResolvedValueOnce({ url: 'https://live/p' });
    const res = await get(req('http://t/api/challenge-jobs/j1'), P('j1'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ job: { id: 'j1', status: 'needs_human' }, liveView: { url: 'https://live/p' } });
  });
  it('GET 404 is also no-store', async () => {
    store.getOwnedJob.mockResolvedValue(null);
    const res = await get(req('http://t/api/challenge-jobs/j1'), P('j1'));
    expect(res.status).toBe(404); expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('capture: conflict is a typed 409', async () => {
    svc.captureJob.mockRejectedValue(Object.assign(new Error('job_conflict'), { code: 'job_conflict', status: 409 }));
    const res = await capture(req('http://t/api/challenge-jobs/j1/capture', {}), P('j1'));
    expect(res.status).toBe(409); expect((await res.json()).error).toBe('job_conflict');
  });
  it('capture: insufficient credits → 402', async () => {
    const { InsufficientCreditsError } = await import('../../../lib/billing/context.js');
    svc.captureJob.mockRejectedValue(new InsufficientCreditsError({ estimate: 275, balance: 1 }));
    const res = await capture(req('http://t/api/challenge-jobs/j1/capture', {}), P('j1'));
    expect(res.status).toBe(402);
  });
});
