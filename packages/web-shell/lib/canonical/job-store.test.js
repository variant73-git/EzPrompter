import { describe, expect, it } from 'vitest';
import {
  ACTIVE, TERMINAL, acquireLease, failOverdueJob, findActiveJobForNode, getOwnedJob, insertJob,
  listCleanupPending, listOverdueJobs, markCleanupDone, moveJob, noteJob, restartJob,
} from './job-store.js';

function fakeSql(rowsByCall = []) {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rowsByCall.shift() ?? []);
  };
  sql._calls = calls;
  return sql;
}

describe('canonical job store', () => {
  it('constantes de estado', () => {
    expect(ACTIVE).toEqual(['queued', 'provisioning', 'recording', 'packaging']);
    expect([...TERMINAL]).toEqual(['ready', 'failed']);
  });

  it('insertJob não sobrescreve: conflito devolve null', async () => {
    const sql = fakeSql([[]]);
    const row = await insertJob({ sql, userId: 1, boardId: 'b', nodeId: 'n', sourceSnapshotId: 's', nativeBundleId: 'nb', idemKey: 'k', opId: 'op' });
    expect(row).toBeNull();
    expect(sql._calls[0].text).toMatch(/ON CONFLICT DO NOTHING/);
    expect(sql._calls[0].values).toEqual([1, 'b', 'n', 's', 'nb', 'k', 'op']);
  });

  it('leituras são sempre pelo dono', async () => {
    const sql = fakeSql([[], []]);
    await getOwnedJob({ sql, userId: 1, jobId: 'j' });
    await findActiveJobForNode({ sql, userId: 1, nodeId: 'n' });
    expect(sql._calls[0].text).toMatch(/WHERE id = \? AND user_id = \?/);
    expect(sql._calls[1].text).toMatch(/node_id = \? AND user_id = \?/);
  });

  it('a trava só pega tarefa ativa e com trava vencida', async () => {
    const sql = fakeSql([[{ id: 'j', lease_owner: 'w' }]]);
    const row = await acquireLease({ sql, jobId: 'j', owner: 'w', ttlSecs: 280 });
    expect(row.lease_owner).toBe('w');
    expect(sql._calls[0].text).toMatch(/status IN \('queued','provisioning','recording','packaging'\)/);
    expect(sql._calls[0].text).toMatch(/lease_until IS NULL OR lease_until < NOW\(\)/);
  });

  it('moveJob é cercado por status, geração E dono, e sobe a geração', async () => {
    const sql = fakeSql([[{ id: 'j', status: 'recording', generation: 3 }], []]);
    const ok = await moveJob({ sql, jobId: 'j', owner: 'w', generation: 2, from: 'provisioning', to: 'recording', patch: { command_id: 'c1' } });
    expect(ok.status).toBe('recording');
    expect(sql._calls[0].text).toMatch(/generation = generation \+ 1/);
    expect(sql._calls[0].text).toMatch(/WHERE id = \? AND status = \? AND generation = \? AND lease_owner = \?/);
    const perdido = await moveJob({ sql, jobId: 'j', owner: 'w', generation: 2, from: 'provisioning', to: 'recording' });
    expect(perdido).toBeNull();
  });

  it('patch fora do conjunto fechado é ignorado', async () => {
    const sql = fakeSql([[{ id: 'j' }]]);
    await noteJob({ sql, jobId: 'j', owner: 'w', generation: 1, patch: { status: 'ready', user_id: 9, stage: 'files', progress_pct: 13 } });
    const { values } = sql._calls[0];
    expect(values).toContain('files');
    expect(values).toContain(13);
    expect(values).not.toContain('ready');
    expect(values).not.toContain(9);
    expect(sql._calls[0].text).toMatch(/GREATEST\(progress_pct/);
    expect(sql._calls[0].text).not.toMatch(/SET status/);
  });

  it('restartJob só recomeça uma vez e apaga máquina/comando', async () => {
    const sql = fakeSql([[{ id: 'j', status: 'queued', attempt: 2 }]]);
    await restartJob({ sql, jobId: 'j', owner: 'w', generation: 4, from: 'recording' });
    const { text } = sql._calls[0];
    expect(text).toMatch(/attempt = attempt \+ 1/);
    expect(text).toMatch(/sandbox_name = NULL/);
    expect(text).toMatch(/command_id = NULL/);
    expect(text).toMatch(/AND attempt < 2/);
  });

  it('a varredura falha só a vencida e na mesma geração', async () => {
    const sql = fakeSql([[{ id: 'j' }], [{ id: 'j', status: 'failed' }]]);
    expect(await listOverdueJobs({ sql, limit: 10 })).toEqual([{ id: 'j' }]);
    await failOverdueJob({ sql, jobId: 'j', generation: 5, from: 'recording' });
    expect(sql._calls[0].text).toMatch(/deadline_at < NOW\(\)/);
    expect(sql._calls[1].text).toMatch(/error_code = 'timeout'/);
    expect(sql._calls[1].text).toMatch(/AND generation = \? AND deadline_at < NOW\(\)/);
    expect(sql._calls[1].text).toMatch(/AND \(lease_until IS NULL OR lease_until < NOW\(\)\)/);
  });

  it('limpeza pendente: só tarefas terminadas, e marcar só nelas', async () => {
    const sql = fakeSql([[{ id: 'j' }], []]);
    expect(await listCleanupPending({ sql, limit: 5 })).toEqual([{ id: 'j' }]);
    await markCleanupDone({ sql, jobId: 'j' });
    expect(sql._calls[0].text).toMatch(/cleanup_done = false AND status IN \('ready','failed'\)/);
    expect(sql._calls[1].text).toMatch(/SET cleanup_done = true/);
    expect(sql._calls[1].text).toMatch(/status IN \('ready','failed'\)/);
  });
});
