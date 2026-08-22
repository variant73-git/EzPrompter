import { describe, expect, it, vi } from 'vitest';
import { createCloneTimer, persistCloneTelemetry , readCloneTelemetry } from './clone-telemetry.js';

function relogio(marcas) {
  let i = 0;
  return () => marcas[Math.min(i++, marcas.length - 1)];
}

describe('createCloneTimer', () => {
  it('separa as etapas e fecha a conta com o total', () => {
    // início 0 · captura 0→100 · controles 100→130 · fim 200
    const t = createCloneTimer(relogio([0, 0, 100, 100, 130, 200]));
    t.start('captura'); t.end('captura');
    t.start('controles'); t.end('controles');
    const r = t.report({ engine: 'native' });
    expect(r.stages).toEqual({ captura: 100, controles: 30 });
    expect(r.totalMs).toBe(200);
    // ⭐ o resto tem que aparecer: sem ele a soma não fecha e ninguém sabe onde foi
    expect(r.unaccountedMs).toBe(70);
  });

  it('fecha a etapa mesmo quando o trabalho lança', async () => {
    const t = createCloneTimer(relogio([0, 0, 50, 50]));
    await expect(t.measure('captura', async () => { throw new Error('estourou'); })).rejects.toThrow('estourou');
    expect(t.report({}).stages.captura).toBe(50);
  });

  it('ignora etapa aberta e nunca fechada, em vez de inventar duração', () => {
    const t = createCloneTimer(relogio([0, 10, 500]));
    t.start('pendurada');
    expect(t.report({}).stages).toEqual({});
  });

  it('converte µ¢ em dólar e aceita ausência de custo', () => {
    const t = createCloneTimer(relogio([0, 100]));
    expect(t.report({ microcents: 2_500_000 }).usd).toBe(2.5);
    expect(t.report({}).usd).toBeNull();
    expect(t.report({}).microcents).toBeNull();
  });
});

describe('persistCloneTelemetry', () => {
  it('funde no meta sem apagar o resto e carimba a hora', async () => {
    const sql = vi.fn(async () => []);
    expect(await persistCloneTelemetry({ sql, nodeId: 'n1', report: { totalMs: 10 } })).toBe(true);
    const enviado = JSON.parse(sql.mock.calls[0][1]);
    expect(enviado.cloneTelemetry.totalMs).toBe(10);
    expect(enviado.cloneTelemetry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(sql.mock.calls[0][0].join('?'))).toMatch(/COALESCE\(meta/);
  });

  // FAIL-OPEN é o contrato: um clone que deu certo não pode morrer porque a
  // medição falhou.
  it('nunca lança quando o banco recusa', async () => {
    const sql = vi.fn(async () => { throw new Error('banco fora'); });
    await expect(persistCloneTelemetry({ sql, nodeId: 'n1', report: { totalMs: 1 } })).resolves.toBe(false);
  });

  it('não grava sem node ou sem relatório', async () => {
    const sql = vi.fn();
    expect(await persistCloneTelemetry({ sql, nodeId: null, report: { a: 1 } })).toBe(false);
    expect(await persistCloneTelemetry({ sql, nodeId: 'n1', report: null })).toBe(false);
    expect(sql).not.toHaveBeenCalled();
  });
});

// ── Achados do Sol (auditoria da telemetria) ────────────────────────────────

describe('persistCloneTelemetry — prazo (Sol #1)', () => {
  // O `catch` cobre uma query que RECUSA; não cobre uma query que TRAVA. Depois
  // do settle o dinheiro já saiu: esperar sem limite por uma medição significa
  // a pessoa pagar e não receber o node quando a rota estoura o maxDuration.
  it('desiste de esperar em vez de segurar a resposta do clone', async () => {
    const nuncaResponde = () => new Promise(() => {});
    const partiu = Date.now();
    const gravou = await persistCloneTelemetry({
      sql: nuncaResponde, nodeId: 'n1', report: { totalMs: 1 }, deadlineMs: 40,
    });
    expect(gravou).toBe(false);
    expect(Date.now() - partiu).toBeLessThan(1500);
  });

  it('uma query lenta que responde dentro do prazo ainda grava', async () => {
    const sql = async () => { await new Promise((r) => setTimeout(r, 10)); return []; };
    expect(await persistCloneTelemetry({ sql, nodeId: 'n1', report: { totalMs: 1 }, deadlineMs: 300 })).toBe(true);
  });
});

describe('readCloneTelemetry — o replay conta a historia do clone que aconteceu', () => {
  it('devolve a medicao guardada no node', async () => {
    const sql = async () => [{ meta: { cloneTelemetry: { totalMs: 203_000, engine: 'native' } } }];
    expect(await readCloneTelemetry({ sql, nodeId: 'n1' })).toEqual({ totalMs: 203_000, engine: 'native' });
  });

  it('devolve null quando nao ha medicao, sem lancar', async () => {
    expect(await readCloneTelemetry({ sql: async () => [{ meta: {} }], nodeId: 'n1' })).toBe(null);
    expect(await readCloneTelemetry({ sql: async () => [], nodeId: 'n1' })).toBe(null);
    expect(await readCloneTelemetry({ sql: async () => { throw new Error('fora'); }, nodeId: 'n1' })).toBe(null);
  });

  it('tambem desiste de esperar — mesma regra do gravar', async () => {
    const partiu = Date.now();
    expect(await readCloneTelemetry({ sql: () => new Promise(() => {}), nodeId: 'n1', deadlineMs: 40 })).toBe(null);
    expect(Date.now() - partiu).toBeLessThan(1500);
  });
});

// ── Rodada 2 do Sol ─────────────────────────────────────────────────────────

describe('comPrazo — nao deixa relogio pendurado (Sol r2 #5)', () => {
  // Quando a query REJEITA, o `await` da corrida lança antes do clearTimeout e
  // o relogio fica vivo ate o prazo inteiro. Numa funcao serverless isso segura
  // o loop de eventos por segundos depois do trabalho ter acabado.
  it('limpa o relogio quando a query rejeita', async () => {
    vi.useFakeTimers();
    try {
      const sql = () => Promise.reject(new Error('banco fora'));
      await persistCloneTelemetry({ sql, nodeId: 'n1', report: { totalMs: 1 }, deadlineMs: 4000 });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe('telemetria e de UMA operacao (Sol r2 #2)', () => {
  // Um node pode ser clonado varias vezes. Sem etiqueta, o replay da operacao A
  // devolveria a medicao da operacao B — um numero de outra corrida com cara de
  // ser desta. Numero que mente e' pior que numero ausente.
  it('grava a etiqueta da operacao junto do relatorio', async () => {
    let gravado = null;
    const sql = (_s, ...v) => { gravado = v; return Promise.resolve([]); };
    await persistCloneTelemetry({ sql, nodeId: 'n1', report: { totalMs: 5 }, idemKey: 'op-A' });
    expect(JSON.parse(gravado[0]).cloneTelemetry.idemKey).toBe('op-A');
  });

  it('so devolve a medicao se ela for desta operacao', async () => {
    const sql = async () => [{ meta: { cloneTelemetry: { totalMs: 9, idemKey: 'op-B' } } }];
    expect(await readCloneTelemetry({ sql, nodeId: 'n1', idemKey: 'op-A' })).toBe(null);
    expect(await readCloneTelemetry({ sql, nodeId: 'n1', idemKey: 'op-B' })).toEqual({ totalMs: 9, idemKey: 'op-B' });

    // Sem etiqueta guardada (medicao antiga) NAO prova pertencimento: pedir uma
    // operacao especifica e receber um numero anonimo e' o mesmo risco de antes.
    const semEtiqueta = async () => [{ meta: { cloneTelemetry: { totalMs: 9 } } }];
    expect(await readCloneTelemetry({ sql: semEtiqueta, nodeId: 'n1', idemKey: 'op-A' })).toBe(null);
    // Sem pedir etiqueta, a leitura segue servindo (ninguem afirmou identidade).
    expect(await readCloneTelemetry({ sql: semEtiqueta, nodeId: 'n1' })).toEqual({ totalMs: 9 });
  });
});

describe('a medicao nunca come o que sobra da rota (Sol r2 #1)', () => {
  it('pula a gravacao quando nao ha folga ate o teto da rota', async () => {
    const sql = vi.fn();
    const gravou = await persistCloneTelemetry({
      sql, nodeId: 'n1', report: { totalMs: 1 }, elapsedMs: 299_000,
    });
    expect(gravou).toBe(false);
    expect(sql).not.toHaveBeenCalled();
  });
});
