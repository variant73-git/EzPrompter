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

// The model only crop-marks regions it judges CLEAN (no real UI overlapping —
// the prompt owns that distinction), so big marked regions are legitimate: a
// hero render bleeding over a plain background is the BEST crop, not a hazard.
// This cap is only a whole-page sanity bound — a region this large necessarily
// contains the page's own cards/toolbars, meaning the model mis-marked it.
const MAX_CROP_AREA = 0.85; // fraction of the whole screenshot

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

// ── Deterministic crop-box refinement ───────────────────────────────────────
// The model's data-clone-crop box is an ESTIMATE — field tests: it cut the
// nose off a plane render on one side and baked the page's toolbar on the
// other. The pixels themselves say where the artwork really is, so we read
// them in 2-D: classify each pixel of a window around the box as content
// (≠ page background), group content into CONNECTED BLOBS, keep the main
// artwork blob (plus comparably-sized companions — collages), and snap the
// box to what's kept. UI blobs separated from the artwork by background are
// dropped — and when a dropped blob still falls INSIDE the rectangular crop
// (a toolbar level with the plane's tail), it is returned as a HOLE with the
// locally-sampled background colour so the cropper can paint it out before
// clipping. 1-D row/column bands can't do that: a toolbar sharing rows with
// a tall tail merges into the artwork band and gets baked into the crop.
// Pure — the playwright side only supplies the window pixels.
// Returns { left, top, right, bottom, holes: [{left,top,right,bottom,color}] }
// or the original `box` (identity, no holes) when there is nothing safe to do.
export function snapRegionToContent(win, box, opts = {}) {
  const { width: w, height: h, data } = win || {};
  if (!w || !h || !data || data.length < w * h * 4 || !box) return box;
  const TH = opts.colorThreshold ?? 24;   // per-channel distance that makes a pixel "content"
  const KEEP_RATIO = opts.keepRatio ?? 0.25; // companion blobs at least this × main size stay
  const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

  // Background = dominant colour of the window's border ring (the window pads
  // the box, so the ring is page background unless the layout is busy).
  const buckets = new Map();
  const feed = (x, y) => {
    const c = px(x, y);
    const k = `${c[0] >> 4},${c[1] >> 4},${c[2] >> 4}`;
    const cur = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += c[0]; cur.g += c[1]; cur.b += c[2];
    buckets.set(k, cur);
  };
  for (let x = 0; x < w; x++) { feed(x, 0); feed(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { feed(0, y); feed(w - 1, y); }
  let bg = null, bgN = 0;
  for (const v of buckets.values()) if (v.n > bgN) { bgN = v.n; bg = [v.r / v.n, v.g / v.n, v.b / v.n]; }
  if (!bg) return box;

  // Content mask + busy bail (nearly-all-content window = gradient/photo
  // backdrop, nothing to snap against — keep the model's estimate).
  const mask = new Uint8Array(w * h);
  let contentTotal = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      if (Math.abs(c[0] - bg[0]) > TH || Math.abs(c[1] - bg[1]) > TH || Math.abs(c[2] - bg[2]) > TH) {
        mask[y * w + x] = 1;
        contentTotal++;
      }
    }
  }
  if (contentTotal === 0) return box;
  if (contentTotal / (w * h) > 0.85) return box;

  // Dilate by 2px (horizontal then vertical) so anti-aliased fragments of one
  // artwork connect, while real background gaps (≥ ~5px) keep blobs apart.
  const R = 2;
  const dilH = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dx = -R; dx <= R; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < w) dilH[y * w + nx] = 1;
      }
    }
  }
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!dilH[y * w + x]) continue;
      for (let dy = -R; dy <= R; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < h) dil[ny * w + x] = 1;
      }
    }
  }

  // Connected blobs (4-neighbour BFS on the dilated mask). Count and bbox are
  // accumulated over ORIGINAL mask pixels so boxes stay tight and size ratios
  // honest — dilation only decides connectivity.
  const label = new Int32Array(w * h); // 0 = unlabelled
  const blobs = []; // { id, count, l, t, r, b }
  const queue = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!dil[start] || label[start]) continue;
    const id = blobs.length + 1;
    const blob = { id, count: 0, l: w, t: h, r: -1, b: -1 };
    let qh = 0, qt = 0;
    label[start] = id;
    queue[qt++] = start;
    while (qh < qt) {
      const cur = queue[qh++];
      const cy = (cur / w) | 0, cx = cur - cy * w;
      if (mask[cur]) {
        blob.count++;
        if (cx < blob.l) blob.l = cx;
        if (cx > blob.r) blob.r = cx;
        if (cy < blob.t) blob.t = cy;
        if (cy > blob.b) blob.b = cy;
      }
      if (cx > 0 && dil[cur - 1] && !label[cur - 1]) { label[cur - 1] = id; queue[qt++] = cur - 1; }
      if (cx < w - 1 && dil[cur + 1] && !label[cur + 1]) { label[cur + 1] = id; queue[qt++] = cur + 1; }
      if (cy > 0 && dil[cur - w] && !label[cur - w]) { label[cur - w] = id; queue[qt++] = cur - w; }
      if (cy < h - 1 && dil[cur + w] && !label[cur + w]) { label[cur + w] = id; queue[qt++] = cur + w; }
    }
    if (blob.count > 0 && blob.r >= blob.l && blob.b >= blob.t) blobs.push(blob);
  }
  if (!blobs.length) return box;

  // Candidates = blobs whose bbox intersects the model's box; the artwork is
  // the biggest of them, companions of comparable size (collage pieces) stay.
  const bL = Math.max(0, Math.round(box.left)), bT = Math.max(0, Math.round(box.top));
  const bR = Math.min(w - 1, Math.round(box.right)), bB = Math.min(h - 1, Math.round(box.bottom));
  const hits = (r, lo0, lo1, hi0, hi1) => r.l <= hi0 && r.r >= lo0 && r.t <= hi1 && r.b >= lo1;
  const candidates = blobs.filter((c) => hits(c, bL, bT, bR, bB));
  if (!candidates.length) return box;
  let main = candidates[0];
  for (const c of candidates) if (c.count > main.count) main = c;
  const kept = candidates.filter((c) => c.count >= KEEP_RATIO * main.count);
  const keptIds = new Set(kept.map((c) => c.id));
  let left = w, top = h, right = -1, bottom = -1;
  for (const c of kept) {
    if (c.l < left) left = c.l;
    if (c.t < top) top = c.t;
    if (c.r > right) right = c.r;
    if (c.b > bottom) bottom = c.b;
  }
  // A refinement that collapsed to a sliver is a mis-read — keep the estimate.
  const area = (right - left + 1) * (bottom - top + 1);
  const boxArea = Math.max(1, (bR - bL + 1) * (bB - bT + 1));
  if (area < 0.15 * boxArea) return box;
  const PAD = 2;
  const out = {
    left: Math.max(0, left - PAD),
    top: Math.max(0, top - PAD),
    right: Math.min(w - 1, right + PAD),
    bottom: Math.min(h - 1, bottom + PAD),
    holes: [],
    // Flags for the generative polish downstream: the window's background
    // colour (letterbox padding) and whether UI had to be left baked because
    // painting it out would clip artwork pixels.
    bg: [Math.round(bg[0]), Math.round(bg[1]), Math.round(bg[2])],
    bakedUi: false,
  };

  // Dropped blobs that still fall inside the rectangular crop become HOLES —
  // paint-out patches in the locally-sampled background colour. Only when the
  // patch rectangle contains NO kept-artwork pixel (else painting it would
  // punch through the artwork itself — leave those baked, they genuinely
  // touch the image).
  for (const c of blobs) {
    if (keptIds.has(c.id)) continue;
    if (!(c.l - PAD <= out.right && c.r + PAD >= out.left && c.t - PAD <= out.bottom && c.b + PAD >= out.top)) continue;
    // The UI's anti-aliased fringe (soft shadow under a button) sits below the
    // content threshold, so the tight bbox can leave a sliver of it visible.
    // Prefer a generous pad; fall back to the tight one when the bigger patch
    // would clip artwork pixels; entangled either way → leave it baked.
    let hole = null;
    for (const pad of [4, PAD]) {
      const hl = Math.max(0, c.l - pad), ht = Math.max(0, c.t - pad);
      const hr = Math.min(w - 1, c.r + pad), hb = Math.min(h - 1, c.b + pad);
      let touchesKept = false;
      for (let y = ht; y <= hb && !touchesKept; y++) {
        for (let x = hl; x <= hr; x++) {
          const lb = label[y * w + x];
          if (lb && keptIds.has(lb) && mask[y * w + x]) { touchesKept = true; break; }
        }
      }
      if (!touchesKept) { hole = { hl, ht, hr, hb }; break; }
    }
    if (!hole) { out.bakedUi = true; continue; }
    const { hl, ht, hr, hb } = hole;
    // Local background = average of non-content pixels in a 3px ring around
    // the patch (falls back to the global estimate when the ring is empty).
    let rr = 0, gg = 0, bb2 = 0, n = 0;
    const rl = Math.max(0, hl - 3), rt = Math.max(0, ht - 3);
    const rrgt = Math.min(w - 1, hr + 3), rbot = Math.min(h - 1, hb + 3);
    for (let y = rt; y <= rbot; y++) {
      for (let x = rl; x <= rrgt; x++) {
        if (x >= hl && x <= hr && y >= ht && y <= hb) continue; // ring only
        if (mask[y * w + x]) continue;
        const c2 = px(x, y);
        rr += c2[0]; gg += c2[1]; bb2 += c2[2]; n++;
      }
    }
    const color = n
      ? [Math.round(rr / n), Math.round(gg / n), Math.round(bb2 / n)]
      : [Math.round(bg[0]), Math.round(bg[1]), Math.round(bg[2])];
    out.holes.push({ left: hl, top: ht, right: hr, bottom: hb, color });
  }
  return out;
}

// Extract a downscaled pixel window around each region from the screenshot
// already loaded in the page, snap each box to its content, and map back to
// %-regions. Any failure returns the original estimates.
async function refineRegionsOnPage(page, dims, regions) {
  const wins = regions.map((r) => {
    if (!r) return null;
    const x = (r.x / 100) * dims.w, y = (r.y / 100) * dims.h;
    const wpx = (r.w / 100) * dims.w, hpx = (r.h / 100) * dims.h;
    const mx = Math.max(24, wpx * 0.15), my = Math.max(24, hpx * 0.15);
    const L = Math.max(0, Math.floor(x - mx)), T = Math.max(0, Math.floor(y - my));
    const R = Math.min(dims.w, Math.ceil(x + wpx + mx)), B = Math.min(dims.h, Math.ceil(y + hpx + my));
    if (R - L < 4 || B - T < 4) return null;
    return { L, T, W: R - L, H: B - T, box: { x, y, w: wpx, h: hpx } };
  });
  const samples = await page.evaluate((ws) => ws.map((s) => {
    if (!s) return null;
    const img = document.getElementById('__s');
    const scale = Math.min(1, 360 / Math.max(s.W, s.H));
    const cw = Math.max(1, Math.round(s.W * scale));
    const ch = Math.max(1, Math.round(s.H * scale));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, s.L, s.T, s.W, s.H, 0, 0, cw, ch);
    return { width: cw, height: ch, data: Array.from(ctx.getImageData(0, 0, cw, ch).data), scale };
  }), wins);
  return regions.map((r, i) => {
    const s = samples?.[i], wn = wins[i];
    if (!r || !s || !wn) return r;
    const k = s.scale;
    const boxWin = {
      left: (wn.box.x - wn.L) * k,
      top: (wn.box.y - wn.T) * k,
      right: (wn.box.x + wn.box.w - wn.L) * k - 1,
      bottom: (wn.box.y + wn.box.h - wn.T) * k - 1,
    };
    const snapped = snapRegionToContent(s, boxWin);
    if (!snapped || snapped === boxWin) return r;
    // Window px → natural px; the region stays in % (the crop loop converts
    // back), the paint-out holes stay in NATURAL px (the cover divs use them
    // directly in page coordinates).
    const toNat = (bx) => ({
      x: wn.L + bx.left / k,
      y: wn.T + bx.top / k,
      w: (bx.right - bx.left + 1) / k,
      h: (bx.bottom - bx.top + 1) / k,
    });
    const nat = toNat(snapped);
    const holes = (snapped.holes || []).map((hh) => ({ ...toNat(hh), color: hh.color }));
    return {
      x: (nat.x / dims.w) * 100,
      y: (nat.y / dims.h) * 100,
      w: (nat.w / dims.w) * 100,
      h: (nat.h / dims.h) * 100,
      holes,
      // UI overlapped this artwork (painted out and/or left baked) — the
      // cropper runs the generative polish on the clipped image when enabled.
      needsCleanup: holes.length > 0 || !!snapped.bakedUi,
      bg: snapped.bg || null,
    };
  });
}

// ── Generative UI-removal polish ─────────────────────────────────────────────
// The deterministic paint-out removes UI blobs it can safely rectangle over,
// but anti-aliased fringes and UI entangled with the artwork survive it. For
// regions where the refinement SAW overlapping UI, the cropped image takes one
// gpt-image-1 edit pass that erases leftover interface elements. Clean crops
// never pay for this. Cost hook: this is the single point a future credit
// system bills for "high-fidelity clone image cleanup" (~1 image edit per
// dirty region). Kill switch: UNCRAFT_CLONE_UI_CLEANUP=0.
const CLEAN_UI_PROMPT =
  'Remove every user-interface element overlapping this artwork — buttons, toolbars, icons, chips, badges, text labels. ' +
  'Reconstruct whatever is behind them (background or artwork) seamlessly. Change NOTHING else: keep the artwork\'s shapes, ' +
  'colours, lighting, framing and position exactly as in the input. Do not add, move, restyle or re-frame anything.';

function cleanupEnabled() {
  const v = String(process.env.UNCRAFT_CLONE_UI_CLEANUP ?? '').toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  return !!process.env.OPENAI_API_KEY;
}

// gpt-image-1 only outputs 1024x1024 / 1536x1024 / 1024x1536 — an unusual
// aspect (a 3.8:1 hero strip) would be re-framed and ruined. So the crop is
// letterboxed onto the closest supported aspect with background colour before
// the edit, and the content band is cut back out after. Pure planner, tested.
export function planAspectPad(w, h) {
  const r = w / Math.max(1, h);
  const targets = [
    { key: '16:9', ratio: 1.5 },
    { key: '1:1', ratio: 1 },
    { key: '9:16', ratio: 2 / 3 },
  ];
  let best = targets[0];
  for (const t of targets) {
    if (Math.abs(Math.log(r / t.ratio)) < Math.abs(Math.log(r / best.ratio))) best = t;
  }
  let canvasW = w, canvasH = h;
  if (r > best.ratio) canvasH = Math.round(w / best.ratio);
  else canvasW = Math.round(h * best.ratio);
  return {
    aspectKey: best.key,
    canvasW,
    canvasH,
    offX: Math.round((canvasW - w) / 2),
    offY: Math.round((canvasH - h) / 2),
  };
}

// Pad → one generative edit → unpad. Any failure returns the original crop —
// the polish can only improve the deterministic result, never lose it.
// `editFn` is injectable for tests; the default routes through the existing
// gpt-image-1 adapter.
export async function cleanCropUi({ page, dataUrl, width, height, bg = null, editFn = null }) {
  try {
    const plan = planAspectPad(width, height);
    const fill = Array.isArray(bg) && bg.length === 3 ? bg : [240, 240, 240];
    const padded = await page.evaluate(async (arg) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = arg.src; });
      const c = document.createElement('canvas');
      c.width = arg.plan.canvasW; c.height = arg.plan.canvasH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = `rgb(${arg.fill[0]},${arg.fill[1]},${arg.fill[2]})`;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, arg.plan.offX, arg.plan.offY, arg.w, arg.h);
      return c.toDataURL('image/png');
    }, { src: dataUrl, plan, fill, w: width, h: height });
    const edit = editFn || (async ({ prompt, baseImageDataUrl, aspectRatio }) => {
      const { generateOpenAIImage } = await import('./image-gen/openai-image.js');
      return generateOpenAIImage({ prompt, baseImageDataUrl, aspectRatio, apiKey: process.env.OPENAI_API_KEY });
    });
    const out = await edit({ prompt: CLEAN_UI_PROMPT, baseImageDataUrl: padded, aspectRatio: plan.aspectKey });
    if (!out?.dataUrl) return dataUrl;
    const unpadded = await page.evaluate(async (arg) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = arg.src; });
      const sx = (arg.plan.offX / arg.plan.canvasW) * img.naturalWidth;
      const sy = (arg.plan.offY / arg.plan.canvasH) * img.naturalHeight;
      const sw = (arg.w / arg.plan.canvasW) * img.naturalWidth;
      const sh = (arg.h / arg.plan.canvasH) * img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = arg.w; c.height = arg.h;
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, arg.w, arg.h);
      return c.toDataURL('image/png');
    }, { src: out.dataUrl, plan, w: width, h: height });
    return unpadded || dataUrl;
  } catch {
    return dataUrl;
  }
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
    // Snap the model's estimated boxes to the real artwork pixels — expands
    // an edge that cut content off, drops UI bands the box swallowed.
    let effective = regions;
    try { effective = await refineRegionsOnPage(page, dims, regions); } catch { /* estimates stand */ }
    const out = [];
    for (const r of effective) {
      if (!r) { out.push(null); continue; }
      const x = clamp(Math.round(r.x / 100 * dims.w), 0, dims.w - 1);
      const y = clamp(Math.round(r.y / 100 * dims.h), 0, dims.h - 1);
      const width = clamp(Math.round(r.w / 100 * dims.w), 1, dims.w - x);
      const height = clamp(Math.round(r.h / 100 * dims.h), 1, dims.h - y);
      let covered = false;
      try {
        // Paint out UI blobs the refinement dropped but that still fall inside
        // the rectangular clip (a toolbar level with the artwork's tail) —
        // cover divs in the locally-sampled background colour.
        if (Array.isArray(r.holes) && r.holes.length) {
          covered = true;
          await page.evaluate((hs) => {
            for (const hh of hs) {
              const d = document.createElement('div');
              d.className = '__uncraft-cover';
              d.style.cssText = `position:absolute;left:${hh.x}px;top:${hh.y}px;width:${hh.w}px;height:${hh.h}px;background:rgb(${hh.color[0]},${hh.color[1]},${hh.color[2]})`;
              document.body.appendChild(d);
            }
          }, r.holes);
        }
        const buf = await page.screenshot({ type: 'png', clip: { x, y, width, height } });
        let url = `data:image/png;base64,${buf.toString('base64')}`;
        // Generative polish only where the refinement SAW overlapping UI —
        // clean crops skip it entirely (zero extra cost).
        if (r.needsCleanup && cleanupEnabled()) {
          url = await cleanCropUi({ page, dataUrl: url, width, height, bg: r.bg });
        }
        out.push(url);
      } catch { out.push(null); }
      if (covered) {
        try {
          await page.evaluate(() => { document.querySelectorAll('.__uncraft-cover').forEach((el) => el.remove()); });
        } catch { /* next region replaces its own covers anyway */ }
      }
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
        // The container may hold the model's rough CSS/SVG approximation as a
        // fallback — real pixels replace it, so clear it or it overlays the
        // crop as a double rendering.
        el.innerHTML = '';
        const prev = el.getAttribute('style') || '';
        el.setAttribute('style', `${prev};background-image:url('${url}');background-size:cover;background-position:center`);
      }
    });
    return dom.serialize();
  } catch {
    return html;
  }
}
