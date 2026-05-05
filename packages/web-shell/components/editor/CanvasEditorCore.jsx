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
  link.id = 'rb-editor-styles';
  document.head.appendChild(link);
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

    // StrictMode safety: in React dev mode the effect runs mount→cleanup→
    // mount synchronously. Naively tearing down on every cleanup yanks the
    // panels out the moment they appear. Defer the teardown via setTimeout;
    // if a re-mount fires before it runs, cancel the timeout and keep the
    // existing editor in place. The pattern is standard for non-React side
    // effects (subscriptions, animations, manual DOM injection).
    if (window.__uncraftEditorTeardownTimer) {
      clearTimeout(window.__uncraftEditorTeardownTimer);
      window.__uncraftEditorTeardownTimer = null;
      // Already mounted — nothing more to do.
      setStatus('active');
      return () => scheduleTeardown();
    }

    let cancelled = false;
    const targetDoc = iframe.contentDocument;
    const targetWin = iframe.contentWindow;
    const transport = createHttpTransport({ boardId, nodeId: node.id });
    transportRef.current = transport;

    // Globals editor.js IIFE looks up at boot.
    window.__rbHost = { doc: document, win: window };
    window.__rbTarget = { doc: targetDoc, win: targetWin };
    window.__uncraftTransport = transport;
    window.__uncraftMountOptions = { boardId, nodeId: node.id, kind: node.kind };

    // CSS first so the editor renders correctly the moment editor.js builds
    // its panels.
    injectCss('/editor-core/editor.css');

    (async () => {
      try {
        for (const f of SCRIPT_FILES) {
          if (cancelled) return;
          await injectScript('/editor-core/' + f);
        }
        if (!cancelled) setStatus('active');
      } catch (e) {
        console.error('[CanvasEditorCore] bootstrap failed:', e);
        if (!cancelled) {
          setError(e.message || 'bootstrap failed');
          setStatus('error');
        }
      }
    })();

    function actuallyTearDown() {
      // Editor.js installs window.__rbDeactivate which tears down panels,
      // listeners, and editor scaffolding. Best-effort — swallow any throw.
      try {
        if (typeof window.__rbDeactivate === 'function') window.__rbDeactivate();
      } catch (_) {}

      // Remove injected <link> + <script> tags so the next mount starts fresh.
      document.head.querySelectorAll('[data-uncraft-editor]').forEach((el) => el.remove());

      delete window.__rbHost;
      delete window.__rbTarget;
      delete window.__uncraftTransport;
      delete window.__uncraftMountOptions;
      // Force the IIFEs to re-register on the next mount. These guards must
      // be cleared in tandem with the script-tag removal above.
      delete window.__rbExtractor;
      delete window.__rbDetectBuilder;
      delete window.__rbFreeze;
      delete window.__rbUnfreeze;
      delete window.__rbRebuild;
      delete window.__rbPersist;
      delete window.__rbModeE;
      delete window.__rbModeEClassic;
      delete window.__rbModeERefine;
      delete window.__rbModeEDiff;
      delete window.__rbModeB;
      delete window.__rbModeE2;
      delete window.__rbS2H;
      delete window.__rbFillPopup;
      delete window.__rbNormalize;
      delete window.__rbEditorActive;
      delete window.__rbDeactivate;
      delete window.__rbPushUndo;
      window.__uncraftEditorTeardownTimer = null;
      transportRef.current = null;
    }

    function scheduleTeardown() {
      cancelled = true;
      window.__uncraftEditorTeardownTimer = setTimeout(actuallyTearDown, 50);
    }

    return scheduleTeardown;
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
