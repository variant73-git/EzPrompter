import { describe, it, expect } from 'vitest';
import { decodeImageDimsFromDataUrl, pickAspectForDims } from './image-dims.js';

// Helpers to build a minimal valid PNG / JPEG header carrying explicit
// width + height so the tests don't depend on real image bytes.
function fakePngDataUrl(w, h) {
  const buf = Buffer.alloc(24);
  // signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47;
  buf[4] = 0x0D; buf[5] = 0x0A; buf[6] = 0x1A; buf[7] = 0x0A;
  // 4 bytes chunk length + 4 bytes 'IHDR' (we don't validate the chunk
  // body strictly; the decoder reads w/h at fixed offsets 16/20)
  buf[8] = 0x00; buf[9] = 0x00; buf[10] = 0x00; buf[11] = 0x0D;
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52;
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function fakeJpegDataUrl(w, h) {
  // SOI + SOF0 segment (FF C0) with: length, precision, height, width, comps
  const buf = Buffer.from([
    0xFF, 0xD8,            // SOI
    0xFF, 0xC0,            // SOF0
    0x00, 0x11,            // segment length (17)
    0x08,                  // precision
    (h >> 8) & 0xFF, h & 0xFF,
    (w >> 8) & 0xFF, w & 0xFF,
    0x03,                  // num components
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

describe('decodeImageDimsFromDataUrl', () => {
  it('reads PNG width/height', () => {
    expect(decodeImageDimsFromDataUrl(fakePngDataUrl(1122, 1402)))
      .toEqual({ w: 1122, h: 1402 });
  });
  it('reads JPEG width/height', () => {
    expect(decodeImageDimsFromDataUrl(fakeJpegDataUrl(800, 600)))
      .toEqual({ w: 800, h: 600 });
  });
  it('returns null on non-data-url', () => {
    expect(decodeImageDimsFromDataUrl('https://example.com/img.png')).toBeNull();
  });
  it('returns null on unsupported mime', () => {
    expect(decodeImageDimsFromDataUrl('data:image/gif;base64,R0lGOD')).toBeNull();
  });
  it('returns null on null input', () => {
    expect(decodeImageDimsFromDataUrl(null)).toBeNull();
  });
});

describe('pickAspectForDims', () => {
  it('1024×1024 → 1:1', () => {
    expect(pickAspectForDims({ w: 1024, h: 1024 })).toBe('1:1');
  });
  // Original screenshot case — non-canonical portrait. Should NOT pick
  // 1:1 (which is what gpt-image-1's `size: 'auto'` was returning before
  // we added explicit inference).
  it('1122×1402 (portrait, ratio 0.80) → portrait (3:4 or 9:16)', () => {
    const picked = pickAspectForDims({ w: 1122, h: 1402 });
    expect(['3:4', '9:16']).toContain(picked);
  });
  it('1920×1080 landscape → landscape (4:3 or 16:9)', () => {
    const picked = pickAspectForDims({ w: 1920, h: 1080 });
    expect(['4:3', '16:9']).toContain(picked);
  });
  it('null dims → null', () => {
    expect(pickAspectForDims({ w: 0, h: 0 })).toBeNull();
    expect(pickAspectForDims({})).toBeNull();
  });
});
