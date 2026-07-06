// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readCanvasScale, chromeScale, isWorldlockChrome } from './canvas-scale.js';

afterEach(() => {
  delete window.__uncraftZoom;
  document.documentElement.classList.remove('canvas-worldlock');
  vi.restoreAllMocks();
});

describe('chromeScale', () => {
  it('floors the zoom at 0.4 normally', () => {
    expect(chromeScale(0.8)).toBe(0.8);
    expect(chromeScale(0.2)).toBe(0.4);
    expect(chromeScale(undefined)).toBe(1);
  });

  it('pins to 1 under the world-lock experiment', () => {
    document.documentElement.classList.add('canvas-worldlock');
    expect(isWorldlockChrome()).toBe(true);
    expect(chromeScale(0.8)).toBe(1);
    expect(chromeScale(0.2)).toBe(1);
    expect(chromeScale(2.5)).toBe(1);
  });
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
