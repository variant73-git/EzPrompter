/**
 * Server-side image dimension decoder.
 *
 * gpt-image-1's `size: 'auto'` doesn't reliably preserve the input
 * aspect when the input isn't one of its 3 canonical sizes (1024x1024,
 * 1024x1536, 1536x1024) — non-standard aspects (e.g. 1122x1402) come
 * back as 1024x1024 squares. So before calling images.edit we decode
 * the base image's actual pixel dimensions and pick the closest
 * supported size explicitly. PNG + JPEG cover everything our pipeline
 * produces or ingests today.
 */

function decodePng(buf) {
  // PNG signature: 8 bytes (89 50 4E 47 0D 0A 1A 0A). IHDR chunk
  // immediately follows: 4 length + 4 type ('IHDR') + 4 width + 4 height + …
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (!w || !h) return null;
  return { w, h };
}

function decodeJpeg(buf) {
  // JPEG starts with FF D8. Walk segments until we hit an SOFn marker
  // (FF C0..C3, C5..C7, C9..CB, CD..CF). The SOFn payload starts at
  // offset+4 (length already past) with: precision (1), height (2),
  // width (2).
  if (buf.length < 4) return null;
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xFF) return null;
    const marker = buf[i + 1];
    // SOFn family — skip the SOI/EOI/RSTn/DNL/DHT/DAC entries.
    const isSof =
      (marker >= 0xC0 && marker <= 0xC3) ||
      (marker >= 0xC5 && marker <= 0xC7) ||
      (marker >= 0xC9 && marker <= 0xCB) ||
      (marker >= 0xCD && marker <= 0xCF);
    if (isSof) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      if (!w || !h) return null;
      return { w, h };
    }
    // Standalone markers (no length) — skip.
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      i += 2;
      continue;
    }
    // Variable-length segment.
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

export function decodeImageDimsFromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return null; }
  if (mime === 'image/png') return decodePng(buf);
  if (mime === 'image/jpeg' || mime === 'image/jpg') return decodeJpeg(buf);
  return null;
}

// Pick the gpt-image-1 supported aspect that best matches the input's
// real pixel ratio. Returns one of: '1:1' | '16:9' | '9:16' | '3:4' | '4:3'.
// '3:4' and '4:3' map to the same gpt-image-1 size as '9:16' / '16:9'
// respectively in our SIZE_MAP — preferring them keeps the canvas card
// dims closer to the input's natural look.
export function pickAspectForDims({ w, h }) {
  if (!w || !h) return null;
  const r = w / h;
  // Reference ratios match SIZE_MAP entries in openai-image.js.
  const candidates = [
    { id: '1:1',  r: 1.0 },
    { id: '4:3',  r: 1536 / 1024 },  // ≈ 1.5
    { id: '16:9', r: 1536 / 1024 },  // same supported size as 4:3, see comment above
    { id: '3:4',  r: 1024 / 1536 },  // ≈ 0.667
    { id: '9:16', r: 1024 / 1536 },  // same supported size as 3:4
  ];
  let best = candidates[0];
  let bestDiff = Math.abs(best.r - r);
  for (const c of candidates) {
    const d = Math.abs(c.r - r);
    if (d < bestDiff) { best = c; bestDiff = d; }
  }
  return best.id;
}
