import { describe, expect, it } from 'vitest';
import { designPanelModel } from './design-md-preview.js';
import { swatchesFromPixels } from './design/palette-swatches-client.js';

const MD = `# Spaces

- color.surface.base=#000000
- Palette: #F5F5F5, #ABABAB
- font.family.primary=Geist
- h1: 64px
- h2: 25px
- body: 16px
`;

describe('DESIGN.MD panel model (Aura-style, spec 2026-08-17)', () => {
  it('caps the largest specimen at 40px and scales the others proportionally', () => {
    const model = designPanelModel({ md: MD });
    const byRole = Object.fromEntries(model.typeRoles.map((t) => [t.role, t]));
    // The specimen shows the FONT NAME in its own font — a wrong family here
    // is a visible lie. Extractor .md files use dotted tokens
    // (font.family.primary=Geist), which the parser must understand.
    expect(byRole.H1.family).toBe('Geist');
    const max = Math.max(...model.typeRoles.map((t) => t.size));
    expect(byRole.H1.specimenPx).toBe(40);
    for (const t of model.typeRoles) {
      if (t.size === max) continue;
      const expected = Math.max(12, Math.round(40 * (t.size / max)));
      expect(t.specimenPx).toBe(expected);
      expect(t.specimenPx).toBeLessThan(40);
    }
  });

  it('uses measured swatches (with shares) when the node carries them, tokens otherwise', () => {
    const swatches = [
      { hex: '#101010', share: 0.7 },
      { hex: '#f5f5f5', share: 0.3 },
    ];
    const measured = designPanelModel({ md: MD, swatches });
    expect(measured.colorRows).toEqual([
      { hex: '#101010'.toUpperCase(), share: 0.7, role: null },
      { hex: '#F5F5F5', share: 0.3, role: null },
    ]);
    const fromTokens = designPanelModel({ md: MD });
    expect(fromTokens.colorRows.length).toBeGreaterThan(0);
    expect(fromTokens.colorRows.every((row) => row.share === null)).toBe(true);
  });

  it('flags typography only when a design.md exists (site w/o md shows colors alone)', () => {
    expect(designPanelModel({ md: MD }).hasTypography).toBe(true);
    expect(designPanelModel({ md: '', swatches: [{ hex: '#111111', share: 1 }] }).hasTypography).toBe(false);
  });
});

describe('client palette swatches (proportions, zero-capture-cost)', () => {
  it('measures shares from pixel data, most frequent first, summing ~1', () => {
    // 3 red pixels + 1 blue pixel, opaque, step=4 (every pixel)
    const px = new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]);
    const swatches = swatchesFromPixels(px, { step: 4 });
    expect(swatches).toHaveLength(2);
    expect(swatches[0].share).toBeCloseTo(0.75);
    expect(swatches[1].share).toBeCloseTo(0.25);
    expect(swatches[0].hex).toMatch(/^#FF0000$/i);
    const total = swatches.reduce((s, x) => s + x.share, 0);
    expect(total).toBeCloseTo(1);
  });

  it('skips transparent pixels and returns [] for fully transparent input', () => {
    const px = new Uint8ClampedArray([255, 0, 0, 10, 0, 255, 0, 10]);
    expect(swatchesFromPixels(px, { step: 4 })).toEqual([]);
  });
});
