/**
 * popup.js — toolbar action UI.
 *
 * Lists the user's boards (fetched from /api/boards with the uncraft_sess
 * cookie that lives in the user's browser) and lets them send the active
 * tab's DOM to the chosen board via /api/snapshot/manual. Uses the same
 * capture pipeline as the auto-handoff flow — capture.js is injected
 * into the tab and called via chrome.scripting.executeScript, then the
 * result is forwarded to the background service worker which adds the
 * screenshot via captureVisibleTab and POSTs to the web-shell.
 *
 * Web-shell origin discovery: tries production first
 * (https://uncraft.app), falls back to localhost:3030 (dev). Cached in
 * chrome.storage.local once a working origin is found so subsequent
 * popups skip the probe.
 */

const STORAGE_KEY_ORIGIN = 'uncraft.webShellOrigin';
const STORAGE_KEY_HANDOFFS = 'uncraft.handoffs';
const CANDIDATE_ORIGINS = [
  'https://uncraft.app',
  'http://localhost:3030',
  'http://127.0.0.1:3030'
];

const el = {
  tabTitle:           document.getElementById('tabTitle'),
  tabFavicon:         document.getElementById('tabFavicon'),
  boardSelect:        document.getElementById('boardSelect'),
  sendBtn:            document.getElementById('sendBtn'),
  status:             document.getElementById('status'),
  signinLink:         document.getElementById('signinLink'),
  openCanvasLink:     document.getElementById('openCanvasLink'),
  pendingHandoff:     document.getElementById('pendingHandoff'),
  completePendingBtn: document.getElementById('completePendingBtn')
};

let state = {
  tab: null,
  webShellOrigin: null,
  boards: [],
  pendingHandoff: null  // {token, url, nodeId, webShellOrigin, expiresAt, ...}
};

// Mirror of handoff.js canonicalize() — keep in sync. Strip `www.`,
// trailing slashes, query, hash so tab URL matches stored handoff
// even after the site redirects from / → /pro/ (or www → bare).
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

async function findPendingHandoffForUrl(currentUrl) {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY_HANDOFFS]);
    const all = res?.[STORAGE_KEY_HANDOFFS] || {};
    const now = Date.now();
    const cur = canonicalize(currentUrl);
    if (!cur) return null;
    let exact = null;
    let loose = null;
    let looseTime = 0;
    for (const entry of Object.values(all)) {
      if (entry?.expiresAt && entry.expiresAt < now) continue;
      const t = canonicalize(entry.url);
      if (!t) continue;
      if (t.full === cur.full) { exact = entry; break; }
      if (t.origin === cur.origin) {
        const reg = entry.registeredAt || 0;
        if (reg > looseTime) { loose = entry; looseTime = reg; }
      }
    }
    return exact || loose;
  } catch (e) {
    return null;
  }
}

function showStatus(text, isError = false) {
  el.status.hidden = false;
  el.status.textContent = text;
  el.status.classList.toggle('popup-status-error', !!isError);
}
function clearStatus() {
  el.status.hidden = true;
  el.status.textContent = '';
  el.status.classList.remove('popup-status-error');
}

// Find the first candidate origin that the user is signed into. We hit
// /api/boards (no body, cheap) and treat 200 as "signed in here".
// Cached for the lifetime of this storage entry.
async function discoverWebShellOrigin() {
  try {
    const cached = await chrome.storage.local.get([STORAGE_KEY_ORIGIN]);
    const seed = cached?.[STORAGE_KEY_ORIGIN];
    const tryOrder = seed ? [seed, ...CANDIDATE_ORIGINS.filter((o) => o !== seed)] : CANDIDATE_ORIGINS;
    for (const origin of tryOrder) {
      try {
        const res = await fetch(`${origin}/api/boards`, { credentials: 'include' });
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          await chrome.storage.local.set({ [STORAGE_KEY_ORIGIN]: origin });
          return { origin, boards: json.boards || [] };
        }
        if (res.status === 401) {
          // Reachable, just not authed — prefer this origin so the
          // sign-in link points at the right one.
          return { origin, boards: [], unauthorized: true };
        }
      } catch (e) {
        // Network unreachable — try next candidate.
      }
    }
  } catch (e) {
    console.warn('[uncraft popup] origin discovery failed:', e);
  }
  return { origin: null, boards: [] };
}

async function loadActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  el.tabTitle.textContent = tab?.title || 'untitled';
  if (tab?.favIconUrl) {
    el.tabFavicon.style.backgroundImage = `url("${tab.favIconUrl.replace(/"/g, '\\"')}")`;
  }
}

function populateBoards(boards) {
  el.boardSelect.innerHTML = '';
  if (!boards.length) {
    el.boardSelect.innerHTML = '<option value="">No boards yet</option>';
    el.boardSelect.disabled = true;
    return;
  }
  for (const b of boards) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name || 'Untitled';
    el.boardSelect.appendChild(opt);
  }
  el.boardSelect.disabled = false;
}

function isCapturableTab(tab) {
  if (!tab?.url) return false;
  return /^https?:\/\//i.test(tab.url);
}

// Capture the active tab via the same pipeline the in-tab banner uses —
// inject capture.js + call __uncraftCapturePage. Shared by both the
// pending-handoff and manual-capture buttons.
async function captureActiveTab() {
  await chrome.scripting.executeScript({
    target: { tabId: state.tab.id },
    world: 'ISOLATED',
    files: ['handoff/capture.js']
  });
  const [capResult] = await chrome.scripting.executeScript({
    target: { tabId: state.tab.id },
    world: 'ISOLATED',
    func: async () => {
      if (typeof window.__uncraftCapturePage !== 'function') {
        return { error: 'capture helper not present' };
      }
      try { return await window.__uncraftCapturePage(); }
      catch (e) { return { error: String(e?.message || e) }; }
    }
  });
  const cap = capResult?.result;
  if (!cap || cap.error) throw new Error(cap?.error || 'capture failed');
  return cap;
}

// Completes a pending handoff against the existing placeholder node
// the web-shell created when the auto-handoff flow detected a challenge.
// Routes to the same /api/snapshot/handoff endpoint the in-tab banner
// uses — the user-typed URL's placeholder gets filled, polling on the
// canvas swaps it for the real node.
async function completePending() {
  clearStatus();
  if (!state.pendingHandoff) return showStatus('No pending handoff found.', true);
  el.completePendingBtn.disabled = true;
  el.completePendingBtn.textContent = 'Capturing tab…';
  el.completePendingBtn.classList.remove('success', 'error');
  try {
    const cap = await captureActiveTab();
    el.completePendingBtn.textContent = 'Sending…';
    const resp = await chrome.runtime.sendMessage({
      action: 'uncraft.handoff.send',
      handoff: state.pendingHandoff,
      payload: { html: cap.html, title: cap.title, viewport: cap.viewport }
    });
    if (!resp?.ok) throw new Error(resp?.error || 'send failed');
    el.completePendingBtn.textContent = 'Sent ✓';
    el.completePendingBtn.classList.add('success');
    showStatus('Placeholder filled. Switch to your canvas — it updates within seconds.');
    el.openCanvasLink.href = `${state.pendingHandoff.webShellOrigin}/canvas`;
    el.openCanvasLink.hidden = false;
    setTimeout(() => window.close(), 1800);
  } catch (e) {
    el.completePendingBtn.disabled = false;
    el.completePendingBtn.textContent = 'Try again';
    el.completePendingBtn.classList.add('error');
    showStatus(String(e?.message || e), true);
  }
}

async function send() {
  clearStatus();
  if (!state.tab?.id) return showStatus('No active tab.', true);
  if (!isCapturableTab(state.tab)) {
    return showStatus("This page can't be captured (browser-internal URL).", true);
  }
  const boardId = el.boardSelect.value;
  if (!boardId) return showStatus('Pick a board first.', true);
  if (!state.webShellOrigin) return showStatus('Sign in to Uncraft first.', true);

  el.sendBtn.disabled = true;
  el.sendBtn.textContent = 'Capturing tab…';
  el.sendBtn.classList.remove('success', 'error');

  try {
    const cap = await captureActiveTab();

    el.sendBtn.textContent = 'Sending to canvas…';

    const resp = await chrome.runtime.sendMessage({
      action: 'uncraft.manual.send',
      webShellOrigin: state.webShellOrigin,
      boardId,
      url: state.tab.url,
      tabId: state.tab.id,
      payload: {
        html: cap.html, title: cap.title, viewport: cap.viewport
      }
    });
    if (!resp?.ok) throw new Error(resp?.error || 'send failed');

    el.sendBtn.textContent = 'Sent ✓';
    el.sendBtn.classList.add('success');
    showStatus('Captured and added to your canvas.');
    el.openCanvasLink.href = `${state.webShellOrigin}/canvas`;
    el.openCanvasLink.hidden = false;
    setTimeout(() => window.close(), 1600);
  } catch (e) {
    el.sendBtn.disabled = false;
    el.sendBtn.textContent = 'Try again';
    el.sendBtn.classList.add('error');
    showStatus(String(e?.message || e), true);
  }
}

async function init() {
  await loadActiveTab();

  if (!isCapturableTab(state.tab)) {
    showStatus("This page can't be captured (browser-internal URL).", true);
    el.boardSelect.disabled = true;
    return;
  }

  // Pending-handoff detection — if the web-shell registered a handoff
  // for this URL (auto-handoff path), surface "Complete pending
  // capture" as the primary action instead of duplicating into a
  // brand-new manual node. Loose URL match handles the
  // `curriculum.com.br → www.curriculum.com.br/pro/` redirect case
  // that confused users when the in-tab banner failed to mount.
  state.pendingHandoff = await findPendingHandoffForUrl(state.tab.url);
  if (state.pendingHandoff) {
    el.pendingHandoff.hidden = false;
  }

  el.boardSelect.innerHTML = '<option>Looking for Uncraft…</option>';
  const disc = await discoverWebShellOrigin();
  state.webShellOrigin = disc.origin;

  if (!disc.origin) {
    el.boardSelect.innerHTML = '<option>Uncraft unreachable</option>';
    showStatus('Could not reach Uncraft (production or localhost). Open the app once, then retry.', true);
    return;
  }
  if (disc.unauthorized) {
    el.boardSelect.innerHTML = '<option>Sign in required</option>';
    el.signinLink.href = `${disc.origin}/login`;
    el.signinLink.hidden = false;
    showStatus('Sign in to Uncraft, then reopen this popup.', true);
    return;
  }

  state.boards = disc.boards;
  populateBoards(disc.boards);
  el.sendBtn.disabled = state.boards.length === 0;
  if (!state.boards.length) {
    showStatus('Create a board in Uncraft first, then come back.', true);
  }
}

el.sendBtn.addEventListener('click', () => send());
el.completePendingBtn.addEventListener('click', () => completePending());
init();
