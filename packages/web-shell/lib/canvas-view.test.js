import { describe, expect, it } from 'vitest';
import {
  CANVAS_DEFAULT_SCALE,
  CANVAS_MAX_SCALE,
  CANVAS_MIN_SCALE,
  clampCanvasScale,
  parseCanvasView,
} from './canvas-view.js';

describe('canvas view persistence', () => {
  it('uses the reference zoom range and default', () => {
    expect(CANVAS_MIN_SCALE).toBe(0.18);
    expect(CANVAS_MAX_SCALE).toBe(1.5);
    expect(CANVAS_DEFAULT_SCALE).toBe(0.72);
  });

  it('clamps persisted scales to the supported range', () => {
    expect(clampCanvasScale(0.05)).toBe(0.18);
    expect(clampCanvasScale(2.4)).toBe(1.5);
    expect(clampCanvasScale('0.75')).toBe(0.75);
  });

  it('parses a valid saved viewport and rejects corrupt values', () => {
    expect(parseCanvasView('{"positionX":10,"positionY":20,"scale":0.6}')).toEqual({
      positionX: 10,
      positionY: 20,
      scale: 0.6,
    });
    expect(parseCanvasView('{"positionX":"nope"}')).toBeNull();
    expect(parseCanvasView('not json')).toBeNull();
  });

  it('discards a stored view whose scale is out of range — the position is incoherent (defect 2, 2026-08-20)', () => {
    // The old behaviour clamped ONLY the scale: a camera saved at 4% (edit
    // mode) restored its raw position under an 18% scale — the site landed
    // far outside the viewport and every zoom-in magnified empty canvas.
    // A position is only meaningful WITH the scale it was computed for, so an
    // out-of-range scale invalidates the whole view (mount falls back to fit).
    expect(parseCanvasView(JSON.stringify({ positionX: 40000, positionY: -3000, scale: 0.04 }))).toBeNull();
    expect(parseCanvasView(JSON.stringify({ positionX: 10, positionY: 10, scale: 2.4 }))).toBeNull();
    // Float noise from the transform library must not discard a valid view.
    expect(parseCanvasView(JSON.stringify({ positionX: 10, positionY: 10, scale: 0.18 }))).toEqual({
      positionX: 10, positionY: 10, scale: 0.18,
    });
  });

  it('exposes the edit-mode floor and wheel ceiling as canonical constants', async () => {
    const { CANVAS_EDIT_MIN_SCALE, CANVAS_WHEEL_MAX_SCALE } = await import('./canvas-view.js');
    expect(CANVAS_EDIT_MIN_SCALE).toBe(0.04);
    expect(CANVAS_WHEEL_MAX_SCALE).toBe(2.5);
  });
});

