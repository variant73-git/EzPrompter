import { describe, expect, it } from 'vitest';
import { buildFramerExport } from './framer-export.js';

function clip(overrides = {}) {
  return {
    id: 'clip-1',
    engine: 'GSAP',
    name: 'Slide',
    editability: 'adapter',
    driver: { type: 'time' },
    timing: { delay: 100, duration: 800, endDelay: 0, iterations: 1, direction: 'normal', easing: 'ease-out', yoyo: false, repeatDelay: 0 },
    tracks: [{
      property: 'opacity',
      keyframes: [
        { offset: 0, value: '0', easing: 'ease-out' },
        { offset: 1, value: '1', easing: null },
      ],
    }],
    scroll: null,
    ...overrides,
  };
}

describe('buildFramerExport', () => {
  it('maps a time-driven clip to motion.div with initial/animate/transition', () => {
    const { code, report } = buildFramerExport({ label: 'Hero headline', tag: 'h1', clips: [clip()] });
    expect(code).toContain("import { motion } from 'framer-motion'");
    expect(code).toContain('motion.h1');
    expect(code).toMatch(/initial=\{\{[^}]*opacity: 0/);
    expect(code).toMatch(/animate=\{\{[^}]*opacity: 1/);
    expect(code).toContain('duration: 0.8');
    expect(code).toContain('delay: 0.1');
    expect(report.some((item) => item.action === 'mapped' && /opacity/.test(item.detail))).toBe(true);
  });

  it('maps a scroll-scrubbed clip to useScroll + useTransform over the trigger pixels', () => {
    const scrubbed = clip({
      driver: { type: 'scroll' },
      scroll: { start: '400', end: '900', scrub: true, pin: false, snap: false },
      tracks: [{
        property: 'x',
        keyframes: [
          { offset: 0, value: '0', easing: null },
          { offset: 1, value: '100', easing: null },
        ],
      }],
    });
    const { code, report } = buildFramerExport({ label: 'Vista', tag: 'div', clips: [scrubbed] });
    expect(code).toContain('useScroll');
    expect(code).toContain('useTransform(scrollY, [400, 900], [0, 100])');
    expect(report.some((item) => item.action === 'mapped' && /scroll/.test(item.feature))).toBe(true);
  });

  it('maps a media clip to a currentTime binding driven by scroll', () => {
    const media = clip({
      driver: { type: 'media' },
      scroll: { start: '1200', end: '2600', scrub: true, pin: false, snap: false },
      tracks: [{
        property: 'currentTime',
        keyframes: [
          { offset: 0, value: '0', easing: null },
          { offset: 1, value: '6.4', easing: null },
        ],
      }],
    });
    const { code } = buildFramerExport({ label: 'Reel', tag: 'video', clips: [media] });
    expect(code).toContain('useMotionValueEvent');
    expect(code).toContain('currentTime');
    expect(code).toContain('[1200, 2600]');
  });

  it('degrades what cannot map — with a report entry, never silently', () => {
    const exotic = clip({
      scroll: { start: 'top top', end: '+=300%', scrub: true, pin: true, snap: false },
      driver: { type: 'scroll' },
      tracks: [{
        property: 'transform',
        keyframes: [
          { offset: 0, value: 'matrix(1, 0, 0, 1, 0, 0)', easing: null },
          { offset: 1, value: 'matrix(1, 0, 0, 1, 100, 0)', easing: null },
        ],
      }],
    });
    const { code, report } = buildFramerExport({ label: 'Pinned', tag: 'section', clips: [exotic] });
    expect(report.some((item) => item.action === 'skipped' && /pin/i.test(item.feature))).toBe(true);
    expect(report.some((item) => item.action === 'degraded' && /transform/.test(item.detail))).toBe(true);
    // The report ships INSIDE the file so the human sees it in Framer.
    expect(code).toContain('TRANSLATION REPORT');
  });

  it('never emits duplicate const declarations when two tracks map to one property', () => {
    // x + xPercent on one scroll tween is the classic GSAP centering pattern —
    // both map to Framer x, and a name collision is a SyntaxError in the export.
    const scrubbed = clip({
      driver: { type: 'scroll' },
      scroll: { start: '400', end: '900', scrub: true, pin: false, snap: false },
      tracks: [
        { property: 'xPercent', keyframes: [{ offset: 0, value: '-50', easing: null }, { offset: 1, value: '-50', easing: null }] },
        { property: 'x', keyframes: [{ offset: 0, value: '0', easing: null }, { offset: 1, value: '120', easing: null }] },
      ],
    });
    const { code, report } = buildFramerExport({ label: 'Centered', tag: 'div', clips: [scrubbed] });
    const constNames = [...code.matchAll(/const (\w+) =/g)].map((match) => match[1]);
    expect(new Set(constNames).size).toBe(constNames.length);
    // Percent props keep their unit — 50 in Framer x means 50px, not 50%.
    expect(code).toContain("'-50%'");
    expect(report.some((item) => item.action === 'degraded' && /x/.test(item.detail))).toBe(true);
  });

  it('always emits a valid component identifier, even for labels starting with digits', () => {
    const { code } = buildFramerExport({ label: '3 steps to better crops', tag: 'div', clips: [clip()] });
    const name = code.match(/export default function (\S+)\(/)?.[1];
    expect(name).toBeTruthy();
    expect(/^[A-Za-z_]/.test(name)).toBe(true);
  });

  it('preserves unit-carrying values as strings instead of stripping them to numbers', () => {
    const sized = clip({
      tracks: [{
        property: 'width',
        keyframes: [
          { offset: 0, value: '50%', easing: null },
          { offset: 1, value: '100%', easing: null },
        ],
      }],
    });
    const { code } = buildFramerExport({ label: 'Sized', tag: 'div', clips: [sized] });
    expect(code).toContain("'50%'");
    expect(code).toContain("'100%'");
    expect(code).not.toMatch(/width: 50[^%]/);
  });

  it('sanitizes report text so page content can never break out of the comment block', () => {
    const hostile = clip({ name: 'evil */ alert(1); /*' });
    const { code } = buildFramerExport({ label: 'evil */ label', tag: 'div', clips: [hostile] });
    // The report block must close exactly once, where the generator closes it.
    const body = code.slice(0, code.indexOf('import '));
    expect(body.match(/\*\//g)).toHaveLength(1);
  });

  it('quotes non-identifier property keys and sanitizes variable names (CSS custom properties)', () => {
    const custom = clip({
      driver: { type: 'scroll' },
      scroll: { start: '100', end: '600', scrub: true, pin: false, snap: false },
      tracks: [{
        property: '--progress',
        keyframes: [
          { offset: 0, value: '0', easing: null },
          { offset: 1, value: '1', easing: null },
        ],
      }],
    });
    const { code } = buildFramerExport({ label: 'Meter', tag: 'div', clips: [custom] });
    // `const --progressValue` and `{ --progress: x }` are both SyntaxErrors.
    expect(code).not.toMatch(/const --/);
    expect(code).toContain("'--progress':");
  });

  it('exports every track of a media clip — sibling properties ride the same scroll range', () => {
    const media = clip({
      driver: { type: 'media' },
      scroll: { start: '1200', end: '2600', scrub: true, pin: false, snap: false },
      tracks: [
        { property: 'currentTime', keyframes: [{ offset: 0, value: '0', easing: null }, { offset: 1, value: '6.4', easing: null }] },
        { property: 'opacity', keyframes: [{ offset: 0, value: '0', easing: null }, { offset: 1, value: '1', easing: null }] },
      ],
    });
    const { code } = buildFramerExport({ label: 'Reel', tag: 'video', clips: [media] });
    expect(code).toContain('useMotionValueEvent');
    expect(code).toMatch(/opacity: \w+/);
    expect(code).toContain('useTransform(scrollY, [1200, 2600], [0, 1])');
  });

  it('maps intermediate keyframes to framer keyframe arrays with times', () => {
    const multi = clip({
      editability: 'direct',
      engine: 'CSS',
      tracks: [{
        property: 'opacity',
        keyframes: [
          { offset: 0, value: '0', easing: null },
          { offset: 0.5, value: '0.6', easing: null },
          { offset: 1, value: '1', easing: null },
        ],
      }],
    });
    const { code } = buildFramerExport({ label: 'Fade', tag: 'p', clips: [multi] });
    expect(code).toMatch(/opacity: \[0, 0\.6, 1\]/);
    expect(code).toMatch(/times: \[0, 0\.5, 1\]/);
  });
});
