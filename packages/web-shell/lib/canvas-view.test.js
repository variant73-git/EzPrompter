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
});

