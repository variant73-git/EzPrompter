import { describe, it, expect } from 'vitest';
import { estimatedDurationMs, progressAt } from './generation-progress.js';

describe('estimatedDurationMs', () => {
  it('returns ~150s for a cloned URL site', () => {
    expect(estimatedDurationMs({ kind: 'site', origin_url: 'https://x.com' })).toBe(150000);
  });
  it('returns ~45s for a blank composition site', () => {
    expect(estimatedDurationMs({ kind: 'site', meta: { source: 'blank' } })).toBe(45000);
  });
  it('returns ~25s for image / asset nodes', () => {
    expect(estimatedDurationMs({ kind: 'image' })).toBe(25000);
    expect(estimatedDurationMs({ kind: 'asset' })).toBe(25000);
  });
  it('falls back to 45s for anything else or null', () => {
    expect(estimatedDurationMs({ kind: 'prompt' })).toBe(45000);
    expect(estimatedDurationMs(null)).toBe(45000);
  });
});

describe('progressAt', () => {
  it('is 0 at t=0', () => {
    expect(progressAt(0, 45000)).toBe(0);
  });
  it('climbs but never reaches or exceeds 95', () => {
    const mid = progressAt(45000, 45000);   // t = duration = 3τ
    expect(mid).toBeGreaterThan(80);
    expect(mid).toBeLessThan(95);
    expect(progressAt(10_000_000, 45000)).toBeLessThanOrEqual(95);
  });
  it('rises monotonically', () => {
    expect(progressAt(2000, 45000)).toBeGreaterThan(progressAt(1000, 45000));
  });
  it('a shorter duration climbs faster at the same elapsed time', () => {
    expect(progressAt(5000, 25000)).toBeGreaterThan(progressAt(5000, 150000));
  });
  it('returns an integer', () => {
    expect(Number.isInteger(progressAt(3333, 45000))).toBe(true);
  });
});
