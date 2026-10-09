import { describe, expect, it } from 'vitest';
import { designMdPreviewModel, swatchInk } from './design-md-preview.js';

describe('design.md preview model', () => {
  it('turns markdown into a compact type scale and deduplicated palette', () => {
    const model = designMdPreviewModel(`# North Star\n\nfont-family: "Sora"\n#faf8f2 #1b1b19 #ff5c35 #ff5c35\n64px 36px 16px`, 'north-star.md');
    expect(model.title).toBe('North Star');
    expect(model.headingFont).toBe('Sora');
    expect(model.scale.map((item) => item.size)).toEqual([64, 36, 16]);
    expect(model.palette).toEqual(['#faf8f2', '#1b1b19', '#ff5c35']);
  });

  it('chooses legible ink for light and dark swatches', () => {
    expect(swatchInk('#f4f1ea')).toBe('#20201e');
    expect(swatchInk('#191917')).toBe('#f1f0eb');
  });
});
