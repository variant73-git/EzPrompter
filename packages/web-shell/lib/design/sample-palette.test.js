import { describe, it, expect } from 'vitest';
import { toHex, colorDist, formatPaletteBrief, samplePalette } from './sample-palette.js';

describe('toHex / colorDist', () => {
  it('formats and clamps rgb to hex', () => {
    expect(toHex([255, 0, 16])).toBe('#ff0010');
    expect(toHex([300, -5, 128])).toBe('#ff0080'); // clamped
  });
  it('measures euclidean distance', () => {
    expect(colorDist([0, 0, 0], [0, 0, 0])).toBe(0);
    expect(Math.round(colorDist([0, 0, 0], [10, 0, 0]))).toBe(10);
  });
});

describe('formatPaletteBrief', () => {
  it('returns empty when there is nothing measured', () => {
    expect(formatPaletteBrief(null)).toBe('');
    expect(formatPaletteBrief({})).toBe('');
  });
  it('reports a GRADIENT when top and bottom differ', () => {
    const out = formatPaletteBrief({ top: [240, 240, 245], bottom: [230, 222, 210], palette: [[255, 255, 255]] });
    expect(out).toMatch(/GRADIENT/);
    expect(out).toContain('#f0f0f5'); // top
    expect(out).toContain('#e6ded2'); // bottom
    expect(out).toContain('#ffffff'); // palette
    expect(out).toMatch(/exact/i);
  });
  it('labels the dominant background and the saturated accent by role', () => {
    const out = formatPaletteBrief({
      top: [245, 245, 245], bottom: [245, 245, 245], palette: [],
      background: [243, 243, 240], accent: [245, 160, 40],
    });
    expect(out).toMatch(/background colour: #f3f3f0/i);
    expect(out).toMatch(/accent.*#f5a028/i);
  });
  it('does not call it a gradient when top ≈ bottom', () => {
    const out = formatPaletteBrief({ top: [245, 245, 245], bottom: [245, 245, 245], palette: [] });
    expect(out).toContain('#f5f5f5');
    expect(out).not.toMatch(/GRADIENT/);
  });
  it('caveats that edge colours may be a presentation backdrop', () => {
    const out = formatPaletteBrief({ top: [240, 240, 245], bottom: [230, 222, 210], palette: [] });
    expect(out).toMatch(/backdrop/i);
  });
});

describe('samplePalette', () => {
  it('formats whatever the (injected) sampler measures', async () => {
    const fake = async () => ({ top: [10, 10, 10], bottom: [250, 250, 250], palette: [] });
    const out = await samplePalette({ imageDataUrl: 'data:image/png;base64,AAA', _sampler: fake });
    expect(out).toMatch(/GRADIENT/);
  });
  it('returns empty when the sampler fails (best-effort)', async () => {
    const out = await samplePalette({ imageDataUrl: 'data:image/png;base64,AAA', _sampler: async () => null });
    expect(out).toBe('');
  });
});
