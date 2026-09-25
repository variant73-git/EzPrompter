/**
 * palette-swatches-client.js — proportional colour swatches, measured in the
 * BROWSER from a screenshot data-URL. Client twin of the server sampler in
 * sample-palette.js (same coarse-bucket histogram), so the DESIGN.MD panel
 * gets colour PROPORTIONS at zero capture cost: sampling runs after the
 * capture lands, on the user's own canvas, in a few milliseconds.
 *
 * Returns [{ hex, share }] sorted by share desc (share ∈ (0..1], sums ~1),
 * or [] when sampling is unavailable (no canvas, broken image).
 */

export function swatchesFromPixels(px, { step = 16 } = {}) {
  const buckets = new Map();
  for (let i = 0; i < px.length; i += step) {
    if (px[i + 3] < 200) continue; // skip transparent
    const key = ((px[i] & 0xe0) << 16) | ((px[i + 1] & 0xe0) << 8) | (px[i + 2] & 0xe0);
    const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += px[i]; cur.g += px[i + 1]; cur.b += px[i + 2];
    buckets.set(key, cur);
  }
  const list = [...buckets.values()].sort((a, b) => b.n - a.n);
  const total = list.reduce((sum, c) => sum + c.n, 0);
  if (!total) return [];
  const toHex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return list.slice(0, 8).map((c) => ({
    hex: `#${toHex(c.r / c.n)}${toHex(c.g / c.n)}${toHex(c.b / c.n)}`.toUpperCase(),
    share: c.n / total,
  }));
}

export async function samplePaletteSwatches(imageDataUrl) {
  if (!imageDataUrl || typeof document === 'undefined') return [];
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = imageDataUrl;
    });
    const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
    const cw = Math.max(1, Math.round(img.naturalWidth * scale));
    const ch = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, cw, ch);
    return swatchesFromPixels(ctx.getImageData(0, 0, cw, ch).data);
  } catch {
    return [];
  }
}
