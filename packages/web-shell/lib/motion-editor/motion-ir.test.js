import { describe, expect, it } from 'vitest';
import {
  MOTION_EDITABILITY,
  buildStripEditPatches,
  coerceMotionValue,
  motionCapabilityLabel,
  motionDriverLabel,
  motionPlaybackMode,
  normalizeMotionClip,
} from './motion-ir.js';

describe('motion IR', () => {
  it('normalizes a sparse runtime clip into predictable editor data', () => {
    expect(normalizeMotionClip({ id: 'fade', timing: { duration: 450 } })).toMatchObject({
      id: 'fade',
      engine: 'Unknown',
      driver: { type: 'time' },
      timing: { duration: 450, delay: 0, iterations: 1, easing: 'linear' },
      tracks: [],
      group: null,
    });
  });

  it('preserves the runtime grouping metadata used to collapse the motion list', () => {
    const group = { splitRootId: 'el-title', splitRootLabel: 'CropTab', timelineId: null };
    expect(normalizeMotionClip({ id: 'char-1', group }).group).toEqual(group);
  });

  it('builds strip-edit patches whose before values come from the ACTIVE motion, not the row envelope', () => {
    // The row strip is the min/max envelope across ALL the element's scroll
    // tweens; the patch targets ONE motion — undo must restore ITS range.
    const motion = { id: 'scroll-1', driver: { type: 'scroll' }, scroll: { start: '600', end: '1200', scrub: true } };
    const row = { scrollStart: 400, scrollEnd: 1200 };
    const patches = buildStripEditPatches({ motion, row, next: { start: 300 } });
    expect(patches).toEqual([{ property: 'scroll.start', before: 600, value: 300 }]);
  });

  it('falls back to the row pixels when the motion scroll range is not numeric, and skips no-ops', () => {
    const motion = { id: 'scroll-1', driver: { type: 'scroll' }, scroll: { start: 'top bottom', end: 'bottom top', scrub: true } };
    const row = { scrollStart: 400, scrollEnd: 1200 };
    expect(buildStripEditPatches({ motion, row, next: { end: 1500 } }))
      .toEqual([{ property: 'scroll.end', before: 1200, value: 1500 }]);
    expect(buildStripEditPatches({ motion, row, next: { end: 1200 } })).toEqual([]);
    expect(buildStripEditPatches({ motion: { ...motion, driver: { type: 'time' } }, row, next: { end: 1500 } })).toEqual([]);
  });

  it('labels drivers and writeback capability in designer language', () => {
    expect(motionDriverLabel({ type: 'scroll' })).toBe('Scroll');
    expect(motionCapabilityLabel(MOTION_EDITABILITY.ADAPTER)).toBe('Adapter');
  });

  it('coerces numeric and toggle values before runtime writeback', () => {
    expect(coerceMotionValue('timing.duration', '1200')).toBe(1200);
    expect(coerceMotionValue('scroll.pin', 'true')).toBe(true);
  });

  it('maps iteration and direction data to designer playback modes', () => {
    expect(motionPlaybackMode({ iterations: 1, direction: 'normal' })).toBe('once');
    expect(motionPlaybackMode({ iterations: Infinity, direction: 'normal' })).toBe('loop');
    expect(motionPlaybackMode({ iterations: Infinity, direction: 'alternate' })).toBe('ping-pong');
  });
});
