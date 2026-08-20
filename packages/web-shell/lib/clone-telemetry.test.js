import { describe, it, expect } from 'vitest';
import { usdFromMicrocents, startCloneTimer, buildCloneTelemetry } from './clone-telemetry.js';

describe('usdFromMicrocents', () => {
  it('converte µ¢ para USD na escala do billing (530_000 µ¢ = $0.53, o Mode E medido)', () => {
    expect(usdFromMicrocents(530_000)).toBeCloseTo(0.53, 6);
  });
  it('devolve 0 para null/NaN/negativo', () => {
    expect(usdFromMicrocents(null)).toBe(0);
    expect(usdFromMicrocents('x')).toBe(0);
    expect(usdFromMicrocents(-5)).toBe(0);
  });
});

describe('startCloneTimer', () => {
  it('mede etapas sequenciais e total com clock injetado', () => {
    let t = 1000;
    const timer = startCloneTimer(() => t);
    t = 1500; timer.mark('capture');
    t = 1800; timer.mark('controls');
    t = 1850; timer.mark('persist');
    const out = timer.finish();
    expect(out.stages).toEqual({ capture: 500, controls: 300, persist: 50 });
    expect(out.totalMs).toBe(850);
  });
  it('acumula marks repetidos sob o mesmo nome', () => {
    let t = 0;
    const timer = startCloneTimer(() => t);
    t = 100; timer.mark('llm');
    t = 250; timer.mark('llm');
    expect(timer.finish().stages.llm).toBe(250);
  });
});

describe('buildCloneTelemetry', () => {
  it('monta o registro com custo derivado de µ¢', () => {
    const rec = buildCloneTelemetry({
      engine: 'native-bundle', reason: 'edit', url: 'https://x.com',
      stages: { capture: 19000 }, totalMs: 22000, credits: 275,
      usageMicrocents: 120_000, at: '2026-08-20T00:00:00Z',
    });
    expect(rec).toEqual({
      engine: 'native-bundle', reason: 'edit', url: 'https://x.com',
      stages: { capture: 19000 }, totalMs: 22000, credits: 275,
      usageMicrocents: 120_000, costUsd: 0.12, at: '2026-08-20T00:00:00Z',
    });
  });
  it('custo null quando µ¢ desconhecido (nunca inventa zero)', () => {
    const rec = buildCloneTelemetry({ engine: 'iter9', totalMs: 177000, usageMicrocents: null });
    expect(rec.costUsd).toBe(null);
    expect(rec.usageMicrocents).toBe(null);
  });
});
