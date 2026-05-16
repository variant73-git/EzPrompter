/**
 * video-scroll-spike — "record scroll + scroll-stop snapshots → reconstruct site"
 *
 * Iteration 6: thumbnails + animation detection (frame-pair diff).
 *
 * Pipeline:
 *   1. Playwright scroll-stops the page at evenly-spaced viewports, takes
 *      a clean screenshot at each, samples color probes, captures asset
 *      manifest with per-stop visibility tags.
 *   2. For each unique asset, render a tiny thumbnail (≤ 180px) inside the
 *      browser context via canvas — gives the vision model a literal preview
 *      of what each IMG#N / SVG#N / BG#N looks like (solves vector-vs-photo
 *      disambiguation that filename+dimensions alone can't resolve).
 *   3. For each consecutive pair of stop frames, fire a focused vision call
 *      asking "what visual transitions occur between these two frames"
 *      → produces an ANIMATIONS list (fade, slide, marquee, parallax,
 *      scroll-trigger reveal). Calls run in parallel.
 *   4. Final vision call: stop frames + asset thumbnails + animation list +
 *      color probes → single HTML document with data-asset-id placeholders.
 *   5. Post-process: swap data-asset-id for real URLs / inline SVGs.
 *
 * Run: node --env-file=.env.local scripts/video-scroll-spike.mjs <url>
 */

import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'spike-out');
const STOPS_DIR = join(OUT_DIR, 'stops');
const THUMBS_DIR = join(OUT_DIR, 'thumbs');
const RASTERS_DIR = join(OUT_DIR, 'rasters');
const VIDEO_DIR = join(OUT_DIR, 'video');

const TARGET_URL = process.argv[2] || 'https://www.farmminerals.com/promo';
const VIEWPORT = { width: 1280, height: 720 };
const MAX_STOPS = 12;
const SCROLL_ANIM_MS = 600;
const SETTLE_MS = 1500;
const INITIAL_SETTLE_MS = 2000;
const THUMB_MAX_PX = 180;
const ANIM_DETECT_CONCURRENCY = 5;
const SVG_INLINE_MAX_BYTES = 50000;   // SVGs above this get rasterized instead of inlined

// ---------------------------------------------------------------------------
// Step 1: navigate, scroll-stop, capture frames + asset manifest
// ---------------------------------------------------------------------------

async function captureStops(url) {
  await mkdir(STOPS_DIR, { recursive: true });
  await mkdir(THUMBS_DIR, { recursive: true });
  await mkdir(RASTERS_DIR, { recursive: true });
  await mkdir(VIDEO_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: VIDEO_DIR, size: VIEWPORT }
  });
  const page = await context.newPage();
  console.log(`[1/5] Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(INITIAL_SETTLE_MS);

  const totalScroll = await page.evaluate(() => Math.max(
    document.body.scrollHeight - window.innerHeight,
    document.documentElement.scrollHeight - window.innerHeight,
    0
  ));
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
  console.log(`[1/5] ${stops.length} stops (stride=${idealStride}px) across ${totalScroll}px of scroll`);

  const stopPaths = [];
  const assetsByStop = [];
  const colorsByStop = [];
  const fontsByStop = [];
  let rasterIdx = 0;
  for (let i = 0; i < stops.length; i++) {
    const targetY = stops[i];
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

    const stopPath = join(STOPS_DIR, `stop-${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: stopPath, fullPage: false });
    stopPaths.push(stopPath);

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

    // Sample the computed font-family of the most important text levels so
    // we can pin typography in the prompt (the model gets it slightly off
    // when inferring from the screenshot alone).
    const fontsAtStop = await page.evaluate(() => {
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
            letterSpacing: cs.letterSpacing
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
          return { family: cs.fontFamily, weight: cs.fontWeight, size: cs.fontSize };
        })()
      };
    });
    fontsByStop.push(fontsAtStop);
    console.log(`[1/5]   stop ${i} y=${targetY} bg=${colors.center} h1=${fontsAtStop.h1?.family?.split(',')[0] || '-'}`);

    const manifest = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      function inView(r) { return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; }
      function quadrant(r) {
        const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
        const h = cx < vw * 0.35 ? 'left' : cx > vw * 0.65 ? 'right' : 'center';
        const v = cy < vh * 0.35 ? 'top' : cy > vh * 0.65 ? 'bottom' : 'middle';
        return v === 'middle' && h === 'center' ? 'center' : `${v}-${h}`;
      }

      // Imgs — also pull from <picture><source> srcsets so we don't miss
      // resolution variants the LLM might want to reference.
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
      // Also include <picture><source> entries even if not currently selected.
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
              alt: '',
              w: Math.round(r.width), h: Math.round(r.height),
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
        if (!inView(r)) continue;  // can only rasterize what's on screen
        const html = el.outerHTML;
        svgs.push({
          kind: 'svg', html,
          w: Math.round(r.width), h: Math.round(r.height),
          bbox: { x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(vw, r.width), h: Math.min(vh, r.height) },
          inView: true, pos: quadrant(r)
        });
      }

      // Canvas + video: always need rasterization (no equivalent of URL or
      // outerHTML representation that the LLM can use directly).
      const rastersDom = [];
      for (const el of document.querySelectorAll('canvas, video, iframe')) {
        const r = el.getBoundingClientRect();
        if (r.width < 60 || r.height < 60) continue;
        if (!inView(r)) continue;
        rastersDom.push({
          kind: 'raster',
          tag: el.tagName.toLowerCase(),
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
            kind: 'bg',
            src: new URL(m[1], document.baseURI).href,
            w: Math.round(r.width), h: Math.round(r.height),
            inView: inView(r), pos: inView(r) ? quadrant(r) : null
          });
        } catch (e) {}
      }
      return [...imgs, ...svgs, ...rastersDom, ...bgs];
    });

    // Rasterize what needs it RIGHT NOW (page is at this stop's scroll
    // position, elements are guaranteed to be at their captured bboxes).
    for (const a of manifest) {
      const needsRaster =
        (a.kind === 'svg' && a.html && a.html.length > SVG_INLINE_MAX_BYTES) ||
        (a.kind === 'raster');
      if (!needsRaster) continue;
      try {
        const rasterFile = `raster-s${i}-${rasterIdx}.png`;
        const rasterPath = join(RASTERS_DIR, rasterFile);
        // Playwright expects { x, y, width, height } — we stored { x, y, w, h }.
        await page.screenshot({
          path: rasterPath,
          clip: { x: a.bbox.x, y: a.bbox.y, width: a.bbox.w, height: a.bbox.h }
        });
        // Replace the entry in-place with a "rendered raster" pointing at
        // the local PNG. Output HTML will reference it via relative path.
        a._rasterized = true;
        a._rasterFile = rasterFile;
        a.kind = 'raster';
        a.src = `rasters/${rasterFile}`;
        delete a.html;
        rasterIdx++;
      } catch (e) {
        // Clip out of bounds, element gone, etc. — fall through to placeholder.
        a._rasterFailed = String(e.message || e).slice(0, 80);
      }
    }

    assetsByStop.push(manifest);
  }

  // Dedupe across stops, accumulate visibility.
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
  const rasterCount = assets.filter(a => a.kind === 'raster').length;
  const rasterFailed = assets.filter(a => a._rasterFailed).length;
  console.log(`[1/5] ${assets.length} unique assets (${assets.filter(a => a.kind === 'img').length} imgs, ${assets.filter(a => a.kind === 'svg').length} svgs, ${assets.filter(a => a.kind === 'bg').length} bgs, ${rasterCount} rasters${rasterFailed ? `, ${rasterFailed} raster failures` : ''})`);
  // Dedupe + summarize fonts across stops (just the unique family stacks).


  // Step 2: render thumbnails in-browser via canvas. Reuse the open page —
  // saves us re-launching a context just for image fetching.
  console.log(`[2/5] Rendering ${assets.length} asset thumbnails`);
  // Reset scroll so canvas-drawn images don't accidentally inherit weird state.
  await page.evaluate(() => window.scrollTo(0, 0));

  let imgIdx = 0, svgIdx = 0, bgIdx = 0, rasIdx = 0;
  for (const a of assets) {
    if (a.kind === 'img') a._id = `IMG#${imgIdx++}`;
    else if (a.kind === 'svg') a._id = `SVG#${svgIdx++}`;
    else if (a.kind === 'bg') a._id = `BG#${bgIdx++}`;
    else if (a.kind === 'raster') a._id = `RAS#${rasIdx++}`;
  }

  for (const a of assets) {
    let dataUrl = null;
    if (a.kind === 'svg') {
      dataUrl = await page.evaluate(async ({ svgHtml, max }) => {
        try {
          const svgBlob = new Blob([svgHtml], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(svgBlob);
          const img = await new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = (e) => rej(new Error('svg load failed'));
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
      // Already on disk — read it, encode it.
      try {
        const buf = await readFile(join(RASTERS_DIR, a._rasterFile));
        dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
      } catch (e) { dataUrl = null; }
    } else {
      dataUrl = await page.evaluate(async ({ url, max }) => {
        try {
          const img = await new Promise((res, rej) => {
            const i = new Image();
            i.crossOrigin = 'anonymous';
            i.onload = () => res(i);
            i.onerror = (e) => rej(new Error('img load failed'));
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
    if (dataUrl) {
      // Persist to disk for debugging.
      const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
      const thumbName = a._id.replace('#', '-') + '.png';
      await writeFile(join(THUMBS_DIR, thumbName), buf);
    }
  }
  const thumbsBuilt = assets.filter((a) => a.thumbDataUrl).length;
  console.log(`[2/5] Built ${thumbsBuilt}/${assets.length} thumbnails (CORS / loading failures account for the gap)`);

  await context.close();
  await browser.close();

  return { stopPaths, assets, colorsByStop, fontsByStop };
}

function buildFontsText(fontsByStop) {
  // Collect unique (level, family-stack, weight, size) tuples across stops.
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
    .map((v) => `${v.level}: family=${v.family} weight=${v.weight} size=${v.size}${v.letterSpacing ? ` letter-spacing=${v.letterSpacing}` : ''} (first seen stop ${v.firstStop})`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Step 3: animation detection — vision diff between consecutive stop pairs
// ---------------------------------------------------------------------------

const ANIM_DIFF_SYSTEM = `You receive TWO screenshots from the same website, taken back-to-back during a scroll. Frame A is BEFORE, Frame B is AFTER. Identify any visual transitions, animations, or scroll-triggered effects that distinguish B from A.

Output: a short JSON array of transition descriptors. Each item: { "kind": "fade-in"|"slide-in"|"parallax"|"marquee"|"scroll-reveal"|"scale"|"colour-shift"|"other", "what": "<one-sentence what changed>", "direction": "<from-left|from-right|from-top|from-bottom|none>", "cssHint": "<minimal CSS implementation hint, e.g. opacity 0→1, translateX(40px)→0, animation: marquee 20s linear infinite>" }.

If nothing meaningful animated between A and B (just scrolled past static content), return [].
Output ONLY the JSON array. No prose, no code fences.`;

function safeParseJsonArray(s) {
  if (!s) return [];
  const cleaned = s.replace(/^```[a-z]*\n/, '').replace(/```\s*$/, '').trim();
  try { const v = JSON.parse(cleaned); return Array.isArray(v) ? v : []; } catch (e) {}
  // Salvage: scan for the array opening then walk balanced braces.
  const start = cleaned.indexOf('[');
  if (start === -1) return [];
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return [];
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (e) { return []; }
}

async function detectAnimations(stopPaths, client) {
  console.log(`[3/5] Detecting animations across ${stopPaths.length - 1} frame pairs`);
  const pairs = [];
  for (let i = 0; i < stopPaths.length - 1; i++) {
    pairs.push([stopPaths[i], stopPaths[i + 1], i]);
  }
  const buffers = await Promise.all(pairs.map(async ([a, b]) => [
    await readFile(a), await readFile(b)
  ]));

  // Throttled parallel calls.
  const results = new Array(pairs.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= pairs.length) return;
      const [bufA, bufB] = buffers[idx];
      const [pathA, pathB, i] = pairs[idx];
      const dataA = `data:image/png;base64,${bufA.toString('base64')}`;
      const dataB = `data:image/png;base64,${bufB.toString('base64')}`;
      const resp = await client.chat.completions.create({
        model: 'gpt-5.5',
        messages: [
          { role: 'system', content: ANIM_DIFF_SYSTEM },
          { role: 'user', content: [
            { type: 'text', text: `Frame A (stop ${i}):` },
            { type: 'image_url', image_url: { url: dataA } },
            { type: 'text', text: `Frame B (stop ${i + 1}):` },
            { type: 'image_url', image_url: { url: dataB } }
          ]}
        ],
        max_completion_tokens: 800
      });
      const raw = resp.choices?.[0]?.message?.content || '';
      const list = safeParseJsonArray(raw);
      results[idx] = { pair: [i, i + 1], items: list };
      process.stdout.write(list.length ? `✓` : `·`);
    }
  }
  const workers = Array.from({ length: ANIM_DETECT_CONCURRENCY }, () => worker());
  await Promise.all(workers);
  process.stdout.write('\n');
  const total = results.reduce((n, r) => n + r.items.length, 0);
  console.log(`[3/5] Detected ${total} transition descriptors`);
  return results;
}

function buildAnimationsText(animResults) {
  if (!animResults.length) return '(no transitions detected)';
  const lines = [];
  for (const r of animResults) {
    if (!r.items.length) continue;
    lines.push(`Between stop ${r.pair[0]} → ${r.pair[1]}:`);
    for (const t of r.items) {
      lines.push(`  • [${t.kind}] ${t.what}${t.direction && t.direction !== 'none' ? ` (${t.direction})` : ''}${t.cssHint ? ` — hint: ${t.cssHint}` : ''}`);
    }
  }
  return lines.length ? lines.join('\n') : '(no transitions detected)';
}

// ---------------------------------------------------------------------------
// Step 4: main vision call → HTML
// ---------------------------------------------------------------------------

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
      const note = a._rasterizedFrom ? ` (rasterized from ${a._rasterizedFrom})` : ' (rasterized region — element captured as PNG to preserve fidelity)';
      return `${a._id} (${a.w}x${a.h})${note}${vis}`;
    }
    return '';
  }).join('\n');
}

function buildColorsText(colorsByStop) {
  return colorsByStop.map((c, i) =>
    `Stop ${i}: center=${c.center} topLeft=${c.topLeft} topRight=${c.topRight} body=${c.body}`
  ).join('\n');
}

function injectAssets(html, assets) {
  let out = html;
  const byId = new Map();
  for (const a of assets) if (a._id) byId.set(a._id, a);

  // <img data-asset-id="IMG#X | BG#X | RAS#X"> → swap data-asset-id for src
  out = out.replace(/<img([^>]*?)data-asset-id=["']([A-Z]+#\d+)["']([^>]*?)>/gi, (m, pre, id, post) => {
    const a = byId.get(id);
    if (!a) return m;
    if (a.kind === 'img' || a.kind === 'bg' || a.kind === 'raster') return `<img${pre}src="${a.src}"${post}>`;
    return m;
  });

  // background-image: data-asset-id(BG#X | RAS#X) → url(...)
  out = out.replace(/data-asset-id\(([A-Z]+#\d+)\)/g, (m, id) => {
    const a = byId.get(id);
    if (!a) return m;
    return `url("${a.src}")`;
  });

  // <div data-asset-id="SVG#X">…</div> → inline SVG outerHTML
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

const VISION_SYSTEM = `You receive everything needed to reconstruct a real website as a single HTML document.

INPUTS
  1. SCROLL-STOP SCREENSHOTS — N frames in scroll order (top → bottom), captured AFTER scroll-triggered animations settled.
  2. ASSET MANIFEST — every <img>, <svg>, background-image, AND every rasterized region from the live page, tagged with stable IDs:
       • IMG#N — original image URLs (photos, avifs, gifs)
       • SVG#N — inline SVG outerHTML (logos, icons that fit inline)
       • BG#N — CSS background-image URLs
       • RAS#N — PNGs WE CAPTURED from the live page (canvas, video, oversized SVGs, complex illustrations, anything visually too rich to reproduce). These are pixel-perfect renderings — PREFER them whenever present.
  3. ASSET THUMBNAILS — a small preview rendered for each manifest entry (labeled with its ID). USE these to visually match a region in a screenshot to the right manifest ID.
  4. COLOR PROBES — ground-truth background colours sampled from the live DOM at five points per stop.
  5. ANIMATIONS DETECTED — short descriptions of visual transitions between consecutive stop frames (fade, slide, marquee, parallax, …) — for context only; you do NOT need to reproduce motion. Visual fidelity matters more than animation.
  6. TYPOGRAPHY DETECTED — exact font-family / weight / size strings sampled from the live DOM for h1, h2, h3, p, and body. These are ground truth — use these verbatim in your CSS.

OUTPUT FORMAT
- Single self-contained HTML document. Inline <style> block + inline styles. No external CSS/JS.
- Zero markdown, zero code fences, zero commentary. Just the HTML.

ASSET BINDING — critical:
- DO NOT emit a 'src' attribute. DO NOT invent URLs. Visual fidelity comes FIRST: reuse the captured assets, never fabricate.
- For ANY visible image, illustration, custom typography-as-art, animated element, canvas, video, complex SVG, or 3D-rendered object: find the matching manifest entry and emit:
    <img data-asset-id="<ID>" alt="..." width="..." height="..." style="...">
  The ID can be IMG#N, RAS#N, BG#N, or SVG#N. Match by VISUAL CONTENT (use the thumbnails) plus dimensions plus per-stop visibility.
- RAS#N entries are PNGs we CAPTURED from the live page (canvas, video, oversized SVG, complex illustrations). They preserve fidelity perfectly. PREFER them when present at the right stop / position.
- For inline SVGs that fit inline (SVG#N): <div data-asset-id="SVG#N"></div> — post-processing inlines the captured outerHTML.
- For CSS background images: background-image: data-asset-id(BG#N); or data-asset-id(RAS#N);
- ONLY fall back to a placeholder when NO manifest entry — including RAS#N rasters — matches the region. Use:
    <div class="rb-placeholder" data-rb-shape="<round|square|tall|wide>"><span>Placeholder · <short object name></span></div>

PLACEHOLDER CSS — include this rule in your <style> block once:
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
  .rb-placeholder span { display:block; max-width: 18ch; }

COLOR FIDELITY:
- Use the COLOR PROBES verbatim for surface colours. If center is 'rgb(64, 79, 29)', that section's bg is rgb(64,79,29).
- Read text colors from screenshots; rely on probes for body / section surfaces.
- DO NOT default to dark mode. DO NOT add gradients absent from the screenshots.

TYPOGRAPHY FIDELITY:
- Use the TYPOGRAPHY DETECTED font-family strings VERBATIM. If the probe says 'h1 family="Geist Sans, sans-serif"', the H1 CSS rule reads font-family: 'Geist Sans', sans-serif. No silent Inter substitution.
- Match weights from the probes (h1 weight=600 → font-weight: 600).
- Sizes from probes are upper-bound references; you may scale slightly for layout but stay close.

TEXT CONTENT FIDELITY:
- Preserve exact text from the screenshots — real headlines, body copy, button labels, prices, numbers. No AI clichés.

ANIMATIONS — DO NOT reproduce motion:
- The animation list is for context. Motion is not the goal — VISUAL FIDELITY is.
- For animated foreground elements (parallax objects, 3D renders, scroll-driven sequences), prefer a RAS#N raster (the captured pixels) over any CSS @keyframes attempt.
- For marquees specifically: it is OK to use 'animation: name Xs linear infinite' with translateX 0 → -50% if the source content is repeatable text. Otherwise emit a static rendering.
- Skip elaborate parallax / scroll-snap / scroll-driven CSS — those rarely match the source and add noise.

LAYOUT — FLUID, NOT FIXED:
- The page MUST be responsive. NEVER set 'width: <Npx>' on body, main, section, container, or hero. ALWAYS use max-width + width: 100%.
- Containers: max-width: min(1280px, 100% - 48px); margin-inline: auto; width: 100%;
- Section paddings: use clamp(), e.g. padding: clamp(48px, 8vw, 120px) clamp(20px, 4vw, 64px);
- Card grids: display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: clamp(16px, 2vw, 32px);
- Type sizes for hero headlines: use clamp(), e.g. font-size: clamp(40px, 8vw, 96px);
- Hero: min-height: 100dvh.
- No horizontal scrollbar at ANY viewport width.

HIERARCHY:
- Hierarchy through weight and colour, not just oversized H1s.
- Preserve the visual order top-to-bottom.`;

async function generateHtml(stopPaths, assets, colorsByStop, animResults, fontsByStop, client) {
  const stopBlocks = await Promise.all(
    stopPaths.map(async (path) => {
      const buf = await readFile(path);
      return { type: 'image_url', image_url: { url: `data:image/png;base64,${buf.toString('base64')}` } };
    })
  );

  // Thumbnail blocks: send each present thumbnail labeled with its ID.
  const thumbBlocks = [];
  for (const a of assets) {
    if (!a.thumbDataUrl) continue;
    thumbBlocks.push({ type: 'text', text: `${a._id}:` });
    thumbBlocks.push({ type: 'image_url', image_url: { url: a.thumbDataUrl } });
  }

  const manifestText = buildManifestText(assets);
  const colorsText = buildColorsText(colorsByStop);
  const animationsText = buildAnimationsText(animResults);
  const fontsText = buildFontsText(fontsByStop);

  const userContent = [
    { type: 'text', text: `ASSET MANIFEST (use these IDs in data-asset-id):\n${manifestText}` },
    { type: 'text', text: `\nASSET THUMBNAILS (visual preview of each manifest entry — for matching by content):` },
    ...thumbBlocks,
    { type: 'text', text: `\nCOLOR PROBES (ground-truth surface colours per stop):\n${colorsText}` },
    { type: 'text', text: `\nTYPOGRAPHY DETECTED (use font-family verbatim — no Inter substitution):\n${fontsText}` },
    { type: 'text', text: `\nANIMATIONS DETECTED (translate each into CSS):\n${animationsText}` },
    { type: 'text', text: `\n${stopPaths.length} scroll-stop screenshots follow, in scroll order (top → bottom). Reconstruct.` },
    ...stopBlocks
  ];

  console.log(`[4/5] Main vision call: ${stopPaths.length} stops + ${thumbBlocks.length / 2} thumbnails + ${animResults.reduce((n, r) => n + r.items.length, 0)} animations`);
  const stream = await client.chat.completions.create({
    model: 'gpt-5.5',
    messages: [
      { role: 'system', content: VISION_SYSTEM },
      { role: 'user', content: userContent }
    ],
    max_completion_tokens: 32000,
    stream: true
  });
  let text = '';
  let chars = 0;
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') {
      text += delta;
      chars += delta.length;
      if (chars > 1000) { process.stdout.write('.'); chars = 0; }
    }
  }
  process.stdout.write('\n');
  return text.replace(/^```[a-z]*\n/, '').replace(/```\s*$/, '').trim();
}

// ---------------------------------------------------------------------------
// Step 5: save output
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const { stopPaths, assets, colorsByStop, fontsByStop } = await captureStops(TARGET_URL);
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(assets.map(a => ({ ...a, thumbDataUrl: a.thumbDataUrl ? '(stripped)' : null })), null, 2), 'utf8');
  await writeFile(join(OUT_DIR, 'manifest.txt'), buildManifestText(assets), 'utf8');
  await writeFile(join(OUT_DIR, 'colors.json'), JSON.stringify(colorsByStop, null, 2), 'utf8');
  await writeFile(join(OUT_DIR, 'fonts.json'), JSON.stringify(fontsByStop, null, 2), 'utf8');
  await writeFile(join(OUT_DIR, 'fonts.txt'), buildFontsText(fontsByStop), 'utf8');

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing in .env.local');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const animResults = await detectAnimations(stopPaths, client);
  await writeFile(join(OUT_DIR, 'animations.json'), JSON.stringify(animResults, null, 2), 'utf8');
  await writeFile(join(OUT_DIR, 'animations.txt'), buildAnimationsText(animResults), 'utf8');

  const rawHtml = await generateHtml(stopPaths, assets, colorsByStop, animResults, fontsByStop, client);
  if (!rawHtml || !/<html/i.test(rawHtml)) {
    throw new Error(`Model returned no usable HTML (${rawHtml.length} chars)`);
  }
  await writeFile(join(OUT_DIR, 'output-raw.html'), rawHtml, 'utf8');

  const html = injectAssets(rawHtml, assets);
  const outPath = join(OUT_DIR, 'output.html');
  await writeFile(outPath, html, 'utf8');

  const placeholders = (rawHtml.match(/data-asset-id=/g) || []).length;
  const remaining = (html.match(/data-asset-id=/g) || []).length;
  console.log(`[5/5] Asset bindings: ${placeholders - remaining} swapped / ${placeholders} emitted (${remaining} unresolved)`);
  console.log(`[5/5] Saved ${html.length} chars to ${outPath}`);
  console.log(`Open: file://${outPath}`);
}

main().catch((e) => {
  console.error('SPIKE FAILED:', e.message);
  process.exit(1);
});
