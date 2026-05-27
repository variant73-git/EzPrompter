/**
 * handoff.js — content script that runs on every URL (isolated world).
 *
 * Two roles depending on which page it's running on:
 *
 *   1. On a web-shell page (uncraft.app / localhost:3030 / *.vercel.app):
 *      Listens for `window.postMessage({source:'uncraft-web-shell',
 *      type:'uncraft.handoff.register', payload})` events fired by
 *      ChallengeModal. Persists the payload in chrome.storage.local
 *      keyed by URL so the banner role can find it later. Also relays
 *      to the background service worker which can route notifications
 *      back to this tab when the handoff completes.
 *
 *   2. On any other page:
 *      On load (and on URL change for SPAs), checks chrome.storage for
 *      an active handoff matching this URL. If found, mounts a frosted
 *      floating banner ("Send to Uncraft") in the top-right corner.
 *      Banner click triggers capture.js's pipeline and dispatches the
 *      result to the background script for screenshot + POST.
 *
 * Lives alongside the legacy content.js (Repix-prompt overlay) without
 * conflict — they listen for different chrome.runtime messages and
 * mount different DOM IDs.
 */
(function () {
  if (window.__uncraftHandoffInjected) return;
  window.__uncraftHandoffInjected = true;

  // ─── Origin classification ─────────────────────────────────────────────
  // Web-shell roots: dev (localhost) and prod (uncraft.app + previews).
  // Tightening this protects against random pages spoofing the postMessage
  // protocol (anyone could fire the same shape, but only web-shell
  // pages should be trusted to register handoffs).
  const WEB_SHELL_ORIGIN_RX = /^https?:\/\/(?:localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?|.*\.uncraft\.app|uncraft\.app|.*\.vercel\.app)$/i;
  function isWebShellOrigin() { return WEB_SHELL_ORIGIN_RX.test(location.origin); }

  const STORAGE_KEY = 'uncraft.handoffs';

  // ─── Shared storage helpers ────────────────────────────────────────────
  function getHandoffs() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const all = res?.[STORAGE_KEY] || {};
        // Prune expired entries on every read — cheap garbage collection.
        const now = Date.now();
        const fresh = {};
        for (const [url, entry] of Object.entries(all)) {
          if (entry?.expiresAt && entry.expiresAt > now) fresh[url] = entry;
        }
        if (Object.keys(fresh).length !== Object.keys(all).length) {
          chrome.storage.local.set({ [STORAGE_KEY]: fresh });
        }
        resolve(fresh);
      });
    });
  }
  function setHandoff(url, entry) {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const all = res?.[STORAGE_KEY] || {};
        all[url] = entry;
        chrome.storage.local.set({ [STORAGE_KEY]: all }, resolve);
      });
    });
  }
  function deleteHandoff(url) {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const all = res?.[STORAGE_KEY] || {};
        delete all[url];
        chrome.storage.local.set({ [STORAGE_KEY]: all }, resolve);
      });
    });
  }

  // ─── Role 1: web-shell bridge ──────────────────────────────────────────
  if (isWebShellOrigin()) {
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return;
      const msg = e.data;
      if (!msg || msg.source !== 'uncraft-web-shell') return;
      if (msg.type !== 'uncraft.handoff.register') return;
      const p = msg.payload || {};
      if (!p.token || !p.url) return;
      setHandoff(p.url, {
        token: p.token,
        url: p.url,
        nodeId: p.nodeId || null,
        webShellOrigin: p.webShellOrigin || location.origin,
        expiresAt: p.expiresAt || (Date.now() + 5 * 60 * 1000),
        registeredAt: Date.now()
      }).then(() => {
        // Echo back so the modal can confirm visually if it wants to.
        window.postMessage({
          source: 'uncraft-extension',
          type: 'uncraft.handoff.registered',
          url: p.url
        }, location.origin);
      });
    }, false);
    return; // Don't mount the banner on the web-shell itself.
  }

  // ─── Role 2: target-tab banner ─────────────────────────────────────────
  // Canonical form for URL matching. Strips `www.`, trailing slashes,
  // hash, and query — so handoffs registered against `curriculum.com.br`
  // still match `https://www.curriculum.com.br/pro/?utm=…` after the
  // site redirects (the common Cloudflare-pass pattern).
  // Two-level shape: { canonicalOrigin, canonicalPath } so we can do
  // either an exact match or fall back to origin-only.
  function canonicalize(u) {
    try {
      const url = new URL(u);
      const host = url.host.replace(/^www\./i, '');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      return {
        origin: `${url.protocol}//${host}`,
        path,
        full: `${url.protocol}//${host}${path}`
      };
    } catch { return null; }
  }

  // Match priority:
  //   1. exact canonical (origin + path) — high confidence
  //   2. canonical origin match alone — covers redirects to subpaths
  //      (`/` → `/pro/`, `/` → `/home`, etc).
  // Picks the highest-priority candidate first; if multiple handoffs
  // share an origin, the most recent wins (so a re-fired challenge
  // overrides a stale one). Loose match logs to console so we can
  // diagnose false positives later.
  function pickBestHandoff(all, current) {
    const cur = canonicalize(current);
    if (!cur) return null;
    let exact = null;
    let loose = null;
    let looseTime = 0;
    for (const entry of Object.values(all)) {
      const t = canonicalize(entry.url);
      if (!t) continue;
      if (t.full === cur.full) { exact = entry; break; }
      if (t.origin === cur.origin) {
        const reg = entry.registeredAt || 0;
        if (reg > looseTime) { loose = entry; looseTime = reg; }
      }
    }
    if (exact) return exact;
    if (loose) {
      console.log('[uncraft.handoff] loose-match origin (path differs):', loose.url, '→', current);
      return loose;
    }
    return null;
  }

  async function findMatchingHandoff() {
    const all = await getHandoffs();
    return pickBestHandoff(all, location.href);
  }

  let bannerEl = null;
  function unmountBanner() {
    if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
  }

  function mountBanner(handoff) {
    if (bannerEl) return; // already mounted
    bannerEl = document.createElement('div');
    bannerEl.id = '__uncraft-handoff-banner';
    bannerEl.setAttribute('data-uncraft-banner', '1');
    // Inline all styles — defending against page CSS overriding ours.
    // Frosted/glass family matches the web-shell modals. Top-right
    // positioning so it doesn't overlap typical page chrome.
    Object.assign(bannerEl.style, {
      position: 'fixed', top: '16px', right: '16px',
      zIndex: '2147483647',  // max — beat any page z-index
      display: 'flex', alignItems: 'center', gap: '14px',
      padding: '12px 14px 12px 16px',
      background: 'rgba(10, 10, 10, 0.78)',
      backdropFilter: 'blur(28px) saturate(140%)',
      WebkitBackdropFilter: 'blur(28px) saturate(140%)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '14px',
      boxShadow: '0 16px 60px rgba(0, 0, 0, 0.55)',
      color: '#f5f5f5',
      fontFamily: "'Aeonik', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: '13px', fontWeight: '400', lineHeight: '1.4',
      maxWidth: '340px',
      animation: 'none', transition: 'opacity 160ms ease'
    });
    bannerEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; flex:1;">
        <span style="
          width:28px; height:28px; display:inline-flex; align-items:center;
          justify-content:center; border-radius:8px;
          background:rgba(56,189,248,0.10); color:#7dd3fc; flex-shrink:0;
        ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
        </span>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="font-weight:500; color:#f5f5f5; letter-spacing:-0.01em;">Uncraft is waiting</span>
          <span style="font-size:11.5px; color:rgba(245,245,245,0.65);">Send this verified page to your canvas</span>
        </div>
      </div>
      <button id="__uncraft-handoff-send" type="button" style="
        background:#0095FF; color:#fff;
        border:1px solid #0095FF; border-radius:8px;
        padding:7px 12px; font-size:12.5px; font-weight:500;
        font-family:inherit; cursor:pointer;
        letter-spacing:0.005em;
      ">Send</button>
      <button id="__uncraft-handoff-dismiss" type="button" aria-label="Dismiss" style="
        background:transparent; color:rgba(245,245,245,0.55);
        border:none; padding:4px; cursor:pointer;
        display:inline-flex; align-items:center; justify-content:center;
      ">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    (document.documentElement || document.body).appendChild(bannerEl);

    bannerEl.querySelector('#__uncraft-handoff-dismiss').addEventListener('click', () => {
      unmountBanner();
    });
    bannerEl.querySelector('#__uncraft-handoff-send').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Capturing…';
      btn.style.opacity = '0.7';
      try {
        if (typeof window.__uncraftCapturePage !== 'function') {
          throw new Error('capture helper not injected');
        }
        const cap = await window.__uncraftCapturePage();
        btn.textContent = 'Sending…';
        const resp = await chrome.runtime.sendMessage({
          action: 'uncraft.handoff.send',
          handoff,
          payload: {
            html: cap.html,
            title: cap.title,
            viewport: cap.viewport,
            baseUrl: cap.baseUrl
          }
        });
        if (!resp || !resp.ok) throw new Error(resp?.error || 'unknown error');
        // Success — show a brief confirmation, then close.
        btn.textContent = 'Sent ✓';
        btn.style.background = '#10b981';
        btn.style.borderColor = '#10b981';
        await deleteHandoff(handoff.url);
        setTimeout(unmountBanner, 1400);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Retry';
        btn.style.background = '#ef4444';
        btn.style.borderColor = '#ef4444';
        // eslint-disable-next-line no-console
        console.warn('[uncraft] handoff send failed:', err);
      }
    });
  }

  async function maybeMountBanner() {
    if (bannerEl) return;
    const handoff = await findMatchingHandoff();
    if (handoff) mountBanner(handoff);
  }

  // Initial check after the page has had a moment to settle (challenges
  // typically navigate once you pass — we don't want to mount mid-redirect).
  function scheduleInitialCheck() {
    if (document.readyState === 'complete') {
      setTimeout(maybeMountBanner, 600);
    } else {
      window.addEventListener('load', () => setTimeout(maybeMountBanner, 600), { once: true });
    }
  }
  scheduleInitialCheck();

  // SPA navigations — listen for pushState/replaceState and hashchange
  // since the URL changing can make us match a new handoff.
  let lastUrl = location.href;
  function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    unmountBanner();
    setTimeout(maybeMountBanner, 600);
  }
  ['pushState', 'replaceState'].forEach((m) => {
    const orig = history[m];
    history[m] = function () {
      const r = orig.apply(this, arguments);
      window.dispatchEvent(new Event('uncraft.locationchange'));
      return r;
    };
  });
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);
  window.addEventListener('uncraft.locationchange', onUrlChange);
})();
