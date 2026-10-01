// Energia de movimento por REGIAO (Astra B1 #1; revisao Claude 2026-10-01): componentes da
// mascara da referencia, cada um medido numa caixa ampliada nos dois lados; vale o pior.
// Mapas sinteticos no formato que a rajada grava (240 px de largura).
import { describe, expect, it } from 'vitest';
import { energiaPorRegiao, AREA_MIN_PX } from './verbatim-gate.mjs';

const W = 240; const H = 200;
const mapa = (pintar) => { const b = new Uint8Array(W * H); pintar(b); return { w: W, h: H, dados: Buffer.from(b).toString('base64') }; };
const ret = (b, x0, y0, w, h, v) => { for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) b[y * W + x] = v; };
// objeto SOLIDO de 33x8 se movendo: so as bordas (2 px) mudam
const bordas = (b, x0, y0, v = 40) => { ret(b, x0, y0, 2, 8, v); ret(b, x0 + 33, y0, 2, 8, v); };

describe('energiaPorRegiao', () => {
  it('botao pequeno: detectado como movimento (no quadro inteiro ficava abaixo do piso)', () => {
    const ref = mapa((b) => bordas(b, 100, 50));
    const r = energiaPorRegiao(ref, ref);
    expect(r.pior).not.toBeNull();
    expect(r.pior.razao).toBe(1);
  });
  it('clone DESLOCADO (2 e 8 px de mapa) com a animacao viva: segue vivo (a 1a versao dava congelado)', () => {
    const ref = mapa((b) => bordas(b, 100, 50));
    for (const [dx, dy] of [[2, 0], [0, 8], [3, 3]]) {
      const cand = mapa((b) => bordas(b, 100 + dx, 50 + dy));
      const r = energiaPorRegiao(ref, cand);
      expect(r.pior.cand, `dx=${dx} dy=${dy}`).toBeGreaterThan(0);
      expect(r.pior.razao, `dx=${dx} dy=${dy}`).toBeGreaterThanOrEqual(0.25);
    }
  });
  it('outra FASE da mesma animacao (elemento em outro trecho do percurso): segue vivo', () => {
    const ref = mapa((b) => bordas(b, 100, 50));
    const cand = mapa((b) => bordas(b, 112, 50));
    expect(energiaPorRegiao(ref, cand).pior.cand).toBeGreaterThan(0);
  });
  it('video vivo ao lado de um botao CONGELADO no clone: o pior componente acusa (a 1a versao dava vivo)', () => {
    const ref = mapa((b) => { ret(b, 0, 100, 120, 60, 90); bordas(b, 180, 20); });
    const cand = mapa((b) => { ret(b, 0, 100, 120, 60, 90); });
    const r = energiaPorRegiao(ref, cand);
    expect(r.componentes.length).toBeGreaterThanOrEqual(2);   // video + botao (as bordas do botao podem ficar separadas)
    expect(r.pior.cand).toBe(0);
  });
  it('video alheio fora de qualquer regiao, animacao principal congelada: congelado', () => {
    const ref = mapa((b) => bordas(b, 100, 50));
    const cand = mapa((b) => ret(b, 0, 150, 80, 50, 90));
    expect(energiaPorRegiao(ref, cand).pior.cand).toBe(0);
  });
  it('movimento minusculo (< AREA_MIN_PX): referencia parada', () => {
    const ref = mapa((b) => ret(b, 10, 10, 1, AREA_MIN_PX - 1, 30));
    expect(energiaPorRegiao(ref, ref).pior).toBeNull();
  });
  it('mapa ausente ou de dimensao diferente: null (cai no quadro inteiro)', () => {
    const ref = mapa((b) => ret(b, 0, 0, 10, 10, 9));
    expect(energiaPorRegiao(ref, undefined)).toBeNull();
    expect(energiaPorRegiao(ref, { w: 120, h: 100, dados: Buffer.alloc(12000).toString('base64') })).toBeNull();
  });
  it('componente de energia baixa (cursor/decode tenue) nao decide o ponto', () => {
    const ref = mapa((b) => { bordas(b, 100, 50); ret(b, 10, 10, 1, 6, 1); });
    const r = energiaPorRegiao(ref, mapa((b) => bordas(b, 100, 50)));
    expect(r.componentes.every((c) => c.ref > 0)).toBe(true);
    expect(r.pior.cand).toBeGreaterThan(0);   // o cursor tenue (energia 1) nao virou o pior componente
  });
});
