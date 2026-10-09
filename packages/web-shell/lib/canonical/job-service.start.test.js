import { describe, expect, it, vi } from 'vitest';
import { CANONICAL_OP, canonicalEditEnabled, publicCanonicalJobView, readyResult, startCanonicalJob } from './job-service.js';

const node = { id: 'n1', board_id: 'b1', current_snapshot_id: 's1', current_snapshot_source: 'native-bundle', current_native_bundle_id: 'nb1' };
function deps(over = {}) {
  return {
    jobStore: {
      findActiveJobForNode: vi.fn(async () => null),
      findJobByIdem: vi.fn(async () => null),
      insertJob: vi.fn(async (a) => ({ id: 'j1', status: 'queued', progress_pct: 10, node_id: a.nodeId })),
    },
    claimOperation: vi.fn(async () => ({ outcome: 'claimed', operationId: 'op1', balance: 100 })),
    settleOperation: vi.fn(async () => ({})),
    ...over,
  };
}

describe('iniciar a preparação', () => {
  it('interruptor do servidor fecha por padrão', () => {
    expect(canonicalEditEnabled({})).toBe(false);
    expect(canonicalEditEnabled({ UNCRAFT_CANONICAL_EDIT: '1' })).toBe(true);
    expect(canonicalEditEnabled({ UNCRAFT_CANONICAL_EDIT: 'true' })).toBe(false);
  });

  it('só node com captura nativa nunca editada', async () => {
    const d = deps();
    for (const source of ['native-edit', 'canonical', 'capture', null]) {
      const out = await startCanonicalJob({ sql: {}, userId: 1, node: { ...node, current_snapshot_source: source }, idemKey: 'k', deps: d });
      expect(out.error).toEqual({ code: 'canonical_not_applicable', status: 409 });
    }
    expect(d.claimOperation).not.toHaveBeenCalled();
  });

  it('reserva a cobrança (preço 0) e cria a tarefa com a versão atual do node', async () => {
    const d = deps();
    const out = await startCanonicalJob({ sql: {}, userId: 1, node, idemKey: 'k', deps: d });
    expect(out.job.id).toBe('j1');
    expect(d.claimOperation).toHaveBeenCalledWith(expect.objectContaining({ op: CANONICAL_OP, idemKey: 'canonical:k', estimate: 0, nodeId: 'n1' }));
    expect(d.jobStore.insertJob).toHaveBeenCalledWith(expect.objectContaining({ sourceSnapshotId: 's1', nativeBundleId: 'nb1', idemKey: 'k', opId: 'op1' }));
  });

  it('segunda aba: devolve a tarefa ativa sem reservar de novo', async () => {
    const d = deps();
    d.jobStore.findActiveJobForNode.mockResolvedValueOnce({ id: 'j-viva', status: 'recording' });
    const out = await startCanonicalJob({ sql: {}, userId: 1, node, idemKey: 'k2', deps: d });
    expect(out.job.id).toBe('j-viva');
    expect(d.claimOperation).not.toHaveBeenCalled();
  });

  it('corrida na inserção com OUTRA etiqueta: devolve a reserva desta e reusa a tarefa vencedora', async () => {
    const d = deps();
    d.jobStore.insertJob.mockResolvedValueOnce(null);
    d.jobStore.findActiveJobForNode.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'j-outra', op_id: 'op-outra' });
    const out = await startCanonicalJob({ sql: {}, userId: 1, node, idemKey: 'k', deps: d });
    expect(out.job.id).toBe('j-outra');
    expect(d.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opId: 'op1', opStatus: 'failed', chargeCredits: 0 }));
  });

  it('corrida com a MESMA etiqueta: a reserva é partilhada e NÃO é devolvida', async () => {
    const d = deps();
    d.claimOperation.mockResolvedValueOnce({ outcome: 'duplicate', row: { id: 'op-gemea', status: 'in_flight' } });
    d.jobStore.insertJob.mockResolvedValueOnce(null);
    d.jobStore.findJobByIdem.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'j-gemea', op_id: 'op-gemea' });
    const out = await startCanonicalJob({ sql: {}, userId: 1, node, idemKey: 'k', deps: d });
    expect(out.job.id).toBe('j-gemea');
    expect(d.jobStore.insertJob).toHaveBeenCalledWith(expect.objectContaining({ opId: 'op-gemea' }));
    expect(d.settleOperation).not.toHaveBeenCalled();
  });

  it('visão pública não vaza detalhe interno', () => {
    expect(publicCanonicalJobView({ id: 'j', node_id: 'n', status: 'failed', progress_pct: 57, error_code: 'timeout', error_detail: 'segredo', sandbox_name: 'x' }))
      .toEqual({ id: 'j', nodeId: 'n', status: 'failed', progressPct: 57, errorCode: 'timeout' });
  });

  it('resultado pronto no formato que o canvas aplica', () => {
    expect(readyResult({ status: 'recording' })).toBeNull();
    expect(readyResult({ status: 'ready', result_bundle_id: 'b2', result_snapshot_id: 's2' })).toEqual({
      kind: 'native', snapshotId: 's2', snapshotSource: 'canonical',
      bundleDescriptor: { bundleId: 'b2' }, motionManifest: { schemaVersion: 2, baseBundleId: 'b2' },
    });
  });
});
