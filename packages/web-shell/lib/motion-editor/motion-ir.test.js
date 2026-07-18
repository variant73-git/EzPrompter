import { describe, expect, it } from 'vitest';
import {
  MOTION_EDITABILITY,
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
    });
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
