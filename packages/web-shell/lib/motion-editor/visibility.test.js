import { describe, expect, it } from 'vitest';
import {
  MEANINGFUL_VISIBLE_PX,
  MIN_VISIBLE_RATIO,
  measureVisibility,
} from './visibility.js';

const viewport = { left: 0, top: 0, right: 400, bottom: 300 };

describe('motion editor visibility', () => {
  it('accepts an element when at least 25 percent of its area is visible', () => {
    const result = measureVisibility({
      elementRect: { left: -75, top: 20, right: 25, bottom: 120 },
      viewportRect: viewport,
    });

    expect(MIN_VISIBLE_RATIO).toBe(0.25);
    expect(result).toMatchObject({ ratio: 0.25, meaningful: true, reason: 'ratio' });
  });

  it('accepts a large element when a 32 by 32 pixel block is visible', () => {
    const result = measureVisibility({
      elementRect: { left: 368, top: 268, right: 768, bottom: 668 },
      viewportRect: viewport,
    });

    expect(MEANINGFUL_VISIBLE_PX).toBe(32);
    expect(result).toMatchObject({
      ratio: 0.0064,
      visibleWidth: 32,
      visibleHeight: 32,
      meaningful: true,
      reason: 'pixels',
    });
  });

  it('rejects a one or two pixel sliver even when it spans the viewport', () => {
    const onePixel = measureVisibility({
      elementRect: { left: 399, top: 0, right: 799, bottom: 300 },
      viewportRect: viewport,
    });
    const twoPixels = measureVisibility({
      elementRect: { left: -398, top: 0, right: 2, bottom: 300 },
      viewportRect: viewport,
    });

    expect(onePixel).toMatchObject({ visibleWidth: 1, meaningful: false, reason: 'sliver' });
    expect(twoPixels).toMatchObject({ visibleWidth: 2, meaningful: false, reason: 'sliver' });
  });

  it('uses ratio for small elements that cannot expose a 32 pixel block', () => {
    const result = measureVisibility({
      elementRect: { left: 390, top: 290, right: 410, bottom: 310 },
      viewportRect: viewport,
    });

    expect(result).toMatchObject({ ratio: 0.25, meaningful: true, reason: 'ratio' });
  });

  it('rejects detached, empty, and fully offscreen geometry', () => {
    expect(measureVisibility({ elementRect: null, viewportRect: viewport }).meaningful).toBe(false);
    expect(measureVisibility({
      elementRect: { left: 10, top: 10, right: 10, bottom: 20 },
      viewportRect: viewport,
    }).reason).toBe('empty');
    expect(measureVisibility({
      elementRect: { left: 500, top: 500, right: 600, bottom: 600 },
      viewportRect: viewport,
    })).toMatchObject({ ratio: 0, meaningful: false, reason: 'offscreen' });
  });
});
