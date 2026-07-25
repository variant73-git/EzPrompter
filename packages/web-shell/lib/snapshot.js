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
import { classify, toMeta, extractVisibleText, extractMotion, visualDiff } from './classify-site.js';

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
// Shadow classifier (visual instrument) guards: skip the fullPage screenshots
// above this page height (a very long page's RGBA raster is width×height×4 bytes
// — an OOM a try/catch can't contain), and bound the in-browser decode/compare.
const SHADOW_MAX_PAGE_PX = 20000;
const SHADOW_VISUAL_TIMEOUT_MS = 10000;
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

// Bot-protection interstitial detection. Cloudflare, hCaptcha, reCAPTCHA,
// Akamai, PerimeterX etc. all serve a small HTML challenge page in front
// of the real site. Capturing that HTML as if it were the site produces
// a broken node + an `null.getComputedStyle` crash when the challenge's
// own scripts run inside our srcDoc iframe (srcDoc inherits parent
// origin — the scripts find none of the elements they expect on their
// real domain). Detect it pre-extraction so we can hand off to the user.
export class ChallengeRequiredError extends Error {
  constructor(kind, url, signals = []) {
    super(`challenge_required: ${kind} on ${url}`);
    this.name = 'ChallengeRequiredError';
    this.kind = kind;
    this.url = url;
    this.signals = signals;
  }
}

// Runs in the page context. Returns { kind, signals } if a challenge
// interstitial is detected; null otherwise. Kept defensive — any throw
// becomes "no challenge" so detection is fail-open (real sites never
// get blocked by a detector bug).
async function detectChallengePage(page) {
  try {
    return await page.evaluate(() => {
      const signals = [];
      const title = (document.title || '').trim();
      const titlePatterns = [
        { rx: /^Just a moment/i, kind: 'cloudflare' },
        { rx: /^Attention Required/i, kind: 'cloudflare' },
        { rx: /Checking (your|if the site connection) is secure/i, kind: 'cloudflare' },
        { rx: /^Access denied/i, kind: 'cloudflare' },
        { rx: /^Please wait/i, kind: 'generic_challenge' },
        { rx: /^One moment/i, kind: 'generic_challenge' }
      ];
      let kind = null;
      for (const p of titlePatterns) {
        if (p.rx.test(title)) { kind = p.kind; signals.push(`title:${title}`); break; }
      }
      // Cloudflare Turnstile / Managed Challenge widgets
      if (document.querySelector('iframe[src*="challenges.cloudflare.com"]')) {
        kind = kind || 'cloudflare'; signals.push('cf:challenges-iframe');
      }
      if (document.querySelector('#challenge-form, #cf-challenge-running, #challenge-running, #cf-please-wait, #challenge-error-text')) {
        kind = kind || 'cloudflare'; signals.push('cf:challenge-form');
      }
      if (document.querySelector('meta[http-equiv="refresh"][content*="challenge"]')) {
        kind = kind || 'cloudflare'; signals.push('cf:refresh-meta');
      }
      // hCaptcha (standalone, not embedded on real pages — embedded
      // hCaptcha is fine, only flag if hCaptcha is the WHOLE page)
      const hcaptcha = document.querySelector('iframe[src*="hcaptcha.com"], .h-captcha');
      if (hcaptcha && document.body.innerText.length < 800) {
        kind = kind || 'hcaptcha'; signals.push('hcaptcha:standalone');
      }
      // reCAPTCHA interstitial (Google "unusual traffic" page)
      if (/unusual traffic|sorry, but your computer/i.test(document.body.innerText || '')) {
        kind = kind || 'recaptcha'; signals.push('recaptcha:unusual-traffic');
      }
      // Akamai bot manager
      if (document.querySelector('script[src*="akamaihd.net/aka-bot"]') ||
          /access denied.*reference/i.test(document.body.innerText || '')) {
        kind = kind || 'akamai'; signals.push('akamai:bot-manager');
      }
      // PerimeterX
      if (document.querySelector('script[src*="px-cdn"], #px-captcha')) {
        kind = kind || 'perimeterx'; signals.push('perimeterx');
      }
      // Heuristic — challenge pages are tiny. Real sites have >2KB of body
      // text. Combined with one of the signals above, this is a strong
      // confirmation; alone it's a soft hint (don't trigger from this).
      const bodyLen = (document.body?.innerText || '').length;
      if (kind && bodyLen < 800) signals.push(`body-len:${bodyLen}`);
      return kind ? { kind, signals } : null;
    });
  } catch (e) {
    return null;
  }
}

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
// Single-pass alternation that consumes each SKIP-token whole (returning it
// unchanged) so a `\d+vh`/`\d+vw` length is never matched inside one. Skip-tokens:
//   - a comment `/* … */`, OR an EOF-terminated `/* …` (no closing) — Sol F1c;
//   - a double/single-quoted string, `\\[\s\S]` so a backslash-newline line
//     continuation stays inside the string — Sol F1b;
//   - a url(...) token, quoted or not, same continuation handling — data-URIs live here.
// The length branch: a CSS number (int, decimal, or leading-dot `.5`) + unit, with
// `(?<![\w-])` so it only fires at a real token start (NOT inside `.h-100vh`) and
// `(?![\w-])` so it never eats a partial like `1vh2` (unit `vh2`) — Sol F4.
// Kept as a source STRING so the exact same lexer runs in-page (pinDomViewportUnits)
// via new RegExp(), never eval() — CSP-safe, zero drift.
// Known residuals (need a real CSS tokenizer; unreachable in real design-site CSS):
// an escaped identifier `u\72l(` and a bare `data:` URI in a custom property outside
// url()/quotes are not recognized as skip-tokens. vmin/vmax left alone. In a headless
// capture viewport svh/lvh/dvh == vh (no dynamic browser UI), so one basis is correct.
const CSS_VH_VW_SRC = /\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|url\(\s*(?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|(?:[^)'"\\]|\\[\s\S])*)\s*\)|(?<![\w-])(-?(?:\d+(?:\.\d+)?|\.\d+))(dvh|svh|lvh|vh|dvw|svw|lvw|vw)(?![\w-])/.source;

export function pinCssLengths(css, captureWidth, captureHeight) {
  return css.replace(new RegExp(CSS_VH_VW_SRC, 'gi'), (m, num, unit) => {
    if (num === undefined) return m; // comment / string / url() token — leave untouched
    const basis = /w$/i.test(unit) ? captureWidth : captureHeight;
    return `${(parseFloat(num) / 100 * basis).toFixed(2)}px`;
  });
}

// String-based viewport-unit pinner — RETAINED AS AN INERT FALLBACK. The capture
// path now pins in the live DOM via pinDomViewportUnits() (below), which is free of
// the regex-context holes this one has. This is still used by reconstruct.js on
// model-generated HTML (which carries no inline data-URIs at pin time), and stays
// available as a fallback, but it is NOT run on captured HTML anymore.
// It scopes conversion to CSS-bearing contexts (<style> blocks + style="" attrs) and
// runs pinCssLengths (which skips comments/strings/url()); data-URIs / sizes="" /
// text stay byte-identical. Known residuals for hostile/exotic input (an SVG data-URI
// whose own inline style="" carries a viewport unit; a `&quot;`-encoded url() inside
// a style attribute) are why the DOM/CSSOM path supersedes it for capture.
export function pinViewportUnits(html, captureWidth, captureHeight) {
  // 1) style="…" / style='…' attributes. The leading separator keeps `data-style`
  //    (and other `*style`) from being mistaken for a real style attribute.
  let out = html.replace(
    /(^|[\s"'/])(style\s*=\s*)("[^"]*"|'[^']*')/gi,
    (_m, sep, pre, val) => `${sep}${pre}${val[0]}${pinCssLengths(val.slice(1, -1), captureWidth, captureHeight)}${val[0]}`
  );

  // 2) Real <style> element contents. Mask every quoted attribute value first so a
  //    literal <style> embedded inside a data-URI attribute value can't be mistaken
  //    for a real style element. The nonce is guaranteed absent from the input.
  let nonce = 'RBSG';
  while (out.includes(nonce)) nonce += 'x';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nRe = new RegExp(esc(nonce) + '(\\d+)' + esc(nonce), 'g');
  const attrs = [];
  let masked = out.replace(/=\s*("[^"]*"|'[^']*')/g, (m) => `${nonce}${attrs.push(m) - 1}${nonce}`);
  masked = masked.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open, cssBody, close) => open + pinCssLengths(cssBody, captureWidth, captureHeight) + close
  );
  return masked.replace(nRe, (_m, i) => attrs[+i]);
}

// ACTIVE capture pin. Pins viewport units in the LIVE DOM (inline style="" attrs +
// <style> element text) before serialization, using the browser as the parser.
// This is what makes it correct where the string pinViewportUnits above (kept as an
// inert fallback) has regex-context holes: `document.querySelectorAll` never returns
// a `<style>` that is actually text inside a data-URI attribute, and
// `getAttribute('style')` / `textContent` come back with real quotes (never `&quot;`)
// and no surrounding markup. So data-URIs in src/srcset/xlink:href, SVGs, Lotties,
// content:"…" strings, comments and url() payloads stay BYTE-IDENTICAL — the
// 2026-07-24 farmminerals "pixelated hero" (base64 corruption) can't recur. External
// <link> stylesheets are pinned separately, as pure CSS, in inlineStylesheets().
// The lexer is rebuilt in-page from CSS_VH_VW_SRC via new RegExp() — NOT eval()/
// Function() — so a strict page CSP can't silently no-op the pin, and no page string
// is ever evaluated. Returns the mutation count so the caller can log/observe whether
// the pin actually ran. Scope note: only serialized light-DOM style is pinned — which
// is exactly what page.content() emits; adoptedStyleSheets / shadow roots / iframes
// don't serialize into the artifact anyway, so they neither need nor get pinning.
export async function pinDomViewportUnits(page, captureWidth, captureHeight) {
  return page.evaluate(({ src, w, h }) => {
    const pin = (css) => css.replace(new RegExp(src, 'gi'), (m, num, unit) =>
      num === undefined ? m : `${(parseFloat(num) / 100 * (/w$/i.test(unit) ? w : h)).toFixed(2)}px`);
    let mutated = 0;
    for (const el of document.querySelectorAll('[style]')) {
      const v = el.getAttribute('style');
      if (v && /v[hw]/i.test(v)) { const p = pin(v); if (p !== v) { el.setAttribute('style', p); mutated++; } }
    }
    for (const styleEl of document.querySelectorAll('style')) {
      const c = styleEl.textContent;
      if (c && /v[hw]/i.test(c)) { const p = pin(c); if (p !== c) { styleEl.textContent = p; mutated++; } }
    }
    return mutated;
  }, { src: CSS_VH_VW_SRC, w: captureWidth, h: captureHeight });
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
    const pinnedCss = pinCssLengths(f.css, captureWidth, captureHeight);
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

// Lazy-load/LQIP sites swap a tiny blurred placeholder for the real asset
// AFTER networkidle fires, so a fixed post-load wait races the swap and
// ~half the captures ship a glitched (blurred) hero image. Wait until every
// visible <img> is complete AND decoded, capped so chatty sites can't hang
// the capture. Safe no-op on pages without images.
export async function waitForImagesSettled(page, capMs = 6000) {
  await page.evaluate((cap) => {
    const imgs = Array.from(document.images).filter((img) => {
      const r = img.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    });
    const settled = imgs.map((img) => {
      if (img.complete && img.naturalWidth > 1) {
        return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
      }
      return new Promise((res) => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
      }).then(() => (img.decode ? img.decode().catch(() => {}) : undefined));
    });
    return Promise.race([
      Promise.all(settled),
      new Promise((res) => setTimeout(res, cap))
    ]);
  }, capMs).catch(() => {});
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
    await waitForImagesSettled(page);

    // Bot-protection interstitial check. Cloudflare/hCaptcha/Akamai/PerimeterX
    // serve a tiny challenge page in front of the real site. Capturing that
    // HTML produces a broken node + a `null.getComputedStyle` overlay error
    // when the challenge scripts run inside our srcDoc iframe. Bail out
    // before any extraction so the route can return a structured 409 and
    // the UI can offer the human-verification handoff flow.
    const challenge = await detectChallengePage(page);
    if (challenge) {
      // eslint-disable-next-line no-console
      console.log(`[snapshot] challenge detected (kind=${challenge.kind}, signals=${challenge.signals.join(',')}) — bailing for handoff`);
      throw new ChallengeRequiredError(challenge.kind, url, challenge.signals);
    }

    // Detect JS-driven scroll narrative sites — but do NOT auto-route to
    // reconstruction anymore: capture is ALWAYS free. We persist the signal
    // so Edit or a workflow that strictly needs editable motion can upgrade
    // the node later, at the moment the capability is actually used.
    const detection = await detectAnimatedBuilder(page);
    if (detection.detected) {
      // eslint-disable-next-line no-console
      console.log(`[snapshot] animated-builder detected (score=${detection.score}, ${JSON.stringify(detection.signals)}) — static capture + animatedDetected flag`);
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

    // Guard for the heroBg body injection below: only fill the body
    // background when the page itself left it UNPAINTED (transparent on
    // both <html> and <body>, no body background-image). That's the void
    // the sampling was designed to fill (IX3 scroll-narrative tracks over
    // a default white body). When the site DID paint its body, injecting
    // the hero's sampled colour floods every transparent section with the
    // hero hue — observed 2026-06-12 as "one section's background
    // stretched over the whole site, growing with node height".
    const bodyHasOwnBg = await page.evaluate(() => {
      const opaque = (c) => {
        if (!c || c === 'transparent') return false;
        const m = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+)\s*)?\)/.exec(c);
        if (!m) return true; // unknown format — assume painted
        return m[1] === undefined || parseFloat(m[1]) > 0;
      };
      const bs = getComputedStyle(document.body);
      const hs = getComputedStyle(document.documentElement);
      return opaque(bs.backgroundColor) || opaque(hs.backgroundColor) || bs.backgroundImage !== 'none';
    }).catch(() => true); // probe failure → don't inject

    const title = (await page.title()) || url;
    // Pin inline style="" + <style> viewport units in the live DOM (browser as
    // parser) BEFORE serializing, so data-URIs / SVGs / Lotties / strings / url()
    // are never touched. External <link> CSS is pinned separately in
    // inlineStylesheets() below. On failure we continue unpinned rather than fall
    // back to the string pinner automatically (kept inert per the current plan).
    const pinnedCount = await pinDomViewportUnits(page, viewport.width, viewport.height).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[snapshot] pinDomViewportUnits failed (capture continues unpinned):', e?.message);
      return -1;
    });
    // eslint-disable-next-line no-console
    console.log(`[snapshot] pinDomViewportUnits: ${pinnedCount < 0 ? 'FAILED' : `pinned ${pinnedCount} style context(s)`}`);
    const rawHtml = await page.content();

    // Inline external stylesheets with vh/vw pinned to capture viewport.
    // Critical for sites where the hero (and other sections) use 100vh —
    // without this, the iframe grows the hero in lockstep with node height
    // and hides everything below.
    const htmlWithCss = await inlineStylesheets(rawHtml, url, page, viewport.width, viewport.height);

    // Reset scroll just for the screenshot — HTML already captured.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await waitForImagesSettled(page, 3000);
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    const screenshotDataUrl = `data:image/png;base64,${screenshot.toString('base64')}`;

    // Inject the sampled hero bg into <body> inline style so any transparent
    // scroll-narrative track below the hero doesn't expose a white body.
    // Skipped when the page painted its own body bg (see guard above).
    let bodyPatched = htmlWithCss;
    if (heroBg && bodyHasOwnBg) heroBg = null;
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
    // Strip scripts on the static path. The earlier "keep scripts" stance
    // was driven by Webflow IX3 / Framer / Lenis sites breaking — but
    // those now route through detectAnimatedBuilder → reconstructPage
    // long before reaching here, so by the time we're in the static
    // branch the page is server-rendered HTML where scripts mostly do
    // harm: they can't hydrate cross-origin under srcDoc, can't fetch
    // their original API, and widget-loader scripts (e.g. WordPress
    // header widgets that do document.write or append-on-load) stack
    // chrome multiple times. curriculum.com.br/AspClientAdapter/header.js
    // was the trigger case — header appeared 3x stacked in the iframe.
    html = stripScripts(html);
    // NOTE: viewport-unit pinning already happened in the live DOM above
    // (pinDomViewportUnits). The string pinViewportUnits() is retained as an inert
    // fallback (still used by reconstruct.js on model-generated HTML) but is NOT run
    // on the captured HTML here, to avoid double-pinning and the regex-context holes.
    html = ensureBaseTag(html, url);

    // SHADOW classifier (env-gated, off by default → zero production cost). Renders
    // the stripped JS-dead artifact and compares its visible text to the live
    // source's, per the 2026-07-23 review. It only LOGS + attaches a shadow field;
    // it does NOT drive `animatedDetected` until calibrated on real captures. Fully
    // isolated: any failure here leaves the capture untouched.
    let classificationShadow = null;
    if (process.env.UNCRAFT_CLASSIFY_SHADOW) {
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(400);
        const sourceText = await page.evaluate(extractVisibleText);
        const motion = await page.evaluate(extractMotion);
        // Skip the fullPage shots (and the visual instrument) on a pathologically
        // long page — the RGBA raster would risk OOMing the process.
        const srcPageH = await page.evaluate(() => document.documentElement.scrollHeight || 0).catch(() => 0);
        const sourceShot = srcPageH > 0 && srcPageH <= SHADOW_MAX_PAGE_PX
          ? await page.screenshot({ type: 'png', fullPage: true }).catch(() => null) : null;

        // Render the artifact the way the shipped srcDoc iframe does: scripts are
        // STRIPPED, but the iframe is sandbox="allow-scripts", so scripting stays
        // ENABLED (a JS-DISABLED probe would wrongly SHOW <noscript> content the
        // real artifact hides). A fresh JS-enabled context on our own script-free
        // html matches it.
        const probeCtx = await browser.newContext({ viewport });
        const probe = await probeCtx.newPage();
        await probe.setContent(html, { waitUntil: 'load', timeout: 15000 });
        await probe.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await probe.waitForTimeout(200);
        const artifactText = await probe.evaluate(extractVisibleText);
        const artPageH = await probe.evaluate(() => document.documentElement.scrollHeight || 0).catch(() => 0);
        const artifactShot = artPageH > 0 && artPageH <= SHADOW_MAX_PAGE_PX
          ? await probe.screenshot({ type: 'png', fullPage: true }).catch(() => null) : null;

        const result = classify({ sourceText, artifactText, motion });
        // Second instrument: the visual diff of the two shots. Run it in a TRUSTED
        // blank page — navigate the probe to about:blank so no site scripts or CSP
        // can tamper with, HANG (an Image that never settles → evaluate never
        // returns), or block the data: image decode — and bound it with a deadline.
        // Logged next to the text verdict for the §3 signals→verify gate.
        let visual = null;
        if (sourceShot && artifactShot) {
          await probe.goto('about:blank').catch(() => {});
          const evalP = probe.evaluate(visualDiff, {
            srcUrl: `data:image/png;base64,${sourceShot.toString('base64')}`,
            artUrl: `data:image/png;base64,${artifactShot.toString('base64')}`,
          });
          evalP.catch(() => {}); // swallow a late rejection if the deadline wins
          visual = await Promise.race([
            evalP,
            new Promise((_r, rej) => setTimeout(() => rej(new Error('visualDiff timeout')), SHADOW_VISUAL_TIMEOUT_MS)),
          ]).catch(() => null);
        }
        await probeCtx.close().catch(() => {});
        classificationShadow = { ...toMeta(result), visual };
        // eslint-disable-next-line no-console
        console.log(
          `[classify-site:shadow] text.category=${result.category} text.coverage=${result.coverage.toFixed(3)} ` +
          `visual.similarity=${visual ? visual.similarity.toFixed(3) : 'n/a'} visual.heightRatio=${visual ? visual.heightRatio.toFixed(3) : 'n/a'} ` +
          `legacy.animatedDetected=${detection.detected} new.animatedDetected=${classificationShadow.animatedDetected} signals=${JSON.stringify(result.signals)}`
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[classify-site:shadow] failed (capture unaffected):', e?.message);
      }
    }

    return {
      html, screenshotDataUrl, title, baseUrl: url,
      animatedDetected: detection.detected,
      ...(classificationShadow ? { classificationShadow } : {}),
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
