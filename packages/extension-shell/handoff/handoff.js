/**
 * handoff.js — content script that runs on every URL (isolated world).
 *
 * Single role now: on web-shell pages (uncraft.app / localhost:3030 /
 * *.vercel.app), listens for `window.postMessage({source:
 * 'uncraft-web-shell', type:'uncraft.handoff.register', payload})`
 * events fired by ChallengeModal. Persists the payload in
 * chrome.storage.local keyed by URL so the Uncraft widget (panel.js)
 * on the target tab can find it later and offer the "Complete capture"
 * action contextually.
 *
 * Previous Role 2 (a floating "Send to Uncraft" banner on target tabs)
 * was removed when the widget's handoff callout shipped — keeping both
 * would have been redundant entry points to the same flow.
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
})();
