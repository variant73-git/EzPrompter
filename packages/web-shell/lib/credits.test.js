import { describe, it, expect } from 'vitest';
import { getUserCredits, deductCredits, hasEnoughCredits } from './credits.js';

describe('credits — MVP stub', () => {
  it('getUserCredits returns unlimited (Number.MAX_SAFE_INTEGER) for any user', async () => {
    const c = await getUserCredits({ userId: 42 });
    expect(c).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('deductCredits is a no-op that returns the new balance', async () => {
    const b = await deductCredits({ userId: 42, cents: 5 });
    expect(b).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('hasEnoughCredits is always true', async () => {
    expect(await hasEnoughCredits({ userId: 42, cents: 1000000 })).toBe(true);
  });
});
