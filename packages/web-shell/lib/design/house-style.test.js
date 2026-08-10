import { describe, expect, it } from 'vitest';
import { buildAbsorb, buildGuardrails, buildInvent } from './house-style.js';

describe('house style reference decomposition', () => {
  it('treats exact type metrics and mobile behavior as ground truth', () => {
    const guardrails = buildGuardrails();
    expect(guardrails).toContain('letter-spacing and line-height as measured source data');
    expect(guardrails).toContain('Mobile quality is a hard gate');
    expect(guardrails).not.toContain('Eyebrows in particular never widen');
  });

  it('separates reusable structure from replaceable treatment', () => {
    const absorb = buildAbsorb();
    expect(absorb).toContain('reusable structure');
    expect(absorb).toContain('replaceable treatment');
    expect(absorb).toContain('within 15%');
    expect(absorb).toContain('choose one scale owner');
    expect(absorb).toContain('independently chosen ingredients');
  });

  it('uses the new macro priorities for sparse invention', () => {
    const invent = buildInvent();
    expect(invent).toContain('large media with anchored text');
    expect(invent).toContain('remain strong on mobile');
    expect(invent).toContain('brand personality separately from business category');
    expect(invent).toContain('structure + text composition/alignment + palette + typography + motion');
  });
});
