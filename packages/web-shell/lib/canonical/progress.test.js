import { describe, expect, it } from 'vitest';
import { PCT, capturePhasePct, monotonicPct, parseProgressLog, pctFromVm } from './progress.js';

describe('progresso da cópia', () => {
  it('lê a última linha válida e ignora a linha cortada no meio da escrita', () => {
    const log = '{"fase":"instalando"}\n{"fase":"gravando","feitas":3,"total":40}\n{"fase":"grav';
    expect(parseProgressLog(log)).toEqual({ fase: 'gravando', feitas: 3, total: 40 });
    expect(parseProgressLog('')).toBeNull();
    expect(parseProgressLog(null)).toBeNull();
  });

  it('gravação vai de 15 a 85 pela fração de paradas', () => {
    expect(pctFromVm({ fase: 'instalando' })).toBe(PCT.installing);
    expect(pctFromVm({ fase: 'gravando', feitas: 0, total: 40 })).toBe(15);
    expect(pctFromVm({ fase: 'gravando', feitas: 20, total: 40 })).toBe(50);
    expect(pctFromVm({ fase: 'gravando', feitas: 40, total: 40 })).toBe(85);
    expect(pctFromVm({ fase: 'gravando', feitas: 50, total: 40 })).toBe(85);
    expect(pctFromVm({ fase: 'montando' })).toBe(PCT.assembling);
    expect(pctFromVm({ fase: 'outra' })).toBeNull();
    expect(pctFromVm(null)).toBeNull();
  });

  it('página que cresce desacelera o número, nunca o faz voltar', () => {
    const antes = pctFromVm({ fase: 'gravando', feitas: 30, total: 40 }); // 68
    const depois = pctFromVm({ fase: 'gravando', feitas: 30, total: 50 }); // 57
    expect(depois).toBeLessThan(antes);
    expect(monotonicPct(antes, depois)).toBe(antes);
    expect(monotonicPct(antes, 90)).toBe(90);
    expect(monotonicPct(undefined, 12)).toBe(12);
    expect(monotonicPct(40, Number.NaN)).toBe(40);
    expect(monotonicPct(40, 140)).toBe(100);
  });

  it('a captura nativa avança por tempo e para abaixo de 10', () => {
    expect(capturePhasePct(0)).toBe(0);
    expect(capturePhasePct(12_500)).toBe(5);
    expect(capturePhasePct(90_000)).toBe(PCT.captureCap);
  });
});
