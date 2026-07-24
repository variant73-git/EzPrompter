/**
 * capture.js — extension-side page capture pipeline.
 *
 * Runs as an isolated-world content script (has DOM access + can fetch
 * cross-origin resources because the extension's host_permissions cover
 * <all_urls>). Used by both the auto-handoff flow (banner click after
 * user passes a Cloudflare/captcha challenge) and the manual capture
 * flow (toolbar popup "Send this tab to <board>").
 *
 * Mirrors the server-side snapshot.js post-processing where it makes
 * sense (absolutize URLs, strip scripts, pin viewport units) so the
 * captured HTML renders the same way inside the canvas iframe whether
 * it came from Playwright or the user's real browser.
 *
 * The key differentiator vs server-side: we run INSIDE the user's
 * authenticated session, so fetch('https://site.com/style.css',
 * {credentials: 'include'}) goes through with their cookies — solving
 * the "Cloudflare-protected CSS doesn't load" problem.
 *
 * Exposes window.__uncraftCapturePage() returning a Promise of
 *   { html, title, viewport: {width, height} }.
 */
(function () {
  if (window.__uncraftCapturePage) return; // idempotent injection

  const BASE_HREF = location.href;
  const ORIGIN = location.origin;

  // Resolve a possibly-relative URL against the page's base href.
  // Returns the input as-is for data:/blob:/about: schemes which
  // would explode in URL().
  function abs(u) {
    if (!u) return u;
    const s = String(u).trim();
    if (/^(?:data|blob|about|javascript):/i.test(s)) return s;
    try { return new URL(s, BASE_HREF).toString(); } catch { return s; }
  }

  // Inline all external stylesheets referenced via <link rel="stylesheet">.
  // The browser already loaded these (so they're in the cache); fetching
  // them again with credentials:'include' gives us the bytes to embed.
  // Each fetched sheet's url(...) references are absolutized relative to
  // the sheet's URL so background-image: url(./hero.png) still resolves
  // when the HTML renders inside our srcDoc iframe.
  async function inlineStylesheets(rootEl) {
    const links = [...rootEl.querySelectorAll('link[rel~="stylesheet"][href]')];
    const tasks = links.map(async (link) => {
      const href = abs(link.getAttribute('href'));
      if (!href || /^data:/i.test(href)) return;
      try {
        const res = await fetch(href, { credentials: 'include', cache: 'force-cache' });
        if (!res.ok) return;
        let css = await res.text();
        // Absolutize url(...) inside the CSS against the SHEET's URL,
        // not the page URL — relative refs in CSS resolve relative to
        // the stylesheet's own location.
        const sheetBase = href;
        css = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_m, q, u) => {
          if (/^(?:data|blob|about):/i.test(u)) return `url(${q}${u}${q})`;
          try { return `url(${q}${new URL(u, sheetBase).toString()}${q})`; }
          catch { return `url(${q}${u}${q})`; }
        });
        const style = document.createElement('style');
        style.setAttribute('data-uncraft-inlined', href);
        style.textContent = css;
        link.replaceWith(style);
      } catch (e) {
        // Leave the <link> intact — best-effort. Worst case: that
        // stylesheet fails to load in the srcDoc context and the
        // captured page renders with partial styles.
      }
    });
    await Promise.all(tasks);
  }

  // Walk the cloned tree and absolutize every URL-bearing attribute.
  // Mirrors snapshot.js's absolutizeUrls but operates on a live DOM
  // tree (faster + more accurate than regex on the HTML string).
  function absolutizeUrls(rootEl) {
    const URL_ATTRS = ['src', 'href', 'poster', 'data', 'action', 'formaction'];
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      for (const a of URL_ATTRS) {
        const v = node.getAttribute && node.getAttribute(a);
        if (v) node.setAttribute(a, abs(v));
      }
      // srcset is comma-separated
      const ss = node.getAttribute && node.getAttribute('srcset');
      if (ss) {
        const fixed = ss.split(',').map((entry) => {
          const t = entry.trim();
          const parts = t.split(/\s+/);
          parts[0] = abs(parts[0]);
          return parts.join(' ');
        }).join(', ');
        node.setAttribute('srcset', fixed);
      }
      // Inline style url()s
      const style = node.getAttribute && node.getAttribute('style');
      if (style && /url\(/i.test(style)) {
        const fixed = style.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
          (_m, q, u) => `url(${q}${abs(u)}${q})`);
        node.setAttribute('style', fixed);
      }
    }
  }

  // Strip ALL <script> tags + inline event handlers from the clone.
  // Same posture as server-side static path: scripts in a srcDoc
  // iframe can't hydrate (cross-origin), can't re-fetch their API,
  // and often re-run side effects that stack chrome (header.js etc).
  function stripScripts(rootEl) {
    rootEl.querySelectorAll('script').forEach((s) => s.remove());
    // Inline event handlers (onclick, onload, …) — remove them all so
    // failed JS calls don't throw inside the srcDoc.
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.attributes) continue;
      const toRemove = [];
      for (const a of node.attributes) {
        if (/^on[a-z]+$/i.test(a.name)) toRemove.push(a.name);
      }
      toRemove.forEach((n) => node.removeAttribute(n));
    }
  }

  // Replace viewport-relative units with pixel equivalents against the capture
  // viewport — a 100vh hero inside a tall iframe blows up; pinning keeps the design
  // intact. Kept in lock-step with web-shell snapshot.js: pin ONLY inside real CSS
  // contexts (<style> blocks and style="" attributes), and pinCssLengths itself
  // skips comments / strings / url(), so we never rewrite bytes inside an inline
  // data-URI. The old naive global replace corrupted base64 payloads (the 2026-07-24
  // farmminerals "pixelated hero": 382 substitutions inside a 7.5 MB inline Lottie).
  function pinCssLengths(css, w, h) {
    const re = /\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?:[^)'"\\]|\\.)*)\s*\)|(?<![\w-])(-?(?:\d+(?:\.\d+)?|\.\d+))(dvh|svh|lvh|vh|dvw|svw|lvw|vw)(?![a-z])/gi;
    return css.replace(re, (m, num, unit) => {
      if (num === undefined) return m; // comment / string / url() token — leave untouched
      const basis = /w$/i.test(unit) ? w : h;
      return `${(parseFloat(num) / 100 * basis).toFixed(2)}px`;
    });
  }
  function pinViewportUnits(htmlStr, w, h) {
    let out = htmlStr.replace(
      /(^|[\s"'/])(style\s*=\s*)("[^"]*"|'[^']*')/gi,
      (_m, sep, pre, val) => `${sep}${pre}${val[0]}${pinCssLengths(val.slice(1, -1), w, h)}${val[0]}`
    );
    let nonce = 'RBSG';
    while (out.includes(nonce)) nonce += 'x';
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nRe = new RegExp(esc(nonce) + '(\\d+)' + esc(nonce), 'g');
    const attrs = [];
    let masked = out.replace(/=\s*("[^"]*"|'[^']*')/g, (m) => `${nonce}${attrs.push(m) - 1}${nonce}`);
    masked = masked.replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_m, open, cssBody, close) => open + pinCssLengths(cssBody, w, h) + close
    );
    return masked.replace(nRe, (_m, i) => attrs[+i]);
  }

  function ensureBaseTag(htmlStr, baseUrl) {
    if (/<base\b[^>]*>/i.test(htmlStr)) return htmlStr;
    if (/<head\b[^>]*>/i.test(htmlStr)) {
      return htmlStr.replace(/<head\b[^>]*>/i, (m) => `${m}<base href="${baseUrl}">`);
    }
    return `<head><base href="${baseUrl}"></head>${htmlStr}`;
  }

  // Capture the visible viewport (NOT full-page) — matches Playwright's
  // default screenshot in snapshot.js so the canvas's hero placeholder
  // is consistent regardless of which path produced the snapshot.
  // Returns a dimensions tuple so the server post-processing knows
  // what to pin vh/vw against.
  function readViewport() {
    return {
      width: Math.max(window.innerWidth || 1280, 320),
      height: Math.max(window.innerHeight || 720, 240)
    };
  }

  // Tag the body with the original viewport so the receiver can pin
  // vh/vw correctly even if the capture lands in an iframe of a
  // different size. Mirrors what snapshot.js inlineStylesheets does
  // for stylesheet-embedded units.
  async function capturePage() {
    const viewport = readViewport();
    const title = document.title || location.href;

    // Clone the document so our mutations don't affect the live page.
    // documentElement.cloneNode(true) is a full deep clone including
    // <head> and <body>.
    const clone = document.documentElement.cloneNode(true);

    // Phase 1: inline external stylesheets (uses credentialed fetch
    // for the user's session). MUST run before stripScripts so a
    // <script> that loaded a stylesheet via document.write doesn't
    // accidentally lose the sheet first.
    await inlineStylesheets(clone);

    // Phase 2: absolutize every URL attribute in the clone.
    absolutizeUrls(clone);

    // Phase 3: strip scripts + inline event handlers.
    stripScripts(clone);

    // Serialise.
    let html = '<!DOCTYPE html>\n' + clone.outerHTML;

    // Pin viewport units against the capture viewport so the hero
    // doesn't balloon inside a tall canvas iframe.
    html = pinViewportUnits(html, viewport.width, viewport.height);

    // Ensure <base> so absolutize is belt-and-suspenders.
    html = ensureBaseTag(html, BASE_HREF);

    return { html, title, viewport, baseUrl: BASE_HREF, origin: ORIGIN };
  }

  window.__uncraftCapturePage = capturePage;
})();
