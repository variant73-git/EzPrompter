import { describe, expect, it } from 'vitest';
import { criarContabilidade } from './byte-ledger.js';

describe('contabilidade unica de bytes', () => {
  it('reserva ate o teto e recusa o que nao cabe, sem reservar pela metade', () => {
    const c = criarContabilidade(100);
    const a = c.reservar(60);
    expect(a).toBeTruthy();
    expect(c.emUso()).toBe(60);
    expect(c.reservar(50)).toBe(null);       // nao cabe
    expect(c.emUso()).toBe(60);              // e NAO reservou parte
    expect(c.reservar(40)).toBeTruthy();     // cabe exato
    expect(c.restante()).toBe(0);
    expect(c.reservar(1)).toBe(null);
  });

  // ⚠️ ESTE e' o achado do Sol: dois caminhos calculando "quanto sobra" cada um
  // por si gastam o MESMO espaco livre duas vezes. Com uma porta so', a ordem
  // deixa de importar.
  it('dois caminhos concorrentes nao gastam o mesmo espaco livre', () => {
    const c = criarContabilidade(100);
    const sobraLidaPelaRepescagem = c.restante();
    expect(sobraLidaPelaRepescagem).toBe(100);
    expect(c.reservar(80)).toBeTruthy();                  // a interceptacao gasta primeiro
    expect(c.reservar(sobraLidaPelaRepescagem)).toBe(null); // a repescagem e' recusada
    expect(c.reservar(c.restante())).toBeTruthy();
    expect(c.emUso()).toBe(100);
  });

  // ⚠️ O TETO conta o que esta' em voo; o RELATORIO conta so' o que entrou.
  // Confundir os dois foi o erro da versao anterior.
  it('separa o que esta em voo do que entrou no pacote', () => {
    const c = criarContabilidade(100);
    const b = c.reservar(30);
    expect(c.emUso()).toBe(30);     // ocupa o teto
    expect(c.gasto()).toBe(0);      // mas ainda nao esta' no pacote
    c.confirmar(b);
    expect(c.gasto()).toBe(30);
    expect(c.pendente()).toBe(0);
  });

  it('devolve o pendente de uma leitura abortada', () => {
    const c = criarContabilidade(100);
    const b = c.reservar(70);
    expect(c.devolver(b)).toBe(true);
    expect(c.emUso()).toBe(0);
    expect(c.reservar(100)).toBeTruthy();
    expect(c.devolver(b)).toBe(false);   // uma vez so'
  });

  it('fechada, nao aceita mais reserva', () => {
    const c = criarContabilidade(100);
    c.fechar();
    expect(c.estaFechada()).toBe(true);
    expect(c.reservar(1)).toBe(null);
    expect(c.gasto()).toBe(0);
  });

  // ⚠️ O caso que derrubou a versao anterior: uma leitura reserva, o pacote e'
  // congelado enquanto ela corre, e ai' ela FALHA. Se `fechar()` congelasse o
  // total sem descartar o pendente, esses bytes ficariam presos e o relatorio
  // contaria um corpo que nao esta' no pacote.
  it('fechar descarta o que estava em voo, e a falha tardia nao deixa resto', () => {
    const c = criarContabilidade(100);
    const entrou = c.reservar(40);
    c.confirmar(entrou);
    const emVoo = c.reservar(25);          // ainda baixando quando o pacote fecha
    c.fechar();
    expect(c.gasto()).toBe(40);            // so' o que entrou
    expect(c.pendente()).toBe(0);          // o em-voo foi descartado
    expect(c.devolver(emVoo)).toBe(false); // a falha tardia nao tem o que devolver
    expect(c.gasto()).toBe(40);            // e nao mexe no total
    expect(c.confirmar(emVoo)).toBe(false); // nem um sucesso tardio entra
    expect(c.gasto()).toBe(40);
  });

  it('recusa valores que nao sao numero', () => {
    const c = criarContabilidade(100);
    expect(c.reservar(NaN)).toBe(null);
    expect(c.reservar(-5)).toBe(null);
    expect(c.reservar(Infinity)).toBe(null);
    expect(c.emUso()).toBe(0);
    expect(() => criarContabilidade(NaN)).toThrow(TypeError);
  });
});
