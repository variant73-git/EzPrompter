import { describe, it, expect } from 'vitest';
import { computeCost, getCostPerImage, MODEL_PRICES } from './cost.js';

describe('cost — chat models', () => {
  it('returns 0 cents for unknown model', () => {
    expect(computeCost({ model: 'unknown-xyz', tokensIn: 1000, tokensOut: 500 })).toBe(0);
  });

  it('computes Sonnet 4.6 cost correctly', () => {
    // Sonnet 4.6: $3 in / $15 out per 1M tokens
    // 1000 in + 500 out = 0.003 + 0.0075 = 0.0105 USD = 1.05 cents → rounded to 1
    const cents = computeCost({ model: 'claude-sonnet-4-6', tokensIn: 1000, tokensOut: 500 });
    expect(cents).toBeGreaterThan(0);
    expect(cents).toBeLessThan(5);
  });

  it('computes Gemini 2.5 Flash much cheaper than Sonnet', () => {
    const sonnet = computeCost({ model: 'claude-sonnet-4-6', tokensIn: 10000, tokensOut: 2000 });
    const flash  = computeCost({ model: 'gemini-2.5-flash',  tokensIn: 10000, tokensOut: 2000 });
    expect(flash).toBeLessThan(sonnet / 10);
  });

  it('handles zero tokens', () => {
    expect(computeCost({ model: 'claude-sonnet-4-6', tokensIn: 0, tokensOut: 0 })).toBe(0);
  });

  it('MODEL_PRICES contains entries for the major models', () => {
    expect(MODEL_PRICES['claude-sonnet-4-6']).toBeDefined();
    expect(MODEL_PRICES['claude-opus-4-7']).toBeDefined();
    expect(MODEL_PRICES['gemini-2.5-flash']).toBeDefined();
    expect(MODEL_PRICES['gemini-3.1-pro-preview']).toBeDefined();
    expect(MODEL_PRICES['gpt-5.5']).toBeDefined();
  });
});

describe('cost — image generation', () => {
  it('returns cost for Imagen', () => {
    expect(getCostPerImage('gemini')).toBeGreaterThan(0);
  });

  it('returns cost for gpt-image-1', () => {
    expect(getCostPerImage('openai')).toBeGreaterThan(0);
  });

  it('returns 0 for unknown provider', () => {
    expect(getCostPerImage('unknown')).toBe(0);
  });
});
