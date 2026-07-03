import { describe, it, expect } from 'vitest';
import { computeCost, getCostPerImage, MODEL_PRICES, computeCostMicrocents, imageCostMicrocents } from './cost.js';

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
    expect(MODEL_PRICES['gpt-4o-mini']).toBeDefined();
  });
});

describe('cost — prompt caching', () => {
  it('Anthropic cache READ is 10% of fresh input rate', () => {
    // 10k all-cached vs 10k all-fresh — should be exactly 10%
    const fresh  = computeCost({ model: 'claude-sonnet-4-6', tokensIn: 10000, tokensOut: 0 });
    const cached = computeCost({ model: 'claude-sonnet-4-6', tokensIn: 10000, tokensOut: 0, cachedInTokens: 10000 });
    expect(cached).toBe(Math.round(fresh * 0.10));
  });

  it('Anthropic cache WRITE is 125% of fresh input rate (the +25% surcharge)', () => {
    const fresh = computeCost({ model: 'claude-sonnet-4-6', tokensIn: 10000, tokensOut: 0 });
    const withWrite = computeCost({
      model: 'claude-sonnet-4-6', tokensIn: 10000, tokensOut: 0,
      cacheWriteTokens: 10000,
    });
    // fresh covers the 10k in + write_rate * 10k separately
    expect(withWrite).toBeGreaterThan(fresh * 2);
  });

  it('OpenAI gpt-4o-mini cache READ is 50% of fresh input rate', () => {
    const fresh  = computeCost({ model: 'gpt-4o-mini', tokensIn: 100000, tokensOut: 0 });
    const cached = computeCost({ model: 'gpt-4o-mini', tokensIn: 100000, tokensOut: 0, cachedInTokens: 100000 });
    expect(cached).toBe(Math.round(fresh * 0.50));
  });

  it('Gemini 2.5 Flash cache READ is 25% of fresh input rate', () => {
    const fresh  = computeCost({ model: 'gemini-2.5-flash', tokensIn: 100000, tokensOut: 0 });
    const cached = computeCost({ model: 'gemini-2.5-flash', tokensIn: 100000, tokensOut: 0, cachedInTokens: 100000 });
    expect(cached).toBe(Math.round(fresh * 0.25));
  });

  it('partial cache hits split between fresh and discounted rates', () => {
    // Use 1M tokens so the cents values are large enough that integer
    // rounding doesn't collapse the three cases to 0.
    // 1M @ $0.15 = 15 cents fresh; @ $0.075 = 7.5 → 8 cents cached.
    const allFresh  = computeCost({ model: 'gpt-4o-mini', tokensIn: 1_000_000, tokensOut: 0 });
    const allCached = computeCost({ model: 'gpt-4o-mini', tokensIn: 1_000_000, tokensOut: 0, cachedInTokens: 1_000_000 });
    const partial   = computeCost({ model: 'gpt-4o-mini', tokensIn: 1_000_000, tokensOut: 0, cachedInTokens: 600_000 });
    expect(partial).toBeGreaterThan(allCached);
    expect(partial).toBeLessThan(allFresh);
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

describe('computeCostMicrocents', () => {
  it('keeps sub-cent costs exact (the 0.02¢ Flash call)', () => {
    // gemini-2.5-flash: in $0.10/M, out $0.40/M → 12k in + 800 out
    // = $0.0012 + $0.00032 = $0.00152 = 0.152¢ = 1520 µ¢
    expect(computeCostMicrocents({ model: 'gemini-2.5-flash', tokensIn: 12000, tokensOut: 800 })).toBe(1520);
  });
  it('returns 0 for unknown models (conservative)', () => {
    expect(computeCostMicrocents({ model: 'nope', tokensIn: 1e6, tokensOut: 1e6 })).toBe(0);
  });
  it('computeCost derives from µ¢ (integer cents, unchanged behaviour)', () => {
    // gpt-5.5: 100k in + 10k out = $0.50 + $0.15 = 65¢
    expect(computeCost({ model: 'gpt-5.5', tokensIn: 100000, tokensOut: 10000 })).toBe(65);
  });
});

describe('imageCostMicrocents', () => {
  it('prices gpt-image-1 by quality', () => {
    expect(imageCostMicrocents({ provider: 'openai', quality: 'high' })).toBe(250000);   // $0.25
    expect(imageCostMicrocents({ provider: 'openai', quality: 'medium' })).toBe(60000);  // $0.06
  });
  it('prices Imagen fast flat and unknown providers at 0', () => {
    expect(imageCostMicrocents({ provider: 'gemini' })).toBe(40000);                     // $0.04
    expect(imageCostMicrocents({ provider: 'other' })).toBe(0);
  });
});
