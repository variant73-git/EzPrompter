/**
 * snapshot.js — server-side URL → captured HTML snapshot.
 *
 * Strategy: launch headless Chromium via playwright-core, navigate, wait for
 * networkidle, grab page.content() + screenshot. Then absolutize all asset
 * URLs and strip <script> tags so the output is safe to inject into iframe
 * srcDoc on our origin.
 *
 * Browser execution paths (in priority order):
 * 1. Browserbase remote browser (production) — if BROWSERBASE_API_KEY is set.
 * 2. Local playwright-core with system Chromium (dev / VPS deploys).
 *
 * The Vercel function size limit makes shipping the full Playwright bundle
 * impractical; production should use Browserbase or @sparticuz/chromium.
 */

import { chromium } from 'playwright-core';
import { inflateSync, inflateRawSync } from 'node:zlib';
import { reconstructPage } from './reconstruct.js';

const NAV_TIMEOUT_MS = 25000;
const RENDER_WAIT_MS = 2000;
// Realistic Chrome 124 UA — Cloudflare/Akamai/Upwork return blocked pages
// for bot-shaped UAs. Mirrors the pre-check UA in route.js.
const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// Scroll dance steps — wakes IntersectionObserver-driven lazy mounts and
// gives animation libs (Webflow IX3, GSAP ScrollTrigger, Framer Motion)
// the chance to mark all elements as "in-view" before we capture HTML.
const SCROLL_STEP_PX = 800;
const SCROLL_STEP_WAIT_MS = 350;
const SCROLL_FINAL_SETTLE_MS = 1000;
// CSS override injected before page.content() to defeat "off-screen initial
// state" rules from common animation libraries. Webflow IX3 / AOS / Framer
// Motion / GSAP ScrollTrigger keep elements at opacity:0 via CSS RULE (not
// inline style) until JS adds an "in-view" class. With scripts stripped from
// the iframe, that class never lands — so we force-resolve via !important.
const ANIM_FORCE_SHOW_CSS = `
[data-w-id]:not([style*="display: none"]),
.w-condition-invisible[data-w-id],
[data-aos]:not(.aos-animate),
[data-anim],
[data-scroll],
[data-framer-component-type],
.reveal,
.reveal-on-scroll,
.fade-in,
.fade-up,
.slide-up,
.gsap-fade,
.gsap-reveal {
  opacity: 1 !important;
  transform: none !important;
  visibility: visible !important;
  filter: none !important;
  clip-path: none !important;
}
.w-animation-active, [data-w-id] {
  --w-anim-progress: 1;
}
`;

// Decode the RGB of the first pixel from a PNG buffer. Used to sample
// the actual rendered colour at a specific viewport location (CSS-based
// sampling misses background images / videos / canvas overlays).
function readPngFirstPixelRgb(buf) {
  let i = 8; // skip 8-byte PNG signature
  let colorType = 2; // 2 = RGB, 6 = RGBA
  while (i < buf.length - 4) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    if (type === 'IHDR') {
      colorType = buf[i + 8 + 9]; // colorType is at offset 9 within IHDR data
    }
    if (type === 'IDAT') {
      // Collect ALL IDAT chunks — large PNGs split data, some encoders even
      // split tiny PNGs. Concat then decompress.
      let combined = Buffer.alloc(0);
      let j = i;
      while (j < buf.length - 4) {
        const cLen = buf.readUInt32BE(j);
        const cType = buf.toString('ascii', j + 4, j + 8);
        if (cType !== 'IDAT') break;
        combined = Buffer.concat([combined, buf.subarray(j + 8, j + 8 + cLen)]);
        j += 8 + cLen + 4;
      }
      let decompressed;
      try { decompressed = inflateSync(combined); }
      catch (e1) {
        try { decompressed = inflateRawSync(combined); }
        catch (e2) { return null; }
      }
      if (decompressed.length < 4) return null;
      const r = decompressed[1];
      const g = decompressed[2];
      const b = decompressed[3];
      return `rgb(${r}, ${g}, ${b})`;
    }
    i += 8 + len + 4;
  }
  console.log(`[png decode] no IDAT chunk found in ${buf.length} bytes`);
  return null;
}

async function samplePixelAt(page, x, y) {
  try {
    const buf = await page.screenshot({ type: 'png', clip: { x, y, width: 1, height: 1 } });
    return readPngFirstPixelRgb(buf);
  } catch (e) { return null; }
}

async function launchBrowser() {
  if (process.env.BROWSERBASE_API_KEY) {
    // Browserbase: connect to remote chromium via CDP.
    const wsUrl = `wss://connect.browserbase.com?apiKey=${encodeURIComponent(process.env.BROWSERBASE_API_KEY)}`;
    return chromium.connectOverCDP(wsUrl);
  }
  // Local fallback. Requires `bunx playwright install chromium` once.
  return chromium.launch({ headless: true });
}

function absolutizeUrls(html, baseUrl) {
  const base = new URL(baseUrl);
  const abs = (raw) => {
    if (!raw) return raw;
    const trimmed = raw.trim();
    if (/^(data:|blob:|https?:|\/\/)/i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('#')) return trimmed;
    try { return new URL(trimmed, base).toString(); } catch { return trimmed; }
  };

  // src, href, srcset, poster
  let out = html.replace(/(<\s*(?:img|script|iframe|video|audio|source|link)\b[^>]*?\b(?:src|href|poster)=)(["'])([^"']+)(["'])/gi,
    (_m, p1, q1, url, q2) => `${p1}${q1}${abs(url)}${q2}`);

  // srcset: comma-separated list
  out = out.replace(/(\bsrcset=)(["'])([^"']+)(["'])/gi, (_m, p1, q1, list, q2) => {
    const fixed = list.split(',').map((entry) => {
      const trimmed = entry.trim();
      const [u, ...rest] = trimmed.split(/\s+/);
      return [abs(u), ...rest].join(' ');
    }).join(', ');
    return `${p1}${q1}${fixed}${q2}`;
  });

  // CSS url(...) inside style attrs and <style> blocks
  out = out.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_m, q, url) => `url(${q}${abs(url)}${q})`);

  return out;
}

function stripScripts(html) {
  // Remove <script>...</script> and <script ... /> entirely.
  return html
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '<!--[uncraft] script removed-->')
    .replace(/<\s*script\b[^>]*\/?>/gi, '<!--[uncraft] script removed-->')
    // Strip on* event handlers from any tag.
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

// Replace viewport-relative units with pixel equivalents based on the
// capture viewport. In iframe srcDoc, `vh` reads against iframe dimensions,
// not the original capture viewport. If a hero is `height: 100vh` and we
// expand the canvas node to the page's natural scrollHeight (e.g. 15000px),
// the hero scales to 15000px — covering everything below. Pinning `vh`
// to the capture viewport height keeps the hero at its designed 800px
// regardless of the iframe's actual size.
export function pinViewportUnits(html, captureWidth, captureHeight) {
  // Variants we substitute: vh, dvh, svh, lvh (height), vw, dvw, svw, lvw (width).
  // Don't touch vmin/vmax — usage there is more nuanced and rarer.
  // Pattern: number (int or decimal, optional sign) followed by unit, with no
  // letter after — avoids matching `vhalign` or other false positives.
  const heightUnit = /(-?\d+(?:\.\d+)?)(dvh|svh|lvh|vh)(?![a-z])/gi;
  const widthUnit  = /(-?\d+(?:\.\d+)?)(dvw|svw|lvw|vw)(?![a-z])/gi;
  return html
    .replace(heightUnit, (_m, n) => `${(parseFloat(n) / 100 * captureHeight).toFixed(2)}px`)
    .replace(widthUnit,  (_m, n) => `${(parseFloat(n) / 100 * captureWidth).toFixed(2)}px`);
}

// Walk the captured HTML for <link rel="stylesheet"> tags, fetch each
// stylesheet, pin its viewport units to the capture viewport, and replace
// the <link> tag with an inline <style> block. After this transform the
// iframe never re-fetches the original (unpinned) CSS from the CDN, so a
// `.hero { height: 100vh }` declaration becomes `.hero { height: 800px }`
// permanently. Without this step the iframe rendering grows the hero in
// proportion to whatever size the canvas node is resized to.
async function inlineStylesheets(html, baseUrl, page, captureWidth, captureHeight) {
  const linkRe = /<link\b[^>]*>/gi;
  const matches = [...html.matchAll(linkRe)];
  const ops = [];
  for (const m of matches) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?stylesheet["']?/i.test(tag)) continue;
    const hrefM = /href\s*=\s*["']?([^"'\s>]+)["']?/i.exec(tag);
    if (!hrefM) continue;
    let href = hrefM[1];
    try { href = new URL(href, baseUrl).toString(); } catch { continue; }
    ops.push({ tag, href });
  }
  // Fetch all stylesheets in parallel — usually 1-5 per page, all on the
  // same CDN, finishes well under 2s.
  const fetched = await Promise.all(ops.map(async (op) => {
    try {
      const res = await page.request.fetch(op.href, { timeout: 10000 });
      if (!res.ok()) return { ...op, css: null };
      const css = await res.text();
      return { ...op, css };
    } catch (e) {
      return { ...op, css: null, err: String(e.message || e) };
    }
  }));
  let out = html;
  let inlinedCount = 0;
  for (const f of fetched) {
    if (!f.css) continue;
    // Pin vh/vw in this stylesheet, then absolutize url(...) refs against
    // the stylesheet's own base (so background-image: url(./a.png) still
    // resolves correctly after inlining).
    const pinnedCss = pinViewportUnits(f.css, captureWidth, captureHeight);
    const cssWithAbsolutes = absolutizeUrls(pinnedCss, f.href);
    // Replace literal tag occurrence with inline style block. We use a
    // unique sentinel attribute so future passes can identify our work.
    const styleBlock = `<style data-uncraft-inlined="${f.href.replace(/"/g, '&quot;')}">${cssWithAbsolutes}</style>`;
    // String.replace with a string pattern only replaces the first match —
    // perfect because each link tag in the source is unique.
    out = out.replace(f.tag, styleBlock);
    inlinedCount++;
  }
  if (inlinedCount > 0) {
    // eslint-disable-next-line no-console
    console.log(`[snapshot] inlined ${inlinedCount}/${ops.length} stylesheets with vh→px pin`);
  }
  return out;
}

// Probe the loaded page for signals that the site is a JS-driven scroll
// narrative — the static capture path produces a broken render for these
// (only the hero shows, sticky sections collapse, animation tracks render
// transparent). When true, we route to lib/reconstruct.js iter-9 pipeline.
async function detectAnimatedBuilder(page) {
  return await page.evaluate(() => {
    const html = document.documentElement;
    const signals = {
      webflowIx3: html.classList.contains('w-mod-ix3'),
      lenis: html.classList.contains('lenis') || !!document.querySelector('.lenis'),
      framer: document.querySelectorAll('[data-framer-component-type]').length >= 3,
      stickyHeavy: document.querySelectorAll('[style*="position: sticky"], [style*="position:sticky"]').length >= 3,
      // Webflow IX3 hard signal: scroll-pinning wrapper class.
      ix3Scroll: !!document.querySelector('[class*="-animation"] [style*="position: sticky"], .promo-animation, .scroll-narrative, .pinned-section')
    };
    const score =
      (signals.webflowIx3 ? 2 : 0) +
      (signals.lenis ? 1 : 0) +
      (signals.framer ? 2 : 0) +
      (signals.stickyHeavy ? 1 : 0) +
      (signals.ix3Scroll ? 2 : 0);
    return { detected: score >= 2, score, signals };
  });
}

function ensureBaseTag(html, baseUrl) {
  // Inject <base href> so relative links resolve correctly inside iframe srcDoc.
  if (/<base\b[^>]*>/i.test(html)) return html;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (m) => `${m}<base href="${baseUrl}">`);
  }
  return `<head><base href="${baseUrl}"></head>${html}`;
}

/**
 * Capture a URL into a self-contained, scrubbed HTML snapshot.
 * @param {string} url
 * @param {{viewport?: {width:number, height:number}}} opts
 * @returns {Promise<{html:string, screenshotDataUrl:string, title:string, baseUrl:string}>}
 */
export async function captureSnapshot(url, opts = {}) {
  const viewport = opts.viewport || { width: 1280, height: 800 };
  const { onProgress = () => {} } = opts;
  let browser, context, page;
  try {
    browser = await launchBrowser();
    context = await browser.newContext({
      viewport,
      userAgent: REAL_UA,
      locale: 'en-US',
      timezoneId: 'America/Sao_Paulo'
    });
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS }).catch(async () => {
      // networkidle can hang on chatty sites; fall back to load.
      await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    });
    await page.waitForTimeout(RENDER_WAIT_MS);

    // Detect JS-driven scroll narrative sites and route to reconstruction.
    // The static capture path produces a broken render for these (only
    // hero shows, sticky sections collapse). reconstructPage does a
    // proper vision-based linear HTML rebuild.
    const detection = await detectAnimatedBuilder(page);
    if (detection.detected) {
      // eslint-disable-next-line no-console
      console.log(`[snapshot] animated-builder detected (score=${detection.score}, ${JSON.stringify(detection.signals)}) — routing to reconstructPage`);
      // Close current browser resources — reconstructPage launches its own
      // since it needs different scroll behaviour (scroll-stops vs
      // scroll-to-bottom). Cost: ~3-5s extra launch time.
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      browser = context = page = null;
      return await reconstructPage(url, { onProgress });
    }

    // Scroll-to-bottom (no reset) — lets Webflow IX3 / Framer Motion / GSAP
    // ScrollTrigger walk through their in-view callbacks for every element,
    // adding the "in-view" classes the CSS depends on. Resetting to top would
    // trigger out-animations on the hero and leave it at opacity:0, so we
    // stay at the bottom for the HTML capture and only scroll back for the
    // screenshot afterwards.
    await page.evaluate(async ({ step, wait, settle }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const maxY = () => Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      ) - window.innerHeight;
      let y = 0;
      for (let i = 0; i < 40; i++) {
        const target = Math.min(y + step, maxY());
        window.scrollTo(0, target);
        await sleep(wait);
        if (target >= maxY()) break;
        y = target;
      }
      await sleep(settle);
    }, { step: SCROLL_STEP_PX, wait: SCROLL_STEP_WAIT_MS, settle: SCROLL_FINAL_SETTLE_MS });

    // Inject force-show CSS — defeats CSS rules like `[data-w-id] {opacity:0}`
    // that the stripped JS would normally toggle off via class addition.
    // Goes at the END of the head so it wins specificity ties.
    await page.evaluate((css) => {
      const style = document.createElement('style');
      style.setAttribute('data-uncraft-force-show', '1');
      style.textContent = css;
      document.head.appendChild(style);
    }, ANIM_FORCE_SHOW_CSS);
    // Tiny settle so the style apply paints before content() reads.
    await page.waitForTimeout(120);

    // Sample the hero background color from actual rendered pixels (not
    // CSS computed style — CSS sampling misses image/video/canvas overlays
    // which is often the real hero "background"). Used as the body
    // fallback so scroll-narrative transparent tracks (Webflow IX3
    // `.texts-animation` etc.) don't expose a default white body.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
    const vw = viewport.width, vh = viewport.height;
    // Sample 5 points around the visible hero, away from typical centred
    // product imagery, then take the mode. Avoids picking a black pebble
    // or other foreground element as the body bg.
    const samples = (await Promise.all([
      samplePixelAt(page, 40, vh * 0.5),
      samplePixelAt(page, vw - 40, vh * 0.5),
      samplePixelAt(page, vw * 0.5, 80),
      samplePixelAt(page, vw * 0.25, vh - 80),
      samplePixelAt(page, vw * 0.75, vh - 80)
    ])).filter(Boolean);
    // Per-channel median across all samples — robust to one or two corner
    // samples landing on body-bg or other off-hero regions.
    let heroBg = null;
    if (samples.length > 0) {
      const channels = { r: [], g: [], b: [] };
      for (const s of samples) {
        const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s);
        if (!m) continue;
        channels.r.push(parseInt(m[1], 10));
        channels.g.push(parseInt(m[2], 10));
        channels.b.push(parseInt(m[3], 10));
      }
      if (channels.r.length > 0) {
        const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
        heroBg = `rgb(${median(channels.r)}, ${median(channels.g)}, ${median(channels.b)})`;
      }
    }

    const title = (await page.title()) || url;
    const rawHtml = await page.content();

    // Inline external stylesheets with vh/vw pinned to capture viewport.
    // Critical for sites where the hero (and other sections) use 100vh —
    // without this, the iframe grows the hero in lockstep with node height
    // and hides everything below.
    const htmlWithCss = await inlineStylesheets(rawHtml, url, page, viewport.width, viewport.height);

    // Reset scroll just for the screenshot — HTML already captured.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    const screenshotDataUrl = `data:image/png;base64,${screenshot.toString('base64')}`;

    // Inject the sampled hero bg into <body> inline style so any transparent
    // scroll-narrative track below the hero doesn't expose a white body.
    let bodyPatched = htmlWithCss;
    if (heroBg) {
      bodyPatched = bodyPatched.replace(/<body\b([^>]*)>/i, (m, attrs) => {
        // If body already has a style attribute, prepend our bg (browser
        // takes the last value, so later inline declarations still win).
        if (/style\s*=\s*["']/i.test(attrs)) {
          return `<body${attrs.replace(/style\s*=\s*(["'])/i, `style=$1background:${heroBg};`)}>`;
        }
        return `<body${attrs} style="background:${heroBg};">`;
      });
      // eslint-disable-next-line no-console
      console.log(`[snapshot] body bg fallback set to ${heroBg}`);
    }

    let html = absolutizeUrls(bodyPatched, url);
    // NOTE: scripts are intentionally KEPT now. Stripping them broke any
    // site that drove layout from JS (Webflow IX3 sticky-scroll, Framer
    // scrollytelling, Lenis smooth-scroll, etc.). Iframe sandbox in
    // CanvasNode is "allow-same-origin allow-scripts" — scripts run within
    // iframe, can touch parent origin (acceptable single-user trade-off
    // now; revisit when we go multi-tenant).
    // html = stripScripts(html);
    html = pinViewportUnits(html, viewport.width, viewport.height);
    html = ensureBaseTag(html, url);

    return { html, screenshotDataUrl, title, baseUrl: url };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
