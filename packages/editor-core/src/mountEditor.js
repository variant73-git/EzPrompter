/**
 * mountEditor — canonical entry point for spinning up Uncraft's editor in any
 * host context. Both extension-shell and web-shell will use this.
 *
 * Phase 3: split host (where panels live) from target (where edited content
 * lives). Extension keeps host === target === document/window. Web canvas
 * passes parent.document as host and iframe.contentDocument as target so the
 * SAME editor.js code drives both products.
 *
 * Stash on `window` so editor.js + mode files can resolve once at IIFE start:
 *   window.__rbHost   = { doc, win }
 *   window.__rbTarget = { doc, win }
 *
 * When omitted, both default to `document`/`window` (extension behaviour).
 *
 * Usage (extension, host === target):
 *   mountEditor({ transport: new ChromeTransport(), options: {...} });
 *
 * Usage (web canvas, host !== target):
 *   mountEditor({
 *     hostDoc:   parent.document,
 *     hostWin:   parent.window,
 *     targetDoc: iframe.contentDocument,
 *     targetWin: iframe.contentWindow,
 *     transport: new HttpTransport(),
 *     options: {...}
 *   });
 */

export function mountEditor({
  hostDoc,
  hostWin,
  targetDoc,
  targetWin,
  // legacy: when callers pass `root` we treat it as both host and target doc
  root,
  transport,
  options = {}
} = {}) {
  if (!transport) throw new Error('mountEditor: transport required (use createNullTransport() for read-only)');

  // Resolve host doc/win — UI panels, keyboard listeners, popups live here.
  var resolvedHostDoc = hostDoc || root || (typeof document !== 'undefined' ? document : null);
  if (!resolvedHostDoc) throw new Error('mountEditor: hostDoc required');
  var resolvedHostWin = hostWin || resolvedHostDoc.defaultView || (typeof window !== 'undefined' ? window : null);

  // Resolve target doc/win — edited content lives here. Defaults to host.
  var resolvedTargetDoc = targetDoc || resolvedHostDoc;
  var resolvedTargetWin = targetWin || resolvedTargetDoc.defaultView || resolvedHostWin;

  // Stash on host window so editor.js IIFE can pick them up.
  // Use host window because that's where editor.js code is loaded as a script.
  if (resolvedHostWin) {
    resolvedHostWin.__rbHost = { doc: resolvedHostDoc, win: resolvedHostWin };
    resolvedHostWin.__rbTarget = { doc: resolvedTargetDoc, win: resolvedTargetWin };
    resolvedHostWin.__uncraftTransport = transport;
    resolvedHostWin.__uncraftMountOptions = options;
  }

  // The host injects editor.js (and supporting files) separately — either via
  // chrome.scripting.executeScript (extension) or by appending <script> tags
  // (web-shell, into the parent document above the iframes).

  return {
    unmount() {
      if (resolvedHostWin) {
        if (resolvedHostWin.__rbDeactivate) {
          try { resolvedHostWin.__rbDeactivate(); } catch (e) { /* swallow */ }
        }
        delete resolvedHostWin.__uncraftTransport;
        delete resolvedHostWin.__uncraftMountOptions;
        delete resolvedHostWin.__rbHost;
        delete resolvedHostWin.__rbTarget;
      }
    }
  };
}

// CJS fallback for ad-hoc requires.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mountEditor };
}
