/**
 * inject-editor.js — load editor-core into a node iframe in the web canvas.
 *
 * Because each iframe uses sandbox="allow-same-origin" and srcDoc-rendered
 * documents inherit the parent origin, we have direct DOM access to the
 * iframe and can inject <link>/<script> tags. The editor self-bootstraps via
 * its existing IIFE pattern (window.__rb* globals).
 *
 * The injected ChromeTransport is a no-op; the editor's chrome.runtime
 * sendMessage paths will fail silently (Mode E etc.). Visual editing —
 * layers, inspector, guides, fill popup, text edit — does not depend on
 * transport and works.
 */

const SCRIPTS = [
  // load order matters; mirrors background.js extension boot order.
  'detect.js',
  'freeze.js',
  'extractor.js',
  'persist.js',
  'mode-e.js',
  'mode-e-classic.js',
  'mode-e-diff.js',
  'mode-e-refine.js',
  'mode-b.js',
  'mode-e2.js',
  's2h.js',
  'rebuild.js',
  'fill-popup.js',
  'editor.js'
];

const BASE_PATH = '/editor-core';

function absUrl(p) {
  // Resolve against the parent window's origin so the captured page's
  // <base href> doesn't redirect editor-core asset loads.
  return `${window.location.origin}${p}`;
}

function loadScript(doc, src) {
  return new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    doc.head.appendChild(s);
  });
}

function loadStylesheet(doc, href) {
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  doc.head.appendChild(link);
}

function shimChrome(iframeWin) {
  // The editor calls chrome.runtime.sendMessage / chrome.storage; in the web
  // canvas we don't have chrome.* APIs. Provide minimal no-op shims so the
  // editor doesn't crash. Real LLM/storage features will be wired through
  // postMessage to the parent in a future iteration.
  if (!iframeWin.chrome) iframeWin.chrome = {};
  const c = iframeWin.chrome;
  if (!c.runtime) {
    c.runtime = {
      sendMessage(msg, cb) {
        if (typeof cb === 'function') cb({ ok: false, error: 'web-canvas: chrome.runtime.sendMessage not wired' });
      },
      onMessage: { addListener() {} },
      lastError: null,
      getURL(p) { return `${BASE_PATH}/${p.replace(/^\/?(editor\/)?/, '')}`; }
    };
  }
  if (!c.storage) {
    const memStore = {};
    const area = {
      get(keys, cb) {
        const out = {};
        const list = Array.isArray(keys) ? keys : (keys && typeof keys === 'object') ? Object.keys(keys) : [keys];
        for (const k of list) out[k] = memStore[k];
        cb && cb(out);
        return Promise.resolve(out);
      },
      set(items, cb) {
        Object.assign(memStore, items);
        cb && cb();
        return Promise.resolve();
      },
      remove(keys, cb) {
        for (const k of [].concat(keys)) delete memStore[k];
        cb && cb();
        return Promise.resolve();
      }
    };
    c.storage = { sync: area, local: area };
  }
  if (!c.tabs) {
    c.tabs = { query() { return Promise.resolve([]); }, captureVisibleTab() { return Promise.resolve(null); } };
  }
  if (!c.scripting) {
    c.scripting = { executeScript() { return Promise.resolve([]); }, insertCSS() { return Promise.resolve(); } };
  }
}

export async function injectEditor(iframe) {
  if (!iframe) throw new Error('iframe not ready');
  let doc, win;
  try { doc = iframe.contentDocument; win = iframe.contentWindow; }
  catch (e) { throw new Error('iframe is cross-origin, cannot inject editor'); }
  if (!doc || !win) throw new Error('iframe not ready');

  try {
    if (win.__uncraftEditorInjected) return;
    win.__uncraftEditorInjected = true;
  } catch (e) {
    throw new Error('iframe became cross-origin, cannot inject editor');
  }

  shimChrome(win);

  loadStylesheet(doc, absUrl(`${BASE_PATH}/editor.css`));
  for (const file of SCRIPTS) {
    try {
      await loadScript(doc, absUrl(`${BASE_PATH}/${file}`));
    } catch (e) {
      console.warn('inject-editor:', e.message);
    }
  }
}

export function detachEditor(iframe) {
  if (!iframe) return;
  let win = null;
  try { win = iframe.contentWindow; } catch (e) { return; }
  if (!win) return;
  try { win.__rbDeactivate && win.__rbDeactivate(); } catch (e) { /* swallow */ }
  try { win.__uncraftEditorInjected = false; } catch (e) { /* cross-origin frame, nothing to clean */ }
}
