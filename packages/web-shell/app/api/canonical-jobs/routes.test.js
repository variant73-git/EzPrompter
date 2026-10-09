import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ user: { id: 42, plan: 'pro' } })) }));
const sqlMock = vi.fn(async () => []);
vi.mock('../../../lib/db.js', () => ({ db: vi.fn(async () => sqlMock) }));
vi.mock('../../../lib/canonical/job-service.js', () => ({
  canonicalEditEnabled: vi.fn(() => true),
  startCanonicalJob: vi.fn(),
  advanceCanonicalJob: vi.fn(),
  publicCanonicalJobView: (j) => ({ id: j.id, status: j.status }),
}));
const svc = await import('../../../lib/canonical/job-service.js');
const { POST: start } = await import('../nodes/[id]/canonical-job/route.js');
const { POST: advance } = await import('./[id]/advance/route.js');

const req = (url, { ticket = 'ticket-1' } = {}) => new Request(url, { method: 'POST', headers: ticket ? { 'idempotency-key': ticket } : {} });
const P = (id) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  svc.canonicalEditEnabled.mockReturnValue(true);
  sqlMock.mockResolvedValue([{ id: 'n1', board_id: 'b1', current_snapshot_id: 's1', current_snapshot_source: 'native-bundle', current_native_bundle_id: 'nb1' }]);
});
afterEach(() => vi.clearAllMocks());

describe('rotas da cópia editável', () => {
  it('interruptor desligado: 404 sem tocar o banco', async () => {
    svc.canonicalEditEnabled.mockReturnValue(false);
    const r1 = await start(req('http://t/api/nodes/n1/canonical-job'), P('n1'));
    const r2 = await advance(req('http://t/api/canonical-jobs/j1/advance'), P('j1'));
    expect(r1.status).toBe(404); expect(r2.status).toBe(404);
    expect((await r1.json()).error).toBe('canonical_disabled');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('iniciar exige a etiqueta de idempotência', async () => {
    const res = await start(req('http://t/api/nodes/n1/canonical-job', { ticket: '' }), P('n1'));
    expect(res.status).toBe(400);
    expect(svc.startCanonicalJob).not.toHaveBeenCalled();
  });

  it('iniciar passa o node do dono e devolve a visão pública', async () => {
    svc.startCanonicalJob.mockResolvedValue({ job: { id: 'j1', status: 'queued' } });
    const res = await start(req('http://t/api/nodes/n1/canonical-job'), P('n1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ job: { id: 'j1', status: 'queued' } });
    expect(svc.startCanonicalJob).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, idemKey: 'ticket-1', node: expect.objectContaining({ id: 'n1' }) }));
  });

  it('node de outro dono: 404', async () => {
    sqlMock.mockResolvedValue([]);
    const res = await start(req('http://t/api/nodes/n1/canonical-job'), P('n1'));
    expect(res.status).toBe(404);
  });

  it('erro tipado do serviço vira status', async () => {
    svc.startCanonicalJob.mockResolvedValue({ error: { code: 'canonical_not_applicable', status: 409 } });
    const res = await start(req('http://t/api/nodes/n1/canonical-job'), P('n1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'canonical_not_applicable' });
  });

  it('avançar devolve tarefa e resultado, no-store', async () => {
    svc.advanceCanonicalJob.mockResolvedValue({ job: { id: 'j1', status: 'ready' }, result: { snapshotId: 's2' } });
    const res = await advance(req('http://t/api/canonical-jobs/j1/advance'), P('j1'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ job: { id: 'j1', status: 'ready' }, result: { snapshotId: 's2' } });
    expect(svc.advanceCanonicalJob).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, jobId: 'j1' }));
  });
});
