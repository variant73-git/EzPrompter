import { describe, expect, it } from 'vitest';
import { computeSsimRgb } from './clone-similarity.js';

// A matemática é pura de propósito: roda no Node aqui e dentro do browser em
// produção. Os controles espelham os do instrumento de linha de comando
// (identidade, sensibilidade, e o zero-sem-oportunidade das lições 177/179).
function imagem(width, height, pintor) {
  const dados = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pintor(x, y);
      const p = (y * width + x) * 4;
      dados[p] = r; dados[p + 1] = g; dados[p + 2] = b; dados[p + 3] = 255;
    }
  }
  return dados;
}

const xadrez = (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [230, 230, 230] : [30, 30, 30];

describe('computeSsimRgb', () => {
  it('identity: an image against itself is 1', () => {
    const a = imagem(64, 64, xadrez);
    expect(computeSsimRgb(a, a, 64, 64)).toBeCloseTo(1, 6);
  });

  it('sensitivity: the negated image scores drastically lower', () => {
    const a = imagem(64, 64, xadrez);
    const b = imagem(64, 64, (x, y) => xadrez(x, y).map((v) => 255 - v));
    // controle de sensibilidade: sem ele, "deu 1" nao prova nada
    expect(computeSsimRgb(a, b, 64, 64)).toBeLessThan(0.1);
  });

  it('a small local change moves the score a little, not to zero', () => {
    const a = imagem(64, 64, xadrez);
    const b = imagem(64, 64, (x, y) => (x < 8 && y < 8 ? [255, 0, 0] : xadrez(x, y)));
    const s = computeSsimRgb(a, b, 64, 64);
    expect(s).toBeGreaterThan(0.8);
    expect(s).toBeLessThan(0.999);
  });

  it('refuses buffers that do not match the declared size', () => {
    const a = imagem(64, 64, xadrez);
    const b = imagem(32, 32, xadrez);
    expect(() => computeSsimRgb(a, b, 64, 64)).toThrow(/não batem/);
  });

  // Deslocamento pontua MAL por construção — é a ressalva documentada do
  // instrumento (SSIM compara pixels alinhados). O teste PRENDE a ressalva:
  // se um dia alguém "consertar" isso silenciosamente, a semântica mudou.
  it('a 4px shift of identical content scores far below identity', () => {
    const a = imagem(64, 64, xadrez);
    const b = imagem(64, 64, (x, y) => xadrez(x + 4, y));
    expect(computeSsimRgb(a, b, 64, 64)).toBeLessThan(0.5);
  });
});
