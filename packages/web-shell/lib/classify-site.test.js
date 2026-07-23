import { describe, it, expect } from 'vitest';
import { classify, textCoverage, toMeta, COVERAGE_OK, COVERAGE_BROKEN } from './classify-site.js';

describe('classify-site', () => {
  describe('textCoverage', () => {
    it('is 1 when the artifact shows all the source text', () => {
      const t = 'the quick brown fox jumps over the lazy dog';
      expect(textCoverage(t, t)).toBe(1);
    });
    it('drops when the artifact is missing source words (broken reveal)', () => {
      const source = 'hero headline pricing features testimonials footer contact';
      const artifact = 'hero headline'; // mid sections collapsed in the photocopy
      expect(textCoverage(source, artifact)).toBeLessThan(COVERAGE_BROKEN);
    });
    it('is robust to conditional UI hidden in BOTH (same visible text → coverage 1)', () => {
      // extractVisibleText excludes hidden nodes on both sides, so a carousel slide
      // hidden in source AND artifact never enters either set.
      const visibleBoth = 'welcome plans enterprise pricing';
      expect(textCoverage(visibleBoth, visibleBoth)).toBe(1);
    });
    it('treats empty source as faithful (nothing to lose)', () => {
      expect(textCoverage('', 'anything')).toBe(1);
    });
  });

  describe('classify', () => {
    const same = 'hero headline pricing plans features testimonials footer contact team about';

    it('static: high coverage, no motion', () => {
      const r = classify({ sourceText: same, artifactText: same, motion: { hasMotion: false } });
      expect(r.photocopyOk).toBe(true);
      expect(r.category).toBe('static');
    });

    it('light: high coverage but motion present (stays FREE)', () => {
      const r = classify({ sourceText: same, artifactText: same, motion: { gsap: true, hasMotion: true } });
      expect(r.photocopyOk).toBe(true);
      expect(r.category).toBe('light');
    });

    it('heavy: low coverage → needs paid', () => {
      const r = classify({ sourceText: same, artifactText: 'hero headline', motion: {} });
      expect(r.photocopyOk).toBe(false);
      expect(r.category).toBe('heavy');
    });

    it('heavy: pin/scrub forces heavy even with perfect coverage', () => {
      const r = classify({ sourceText: same, artifactText: same, motion: { pinOrScrub: true, hasMotion: true } });
      expect(r.photocopyOk).toBe(false);
      expect(r.category).toBe('heavy');
    });

    it('unknown: middle coverage ships free with a hedge, never asserts paid', () => {
      // ~0.8 coverage: 8 of 10 source words present.
      const source = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
      const artifact = 'alpha bravo charlie delta echo foxtrot golf hotel'; // 8/10
      const r = classify({ sourceText: source, artifactText: artifact, motion: {} });
      expect(r.coverage).toBeGreaterThanOrEqual(COVERAGE_BROKEN);
      expect(r.coverage).toBeLessThan(COVERAGE_OK);
      expect(r.photocopyOk).toBe(null);
      expect(r.category).toBe('unknown');
    });
  });

  describe('toMeta (legacy bridge into reconstruction-policy)', () => {
    it('heavy → animatedDetected true', () => {
      const m = toMeta(classify({ sourceText: 'alpha bravo charlie delta echo', artifactText: 'alpha', motion: {} }));
      expect(m.animatedDetected).toBe(true);
      expect(m.photocopyUncertain).toBe(false);
    });
    it('light → animatedDetected false (stays free, no paywall)', () => {
      const t = 'hero pricing features footer contact team about plans';
      const m = toMeta(classify({ sourceText: t, artifactText: t, motion: { gsap: true, hasMotion: true } }));
      expect(m.animatedDetected).toBe(false);
      expect(m.classification.category).toBe('light');
    });
    it('unknown → animatedDetected false but photocopyUncertain true (hedge, not paywall)', () => {
      const source = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
      const artifact = 'alpha bravo charlie delta echo foxtrot golf hotel';
      const m = toMeta(classify({ sourceText: source, artifactText: artifact, motion: {} }));
      expect(m.animatedDetected).toBe(false);
      expect(m.photocopyUncertain).toBe(true);
    });
  });
});
