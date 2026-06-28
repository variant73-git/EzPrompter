/**
 * sample-palette.js — DETERMINISTIC colour ground-truth for style transfer.
 *
 * A vision model eyeballs colour poorly — it drifts the exact grey of a
 * background, misses that a "flat grey" is actually a gradient, approximates an
 * accent. So instead of trusting the model, we MEASURE: draw the source image
 * to a canvas and read the real pixels — the background's gradient endpoints and
 * a small dominant palette — then feed those EXACT hexes into the style brief as
 * authority. The restyler stops guessing colour.
 *
 * The browser sampler is isolated (mockable); the formatting is pure + tested.
 */

export function toHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function colorDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

// Turn the raw measured samples into a markdown ground-truth block to append to
// the style brief. `null`/empty → '' (nothing to pin). Pure + tested.
export function formatPaletteBrief(sampled) {
  if (!sampled || !sampled.top || !sampled.bottom) return '';
  const top = toHex(sampled.top);
  const bottom = toHex(sampled.bottom);
  const gradient = colorDist(sampled.top, sampled.bottom) > 10;
  const bg = gradient
    ? `a GRADIENT from ${top} (top) to ${bottom} (bottom) — it is NOT a flat colour`
    : `a flat ${top}`;
  const palette = (sampled.palette || []).map(toHex);
  const paletteLine = palette.length ? `\n- Dominant colours measured in the image: ${palette.join(', ')}` : '';
  return (
    '\n\nSAMPLED GROUND-TRUTH COLOURS (measured from the source pixels — use these EXACT values, never approximate or drift them):\n' +
    `- Page background is ${bg}.` +
    paletteLine
  );
}

// Draw the image to a downscaled canvas and read: the average colour of the top
// band and the bottom band (the gradient endpoints), plus a quantised dominant
// palette. Isolated so callers/tests can inject a fake. Returns null on failure.
export async function sampleImagePixels(imageDataUrl) {
  if (!imageDataUrl) return null;
  try {
    const { launchBrowser } = await import('../browser.js');
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(
        `<!doctype html><html><body style="margin:0"><img id="__s" src="${imageDataUrl}" style="display:block"></body></html>`,
        { waitUntil: 'load' },
      );
      await page.waitForFunction(() => {
        const i = document.getElementById('__s');
        return i && i.complete && i.naturalWidth > 0;
      }, { timeout: 15000 });
      return await page.evaluate(() => {
        const img = document.getElementById('__s');
        const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
        const cw = Math.max(1, Math.round(img.naturalWidth * scale));
        const ch = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        const px = ctx.getImageData(0, 0, cw, ch).data;
        const at = (x, y) => { const i = (y * cw + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
        const bandAvg = (y0, y1) => {
          let r = 0, g = 0, b = 0, n = 0;
          for (let y = y0; y < y1; y++) for (let x = 0; x < cw; x += 3) { const p = at(x, y); r += p[0]; g += p[1]; b += p[2]; n++; }
          return n ? [r / n, g / n, b / n] : [0, 0, 0];
        };
        const top = bandAvg(0, Math.max(1, Math.round(ch * 0.12)));
        const bottom = bandAvg(Math.round(ch * 0.88), ch);
        const hist = new Map();
        for (let i = 0; i < px.length; i += 16) {
          const key = ((px[i] & 0xf0) << 16) | ((px[i + 1] & 0xf0) << 8) | (px[i + 2] & 0xf0);
          hist.set(key, (hist.get(key) || 0) + 1);
        }
        const palette = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
        return { top, bottom, palette };
      });
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

// Public: measure the source image's colours and return the ground-truth brief
// block to append (''  when sampling is unavailable). `_sampler` injectable.
export async function samplePalette({ imageDataUrl, _sampler = sampleImagePixels } = {}) {
  const sampled = await _sampler(imageDataUrl);
  return formatPaletteBrief(sampled);
}
