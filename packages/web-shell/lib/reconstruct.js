/**
 * reconstruct.js — site reconstruction via iter-9 pipeline.
 *
 * For sites where static snapshot capture doesn't work (Webflow IX3
 * sticky-scroll, Framer scrollytelling, Lenis smooth-scroll — anything
 * where JS drives the visual narrative), this pipeline produces a clean
 * linear HTML reconstruction:
 *
 *   1. Scroll-stops the page at viewport intervals, captures clean screen-
 *      shots at each stop after animations settle.
 *   2. Builds an asset manifest of <img>/<svg>/bg-image + auto-rasterizes
 *      <canvas>, <video>, <iframe>, and oversized SVGs into PNGs.
 *   3. Probes ground-truth colors + font-family from the live DOM.
 *   4. Single GPT-5.5 vision call assembles stops + thumbnails + manifest
 *      into HTML with data-asset-id placeholders.
 *   5. Post-process inlines real asset URLs / SVGs / raster references.
 *
 * Output shape mirrors captureSnapshot in lib/snapshot.js so this can be
 * a drop-in fallback when the static path would fail.
 *
 * Built from the spike at scripts/video-scroll-spike.mjs (validated on
 * farmminerals.com/promo, toolfolio.io, residence.co).
 *
 * Storage: rasters written to packages/web-shell/public/rasters/<hash>/
 * and referenced from the generated HTML via relative URLs like
 * /rasters/<hash>/raster-N.png. Next.js serves /public/* at the root.
 */

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { pinViewportUnits } from './snapshot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_RASTERS_DIR = join(__dirname, '..', 'public', 'rasters');

// --- knobs -----------------------------------------------------------------
const VIEWPORT = { width: 1280, height: 800 };
const MAX_STOPS = 12;
const SCROLL_ANIM_MS = 600;
const SETTLE_MS = 1500;
const INITIAL_SETTLE_MS = 2000;
const THUMB_MAX_PX = 180;
const SVG_INLINE_MAX_BYTES = 50000;
const NAV_TIMEOUT_MS = 30000;
const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --- main entry ------------------------------------------------------------

/**
 * Reconstruct a URL into a clean HTML snapshot using vision-driven re-rendering.
 *
 * @param {string} url
 * @param {object} opts
 * @param {(step: string) => void} [opts.onProgress] — invoked when major
 *   stage transitions occur, e.g. 'capturing', 'rasterizing', 'thinking',
 *   'finalizing'. Used to surface a runStatus chip on the calling node.
 * @returns {Promise<{html: string, screenshotDataUrl: string, title: string,
 *   baseUrl: string, stats: object}>}
 */
export async function reconstructPage(url, opts = {}) {
  const { onProgress = () => {} } = opts;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY missing — required for reconstruction');
  }

  // Per-URL raster directory. Deterministic hash so repeat captures don't
  // accumulate (we wipe before re-writing). Short slug for readability.
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 10);
  const rasterDir = join(PUBLIC_RASTERS_DIR, hash);
  const rasterUrlBase = `/rasters/${hash}`;
  await rm(rasterDir, { recursive: true, force: true });
  await mkdir(rasterDir, { recursive: true });

  // Dynamic import — playwright-core is server-only, keep it lazy for safety.
  const { chromium } = await import('playwright-core');
  let browser, context, page;
  try {
    onProgress('launching');
    browser = await launchBrowser(chromium);
    context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: REAL_UA,
      locale: 'en-US'
    });
    page = await context.newPage();

    onProgress('navigating');
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS }).catch(async () => {
      await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    });
    await page.waitForTimeout(INITIAL_SETTLE_MS);

    onProgress('capturing');
    const captured = await captureStops(page, rasterDir, rasterUrlBase);
    const { stops, assets, colorsByStop, fontsByStop, title, stopsBuffers } = captured;

    onProgress('thumbnailing');
    await renderThumbnails(page, assets);

    onProgress('thinking');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const rawHtml = await generateHtml({
      stopsBuffers, assets, colorsByStop, fontsByStop, openai
    });
    if (!rawHtml || !/<html/i.test(rawHtml)) {
      throw new Error(`Vision call returned no usable HTML (${rawHtml?.length || 0} chars)`);
    }

    onProgress('finalizing');
    // Pin viewport units to the capture viewport. The vision prompt asks
    // for fluid layout, but the model still emits `min-height: 100dvh` on
    // heroes (etc.) — in iframe srcDoc, dvh reads against iframe dims so
    // any resize stretches the hero. Pinning makes them stable px values.
    const pinnedHtml = pinViewportUnits(rawHtml, VIEWPORT.width, VIEWPORT.height);
    const html = injectAssets(pinnedHtml, assets);

    // Screenshot for the node thumbnail — top of the page, original viewport.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    const screenshotDataUrl = `data:image/png;base64,${screenshot.toString('base64')}`;

    return {
      html,
      screenshotDataUrl,
      title: title || url,
      baseUrl: url,
      stats: {
        stops: stops.length,
        assets: assets.length,
        rasters: assets.filter((a) => a.kind === 'raster').length,
        bindings: (rawHtml.match(/data-asset-id=/g) || []).length
      }
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// --- browser ---------------------------------------------------------------

async function launchBrowser(chromium) {
  if (process.env.BROWSERBASE_API_KEY) {
    const wsUrl = `wss://connect.browserbase.com?apiKey=${encodeURIComponent(process.env.BROWSERBASE_API_KEY)}`;
    return chromium.connectOverCDP(wsUrl);
  }
  return chromium.launch({ headless: true });
}

// --- step 1: scroll-stops, manifest, color/font probes, rasterization -----

async function captureStops(page, rasterDir, rasterUrlBase) {
  const totalScroll = await page.evaluate(() => Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
    0
  ) - window.innerHeight);

  const idealStride = totalScroll > 0
    ? Math.max(1, Math.ceil(totalScroll / (MAX_STOPS - 1) / VIEWPORT.height)) * VIEWPORT.height
    : VIEWPORT.height;
  const stops = [];
  for (let y = 0; y <= totalScroll; y += idealStride) {
    stops.push(y);
    if (stops.length >= MAX_STOPS) break;
  }
  if (stops[stops.length - 1] < totalScroll && totalScroll > 0) {
    if (stops.length >= MAX_STOPS) stops[stops.length - 1] = totalScroll;
    else stops.push(totalScroll);
  }

  const stopsBuffers = [];
  const assetsByStop = [];
  const colorsByStop = [];
  const fontsByStop = [];
  let rasterIdx = 0;

  for (let i = 0; i < stops.length; i++) {
    const targetY = stops[i];

    // Smooth scroll so scroll-triggered animations fire.
    await page.evaluate(async ({ targetY, durMs }) => {
      const startY = window.scrollY;
      const start = performance.now();
      return new Promise((resolve) => {
        function step(now) {
          const t = Math.min(1, (now - start) / durMs);
          const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          window.scrollTo(0, startY + (targetY - startY) * eased);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        }
        requestAnimationFrame(step);
      });
    }, { targetY, durMs: SCROLL_ANIM_MS });

    await page.waitForTimeout(SETTLE_MS);

    // Full-viewport screenshot at this stop, kept in memory.
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    stopsBuffers.push(buf);

    // Color probes (computed style at 5 points).
    const colors = await page.evaluate(({ vw, vh }) => {
      function colorAt(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        let cur = el;
        while (cur) {
          const bg = getComputedStyle(cur).backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
          cur = cur.parentElement;
        }
        return null;
      }
      return {
        topLeft: colorAt(20, 20),
        topRight: colorAt(vw - 20, 20),
        center: colorAt(vw / 2, vh / 2),
        bottomLeft: colorAt(20, vh - 20),
        bottomRight: colorAt(vw - 20, vh - 20),
        body: getComputedStyle(document.body).backgroundColor,
        html: getComputedStyle(document.documentElement).backgroundColor
      };
    }, { vw: VIEWPORT.width, vh: VIEWPORT.height });
    colorsByStop.push(colors);

    // Typography probes for the major text levels.
    const fonts = await page.evaluate(() => {
      function visibleSample(selector) {
        for (const el of document.querySelectorAll(selector)) {
          const r = el.getBoundingClientRect();
          if (r.width < 20 || r.height < 12) continue;
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          if (!el.textContent || !el.textContent.trim()) continue;
          const cs = getComputedStyle(el);
          return {
            family: cs.fontFamily,
            weight: cs.fontWeight,
            size: cs.fontSize,
            letterSpacing: cs.letterSpacing,
            style: cs.fontStyle
          };
        }
        return null;
      }
      return {
        h1: visibleSample('h1'),
        h2: visibleSample('h2'),
        h3: visibleSample('h3'),
        p: visibleSample('p'),
        body: (() => {
          const cs = getComputedStyle(document.body);
          return { family: cs.fontFamily, weight: cs.fontWeight, size: cs.fontSize, style: cs.fontStyle };
        })()
      };
    });
    fontsByStop.push(fonts);

    // Asset manifest at this scroll position (per-stop visibility added later).
    const manifest = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      function inView(r) { return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; }
      function quadrant(r) {
        const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
        const h = cx < vw * 0.35 ? 'left' : cx > vw * 0.65 ? 'right' : 'center';
        const v = cy < vh * 0.35 ? 'top' : cy > vh * 0.65 ? 'bottom' : 'middle';
        return v === 'middle' && h === 'center' ? 'center' : `${v}-${h}`;
      }

      const imgs = [];
      for (const el of document.querySelectorAll('img')) {
        const r = el.getBoundingClientRect();
        if (r.width < 32 || r.height < 32) continue;
        try {
          imgs.push({
            kind: 'img',
            src: new URL(el.currentSrc || el.src, document.baseURI).href,
            alt: el.alt || '',
            w: Math.round(r.width), h: Math.round(r.height),
            inView: inView(r), pos: inView(r) ? quadrant(r) : null
          });
        } catch (e) {}
      }
      for (const pic of document.querySelectorAll('picture')) {
        const r = pic.getBoundingClientRect();
        if (r.width < 32 || r.height < 32) continue;
        for (const src of pic.querySelectorAll('source[srcset]')) {
          const first = (src.getAttribute('srcset') || '').split(',')[0].trim().split(' ')[0];
          if (!first) continue;
          try {
            imgs.push({
              kind: 'img',
              src: new URL(first, document.baseURI).href,
              alt: '', w: Math.round(r.width), h: Math.round(r.height),
              inView: inView(r), pos: inView(r) ? quadrant(r) : null,
              fromPicture: true
            });
          } catch (e) {}
        }
      }

      const svgs = [];
      for (const el of document.querySelectorAll('svg')) {
        const r = el.getBoundingClientRect();
        if (r.width < 24 || r.height < 24) continue;
        if (!inView(r)) continue;
        const html = el.outerHTML;
        svgs.push({
          kind: 'svg', html,
          w: Math.round(r.width), h: Math.round(r.height),
          bbox: { x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(vw, r.width), h: Math.min(vh, r.height) },
          inView: true, pos: quadrant(r)
        });
      }

      const rasters = [];
      for (const el of document.querySelectorAll('canvas, video, iframe')) {
        const r = el.getBoundingClientRect();
        if (r.width < 60 || r.height < 60) continue;
        if (!inView(r)) continue;
        rasters.push({
          kind: 'raster', tag: el.tagName.toLowerCase(),
          w: Math.round(r.width), h: Math.round(r.height),
          bbox: { x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(vw, r.width), h: Math.min(vh, r.height) },
          inView: true, pos: quadrant(r)
        });
      }

      const bgs = [];
      const all = document.querySelectorAll('body *');
      for (let i = 0; i < all.length && bgs.length < 40; i++) {
        const el = all[i];
        const cs = getComputedStyle(el);
        const bi = cs.backgroundImage;
        if (!bi || bi === 'none' || !bi.includes('url(')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 60 || r.height < 60) continue;
        const m = /url\(["']?([^"')]+)["']?\)/.exec(bi);
        if (!m) continue;
        try {
          bgs.push({
            kind: 'bg', src: new URL(m[1], document.baseURI).href,
            w: Math.round(r.width), h: Math.round(r.height),
            inView: inView(r), pos: inView(r) ? quadrant(r) : null
          });
        } catch (e) {}
      }
      return [...imgs, ...svgs, ...rasters, ...bgs];
    });

    // Rasterize what needs it (oversized SVGs + canvas/video/iframe) right
    // now while the page is at this stop's scroll position.
    for (const a of manifest) {
      const needsRaster =
        (a.kind === 'svg' && a.html && a.html.length > SVG_INLINE_MAX_BYTES) ||
        (a.kind === 'raster');
      if (!needsRaster) continue;
      try {
        const rasterFile = `raster-s${i}-${rasterIdx}.png`;
        const rasterPath = join(rasterDir, rasterFile);
        await page.screenshot({
          path: rasterPath,
          clip: { x: a.bbox.x, y: a.bbox.y, width: a.bbox.w, height: a.bbox.h }
        });
        a.kind = 'raster';
        a.src = `${rasterUrlBase}/${rasterFile}`;
        a._rasterFile = rasterFile;
        a._rasterPath = rasterPath;
        delete a.html;
        rasterIdx++;
      } catch (e) {
        a._rasterFailed = String(e.message || e).slice(0, 80);
      }
    }
    assetsByStop.push(manifest);
  }

  // Dedupe assets across stops, accumulate visibility.
  const byKey = new Map();
  for (let si = 0; si < assetsByStop.length; si++) {
    for (const a of assetsByStop[si]) {
      const key = a.kind === 'svg' ? `svg:${a.html.slice(0, 200)}` : `${a.kind}:${a.src}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { ...a, visibility: [] };
        delete entry.inView;
        delete entry.pos;
        byKey.set(key, entry);
      }
      if (a.inView && a.pos) {
        entry.visibility.push({ stop: si, pos: a.pos });
      }
    }
  }
  const assets = [...byKey.values()];

  // Assign stable IDs.
  let imgIdx = 0, svgIdx = 0, bgIdx = 0, rasIdx = 0;
  for (const a of assets) {
    if (a.kind === 'img') a._id = `IMG#${imgIdx++}`;
    else if (a.kind === 'svg') a._id = `SVG#${svgIdx++}`;
    else if (a.kind === 'bg') a._id = `BG#${bgIdx++}`;
    else if (a.kind === 'raster') a._id = `RAS#${rasIdx++}`;
  }

  const title = (await page.title()) || null;

  return { stops, assets, colorsByStop, fontsByStop, stopsBuffers, title };
}

// --- step 2: render thumbnails for each manifest entry --------------------

async function renderThumbnails(page, assets) {
  // Reset scroll so img onload positioning is deterministic.
  await page.evaluate(() => window.scrollTo(0, 0));

  for (const a of assets) {
    let dataUrl = null;
    if (a.kind === 'svg') {
      dataUrl = await page.evaluate(async ({ svgHtml, max }) => {
        try {
          const blob = new Blob([svgHtml], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const img = await new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = () => rej(new Error('svg load failed'));
            i.src = url;
          });
          const iw = img.naturalWidth || 200, ih = img.naturalHeight || 200;
          const scale = Math.min(max / iw, max / ih, 1);
          const w = Math.max(1, Math.round(iw * scale));
          const h = Math.max(1, Math.round(ih * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          return canvas.toDataURL('image/png');
        } catch (e) { return null; }
      }, { svgHtml: a.html, max: THUMB_MAX_PX });
    } else if (a.kind === 'raster') {
      try {
        const buf = await readFile(a._rasterPath);
        dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
      } catch (e) { dataUrl = null; }
    } else {
      dataUrl = await page.evaluate(async ({ url, max }) => {
        try {
          const img = await new Promise((res, rej) => {
            const i = new Image();
            i.crossOrigin = 'anonymous';
            i.onload = () => res(i);
            i.onerror = () => rej(new Error('img load failed'));
            i.src = url;
          });
          const iw = img.naturalWidth, ih = img.naturalHeight;
          if (!iw || !ih) return null;
          const scale = Math.min(max / iw, max / ih, 1);
          const w = Math.max(1, Math.round(iw * scale));
          const h = Math.max(1, Math.round(ih * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          return canvas.toDataURL('image/png');
        } catch (e) { return null; }
      }, { url: a.src, max: THUMB_MAX_PX });
    }
    a.thumbDataUrl = dataUrl;
  }
}

// --- step 3: vision call -> HTML -------------------------------------------

const VISION_SYSTEM = `You receive everything needed to reconstruct a real website as a single HTML document.

INPUTS
  1. SCROLL-STOP SCREENSHOTS — N frames in scroll order (top → bottom), captured AFTER scroll-triggered animations settled.
  2. ASSET MANIFEST — every <img>, <svg>, background-image, AND every rasterized region from the live page, tagged with stable IDs:
       • IMG#N — original image URLs
       • SVG#N — inline SVG outerHTML
       • BG#N — CSS background-image URLs
       • RAS#N — PNGs WE CAPTURED from the live page (canvas, video, oversized SVGs, complex illustrations). Pixel-perfect — PREFER them whenever present.
  3. ASSET THUMBNAILS — a small preview rendered for each manifest entry (labeled with its ID). USE these to visually match a region in a screenshot to the right manifest ID.
  4. COLOR PROBES — ground-truth background colours sampled from the live DOM at five points per stop.
  5. TYPOGRAPHY DETECTED — exact font-family / weight / size / font-style strings sampled from the live DOM. Use verbatim — this is GROUND TRUTH, more reliable than how the screenshot looks.

OUTPUT FORMAT
- Single self-contained HTML document. Inline <style> + inline styles. No external CSS/JS.
- Zero markdown, zero code fences, zero commentary. Just the HTML.

ASSET BINDING — critical:
- DO NOT emit a 'src' attribute. DO NOT invent URLs.
- For images: <img data-asset-id="IMG#N" alt="..." width="..." height="..." style="...">
- For inline SVGs: <div data-asset-id="SVG#N"></div>
- For CSS background images: background-image: data-asset-id(BG#N);
- Use placeholders only as last resort: <div class="rb-placeholder" data-rb-shape="round"><span>Placeholder · name</span></div>

PLACEHOLDER CSS (include once):
  .rb-placeholder {
    display: inline-flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, currentColor 6%, transparent);
    border: 1.5px dashed color-mix(in srgb, currentColor 25%, transparent);
    border-radius: 12px; aspect-ratio: 1 / 1; min-width: 120px;
    color: inherit; opacity: 0.55;
    font: 500 10px/1.2 system-ui, sans-serif;
    letter-spacing: 0.08em; text-transform: uppercase;
    padding: 16px; text-align: center;
  }
  .rb-placeholder[data-rb-shape="tall"] { aspect-ratio: 3 / 4; }
  .rb-placeholder[data-rb-shape="wide"] { aspect-ratio: 16 / 9; }
  .rb-placeholder[data-rb-shape="round"] { border-radius: 999px; aspect-ratio: 1 / 1; }

COLOR FIDELITY:
- Use the COLOR PROBES verbatim for surface colours.
- DO NOT default to dark mode. DO NOT add gradients absent from the screenshots.

TYPOGRAPHY FIDELITY:
- Use the TYPOGRAPHY DETECTED font-family strings VERBATIM. No silent Inter substitution.
- font-style comes from TYPOGRAPHY DETECTED (ground truth), NOT from how the screenshot looks. It is almost always 'normal'. If the detected font-style is normal, the element MUST be upright (font-style: normal) even if a heading "looks" slanted to you. NEVER italicize titles, names, labels, or numbers — vision models over-italicize; apply italic ONLY when the detected font-style for that level is literally 'italic'.

BORDER & SHADOW FIDELITY:
- Only give a card/container a border, outline, or drop-shadow if the screenshot actually shows it. Do NOT add borders or subtle shadows the source lacks (common vision-model tells). When cards are flat (separated by fill alone), reproduce exactly that — no border, no shadow.

PROPORTION & PADDING FIDELITY:
- Match the size of text RELATIVE to its buttons, pills, and containers as shown. Match the INTERNAL padding — the gap between content and each container's edges. Do not tighten or inflate this breathing room; reproduce the proportions in the screenshots.

TEXT CONTENT FIDELITY:
- Preserve exact text from the screenshots. No AI clichés.

LAYOUT — FLUID, NOT FIXED:
- The page MUST be responsive. NEVER set 'width: <Npx>' on body/main/section/container/hero.
- Containers: max-width: min(1280px, 100% - 48px); margin-inline: auto; width: 100%;
- Section paddings: clamp(48px, 8vw, 120px) clamp(20px, 4vw, 64px);
- Card grids: display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: clamp(16px, 2vw, 32px);
- Type sizes for hero headlines: clamp(40px, 8vw, 96px);
- Hero: min-height: 100dvh.

HIERARCHY:
- Hierarchy through weight and colour, not just oversized H1s.
- Preserve the visual order top-to-bottom.`;

function buildManifestText(assets) {
  if (assets.length === 0) return '(no assets detected on this page)';
  return assets.map((a) => {
    const vis = (a.visibility || []).length
      ? ` — appears in stops: ${a.visibility.map((v) => `${v.stop}@${v.pos}`).join(', ')}`
      : '';
    if (a.kind === 'img') {
      return `${a._id} (${a.w}x${a.h})${a.alt ? ` alt="${a.alt}"` : ''} — filename: ${a.src.split('/').pop()}${vis}`;
    } else if (a.kind === 'svg') {
      return `${a._id} (${a.w}x${a.h})${vis}`;
    } else if (a.kind === 'bg') {
      return `${a._id} (${a.w}x${a.h}) — filename: ${a.src.split('/').pop()}${vis}`;
    } else if (a.kind === 'raster') {
      return `${a._id} (${a.w}x${a.h}) (rasterized — captured PNG, pixel-perfect)${vis}`;
    }
    return '';
  }).join('\n');
}

function buildColorsText(colorsByStop) {
  return colorsByStop.map((c, i) =>
    `Stop ${i}: center=${c.center} topLeft=${c.topLeft} topRight=${c.topRight} body=${c.body}`
  ).join('\n');
}

function buildFontsText(fontsByStop) {
  const seen = new Map();
  for (let si = 0; si < fontsByStop.length; si++) {
    const f = fontsByStop[si];
    for (const level of ['h1', 'h2', 'h3', 'p', 'body']) {
      const v = f[level];
      if (!v || !v.family) continue;
      const key = `${level}|${v.family}|${v.weight}|${v.size}`;
      if (!seen.has(key)) seen.set(key, { level, ...v, firstStop: si });
    }
  }
  if (seen.size === 0) return '(no font data captured)';
  return [...seen.values()]
    .map((v) => `${v.level}: family=${v.family} weight=${v.weight} size=${v.size} font-style=${v.style || 'normal'}${v.letterSpacing ? ` letter-spacing=${v.letterSpacing}` : ''} (first seen stop ${v.firstStop})`)
    .join('\n');
}

async function generateHtml({ stopsBuffers, assets, colorsByStop, fontsByStop, openai }) {
  const stopBlocks = stopsBuffers.map((buf) => ({
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${buf.toString('base64')}` }
  }));

  const thumbBlocks = [];
  for (const a of assets) {
    if (!a.thumbDataUrl) continue;
    thumbBlocks.push({ type: 'text', text: `${a._id}:` });
    thumbBlocks.push({ type: 'image_url', image_url: { url: a.thumbDataUrl } });
  }

  const userContent = [
    { type: 'text', text: `ASSET MANIFEST (use these IDs in data-asset-id):\n${buildManifestText(assets)}` },
    { type: 'text', text: `\nASSET THUMBNAILS (visual preview of each manifest entry):` },
    ...thumbBlocks,
    { type: 'text', text: `\nCOLOR PROBES (ground-truth per stop):\n${buildColorsText(colorsByStop)}` },
    { type: 'text', text: `\nTYPOGRAPHY DETECTED (use font-family AND font-style verbatim — ground truth):\n${buildFontsText(fontsByStop)}` },
    { type: 'text', text: `\n${stopsBuffers.length} scroll-stop screenshots follow, in scroll order (top → bottom). Reconstruct.` },
    ...stopBlocks
  ];

  const stream = await openai.chat.completions.create({
    model: 'gpt-5.5',
    messages: [
      { role: 'system', content: VISION_SYSTEM },
      { role: 'user', content: userContent }
    ],
    max_completion_tokens: 32000,
    stream: true
  });

  let text = '';
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') text += delta;
  }
  return text.replace(/^```[a-z]*\n/, '').replace(/```\s*$/, '').trim();
}

// --- step 4: inject real asset URLs / inline SVGs --------------------------

function injectAssets(html, assets) {
  let out = html;
  const byId = new Map();
  for (const a of assets) if (a._id) byId.set(a._id, a);

  out = out.replace(/<img([^>]*?)data-asset-id=["']([A-Z]+#\d+)["']([^>]*?)>/gi, (m, pre, id, post) => {
    const a = byId.get(id);
    if (!a) return m;
    if (a.kind === 'img' || a.kind === 'bg' || a.kind === 'raster') return `<img${pre}src="${a.src}"${post}>`;
    return m;
  });

  out = out.replace(/data-asset-id\(([A-Z]+#\d+)\)/g, (m, id) => {
    const a = byId.get(id);
    if (!a) return m;
    return `url("${a.src}")`;
  });

  out = out.replace(/<(div|span)([^>]*?)data-asset-id=["'](SVG#\d+)["']([^>]*?)>[\s\S]*?<\/\1>/gi, (m, tag, pre, id) => {
    const a = byId.get(id);
    if (!a || a.kind !== 'svg') return m;
    return a.html;
  });
  out = out.replace(/<img([^>]*?)data-asset-id=["'](SVG#\d+)["']([^>]*?)>/gi, (m, pre, id) => {
    const a = byId.get(id);
    if (!a || a.kind !== 'svg') return m;
    return a.html;
  });

  return out;
}
