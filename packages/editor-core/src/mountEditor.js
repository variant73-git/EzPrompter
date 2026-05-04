/**
 * mountEditor — canonical entry point for spinning up Uncraft's editor in any
 * host context. Both extension-shell and web-shell will use this.
 *
 * In Phase 1, this is a thin wrapper. It exposes a contract; the existing
 * editor.js IIFE still self-bootstraps when the host injects it via
 * <script>. As we migrate editor-core to be ES-module-aware, mountEditor
 * becomes the only call sites need.
 *
 * Usage (web-shell, inside a node iframe):
 *   import { mountEditor } from '@uncraft/editor-core/src/mountEditor.js';
 *   const handle = mountEditor({ root: document, transport, options: {...} });
 *   // later: handle.unmount();
 */

export function mountEditor({ root = (typeof document !== 'undefined' ? document : null), transport, options = {} } = {}) {
  if (!root) throw new Error('mountEditor: root document required');
  if (!transport) throw new Error('mountEditor: transport required (use createNullTransport() for read-only)');

  // Stash for editor.js + mode files to discover when they boot.
  // editor.js currently resolves deps via window.__rb* globals; this is the
  // designated location for the transport.
  if (typeof window !== 'undefined') {
    window.__uncraftTransport = transport;
    window.__uncraftMountOptions = options;
  }

  // The host injects editor.js (and supporting files) separately — either via
  // chrome.scripting.executeScript (extension) or by appending <script> tags
  // (web-shell, inside the node iframe). This function records the contract;
  // bootstrapping is the host's responsibility until Phase 3 ES-module migration.

  return {
    unmount() {
      if (typeof window !== 'undefined') {
        if (window.__rbDeactivate) {
          try { window.__rbDeactivate(); } catch (e) { /* swallow */ }
        }
        delete window.__uncraftTransport;
        delete window.__uncraftMountOptions;
      }
    }
  };
}

// CJS fallback for ad-hoc requires.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mountEditor };
}
