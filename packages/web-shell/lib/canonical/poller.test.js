import { describe, expect, it, vi } from 'vitest';
import { createCanonicalPoller } from './poller.js';

// agenda imediata: cada "espera" vira a próxima volta do laço de microtarefas
const immediate = { schedule: (fn) => { Promise.resolve().then(fn); return 1; }, cancel: () => {} };

describe('consulta da preparação', () => {
  it('consulta até ficar pronta e devolve o resultado', async () => {
    const advance = vi.fn()
      .mockResolvedValueOnce({ job: { id: 'j', status: 'recording', progressPct: 30 } })
      .mockResolvedValueOnce({ job: { id: 'j', status: 'ready', progressPct: 100 }, result: { snapshotId: 's2' } });
    const onUpdate = vi.fn();
    const out = await createCanonicalPoller({ advance, onUpdate, ...immediate }).run('j');
    expect(out).toMatchObject({ ok: true, result: { snapshotId: 's2' } });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(advance).toHaveBeenCalledTimes(2);
  });

  it('falha da tarefa devolve o código', async () => {
    const advance = vi.fn().mockResolvedValue({ job: { id: 'j', status: 'failed', errorCode: 'timeout' } });
    expect(await createCanonicalPoller({ advance, ...immediate }).run('j')).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('nunca sobrepõe consultas: a próxima só sai depois da resposta', async () => {
    let emVoo = 0; let pico = 0;
    const advance = vi.fn(async () => {
      emVoo += 1; pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo -= 1;
      return advance.mock.calls.length < 3 ? { job: { status: 'recording' } } : { job: { status: 'ready' }, result: {} };
    });
    await createCanonicalPoller({ advance, ...immediate }).run('j');
    expect(pico).toBe(1);
  });

  it('erro de rede passageiro continua; cinco seguidos desistem', async () => {
    const flaky = vi.fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ job: { status: 'ready' }, result: { snapshotId: 's' } });
    expect((await createCanonicalPoller({ advance: flaky, ...immediate }).run('j')).ok).toBe(true);
    const dead = vi.fn().mockRejectedValue(Object.assign(new Error('net'), { code: 'internal' }));
    expect(await createCanonicalPoller({ advance: dead, ...immediate }).run('j')).toMatchObject({ ok: false, code: 'internal' });
    expect(dead).toHaveBeenCalledTimes(5);
  });

  it('stop no meio de uma consulta PENDENTE: cancela sem erro e não consulta de novo', async () => {
    let soltar;
    const advance = vi.fn(() => new Promise((r) => { soltar = r; }));
    const poller = createCanonicalPoller({ advance, ...immediate });
    const promessa = poller.run('j');
    poller.stop();
    expect(await promessa).toMatchObject({ ok: false, code: 'cancelled' });
    soltar({ job: { status: 'recording' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('stop encerra como cancelado', async () => {
    const advance = vi.fn().mockResolvedValue({ job: { status: 'recording' } });
    const poller = createCanonicalPoller({ advance, schedule: (fn) => setTimeout(fn, 1), cancel: clearTimeout });
    const promessa = poller.run('j');
    await new Promise((r) => setTimeout(r, 0));
    poller.stop();
    expect(await promessa).toMatchObject({ ok: false, code: 'cancelled' });
  });

  it('queda de conexão (erro sem código) vira network, não falha da preparação (revisão final, Codex)', async () => {
    const semRede = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await createCanonicalPoller({ advance: semRede, ...immediate }).run('j')).toMatchObject({ ok: false, code: 'network' });
    expect(semRede).toHaveBeenCalledTimes(5);
  });
});

