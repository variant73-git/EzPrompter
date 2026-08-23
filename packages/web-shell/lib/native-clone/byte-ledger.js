/**
 * UMA contabilidade de bytes, compartilhada por quem captura.
 *
 * Antes havia duas: a interceptação somava num total e a repescagem tinha
 * orçamento próprio, calculado UMA vez. Como o ouvinte de respostas continua
 * ativo durante a repescagem, os dois caminhos gastavam o mesmo espaço livre
 * sem se falar, e o teto global podia ser ultrapassado (achado do Sol).
 *
 * ⚠️ PENDENTE e CONFIRMADO são coisas diferentes, e confundi-las foi o erro da
 * versão anterior. Uma leitura em fluxo reserva enquanto baixa, e só no fim se
 * sabe se o corpo entra no pacote. Então:
 *
 *   - o TETO conta pendente + confirmado (conservador: são bytes que já
 *     trafegaram ou vão trafegar);
 *   - o RELATÓRIO conta só confirmado, depois de fechar;
 *   - `fechar()` DESCARTA o pendente, porque nada mais entra no pacote — o que
 *     estava no meio do caminho nunca vai ser empacotado.
 *
 * Assim uma leitura que falha DEPOIS do fechamento não deixa bytes presos (não
 * há o que devolver: o pendente dela já saiu), e o total nunca conta um corpo
 * que não está lá.
 */
export function criarContabilidade(teto) {
  if (!Number.isFinite(teto) || teto < 0) throw new TypeError('teto de bytes invalido');
  let confirmado = 0;
  let fechada = false;
  const pendentes = new Map();       // bilhete -> bytes
  let proximo = 1;
  const somaPendente = () => { let t = 0; for (const n of pendentes.values()) t += n; return t; };
  return {
    /**
     * Tenta reservar. Devolve um bilhete, ou null se não couber (e aí não
     * reserva nada — nunca pela metade).
     */
    reservar(n) {
      if (fechada) return null;
      if (!Number.isFinite(n) || n < 0) return null;
      if (confirmado + somaPendente() + n > teto) return null;
      const bilhete = proximo++;
      pendentes.set(bilhete, n);
      return bilhete;
    },
    /** O corpo entrou no pacote: o pendente vira confirmado. */
    confirmar(bilhete) {
      const n = pendentes.get(bilhete);
      if (n === undefined) return false;
      pendentes.delete(bilhete);
      confirmado += n;
      return true;
    },
    /** O corpo não entrou (leitura abortada, recusa): o pendente some. */
    devolver(bilhete) {
      return pendentes.delete(bilhete);
    },
    /** O que conta para o teto: já confirmado mais o que está em voo. */
    emUso: () => confirmado + somaPendente(),
    /** O que o relatório deve dizer: só o que está no pacote. */
    gasto: () => confirmado,
    pendente: () => somaPendente(),
    restante() { return Math.max(0, teto - (confirmado + somaPendente())); },
    /** Nada mais entra no pacote: o que estava em voo é descartado. */
    fechar() { fechada = true; pendentes.clear(); },
    estaFechada: () => fechada,
  };
}
