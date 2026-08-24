import { describe, expect, it } from 'vitest';
import { parseByteRange, parseContentRange, rangeHeaders } from './byte-range.js';

describe('faixas de bytes — o que faz video buscar quadro', () => {
  it('le a forma comum que o navegador manda', () => {
    expect(parseByteRange('bytes=0-', 1000)).toEqual({ satisfazivel: true, inicio: 0, fim: 999, tamanho: 1000 });
    expect(parseByteRange('bytes=100-199', 1000)).toEqual({ satisfazivel: true, inicio: 100, fim: 199, tamanho: 1000 });
    expect(parseByteRange('bytes=500-99999', 1000)).toEqual({ satisfazivel: true, inicio: 500, fim: 999, tamanho: 1000 });
  });

  it('le a forma de SUFIXO (os ultimos N bytes)', () => {
    expect(parseByteRange('bytes=-300', 1000)).toEqual({ satisfazivel: true, inicio: 700, fim: 999, tamanho: 1000 });
    // sufixo maior que o arquivo = o arquivo inteiro, nao erro
    expect(parseByteRange('bytes=-99999', 1000)).toEqual({ satisfazivel: true, inicio: 0, fim: 999, tamanho: 1000 });
  });

  // ⚠️ Insatisfazivel NAO e' o mesmo que "nao se aplica": o primeiro devolve
  // 416, o segundo serve o arquivo inteiro. Confundir os dois faz o navegador
  // receber 200 onde esperava 416 e a busca no video falhar em silencio.
  it('separa insatisfazivel de nao-se-aplica', () => {
    expect(parseByteRange('bytes=1000-', 1000)).toEqual({ satisfazivel: false, tamanho: 1000 });
    expect(parseByteRange('bytes=900-100', 1000)).toEqual({ satisfazivel: false, tamanho: 1000 });
    expect(parseByteRange('bytes=-0', 1000)).toEqual({ satisfazivel: false, tamanho: 1000 });
    expect(parseByteRange('bytes=0-', 0)).toEqual({ satisfazivel: false, tamanho: 0 });
    expect(parseByteRange('bytes=-5', 0)).toEqual({ satisfazivel: false, tamanho: 0 });
    // nao se aplica:
    expect(parseByteRange(undefined, 1000)).toBe(null);
    expect(parseByteRange('', 1000)).toBe(null);
    expect(parseByteRange('items=0-10', 1000)).toBe(null);
    expect(parseByteRange('bytes=abc', 1000)).toBe(null);
  });

  // Faixa multipla exige resposta multipart. Servir o arquivo inteiro e'
  // resposta permitida; uma multipart mal formada nao e'.
  it('recusa faixa multipla em vez de fingir', () => {
    expect(parseByteRange('bytes=0-99,200-299', 1000)).toBe(null);
  });

  it('monta os cabecalhos de 206 e de 416', () => {
    expect(rangeHeaders(parseByteRange('bytes=100-199', 1000))).toEqual({
      status: 206, 'Content-Range': 'bytes 100-199/1000', 'Content-Length': '100',
    });
    expect(rangeHeaders(parseByteRange('bytes=1000-', 1000))).toEqual({
      status: 416, 'Content-Range': 'bytes */1000',
    });
    expect(rangeHeaders(null)).toBe(null);
  });
});

// O outro lado do espelho: LER um Content-Range de resposta 206. A pergunta
// que importa e' uma so' — este corpo e' o arquivo INTEIRO? Medido no site
// real: 206 parciais do meio do arquivo chegam com corpo legivel, e guardar
// um deles como o arquivo inteiro corrompe o pacote.
describe('parseContentRange — este 206 cobre o arquivo inteiro?', () => {
  it('le a forma comum', () => {
    expect(parseContentRange('bytes 0-938608/938609')).toEqual({ inicio: 0, fim: 938608, total: 938609 });
    expect(parseContentRange('bytes 622592-2914473/2914474')).toEqual({ inicio: 622592, fim: 2914473, total: 2914474 });
  });

  it('total desconhecido ou forma estranha viram null — nunca "completo"', () => {
    expect(parseContentRange('bytes 0-99/*')).toBe(null);
    expect(parseContentRange('bytes */938609')).toBe(null);
    expect(parseContentRange('')).toBe(null);
    expect(parseContentRange(undefined)).toBe(null);
    expect(parseContentRange('items 0-99/1000')).toBe(null);
    expect(parseContentRange('bytes 99-0/1000')).toBe(null);
  });
});
