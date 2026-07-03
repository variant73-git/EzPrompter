// lib/billing/pricing.test.js
import { describe, it, expect } from 'vitest';
import { roundCredits, creditsForOperation, estimateOp, estimateChain, pricingFor } from './pricing.js';

describe('roundCredits', () => {
  it('rounds UP to multiples of 5 with a floor of 5', () => {
    expect(roundCredits(159)).toBe(160);
    expect(roundCredits(161)).toBe(165);
    expect(roundCredits(0.9)).toBe(5);
    expect(roundCredits(155)).toBe(155);
  });
});

describe('creditsForOperation', () => {
  it('applies the per-op multiplier ($0.53 clone × 4 → 215)', () => {
    expect(creditsForOperation({ op: 'extract.clone', totalMicrocents: 530_000 })).toBe(215);
  });
  it('compose at 3× ($0.20 → 60)', () => {
    expect(creditsForOperation({ op: 'compose', totalMicrocents: 200_000 })).toBe(60);
  });
  it('reconstruct has a 150 floor even when cheap', () => {
    expect(creditsForOperation({ op: 'reconstruct', totalMicrocents: 100_000 })).toBe(150); // $0.10×10=100→floor
    expect(creditsForOperation({ op: 'reconstruct', totalMicrocents: 250_000 })).toBe(250);
  });
  it('static site clone is flat 25 regardless of measured cost', () => {
    expect(creditsForOperation({ op: 'extract.html', totalMicrocents: 0 })).toBe(25);
  });
  it('chat and capture are free', () => {
    expect(creditsForOperation({ op: 'chat', totalMicrocents: 5_000 })).toBe(0);
    expect(creditsForOperation({ op: 'capture', totalMicrocents: 0 })).toBe(0);
  });
  it('unknown extract.<to> falls back to the extract prefix (3×)', () => {
    expect(pricingFor('extract.designmd').mult).toBe(3);
    expect(creditsForOperation({ op: 'extract.designmd', totalMicrocents: 100_000 })).toBe(30);
  });
});

describe('estimates', () => {
  it('single-op estimates match the spec table', () => {
    expect(estimateOp('extract.clone')).toBe(250);
    expect(estimateOp('compose')).toBe(75);
    expect(estimateOp('reconstruct')).toBe(200);
  });
  it('chain estimate is the sum', () => {
    expect(estimateChain(['extract.clone', 'transplant', 'image.generate.gemini', 'image.generate.gemini']))
      .toBe(250 + 75 + 20 + 20);
  });
});
