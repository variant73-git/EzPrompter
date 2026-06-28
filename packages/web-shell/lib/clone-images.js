/**
 * clone-images.js — crop-and-embed the REAL images of a cloned site.
 *
 * A vision model can reproduce layout, colour and type, but it cannot redraw a
 * photo / 3D render / image-logo faithfully. So the clone prompt marks each
 * real raster image with `data-clone-crop="X,Y,W,H"` (percentages of the source
 * screenshot, top-left origin). Here we crop those exact regions out of the
 * screenshot pixels and embed them as the <img> src — pixel-identical heroes,
 * logos and photos instead of placeholders or redrawn guesses.
 */

import { JSDOM } from 'jsdom';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// A clean, croppable image is a bounded rectangle — rarely more than ~a third
// of the page. A bigger marked region almost always means the model grabbed a
// bleeding/floating hero PLUS the UI overlapping it (toolbar buttons over a
// transparent render). Cropping that bakes the overlap into one messy picture
// with a frame — so skip it and let the placeholder stand instead.
const MAX_CROP_AREA = 0.35; // fraction of the whole screenshot

// Parse + clamp one data-clone-crop value → { x, y, w, h } | null (malformed or
// implausibly large = null, i.e. don't crop).
function regionFromAttr(val) {
  const [x, y, w, h] = String(val || '').split(',').map((n) => parseFloat(n.trim()));
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  const cx = clamp(x, 0, 100), cy = clamp(y, 0, 100);
  const cw = clamp(w, 0, 100 - cx), ch = clamp(h, 0, 100 - cy);
  if ((cw / 100) * (ch / 100) > MAX_CROP_AREA) return null; // too big → not a clean image
  return { x: cx, y: cy, w: cw, h: ch };
}

// Pure: read the marked regions out of the HTML. Exported for testing + reuse.
// Returns [{ x, y, w, h } | null] in source order (null = malformed/too-large).
export function parseCropRegions(html) {
  const dom = new JSDOM(html);
  return [...dom.window.document.querySelectorAll('[data-clone-crop]')]
    .map((el) => regionFromAttr(el.getAttribute('data-clone-crop')));
}

// Crop the given %-regions out of a screenshot data URL via playwright clip.
// Returns [dataUrl | null] aligned to `regions`. Isolated so it can be mocked.
export async function cropScreenshotRegions(screenshotDataUrl, regions) {
  if (!regions.some(Boolean)) return regions.map(() => null);
  const { launchBrowser } = await import('./browser.js');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<!doctype html><html><body style="margin:0;padding:0"><img id="__s" src="${screenshotDataUrl}" style="display:block"></body></html>`,
      { waitUntil: 'load' },
    );
    await page.waitForFunction(() => {
      const i = document.getElementById('__s');
      return i && i.complete && i.naturalWidth > 0;
    }, { timeout: 15000 });
    const dims = await page.evaluate(() => {
      const i = document.getElementById('__s');
      return i ? { w: i.naturalWidth, h: i.naturalHeight } : null;
    });
    if (!dims || !dims.w || !dims.h) return regions.map(() => null);
    await page.setViewportSize({ width: dims.w, height: dims.h });
    const out = [];
    for (const r of regions) {
      if (!r) { out.push(null); continue; }
      const x = clamp(Math.round(r.x / 100 * dims.w), 0, dims.w - 1);
      const y = clamp(Math.round(r.y / 100 * dims.h), 0, dims.h - 1);
      const width = clamp(Math.round(r.w / 100 * dims.w), 1, dims.w - x);
      const height = clamp(Math.round(r.h / 100 * dims.h), 1, dims.h - y);
      try {
        const buf = await page.screenshot({ type: 'png', clip: { x, y, width, height } });
        out.push(`data:image/png;base64,${buf.toString('base64')}`);
      } catch { out.push(null); }
    }
    return out;
  } finally {
    await browser.close();
  }
}

// Replace every data-clone-crop placeholder in `html` with its real cropped
// pixels from `screenshotDataUrl`. A failed crop leaves the placeholder intact
// (minus the marker attr). Never throws into the caller — on any error the
// original html is returned unchanged. `cropFn` is injectable for tests.
export async function embedClonedImageRegions(html, screenshotDataUrl, { cropFn = cropScreenshotRegions } = {}) {
  if (!html || !screenshotDataUrl) return html;
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const marked = [...doc.querySelectorAll('[data-clone-crop]')];
    if (!marked.length) return html;
    const regions = marked.map((el) => regionFromAttr(el.getAttribute('data-clone-crop')));
    const crops = await cropFn(screenshotDataUrl, regions);
    marked.forEach((el, i) => {
      el.removeAttribute('data-clone-crop');
      const url = crops?.[i];
      if (!url) return;                       // crop failed → keep placeholder
      if (el.tagName === 'IMG') {
        el.setAttribute('src', url);
      } else {
        const prev = el.getAttribute('style') || '';
        el.setAttribute('style', `${prev};background-image:url('${url}');background-size:cover;background-position:center`);
      }
    });
    return dom.serialize();
  } catch {
    return html;
  }
}
