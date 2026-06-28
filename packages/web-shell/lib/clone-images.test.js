import { describe, it, expect } from 'vitest';
import { parseCropRegions, embedClonedImageRegions } from './clone-images.js';

describe('parseCropRegions', () => {
  it('reads a well-formed marker', () => {
    expect(parseCropRegions('<img data-clone-crop="10,20,30,40">')).toEqual([{ x: 10, y: 20, w: 30, h: 40 }]);
  });
  it('returns null for a malformed marker', () => {
    expect(parseCropRegions('<img data-clone-crop="nope">')).toEqual([null]);
    expect(parseCropRegions('<img data-clone-crop="10,20,0,40">')).toEqual([null]); // zero width
  });
  it('clamps a region that runs past the screenshot edge', () => {
    const [r] = parseCropRegions('<img data-clone-crop="90,0,50,50">');
    expect(r.w).toBe(10); // 100 - 90
  });
  it('skips an implausibly large region (a bleeding hero + overlapping UI)', () => {
    expect(parseCropRegions('<img data-clone-crop="10,10,80,80">')).toEqual([null]); // 64% area
    expect(parseCropRegions('<img data-clone-crop="0,0,30,30">')[0]).toBeTruthy();   // 9% area is fine
  });
  it('finds multiple markers in source order', () => {
    const regions = parseCropRegions('<img data-clone-crop="0,0,10,10"><img data-clone-crop="50,50,20,20">');
    expect(regions).toHaveLength(2);
    expect(regions[1]).toEqual({ x: 50, y: 50, w: 20, h: 20 });
  });
});

describe('embedClonedImageRegions', () => {
  const fakeCrop = async (_url, regions) => regions.map((r) => (r ? 'data:image/png;base64,CROP' : null));

  it('fills the real cropped pixels into a marked <img> and drops the marker', async () => {
    const html = '<!doctype html><html><body><img data-clone-crop="10,20,30,40" alt="plane"></body></html>';
    const out = await embedClonedImageRegions(html, 'data:image/png;base64,SRC', { cropFn: fakeCrop });
    expect(out).toContain('src="data:image/png;base64,CROP"');
    expect(out).not.toContain('data-clone-crop');
    expect(out).toContain('alt="plane"');
  });

  it('uses background-image for a non-img placeholder', async () => {
    const html = '<div data-clone-crop="0,0,50,50" class="hero"></div>';
    const out = await embedClonedImageRegions(html, 'data:image/png;base64,SRC', { cropFn: fakeCrop });
    expect(out).toContain('background-image:url(');
    expect(out).not.toContain('data-clone-crop');
  });

  it('keeps the placeholder (no src) when the crop fails', async () => {
    const html = '<img data-clone-crop="10,20,30,40">';
    const failCrop = async (_url, regions) => regions.map(() => null);
    const out = await embedClonedImageRegions(html, 'data:image/png;base64,SRC', { cropFn: failCrop });
    expect(out).not.toContain('data-clone-crop');
    expect(out).not.toContain('src=');
  });

  it('returns html untouched when there are no markers (no crop call)', async () => {
    let called = false;
    const spy = async (...a) => { called = true; return []; };
    const html = '<div>plain</div>';
    const out = await embedClonedImageRegions(html, 'data:image/png;base64,SRC', { cropFn: spy });
    expect(out).toBe(html);
    expect(called).toBe(false);
  });

  it('is a no-op without a screenshot', async () => {
    const html = '<img data-clone-crop="0,0,10,10">';
    expect(await embedClonedImageRegions(html, null, { cropFn: fakeCrop })).toBe(html);
  });
});
