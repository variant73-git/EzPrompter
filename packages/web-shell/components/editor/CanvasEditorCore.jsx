'use client';

import { useEffect, useRef, useState } from 'react';
import { createHttpTransport } from '../../lib/transport/HttpTransport.js';

/**
 * CanvasEditorCore — wires the real editor-core (~1MB IIFE) into the canvas
 * host. The site being edited lives in `iframe.contentDocument` (target);
 * the editor's panels, popups, and keyboard listeners live in the parent
 * document (host). This is the same code that drives the Chrome extension —
 * it just gets told a different host/target via mountEditor's globals.
 *
 * Boot sequence (host):
 *  1. Set window.__rbHost / window.__rbTarget so editor.js IIFE picks them up.
 *  2. Inject editor.css <link> into host head (chrome.runtime.getURL is N/A
 *     here — the IIFE no-ops if the link can't be made).
 *  3. Inject editor-core scripts in dependency order. The last one
 *     (editor.js) self-bootstraps on load.
 *
 * Teardown:
 *  - call window.__rbDeactivate() (set by editor.js).
 *  - clean up __rbHost / __rbTarget / transport globals.
 *  - remove the injected <link> + <script> tags so a re-entry starts clean.
 *
 * Same-origin assumption: all node iframes are srcDoc + sandbox=
 * "allow-same-origin allow-scripts", so they share the parent's origin and
 * cross-doc DOM access works without postMessage choreography.
 */

// Order matters — matches background.js for the extension.
const SCRIPT_FILES = [
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

function injectScript(src) {
  return new Promise((resolve, reject) => {
    // Reuse if already on the page (e.g., second mount in same session).
    const existing = document.head.querySelector(`script[data-uncraft-editor="${src}"]`);
    if (existing) {
      // Re-injection: remove and let it run fresh so IIFEs that early-return
      // on `if (window.__rb...) return;` get a chance after we've cleared the
      // global on the previous teardown.
      existing.remove();
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = false; // preserve order across multiple appendChilds
    s.dataset.uncraftEditor = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}

function injectCss(href) {
  if (document.head.querySelector(`link[data-uncraft-editor="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.uncraftEditor = href;
  // Use a dedicated id — the editor's `rb-editor-styles` slot is reserved
  // for the saved-state recovery <style> that initAutoSave() legitimately
  // wipes on every boot. Sharing the id made our stylesheet vanish.
  link.id = 'rb-editor-stylesheet';
  document.head.appendChild(link);
}

// Module-scope boot state. Survives StrictMode mount→cleanup→mount cycles
// so the script-loader runs ONCE per (boardId, nodeId) regardless of how
// many times the React effect fires. The closure-scoped aborted flag in
// the original implementation got flipped by every cleanup — including
// StrictMode's synthetic one — leaving the loader stuck mid-flight while
// the re-mount short-circuited assuming bootstrap had finished.
let bootPromise = null;
let bootKey = null;          // `${boardId}:${nodeId}` — invalidates on key change
let bootAborted = false;     // only flipped by teardownEditor (real exit)

// Tear down the editor from the host page. Idempotent — safe to call when
// nothing is mounted.
function teardownEditor() {
  bootAborted = true;
  bootPromise = null;
  bootKey = null;

  try {
    if (typeof window.__rbDeactivate === 'function') window.__rbDeactivate();
  } catch (_) {}

  document.head.querySelectorAll('[data-uncraft-editor]').forEach((el) => el.remove());

  delete window.__rbHost;
  delete window.__rbTarget;
  delete window.__uncraftTransport;
  delete window.__uncraftMountOptions;
  // Clear the IIFE registration globals so the next mount re-runs them.
  // Without this, scripts early-return on `if (window.__rbX) return;`.
  const guards = [
    '__rbExtractor', '__rbDetectBuilder', '__rbFreeze', '__rbUnfreeze',
    '__rbRebuild', '__rbPersist', '__rbModeE', '__rbModeEClassic',
    '__rbModeERefine', '__rbModeEDiff', '__rbModeB', '__rbModeE2',
    '__rbS2H', '__rbFillPopup', '__rbNormalize', '__rbEditorActive',
    '__rbDeactivate', '__rbPushUndo'
  ];
  for (const k of guards) delete window[k];
  window.__uncraftEditorTeardownTimer = null;
}

function scheduleTeardown() {
  // Defer 50ms so a StrictMode mount→cleanup→mount cycle can cancel us.
  if (window.__uncraftEditorTeardownTimer) clearTimeout(window.__uncraftEditorTeardownTimer);
  window.__uncraftEditorTeardownTimer = setTimeout(teardownEditor, 50);
}

// Bootstrap the editor at module scope. Called from useEffect; idempotent
// for the same (boardId, nodeId). Returns a promise that resolves when all
// 14 scripts have loaded. StrictMode re-mount finds the existing pending
// promise and attaches to it instead of restarting.
function bootEditor({ targetDoc, targetWin, transport, boardId, nodeId, kind }) {
  const key = `${boardId}:${nodeId}`;

  if (bootPromise && bootKey === key) {
    return bootPromise;
  }

  // Different node/board than the one currently booted — tear down first.
  // (Rare: typically each node mounts a fresh component.)
  if (bootPromise) teardownEditor();

  bootKey = key;
  bootAborted = false;

  // Globals editor.js IIFE looks up at boot.
  window.__rbHost = { doc: document, win: window };
  window.__rbTarget = { doc: targetDoc, win: targetWin };
  window.__uncraftTransport = transport;
  window.__uncraftMountOptions = { boardId, nodeId, kind };

  // CSS first so the editor renders correctly the moment editor.js builds
  // its panels. Fresh cache-bust per mount — the editor's source files
  // get edited mid-session in dev, and a single page-load timestamp would
  // re-use the stale CSS/JS already in the browser cache. Cost of
  // re-fetching once per editor mount is negligible.
  const cacheBust = String(Date.now());
  // Drop any previously-injected editor stylesheets so the new ?v=...
  // version actually replaces it (browsers de-dupe by full href).
  document.head.querySelectorAll('link[data-uncraft-editor]').forEach((el) => el.remove());
  injectCss('/editor-core/editor.css?v=' + cacheBust);

  bootPromise = (async () => {
    for (const f of SCRIPT_FILES) {
      if (bootAborted) throw new Error('boot aborted');
      await injectScript('/editor-core/' + f + '?v=' + cacheBust);
    }
  })();

  return bootPromise;
}

export default function CanvasEditorCore({ iframe, node, boardId, onExit, onSnapshotSaved }) {
  const [status, setStatus] = useState('booting'); // booting | active | error | exiting
  const [error, setError] = useState(null);
  const transportRef = useRef(null);

  useEffect(() => {
    if (!iframe?.contentDocument || !iframe?.contentWindow) {
      setError('iframe not ready');
      setStatus('error');
      return;
    }

    // Cancel any pending teardown — we're (re)mounting, so the editor
    // should keep running. If this is a StrictMode re-mount, the original
    // mount scheduled a teardown 50ms ago that we're aborting here.
    if (window.__uncraftEditorTeardownTimer) {
      clearTimeout(window.__uncraftEditorTeardownTimer);
      window.__uncraftEditorTeardownTimer = null;
    }

    const transport = createHttpTransport({ boardId, nodeId: node.id });
    transportRef.current = transport;

    let cancelled = false;
    // Large srcDoc snapshots (multi-MB static captures) parse for a while
    // after contentDocument first exists — booting then hands the editor a
    // document with no <body>, rebuild() throws, and the panels come up
    // empty with only the banner built. Wait for parse to finish, and
    // re-read contentDocument at boot time (srcDoc swaps replace the doc).
    const waitForTargetReady = () => new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (cancelled) return reject(new Error('boot aborted'));
        let d = null;
        try { d = iframe.contentDocument; } catch { /* cross-origin mid-swap */ }
        // body.children > 0 matters: srcDoc iframes surface a transient
        // blank document (readyState 'complete', empty body) BEFORE the
        // real parsed document swaps in — booting against it leaves the
        // editor holding a ghost doc while the site loads elsewhere.
        if (d && d.readyState !== 'loading' && d.body && d.body.children.length > 0) return resolve();
        if (Date.now() - started > 30000) return reject(new Error('site content never finished loading'));
        setTimeout(check, 50);
      };
      check();
    });
    waitForTargetReady()
      .then(() => bootEditor({
        targetDoc: iframe.contentDocument,
        targetWin: iframe.contentWindow,
        transport,
        boardId,
        nodeId: node.id,
        kind: node.kind
      }))
      .then(() => { if (!cancelled) setStatus('active'); })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || 'bootstrap failed');
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      scheduleTeardown();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframe, node.id, boardId]);

  if (status === 'error') {
    return (
      <div style={{
        position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
        background: '#dc2626', color: '#fff', padding: '10px 14px',
        borderRadius: 8, fontSize: 13, zIndex: 2147483647,
        fontFamily: 'system-ui'
      }}>
        Editor failed: {error || 'unknown'}
        <button
          onClick={onExit}
          style={{
            marginLeft: 12, background: 'transparent', border: '1px solid currentColor',
            color: '#fff', padding: '2px 8px', borderRadius: 4, cursor: 'pointer'
          }}
        >Close</button>
      </div>
    );
  }
  // editor.js owns the visible UI (banner, panels, popups). We just render
  // a minimal exit hatch when booting so the user can bail out of a stuck
  // bootstrap.
  if (status === 'booting') {
    return (
      <div style={{
        position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '8px 14px',
        borderRadius: 8, fontSize: 12, zIndex: 2147483647,
        fontFamily: 'system-ui'
      }}>
        Loading editor…
      </div>
    );
  }
  return null;
}
