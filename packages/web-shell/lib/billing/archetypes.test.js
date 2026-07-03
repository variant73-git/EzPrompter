// lib/billing/archetypes.test.js
import { describe, it, expect } from 'vitest';
import { creditsForOperation } from './pricing.js';

const charge = (op, usd) => creditsForOperation({ op, totalMicrocents: Math.round(usd * 1_000_000) });

describe('flow archetypes land in their spec ranges (spec §4)', () => {
  it('prompt → site', () => {
    const total = charge('compose', 0.20);
    expect(total).toBeGreaterThanOrEqual(60); expect(total).toBeLessThanOrEqual(90);
  });
  it('image clone (clean / with cleanup regions)', () => {
    expect(charge('extract.clone', 0.53)).toBe(215);
    expect(charge('extract.clone', 0.53 + 0.25)).toBeGreaterThanOrEqual(315);
  });
  it('rebrand = extract + transplant', () => {
    const total = charge('extract.designmd', 0.05) + charge('transplant', 0.25);
    expect(total).toBeGreaterThanOrEqual(90); expect(total).toBeLessThanOrEqual(105);
  });
  it('reconstruct floor + typical', () => {
    expect(charge('reconstruct', 0.05)).toBe(150);
    expect(charge('reconstruct', 0.20)).toBe(200);
  });
  it('full showcase with Imagen stays under the 500 welcome pack', () => {
    const total = charge('extract.clone', 0.53) + charge('extract.designmd', 0.05)
      + charge('transplant', 0.25) + 2 * charge('image.generate', 0.04);
    expect(total).toBeLessThanOrEqual(500);
  });
});
