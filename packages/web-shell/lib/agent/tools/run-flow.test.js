import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  return { sql };
});

vi.mock('../../run-flow.js', () => ({
  runCompose: vi.fn(async () => ({
    html: '<html><body>fresh</body></html>',
    snapshotId: 'snap-1',
  })),
}));

// Ledger mocked so runBilledOperation's hold/settle don't consume the
// scripted sql sequences (same pattern as edit-site.test.js).
vi.mock('../../billing/operations.js', () => ({
  claimOperation: vi.fn(async () => ({ outcome: 'claimed', operationId: 'op-test' })),
  reclaimOperation: vi.fn(async () => ({ outcome: 'reclaimed', operationId: 'op-test' })),
}));
vi.mock('../../billing/ledger.js', () => ({
  holdCredits: vi.fn(async () => ({ held: true, balance: 500 })),
  refundHold: vi.fn(async () => ({ balance: 500 })),
  settleOperation: vi.fn(async ({ chargeCredits }) => ({ balanceAfter: 500 - chargeCredits })),
  grantCredits: vi.fn(async () => ({ balanceAfter: 500 })),
  getBalance: vi.fn(async () => 500),
  recentLedger: vi.fn(async () => []),
}));

const { sql } = await import('../../db.js');
const { runCompose } = await import('../../run-flow.js');
const { runFlowTool } = await import('./run-flow.js');

function mockRunSequence() {
  let call = 0;
  sql.mockImplementation(() => {
    call++;
    if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: {}, board_id: 'b1', current_html: '<div>old</div>', current_design_md: null }]);
    if (call === 2) return Promise.resolve([{ edge_id: 'e1', edge_payload: null, source_node_id: 's1', kind: 'prompt', meta: { prompt: 'a brief' }, source_html: null, source_design_md: null }]);
    return Promise.resolve([{ id: 'snap-new' }]);
  });
}

describe('runFlowTool', () => {
  it('classification is safe — confirm chips are reserved for deletes (2026-06-12)', () => {
    expect(runFlowTool.classification).toBe('safe');
  });

  it('returns error when nodeId missing', async () => {
    const r = await runFlowTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('returns error when target node not owned', async () => {
    sql._nextResult = [];
    sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
    const r = await runFlowTool.execute({ nodeId: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('forbidden');
  });

  it('forwards the dock picker model to runCompose when the agent passes no override', async () => {
    mockRunSequence();
    const r = await runFlowTool.execute(
      { nodeId: 'n1' },
      { boardId: 'b1', userId: 42, pickerModel: 'gpt-5.5' },
    );
    expect(r.error).toBeUndefined();
    expect(runCompose).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'gpt-5.5' }));
  });

  it('an explicit tool-arg modelId wins over the picker', async () => {
    mockRunSequence();
    const r = await runFlowTool.execute(
      { nodeId: 'n1', modelId: 'gemini-3.1-pro' },
      { boardId: 'b1', userId: 42, pickerModel: 'gpt-5.5' },
    );
    expect(r.error).toBeUndefined();
    expect(runCompose).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'gemini-3.1-pro' }));
  });
});

// ⭐ O agente tem entrada PROPRIA e passava por fora do portao de operacao
// estrutural: um flow disparado pelo chat podia compor sobre um clone com
// edicoes de movimento abertas e sobrescrever o trabalho vivo, em silencio.
describe('o agente passa pelo mesmo portao', () => {
  it('recusa quando o clone tem edicao de movimento que o documento nao inclui', async () => {
    runCompose.mockClear();
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      // alvo: clone animado com uma transacao ja' absorvida no snapshot
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: {}, board_id: 'b1',
        current_html: '<div>old</div>', current_design_md: null, current_snapshot_id: 'snap-0',
        native_bundle_id: '11111111-2222-4333-8444-555555555555', motion_manifest: { transactions: [{ id: 'a' }] } }]);
      if (call === 2) return Promise.resolve([{ edge_id: 'e1', edge_payload: null, source_node_id: 's1',
        kind: 'prompt', meta: { prompt: 'a brief' }, source_html: null, source_design_md: null }]);
      return Promise.resolve([]);
    });
    const out = await runFlowTool.execute({ nodeId: 'n1' }, { userId: 1, boardId: 'b1', runId: 'r1' });
    expect(out.error).toBe('stale_clone_document');
    expect(runCompose).not.toHaveBeenCalled();
  });

  it('recusa quando o clone nao tem documento — senao compoe de pagina em branco', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: {}, board_id: 'b1',
        current_html: null, current_design_md: null, current_snapshot_id: 'snap-0',
        native_bundle_id: '11111111-2222-4333-8444-555555555555', motion_manifest: { transactions: [] } }]);
      if (call === 2) return Promise.resolve([{ edge_id: 'e1', edge_payload: null, source_node_id: 's1',
        kind: 'prompt', meta: { prompt: 'a brief' }, source_html: null, source_design_md: null }]);
      return Promise.resolve([]);
    });
    const out = await runFlowTool.execute({ nodeId: 'n1' }, { userId: 1, boardId: 'b1', runId: 'r1' });
    expect(out.error).toBe('missing_clone_document');
  });

  // A escrita tem que ser UM comando: entre inserir e apontar, uma sessao pode
  // abrir — e abrir sessao nao muda `current_snapshot_id`.
  it('grava snapshot e ponteiro no mesmo comando', async () => {
    const textos = [];
    let call = 0;
    sql.mockImplementation((strings) => {
      call++;
      textos.push(Array.isArray(strings) ? strings.join(' ') : String(strings));
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: {}, board_id: 'b1',
        current_html: '<div>old</div>', current_design_md: null, current_snapshot_id: 'snap-0',
        native_bundle_id: null, motion_manifest: null }]);
      if (call === 2) return Promise.resolve([{ edge_id: 'e1', edge_payload: null, source_node_id: 's1',
        kind: 'prompt', meta: { prompt: 'a brief' }, source_html: null, source_design_md: null }]);
      return Promise.resolve([{ id: 'snap-novo' }]);
    });
    runCompose.mockResolvedValueOnce({ html: '<html><body>novo</body></html>' });
    const out = await runFlowTool.execute({ nodeId: 'n1' }, { userId: 1, boardId: 'b1', runId: 'r1' });
    expect(out.ran).toBe(true);
    const escrita = textos.find((t) => /INSERT INTO snapshots/i.test(t));
    expect(escrita).toMatch(/UPDATE nodes/i);
    expect(escrita).toMatch(/native_motion_edit_sessions/i);
  });
});

// Sem marcar terminal, o agente chama de novo com os mesmos argumentos ate'
// esgotar as iteracoes — a recusa vira laco (Sol).
describe('a recusa do portao e terminal para o agente', () => {
  it('volta como nao-repetivel, com o proximo passo escrito', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: {}, board_id: 'b1',
        current_html: '<div>x</div>', current_design_md: null, current_snapshot_id: 'snap-0',
        native_bundle_id: '11111111-2222-4333-8444-555555555555', motion_manifest: { transactions: [{ id: 'a' }] } }]);
      if (call === 2) return Promise.resolve([{ edge_id: 'e1', edge_payload: null, source_node_id: 's1',
        kind: 'prompt', meta: { prompt: 'x' }, source_html: null, source_design_md: null }]);
      return Promise.resolve([]);
    });
    const out = await runFlowTool.execute({ nodeId: 'n1' }, { userId: 1, boardId: 'b1', runId: 'r1' });
    expect(out.retryable).toBe(false);
    expect(out.nextStep).toMatch(/do not call runFlow again/i);
  });
});
