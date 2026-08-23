import { describe, it, expect } from 'vitest';
import { stringLiteralsDeJs } from './js-string-literals.js';

function valores(fonte) {
  const r = stringLiteralsDeJs(fonte);
  return r.literais.map((l) => fonte.slice(l.inicio, l.fim));
}

describe('onde estao as strings de um javascript', () => {
  it('acha string de aspas e de apostrofo', () => {
    expect(valores(`var a = "um"; var b = 'dois';`)).toEqual(['um', 'dois']);
  });

  // A razao de existir: uma URL dentro de comentario nao e' uma referencia.
  it('ignora comentario de linha e de bloco', () => {
    expect(valores('// "a"\nvar x = "b"; /* "c" */')).toEqual(['b']);
  });

  // E dentro de expressao regular tambem nao e'.
  it('ignora o que esta dentro de expressao regular', () => {
    expect(valores('var re = /"nao"/g; var s = "sim";')).toEqual(['sim']);
  });

  it('atravessa escape sem se perder', () => {
    expect(valores('var a = "com \\" aspas"; var b = "depois";')).toEqual(['com \\" aspas', 'depois']);
  });

  // Template nao entra: o valor pode ser montado, e substituir dentro dele
  // mudaria o significado do que o autor escreveu.
  it('nao devolve template literal', () => {
    expect(valores('var a = `x${y}z`; var b = "sim";')).toEqual(['sim']);
  });

  it('atravessa interpolacao aninhada', () => {
    const r = stringLiteralsDeJs('var a = `x${ f({ n: 1 }) }z`; var b = "sim";');
    expect(r.completo).toBe(true);
    expect(r.literais).toHaveLength(1);
  });

  // Divisao apos `)` — uma heuristica precisava DESISTIR aqui; o parser resolve.
  it('divisao depois de parentese e lida certo', () => {
    expect(valores('var x = (a + b) / c; var s = "sim";')).toEqual(['sim']);
    expect(valores('var x = a / b; var s = "sim";')).toEqual(['sim']);
    expect(valores('var x = 10 / 2; var s = "sim";')).toEqual(['sim']);
  });

  it('barra depois de return abre expressao regular', () => {
    expect(valores('function f(){ return /"nao"/.test(x); } var s = "sim";')).toEqual(['sim']);
  });

  // ⭐ O caso que derrubou a heuristica (achado do Sol): apos `break`, a
  // insercao automatica de ponto e virgula faz a barra da linha seguinte abrir
  // uma expressao REGULAR. A heuristica lia divisao, e entao classificava o
  // miolo do regex como string — traduzindo dentro dele e corrompendo o
  // programa em silencio.
  it('respeita a insercao automatica de ponto e virgula', () => {
    const js = 'while (ativo) {\n  break\n  /["//cdn.exemplo.com/foo"]+x/.test(v)\n}\nvar s = "sim";';
    expect(valores(js)).toEqual(['sim']);
  });

  it('declara incompleto quando o parse falha, e nao devolve literal nenhum', () => {
    const r = stringLiteralsDeJs('var a = "sem fim');
    expect(r.completo).toBe(false);
    expect(r.motivo).toMatch(/^parse_falhou/);
    expect(r.literais).toEqual([]);
    expect(stringLiteralsDeJs('function {{{').completo).toBe(false);
  });

  it('le tambem modulo com import/export', () => {
    expect(valores('import x from "mod"; export const y = "sim";')).toEqual(['mod', 'sim']);
  });

  it('nao quebra com entrada vazia ou nula', () => {
    expect(stringLiteralsDeJs('').completo).toBe(true);
    expect(stringLiteralsDeJs(null).literais).toEqual([]);
  });
});
