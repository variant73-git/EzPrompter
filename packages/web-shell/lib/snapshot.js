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

const NAV_TIMEOUT_MS = 25000;
const RENDER_WAIT_MS = 2000;

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
  let browser, context, page;
  try {
    browser = await launchBrowser();
    context = await browser.newContext({ viewport, userAgent: 'Mozilla/5.0 (UncraftBot/0.1)' });
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS }).catch(async () => {
      // networkidle can hang on chatty sites; fall back to load.
      await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    });
    await page.waitForTimeout(RENDER_WAIT_MS);

    const title = (await page.title()) || url;
    const rawHtml = await page.content();
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    const screenshotDataUrl = `data:image/png;base64,${screenshot.toString('base64')}`;

    let html = absolutizeUrls(rawHtml, url);
    html = stripScripts(html);
    html = ensureBaseTag(html, url);

    return { html, screenshotDataUrl, title, baseUrl: url };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
