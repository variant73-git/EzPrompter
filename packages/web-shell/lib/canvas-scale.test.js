// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readCanvasScale } from './canvas-scale.js';

afterEach(() => {
  delete window.__uncraftZoom;
  vi.restoreAllMocks();
});

describe('readCanvasScale', () => {
  it('prefers the live zoom API when available', () => {
    window.__uncraftZoom = { getScale: () => 0.42 };
    expect(readCanvasScale()).toBe(0.42);
  });

  it('falls back to the --canvas-scale CSS variable when the API is missing', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '0.75',
    });
    expect(readCanvasScale()).toBe(0.75);
  });

  it('falls back to the CSS variable when the API returns a non-positive value', () => {
    window.__uncraftZoom = { getScale: () => 0 };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '0.5',
    });
    expect(readCanvasScale()).toBe(0.5);
  });

  it('returns 1 when nothing is available', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '',
    });
    expect(readCanvasScale()).toBe(1);
  });
});
