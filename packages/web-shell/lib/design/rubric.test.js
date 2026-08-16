import { describe, expect, it } from 'vitest';
import { CRITERIA } from './house-style.js';
import { coveredCriterionIds } from '@uncraft/design-eval';
import { buildRubric, rubricCoverage } from './rubric.js';

// The rubric is DERIVED from the switchboard, never hand-maintained: pendência 5
// of the 2026-07-22 handoff — "cada critério → 1 check pontuado". Deriving it in
// code is what stops the rubric and the guardrails from drifting apart, which is
// the failure this whole line of work exists to prevent.

describe('rubric derivation', () => {
  it('emits exactly one check per enabled criterion', () => {
    const rubric = buildRubric();
    const enabled = CRITERIA.filter((c) => c.on);
    expect(rubric.checks).toHaveLength(enabled.length);
    expect(new Set(rubric.checks.map((c) => c.criterion)).size).toBe(enabled.length);
  });

  it('routes to the cheap layer whenever a deterministic check exists', () => {
    const rubric = buildRubric();
    const det = rubric.checks.filter((c) => c.method === 'deterministic').map((c) => c.criterion);
    expect(det.sort()).toEqual([...coveredCriterionIds()].sort());
    // Everything else has to be asked of the vision judge, with a real question.
    for (const check of rubric.checks.filter((c) => c.method === 'judge')) {
      expect(check.question.length).toBeGreaterThan(20);
      expect(check.criterionText).toBeTruthy();
    }
  });

  it('keeps a partially-covered criterion with the judge, and says what the cheap layer misses', () => {
    const byCriterion = Object.fromEntries(buildRubric().checks.map((c) => [c.criterion, c]));
    const partial = byCriterion['layout-constrain-containers'];
    expect(partial.method).toBe('judge');          // NOT retired by a half-check
    expect(partial.alsoDeterministic).toBe(true);  // but the cheap check still runs
    expect(partial.deterministicBlindSpot).toMatch(/constrain/i);
    expect(partial.question).toBeTruthy();
  });

  it('keeps composite decision provenance intact', () => {
    const byCriterion = Object.fromEntries(buildRubric().checks.map((c) => [c.criterion, c]));
    expect(byCriterion['type-no-mono'].decision).toBe('38/39'); // not just "38"
  });

  it('carries provenance and the decision number when there is one', () => {
    const rubric = buildRubric();
    const byCriterion = Object.fromEntries(rubric.checks.map((c) => [c.criterion, c]));
    expect(byCriterion['color-accent-count'].decision).toBe('47');
    expect(byCriterion['content-real-numbers'].decision).toBe('53');
    expect(byCriterion['type-hierarchy'].decision).toBe(null); // consensus half, no number
    expect(rubric.source).toContain('house-style.js');
  });

  it('is a compliance check, not a grader — no threshold, no weights', () => {
    const rubric = buildRubric();
    // The criteria are BUILD INSTRUCTIONS ("ordens objetivas do que fazer ou não"),
    // so the eval asks "was the instruction followed?", never "what grade is this?".
    expect(rubric.thresholds).toBeUndefined();
    expect(rubric.verdictModel).toBe('compliance');
    for (const check of rubric.checks) expect(check.weight).toBeUndefined();
  });

  it('points calibration at the reference bank keeps, not at hand-picked exemplars', () => {
    expect(buildRubric().calibration.source).toMatch(/reference bank/i);
    expect(buildRubric().calibration.selector).toMatch(/keep/i);
  });

  it('honours a criterion switched off', () => {
    const rubric = buildRubric({ off: ['no-such-id', 'motion-stagger'] });
    expect(rubric.checks.map((c) => c.criterion)).not.toContain('motion-stagger');
  });
});

describe('coverage reporting', () => {
  it('reports how much of the spine the cheap layer covers', () => {
    const cov = rubricCoverage();
    expect(cov.total).toBe(CRITERIA.filter((c) => c.on).length);
    expect(cov.deterministic).toBe(coveredCriterionIds().length);
    expect(cov.judge).toBe(cov.total - cov.deterministic);
    expect(cov.deterministicPct).toBeCloseTo(cov.deterministic / cov.total, 5);
  });
});
