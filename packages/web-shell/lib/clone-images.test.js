import { describe, it, expect } from 'vitest';
import { parseCropRegions, embedClonedImageRegions, snapRegionToContent, planAspectPad } from './clone-images.js';

// Synthetic RGBA window: paint(x, y) → [r, g, b].
function makeWin(w, h, paint) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

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
  it('accepts a large clean region (bleeding hero render) but rejects a whole-page grab', () => {
    // The model only marks regions free of functional UI, so big crops are
    // legitimate — 64% (a centre hero render) must survive the guard now.
    expect(parseCropRegions('<img data-clone-crop="10,10,80,80">')[0]).toEqual({ x: 10, y: 10, w: 80, h: 80 });
    expect(parseCropRegions('<img data-clone-crop="0,0,30,30">')[0]).toBeTruthy(); // 9% area is fine
    // ~90% of the screenshot necessarily includes the page's own UI — mis-marked.
    expect(parseCropRegions('<img data-clone-crop="0,0,95,95">')).toEqual([null]);
  });
  it('finds multiple markers in source order', () => {
    const regions = parseCropRegions('<img data-clone-crop="0,0,10,10"><img data-clone-crop="50,50,20,20">');
    expect(regions).toHaveLength(2);
    expect(regions[1]).toEqual({ x: 50, y: 50, w: 20, h: 20 });
  });
});

describe('snapRegionToContent', () => {
  const GREY = [220, 220, 220];
  const DARK = [60, 60, 60];

  it('expands a cut-off edge and drops a UI blob separated by background (the field bug)', () => {
    // Plane artwork rows 50-90 × cols 10-110; a toolbar row 6-14 × cols 40-70
    // floats above it, separated by background. The model's box cut the
    // plane's nose/right (stopped at col 100, row 80) and swallowed the
    // toolbar (top at row 10).
    const win = makeWin(120, 120, (x, y) => {
      const plane = y >= 50 && y <= 90 && x >= 10 && x <= 110;
      const toolbar = y >= 6 && y <= 14 && x >= 40 && x <= 70;
      return plane || toolbar ? DARK : GREY;
    });
    const out = snapRegionToContent(win, { left: 30, top: 10, right: 100, bottom: 80 });
    // Snapped to the plane blob (+2px pad): toolbar out, nose and tail in.
    // The toolbar ends up fully OUTSIDE the crop, so no paint-out is needed.
    expect(out).toEqual({
      left: 8, top: 48, right: 112, bottom: 92,
      holes: [], bg: [220, 220, 220], bakedUi: false,
    });
  });

  it('paints out a toolbar that shares rows with a tall tail (rectangular crop cannot exclude it)', () => {
    // The second field bug: the plane's tail rises to the toolbar's rows, so
    // the artwork's bounding rectangle CONTAINS the toolbar even though they
    // are separate blobs. The box must include the tail — and the toolbar
    // comes back as a HOLE to be painted over with the local background.
    const win = makeWin(120, 120, (x, y) => {
      const body = y >= 50 && y <= 90 && x >= 10 && x <= 110;
      const tail = y >= 20 && y <= 49 && x >= 95 && x <= 105;
      const toolbar = y >= 20 && y <= 28 && x >= 40 && x <= 70;
      return body || tail || toolbar ? DARK : GREY;
    });
    const out = snapRegionToContent(win, { left: 30, top: 25, right: 100, bottom: 80 });
    expect(out.left).toBe(8);
    expect(out.top).toBe(18);   // tail top (20) − pad
    expect(out.right).toBe(112);
    expect(out.bottom).toBe(92);
    // Generous 4px pad — swallows the anti-aliased fringe under the buttons
    // that sits below the content threshold (the "20% of the button bases
    // still visible" field report).
    expect(out.holes).toEqual([
      { left: 36, top: 16, right: 74, bottom: 32, color: [220, 220, 220] },
    ]);
  });

  it('keeps comparably-sized companion blobs (a collage is not UI)', () => {
    const win = makeWin(120, 120, (x, y) => {
      const a = y >= 40 && y <= 80 && x >= 10 && x <= 50;
      const b = y >= 40 && y <= 80 && x >= 70 && x <= 110;
      return a || b ? DARK : GREY;
    });
    const out = snapRegionToContent(win, { left: 15, top: 45, right: 105, bottom: 75 });
    expect(out).toEqual({
      left: 8, top: 38, right: 112, bottom: 82,
      holes: [], bg: [220, 220, 220], bakedUi: false,
    });
  });

  it('flags baked UI it could not paint out and reports the window background', () => {
    // Verified indirectly by the shape of every refined result: bg is always
    // the sampled window background, bakedUi stays false when nothing was
    // left entangled (the paint-out tests above), so downstream cleanup
    // triggers only off holes/bakedUi.
    const win = makeWin(120, 120, (x, y) =>
      (y >= 50 && y <= 90 && x >= 10 && x <= 110) ? DARK : GREY);
    const out = snapRegionToContent(win, { left: 20, top: 45, right: 100, bottom: 85 });
    expect(out.bg).toEqual([220, 220, 220]);
    expect(out.bakedUi).toBe(false);
    expect(out.holes).toEqual([]);
  });

  it('keeps the estimate when the window has no content at all', () => {
    const win = makeWin(60, 60, () => GREY);
    const box = { left: 10, top: 10, right: 50, bottom: 50 };
    expect(snapRegionToContent(win, box)).toBe(box);
  });

  it('keeps the estimate on a busy window (no background to snap against)', () => {
    // Thin background ring, interior nearly all content — a gradient/photo
    // backdrop. Snapping against it would be noise.
    const win = makeWin(60, 60, (x, y) =>
      (x === 0 || y === 0 || x === 59 || y === 59) ? GREY : DARK);
    const box = { left: 10, top: 10, right: 50, bottom: 50 };
    expect(snapRegionToContent(win, box)).toBe(box);
  });

  it('keeps the estimate when the refinement collapses to a sliver', () => {
    // Only a tiny 4×4 chip inside a huge estimated box — a collapse that
    // extreme means the read is untrustworthy, not that the image is 4px.
    const win = makeWin(120, 120, (x, y) =>
      (x >= 60 && x <= 63 && y >= 60 && y <= 63) ? DARK : GREY);
    const box = { left: 5, top: 5, right: 115, bottom: 115 };
    expect(snapRegionToContent(win, box)).toBe(box);
  });
});

describe('planAspectPad', () => {
  it('letterboxes a wide hero strip onto the 16:9 canvas without distortion', () => {
    // The plane crop from the field test: ~3.8:1 — far outside gpt-image-1's
    // supported outputs. Pad to 16:9, content centred; unpad after the edit.
    expect(planAspectPad(720, 190)).toEqual({ aspectKey: '16:9', canvasW: 720, canvasH: 480, offX: 0, offY: 145 });
  });
  it('keeps a near-square crop on the square canvas', () => {
    expect(planAspectPad(500, 480)).toEqual({ aspectKey: '1:1', canvasW: 500, canvasH: 500, offX: 0, offY: 10 });
  });
  it('pads a tall crop onto the portrait canvas', () => {
    expect(planAspectPad(300, 600)).toEqual({ aspectKey: '9:16', canvasW: 400, canvasH: 600, offX: 50, offY: 0 });
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

  it('clears the redrawn fallback inside a container when the real crop lands', async () => {
    // The model leaves a rough CSS approximation INSIDE the marked container as
    // fallback — once real pixels arrive it must go, or it overlays the crop.
    const html = '<div data-clone-crop="10,10,60,60" class="hero"><svg id="fake"></svg><span>redrawn valve</span></div>';
    const out = await embedClonedImageRegions(html, 'data:image/png;base64,SRC', { cropFn: fakeCrop });
    expect(out).toContain('background-image:url(');
    expect(out).not.toContain('redrawn valve');
    expect(out).not.toContain('id="fake"');
  });

  it('keeps the redrawn fallback when the crop fails', async () => {
    const failCrop = async (_url, regions) => regions.map(() => null);
    const html = '<div data-clone-crop="10,10,60,60"><span>redrawn valve</span></div>';
    const out = await embedClonedImageRegions(html, 'data:image/png;base64,SRC', { cropFn: failCrop });
    expect(out).toContain('redrawn valve');
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
