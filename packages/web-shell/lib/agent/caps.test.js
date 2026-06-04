import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCaps } from './caps.js';

const env = { ...process.env };
beforeEach(() => {
  delete process.env.UNCRAFT_AGENT_SOFT_ITER;
  delete process.env.UNCRAFT_AGENT_HARD_ITER;
  delete process.env.UNCRAFT_AGENT_RETRY_BUDGET;
  delete process.env.UNCRAFT_AGENT_WALL_TIMEOUT_MS;
});
afterEach(() => { process.env = { ...env }; });

describe('getCaps', () => {
  it('returns spec defaults when no env set', () => {
    expect(getCaps()).toEqual({
      softIterations: 10,
      hardIterations: 50,
      retryBudget: 3,
      wallTimeoutMs: 5 * 60 * 1000,
    });
  });

  it('respects env overrides', () => {
    process.env.UNCRAFT_AGENT_SOFT_ITER = '2';
    process.env.UNCRAFT_AGENT_HARD_ITER = '5';
    process.env.UNCRAFT_AGENT_RETRY_BUDGET = '1';
    process.env.UNCRAFT_AGENT_WALL_TIMEOUT_MS = '30000';
    expect(getCaps()).toEqual({
      softIterations: 2,
      hardIterations: 5,
      retryBudget: 1,
      wallTimeoutMs: 30000,
    });
  });

  it('falls back to defaults on invalid env values', () => {
    process.env.UNCRAFT_AGENT_SOFT_ITER = 'not a number';
    process.env.UNCRAFT_AGENT_HARD_ITER = '-1';
    expect(getCaps().softIterations).toBe(10);
    expect(getCaps().hardIterations).toBe(50);
  });
});
