/**
 * Onde o clone gasta TEMPO e DINHEIRO — medido, não estimado.
 *
 * A pergunta que ficou sem resposta por semanas: "por que meu clone demora
 * minutos se o motor faz em 24s?". O 22–24s do handoff é do produtor ISOLADO;
 * o que a pessoa espera inclui fila, banco, persistência, geração de controles
 * e miniatura. Sem separar as etapas, qualquer otimização é palpite.
 *
 * Contrato:
 *  - FAIL-OPEN. Telemetria nunca derruba um clone que deu certo.
 *  - Escrita DEPOIS do settle: antes dele, `credits` e µ¢ não existem.
 *  - Replay de dedup NÃO grava: não houve clone novo, e sobrescrever apagaria
 *    a medição do clone que de fato aconteceu.
 */

/** Cronômetro de etapas. Uma etapa aberta e não fechada não entra no relatório. */
export function createCloneTimer(now = () => Date.now()) {
  const inicio = now();
  const etapas = {};
  const abertas = new Map();
  return {
    start(nome) {
      abertas.set(nome, now());
      return () => this.end(nome);
    },
    end(nome) {
      const t0 = abertas.get(nome);
      if (t0 == null) return;
      abertas.delete(nome);
      etapas[nome] = (etapas[nome] || 0) + (now() - t0);
    },
    /** Mede uma promessa inteira, fechando a etapa mesmo se ela lançar. */
    async measure(nome, fn) {
      this.start(nome);
      try { return await fn(); } finally { this.end(nome); }
    },
    /** Quanto tempo esta rota já gastou — quem decide se ainda há folga. */
    elapsed() { return now() - inicio; },
    report({ engine, credits = null, microcents = null } = {}) {
      const totalMs = now() - inicio;
      const somaEtapas = Object.values(etapas).reduce((s, v) => s + v, 0);
      return {
        schemaVersion: 1,
        engine: engine || null,
        stages: { ...etapas },
        // O que o servidor gastou fora das etapas nomeadas — sem isto, a soma
        // não fecha com o total e ninguém sabe onde foi o resto.
        unaccountedMs: Math.max(0, totalMs - somaEtapas),
        totalMs,
        credits,
        microcents,
        usd: microcents == null ? null : microcents / 1_000_000,
        at: null, // carimbado por quem grava (Date.now não roda em script de workflow)
      };
    },
  };
}

/**
 * ⏱️ A REGRA DO PRAZO, num lugar só (achado do Sol).
 *
 * `try/catch` cobre a query que RECUSA; não cobre a que TRAVA. Como toda
 * chamada daqui acontece DEPOIS do settle — o dinheiro já saiu —, esperar sem
 * limite por uma MEDIÇÃO significa a pessoa pagar e não receber o node quando a
 * rota estoura o maxDuration. Desistir de esperar perde a telemetria, que é o
 * preço certo: medição não é dinheiro.
 */
async function comPrazo(consulta, deadlineMs, aoDesistir) {
  const desistiu = Symbol('prazo');
  let alarme;
  const prazo = new Promise((r) => { alarme = setTimeout(() => r(desistiu), deadlineMs); });
  let chegou;
  try {
    chegou = await Promise.race([consulta.then((v) => ({ valor: v })), prazo]);
  } finally {
    // `finally` e nao a linha seguinte: quando a consulta REJEITA, o await lanca
    // antes do clearTimeout e o relogio fica pendurado ate o prazo inteiro —
    // segurando o loop de eventos depois do trabalho ter acabado (Sol r2).
    clearTimeout(alarme);
  }
  if (chegou === desistiu) {
    consulta.catch(() => {});   // segue viva; só não seguramos a resposta
    aoDesistir();
    return { desistiu: true };
  }
  return chegou;
}

/**
 * Grava o relatório no meta do node, sem tocar no resto do meta.
 * Devolve `true` se gravou. Qualquer falha vira `false` + log — nunca lança.
 */
/**
 * Teto da rota (`maxDuration`) e a folga que a RESPOSTA precisa depois do
 * settle. A medicao so' pode gastar o que sobra: se o clone ja' consumiu quase
 * tudo, ela e' pulada inteira. Esperar por uma medicao com o dinheiro ja' pago
 * e' trocar o node da pessoa por um numero (Sol r2).
 */
const TETO_DA_ROTA_MS = 300_000;
const FOLGA_PARA_RESPONDER_MS = 8_000;

function prazoDisponivel(deadlineMs, elapsedMs) {
  if (elapsedMs == null) return deadlineMs;
  return Math.min(deadlineMs, TETO_DA_ROTA_MS - FOLGA_PARA_RESPONDER_MS - elapsedMs);
}

export async function persistCloneTelemetry({ sql, nodeId, report, deadlineMs = 4000, elapsedMs = null, idemKey = null }) {
  if (!sql || !nodeId || !report) return false;
  const disponivel = prazoDisponivel(deadlineMs, elapsedMs);
  if (disponivel <= 0) {
    // eslint-disable-next-line no-console
    console.warn(`[clone-telemetry] sem folga na rota (node=${nodeId}) — clone entregue sem medicao`);
    return false;
  }
  try {
    // A ETIQUETA da operacao viaja junto: um node pode ser clonado varias vezes,
    // e sem ela o replay da operacao A devolveria a medicao da operacao B — um
    // numero de outra corrida com cara de ser desta (Sol r2).
    const carimbado = { ...report, idemKey, at: new Date().toISOString() };
    const resultado = await comPrazo(sql`
      UPDATE nodes
         SET meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ cloneTelemetry: carimbado })}::jsonb
       WHERE id = ${nodeId}
    `, disponivel, () => {
      // eslint-disable-next-line no-console
      console.warn(`[clone-telemetry] prazo de ${disponivel}ms estourou ao gravar (node=${nodeId}) — clone entregue sem medicao`);
    });
    return !resultado.desistiu;
  } catch (erro) {
    // eslint-disable-next-line no-console
    console.warn(`[clone-telemetry] nao gravou (node=${nodeId}): ${String(erro?.message || erro).slice(0, 160)}`);
    return false;
  }
}

/**
 * Lê a medição já guardada no node.
 *
 * Existe para o REPLAY idempotente: o retry não clonou nada, então o cronômetro
 * dele mediria milissegundos — mas é justamente o clone cuja primeira resposta
 * se perdeu que costuma ser o lento. Devolver `null` ali esconderia o caso que
 * mais interessa; devolver o relatório guardado conta a história verdadeira.
 */
export async function readCloneTelemetry({ sql, nodeId, deadlineMs = 4000, elapsedMs = null, idemKey = null }) {
  if (!sql || !nodeId) return null;
  const disponivel = prazoDisponivel(deadlineMs, elapsedMs);
  if (disponivel <= 0) return null;
  try {
    const resultado = await comPrazo(
      Promise.resolve(sql`SELECT meta FROM nodes WHERE id = ${nodeId}`),
      disponivel,
      () => {
        // eslint-disable-next-line no-console
        console.warn(`[clone-telemetry] prazo estourou ao ler (node=${nodeId})`);
      },
    );
    if (resultado.desistiu) return null;
    const guardada = resultado.valor?.[0]?.meta?.cloneTelemetry ?? null;
    // A etiqueta tem que BATER, nao apenas nao-divergir: uma medicao guardada
    // sem etiqueta (legado) nao prova pertencer a esta operacao, e devolve-la
    // seria o mesmo numero-do-vizinho que a etiqueta veio impedir (Sol r3).
    if (idemKey && guardada?.idemKey !== idemKey) return null;
    return guardada;
  } catch {
    return null;
  }
}
