import { describe, it, expect } from 'vitest';
import { clampToViewport } from './menu-position.js';

const VW = 1000, VH = 800;

describe('clampToViewport', () => {
  it('leaves a menu that fits where it is', () => {
    expect(clampToViewport(100, 100, 200, 300, VW, VH)).toEqual({ left: 100, top: 100 });
  });

  it('flips a menu off the bottom edge so it stays fully visible', () => {
    // Anchored near the bottom with a tall menu — the bug from the report.
    const p = clampToViewport(100, 700, 200, 300, VW, VH);
    expect(p.top + 300).toBeLessThanOrEqual(VH - 8);
    expect(p.top).toBe(800 - 8 - 300);
  });

  it('flips a menu off the right edge', () => {
    const p = clampToViewport(900, 100, 280, 200, VW, VH);
    expect(p.left + 280).toBeLessThanOrEqual(VW - 8);
  });

  it('never positions above/left of the 8px margin even if the menu is huge', () => {
    const p = clampToViewport(50, 50, 2000, 2000, VW, VH);
    expect(p.left).toBe(8);
    expect(p.top).toBe(8);
  });
});
