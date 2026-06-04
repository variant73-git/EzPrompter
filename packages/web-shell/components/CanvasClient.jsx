'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { nodeOrigin, originColor } from '../lib/node-origin.js';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { api } from '../lib/canvas-api.js';
import CanvasNode from './CanvasNode.jsx';
import EdgeLayer, { DraftEdgeLayer } from './EdgeLayer.jsx';
import ZoomControls from './ZoomControls.jsx';
import UserPill from './UserPill.jsx';
import { normalizeUrl, looksLikeUrl } from '../lib/url.js';
// EdgePopup removed — the per-edge config widget was the legacy "manual mode".
// Edges are now selected by click and deleted with the keyboard.
import PromptDock from './PromptDock.jsx';
import CategoryCounts from './CategoryCounts.jsx';
import Minimap from './Minimap.jsx';
import ChallengeModal from './ChallengeModal.jsx';
import { ToastRoot, toast } from './Toast.jsx';

// Inline SVGs for the canvas + context menus. Phosphor-style strokes,
// 1.6px weight, currentColor — matches the rest of the editor chrome.
const MenuIcon = {
  Url: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>
      <path d="M12 3a13 13 0 0 1 4 9 13 13 0 0 1-4 9 13 13 0 0 1-4-9 13 13 0 0 1 4-9z"/>
    </svg>
  ),
  Html: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>
      <path d="M14 3v5h5"/><path d="m9 14-1.5 2L9 18"/><path d="m13.5 14 1.5 2-1.5 2"/>
    </svg>
  ),
  Md: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10 1.66 0 3-1.34 3-3 0-.78-.29-1.49-.78-2.04-.17-.19-.32-.41-.32-.66 0-.55.45-1 1-1H17c2.76 0 5-2.24 5-5 0-4.98-4.48-9-10-9z"/>
      <circle cx="6.5"  cy="11.5" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="9.5"  cy="7.5"  r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="14.5" cy="7.5"  r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="17.5" cy="11.5" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  ),
  Image: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <circle cx="9" cy="10.5" r="1.5"/><path d="m21 16-5-5L5 19"/>
    </svg>
  ),
  Prompt: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <path d="M8 10h8M8 13h5"/>
    </svg>
  ),
  Code: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 8-5 4 5 4"/><path d="m15 8 5 4-5 4"/><path d="m13 4-2 16"/>
    </svg>
  ),
  Skill: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3 2.5 5 5.5.8-4 3.9.95 5.5L12 15.6 7.05 18.2 8 12.7 4 8.8 9.5 8z"/>
    </svg>
  ),
  Blank: () => (
    // Dashed-corner page reads as "empty canvas to compose into" rather
    // than a captured/imported document. Mirrors the icon in PromptDock's
    // "+" menu so the two entry points feel like the same action.
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" strokeDasharray="3 2.5"/>
      <path d="M9 10h6M9 14h4" opacity="0.55"/>
    </svg>
  )
};

const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 6000;

// Empty scaffold for the "Add blank website" flow. Renders as a calm
// near-white page with a dashed-frame hint so the empty state reads as
// intentional ("compose here") rather than a broken capture. Designed
// to work inside our srcDoc iframe — no external resources, no scripts,
// system font fallback (Aeonik isn't loaded inside iframes).
const BLANK_SITE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blank website</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; min-height: 100vh; background: #fafafa; }
  body {
    display: flex; align-items: center; justify-content: center;
    color: #64748b;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    font-size: 14px; letter-spacing: -0.005em;
  }
  .hint {
    text-align: center; padding: 28px;
    max-width: 320px;
  }
  .hint-icon {
    width: 56px; height: 56px; margin: 0 auto 18px;
    border: 1.5px dashed rgba(45, 212, 191, 0.55);
    border-radius: 14px;
    display: inline-flex; align-items: center; justify-content: center;
    color: rgba(45, 212, 191, 0.85);
    background: rgba(45, 212, 191, 0.06);
  }
  .hint-title {
    font-size: 14px; color: #334155; font-weight: 500;
    margin: 0 0 6px;
  }
  .hint-sub {
    font-size: 12.5px; color: #94a3b8; line-height: 1.5; margin: 0;
  }
</style>
</head>
<body>
<div class="hint" role="status">
  <div class="hint-icon" aria-hidden="true">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M9 9h6M9 13h6M9 17h4"/>
    </svg>
  </div>
  <p class="hint-title">Blank website</p>
  <p class="hint-sub">Connect inputs from other nodes or build from the asset library.</p>
</div>
</body>
</html>`;

export default function CanvasClient({ board, initialNodes, initialEdges, user }) {
  const [nodes, setNodes] = useState(initialNodes || []);
  const [edges, setEdges] = useState(initialEdges || []);
  const [boardName, setBoardName] = useState(board.name || 'Untitled');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [draftEdge, setDraftEdge] = useState(null);  // {sourceNodeId, mouseX, mouseY}
  const [popupPos, setPopupPos] = useState(null);
  const [emptyDropMenu, setEmptyDropMenu] = useState(null);  // {sourceNodeId, x, y, worldX, worldY}
  const [contextMenu, setContextMenu] = useState(null);  // {x, y, worldX, worldY} — right-click on empty canvas
  const [editingNodeId, setEditingNodeId] = useState(null);
  const [canvasScale, setCanvasScale] = useState(0.6);
  const [lightMode, setLightMode] = useState(false);
  // Bot-protection interstitial state. When captureSnapshot returns 409
  // challenge_required, we stash {kind, url, signals, placeholderId} here
  // so <ChallengeModal /> mounts. placeholderId lets the modal's cancel /
  // open-site handlers clean up the temp node from the canvas.
  const [challenge, setChallenge] = useState(null);
  const transformRef = useRef(null);

  // Light/dark theme — toggling sets `body.rb-ed-light` so the editor
  // (when active) inherits the same setting. Persisted under the SAME
  // localStorage key the editor uses (`rb-ed-theme`) so editor + canvas
  // stay in sync — without this, the editor's boot-time applyTheme()
  // overrides whatever the canvas just set.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('rb-ed-theme') === 'light';
    if (saved) {
      setLightMode(true);
      document.body.classList.add('rb-ed-light');
    }
  }, []);

  // Dedup duplicate edges on mount. Each (source, target) pair should
  // have at most one edge — earlier UX permitted creating many. The
  // first one in iteration order wins; the rest are deleted on the
  // server and removed from local state. Idempotent: with no dups this
  // is a no-op.
  const dedupRanRef = useRef(false);
  useEffect(() => {
    if (dedupRanRef.current) return;
    if (!edges.length) return;
    dedupRanRef.current = true;
    const seen = new Set();
    const dups = [];
    for (const e of edges) {
      const key = `${e.source_node_id}::${e.target_node_id}`;
      if (seen.has(key)) dups.push(e.id);
      else seen.add(key);
    }
    if (dups.length === 0) return;
    setEdges((prev) => prev.filter((e) => !dups.includes(e.id)));
    for (const id of dups) {
      api.deleteEdge(id).catch(console.warn);
    }
  }, [edges]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('rb-ed-light', lightMode);
    try { localStorage.setItem('rb-ed-theme', lightMode ? 'light' : 'dark'); } catch (e) {}
  }, [lightMode]);

  // Expose a tiny zoom API so the in-editor inspector header can drive
  // the canvas TransformWrapper without React-bridging. Editor-core is
  // vanilla JS and lives inside the host doc — it picks this up off
  // window.__uncraftZoom on demand.
  useEffect(() => {
    const ZOOM_STEP = 1.2, MIN = 0.1, MAX = 2.5;
    // Snapshot the previously-stored edit frame so we can restore it
    // after replacing the __uncraftZoom object (this effect re-runs on
    // every canvas-scale tick, otherwise the frame would be wiped).
    const prevEditFrame = window.__uncraftZoom?._editFrame;
    function setAbs(target) {
      const t = transformRef.current;
      if (!t) return;
      const inst = t.instance || t;
      const wrapper = inst?.wrapperComponent;
      if (!wrapper) { t.setTransform?.(0, 0, target, 200); return; }
      const rect = wrapper.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const state = inst.transformState || t.state || { positionX: 0, positionY: 0, scale: 1 };
      const wx = (cx - state.positionX) / state.scale;
      const wy = (cy - state.positionY) / state.scale;
      t.setTransform(cx - wx * target, cy - wy * target, target, 200);
    }
    window.__uncraftZoom = {
      getScale: () => {
        const t = transformRef.current;
        const inst = t?.instance || t;
        return inst?.transformState?.scale || canvasScale || 1;
      },
      setScale: (s) => setAbs(Math.max(MIN, Math.min(MAX, s))),
      zoomIn: () => {
        const cur = window.__uncraftZoom.getScale();
        setAbs(Math.min(MAX, cur * ZOOM_STEP));
      },
      zoomOut: () => {
        const cur = window.__uncraftZoom.getScale();
        setAbs(Math.max(MIN, cur / ZOOM_STEP));
      },
      // Translate the canvas by screen-space deltas. Used by per-node wheel
      // handlers (CanvasNode) to scroll the canvas when the cursor is inside
      // an iframe — TransformWrapper otherwise ignores wheel inside the
      // node iframe (it's in `wheel.excluded`).
      panBy: (dx, dy) => {
        const t = transformRef.current;
        if (!t) return;
        const inst = t.instance || t;
        const state = inst?.transformState || t.state || { positionX: 0, positionY: 0, scale: 1 };
        t.setTransform(state.positionX + dx, state.positionY + dy, state.scale, 0);
      },
      // Cursor-anchored zoom: scale around (cx, cy) in host viewport coords
      // so the world point under the cursor stays fixed. Used by canvas-level
      // wheel handler and by edit-mode iframe-doc wheel handler (which
      // translates iframe-local coords to host coords before calling).
      zoomAtPoint: (deltaY, cx, cy) => {
        if (!deltaY) return;
        const t = transformRef.current;
        if (!t) return;
        const inst = t.instance || t;
        const state = inst?.transformState || t.state || { positionX: 0, positionY: 0, scale: 1 };
        const factor = Math.exp(-deltaY * 0.0015);
        const newScale = Math.max(MIN, Math.min(MAX, state.scale * factor));
        if (newScale === state.scale) return;
        const ratio = newScale / state.scale;
        const newPosX = cx - (cx - state.positionX) * ratio;
        const newPosY = cy - (cy - state.positionY) * ratio;
        t.setTransform(newPosX, newPosY, newScale, 0);
      },
      // Snapshot the canvas position+scale. Used by the editor to remember
      // the entry framing so a "frame back" button can restore it.
      getState: () => {
        const t = transformRef.current;
        const inst = t?.instance || t;
        const s = inst?.transformState || t?.state;
        if (!s) return { positionX: 0, positionY: 0, scale: 1 };
        return { positionX: s.positionX || 0, positionY: s.positionY || 0, scale: s.scale || 1 };
      },
      setState: (state, animMs = 250) => {
        if (!state) return;
        const t = transformRef.current;
        if (!t?.setTransform) return;
        t.setTransform(state.positionX || 0, state.positionY || 0, state.scale || 1, animMs);
      },
      // Compute the edit-mode frame (width-fit) for a given node ID.
      // Returns null if the node doesn't exist yet (e.g. between
      // setEditingNodeId and the iframe mount). Used by the editor's
      // frame-back button to decide enabled state and where to animate.
      getNodeFrame: (nodeId) => {
        const node = nodes.find((n) => n.id === nodeId);
        return node ? computeEditFrame(node) : null;
      },
      // Animate the canvas back to a node's edit-mode frame. The editor's
      // frame-back button calls this on click — no _editFrame stamping
      // race, since we look up the node by id at call time.
      frameNode: (nodeId, animMs = 280) => {
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const f = computeEditFrame(node);
        const t = transformRef.current;
        if (!t?.setTransform) return;
        t.setTransform(f.positionX, f.positionY, f.scale, animMs);
      },
      fit: () => fitToContent()
    };
    // CRITICAL: this effect re-runs every time `canvasScale` or `nodes`
    // change (which is constantly — every pan/zoom updates canvasScale).
    // Without preserving _editFrame across re-runs the frame-back button
    // observes a fresh object and stays disabled forever.
    if (prevEditFrame !== undefined) window.__uncraftZoom._editFrame = prevEditFrame;
    return () => { try { delete window.__uncraftZoom; } catch (e) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasScale, nodes]);

  const fileInputRef = useRef(null);
  const fileInputAcceptRef = useRef('');
  const fileInputResolverRef = useRef(null);

  const updateNodeLocal = useCallback((id, patch) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const dragNodeServer = useRef(new Map());
  function persistNodePosition(id, posX, posY) {
    clearTimeout(dragNodeServer.current.get(id));
    const t = setTimeout(() => api.updateNode(id, { posX, posY }).catch(console.warn), 250);
    dragNodeServer.current.set(id, t);
  }

  function nextNodePosition(opts = {}) {
    const newW = opts.width || 1280;
    const newH = opts.height || 800;
    const GAP = 80;

    // Find a non-overlapping (x, y) starting from a desired anchor. Walks
    // right first (raster), drops a row when no x fits, eventually returns
    // the desired anchor verbatim if 2k iterations didn't find space (unrealistic).
    function settle(desiredX, desiredY) {
      function overlaps(testX, testY) {
        return nodes.some((n) => {
          if (n._loading && !n.width) return false;
          const nx = n.pos_x, ny = n.pos_y;
          const nw = n.width || 1280, nh = n.height || 800;
          return !(testX + newW + GAP <= nx ||
                   nx + nw + GAP <= testX ||
                   testY + newH + GAP <= ny ||
                   ny + nh + GAP <= testY);
        });
      }
      let x = desiredX, y = desiredY;
      const STEP_X = 240;
      const STEP_Y = 240;
      for (let i = 0; i < 2000; i++) {
        if (!overlaps(x, y)) return { x, y };
        x += STEP_X;
        if (x - desiredX > 6000) { x = desiredX; y += STEP_Y; }
      }
      return { x: desiredX, y: desiredY };
    }

    // Caller-supplied world coords (right-click context, edge drop) — honour
    // the anchor but slide off any collision.
    if (opts.worldX != null && opts.worldY != null) {
      const s = settle(opts.worldX, opts.worldY);
      return { posX: s.x, posY: s.y };
    }

    // For new URL nodes, sit immediately to the LEFT of the leftmost
    // existing URL node (if any) so the canvas reads as a left-growing
    // column of captures. Falls back to a cascade when there's none.
    if (opts.placeLeftOfUrlNodes) {
      const urlNodes = nodes.filter((n) => n.kind === 'site' && n.origin_url);
      if (urlNodes.length > 0) {
        const leftmost = urlNodes.reduce((acc, n) => (n.pos_x < acc.pos_x ? n : acc), urlNodes[0]);
        const desiredX = leftmost.pos_x - newW - GAP;
        const desiredY = leftmost.pos_y;
        const s = settle(desiredX, desiredY);
        return { posX: s.x, posY: s.y };
      }
    }
    const offset = nodes.length * 40;
    const s = settle(200 + offset, 200 + offset);
    return { posX: s.x, posY: s.y };
  }

  async function autoLinkNewNode(sourceNodeId, newNodeId) {
    if (!sourceNodeId || !newNodeId) return;
    try {
      const { edge } = await api.createEdge({
        boardId: board.id, sourceNodeId, targetNodeId: newNodeId,
        kind: 'transplant', payload: { sourceSelector: 'body', targetSelector: 'body' }
      });
      setEdges((prev) => [...prev, edge]);
    } catch (e) { console.warn('auto-link failed', e); }
  }

  // Poll a handoff-pending node for the snapshot the extension will
  // POST to /api/snapshot/handoff. Stops when the snapshot lands or
  // after ~10 minutes (token TTL is 5 min; we give the user some
  // extra slack to actually click the banner). Polling registry on
  // the ref prevents duplicate intervals if the user retries.
  const handoffPollersRef = useRef(new Map());
  function startHandoffPolling(nodeId) {
    if (!nodeId) return;
    const existing = handoffPollersRef.current.get(nodeId);
    if (existing) return; // already polling
    const startedAt = Date.now();
    const intervalMs = 3000;
    const giveUpAfterMs = 10 * 60 * 1000;
    const tick = async () => {
      try {
        const { node, snapshot } = await api.getNode(nodeId);
        if (snapshot?.html) {
          // Handoff landed — render it.
          setNodes((prev) => prev.map((n) =>
            n.id === nodeId ? {
              ...n,
              ...node,
              current_html: snapshot.html,
              current_screenshot: snapshot.screenshot_url || null,
              _loading: false, _loadingLabel: undefined,
              _challenge: false, _handoffPending: false
            } : n
          ));
          stopHandoffPolling(nodeId);
          return;
        }
      } catch (e) {
        // 404 → node was deleted; abandon the poller. Other errors
        // are transient (network blip, dev-server restart) — keep
        // trying until the timeout.
        if (/404|not_found/i.test(String(e?.message || ''))) {
          stopHandoffPolling(nodeId);
          return;
        }
      }
      if (Date.now() - startedAt > giveUpAfterMs) {
        stopHandoffPolling(nodeId);
        // Surface a soft failure in the placeholder so the user knows
        // the wait timed out — they can delete the node manually.
        setNodes((prev) => prev.map((n) =>
          n.id === nodeId ? {
            ...n, _loadingLabel: 'Verification timed out',
            _handoffPending: false
          } : n
        ));
      }
    };
    const handle = setInterval(tick, intervalMs);
    handoffPollersRef.current.set(nodeId, handle);
    // First tick immediately so we don't wait 3s before checking.
    tick();
  }
  function stopHandoffPolling(nodeId) {
    const h = handoffPollersRef.current.get(nodeId);
    if (h) {
      clearInterval(h);
      handoffPollersRef.current.delete(nodeId);
    }
  }
  // Cleanup on unmount — without this, intervals keep firing during
  // dev-server HMR and pollute the network tab forever.
  useEffect(() => {
    const map = handoffPollersRef.current;
    return () => {
      for (const h of map.values()) clearInterval(h);
      map.clear();
    };
  }, []);

  async function handleAddUrl(url, opts = {}) {
    const id = `temp-${Date.now()}`;
    // Hero-section proportion (16:9). The body is a fixed viewport into a
    // potentially much taller iframe; the user expands via dash handles or
    // the Expand button.
    const width = 1280, height = Math.round(width * 9 / 16);
    const { posX, posY } = nextNodePosition({ ...opts, placeLeftOfUrlNodes: true, width });
    const placeholderNode = {
      id, kind: 'site', origin_url: url,
      pos_x: posX, pos_y: posY, width, height,
      is_main: nodes.length === 0,
      current_html: null, _loading: true
    };
    setNodes((prev) => [...prev, placeholderNode]);

    try {
      // Stream progress so the placeholder shows stage labels (especially
      // useful for the reconstruction path which can take 2-3 minutes).
      const STAGE_LABEL = {
        launching:    'Launching browser…',
        navigating:   'Navigating to site…',
        capturing:    'Capturing scroll-stops…',
        thumbnailing: 'Rendering thumbnails…',
        thinking:     'Reconstructing layout…',
        finalizing:   'Finalizing…'
      };
      // Pass placement so the server can pre-create a persistent placeholder
      // node + mint a handoff token if Cloudflare/captcha challenges the
      // capture. That node sticks in DB even if the user closes the tab,
      // and the extension's POST /api/snapshot/handoff fills it in later.
      const placement = {
        boardId: board.id, posX, posY, width, height,
        isMain: nodes.length === 0
      };
      const cap = await api.captureUrlStream(url, null, (step) => {
        setNodes((prev) => prev.map((n) =>
          n.id === id ? { ...n, _loadingLabel: STAGE_LABEL[step] || step } : n
        ));
      }, placement);
      const created = await api.createNode({
        boardId: board.id, kind: 'site', originUrl: url,
        posX, posY, width, height,
        isMain: nodes.length === 0,
        html: cap.html
      });
      const finalNode = {
        ...created.node,
        current_html: cap.html,
        current_screenshot: cap.screenshotDataUrl,
        _loading: false
      };
      setNodes((prev) => prev.map((n) => (n.id === id ? finalNode : n)));
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      // Frame the new node at 100% so it's the immediate focus.
      setTimeout(() => zoomToNode(finalNode, 350, 1), 80);
    } catch (e) {
      // Bot-protection interstitial — captureUrlStream tags the thrown
      // error with `.challenge` and (when placement was passed) the
      // server has already pre-created a persistent node + minted a
      // handoff token. Swap the in-memory temp placeholder for the
      // real server node and start the polling loop that waits for
      // the extension to ship the verified DOM back via
      // POST /api/snapshot/handoff.
      if (e?.challenge) {
        const ch = e.challenge;
        const persistedNode = ch.node;
        if (persistedNode) {
          setNodes((prev) => prev.map((n) =>
            n.id === id ? {
              ...persistedNode,
              current_html: null,
              _loading: true,
              _loadingLabel: 'Waiting for verification…',
              _challenge: true,
              _handoffPending: true
            } : n
          ));
          startHandoffPolling(persistedNode.id);
          setChallenge({ ...ch, placeholderId: persistedNode.id });
        } else {
          // Fallback for the no-placement path (route returned
          // challenge without pre-creating). UX is the same as before:
          // placeholder waits, cancel/open-site clears it.
          setNodes((prev) => prev.map((n) =>
            n.id === id ? { ...n, _loadingLabel: 'Waiting for verification…', _challenge: true } : n
          ));
          setChallenge({ ...ch, placeholderId: id });
        }
        return;
      }
      console.error(e);
      setNodes((prev) => prev.filter((n) => n.id !== id));
      toast.error(e.message || 'Could not add this URL.');
    }
  }

  async function handleUploadHtml(file, opts = {}) {
    const html = await file.text();
    if (!/^<!doctype|<html/i.test(html.trim())) {
      toast.error('File does not look like a complete HTML document.');
      return;
    }
    const { posX, posY } = nextNodePosition(opts);
    try {
      const created = await api.createNode({
        boardId: board.id, kind: 'site',
        posX, posY, width: 1280, height: Math.round(1280 * 9 / 16),
        meta: { name: file.name, source: 'upload' },
        html
      });
      setNodes((prev) => [...prev, { ...created.node, current_html: html }]);
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
    } catch (e) { toast.error(`Upload failed: ${e.message}`); }
  }

  // Empty composition target — designer assembles content from incoming
  // edges (brainstorm mode pulls design.md from one source + .html from
  // another) and the asset library when that lands. The iframe shows a
  // dashed-frame hint so the empty state reads as intentional rather than
  // a broken capture. kind='site' + meta.source='blank' triggers the
  // teal "origin-blank" border via nodeOrigin().
  async function handleAddBlankSite(opts = {}) {
    const width = 1280;
    const height = Math.round(width * 9 / 16);
    const { posX, posY } = nextNodePosition({ ...opts, width });
    try {
      const created = await api.createNode({
        boardId: board.id, kind: 'site',
        posX, posY, width, height,
        isMain: nodes.length === 0,
        meta: { source: 'blank', name: 'Blank website' },
        html: BLANK_SITE_HTML
      });
      const finalNode = { ...created.node, current_html: BLANK_SITE_HTML };
      setNodes((prev) => [...prev, finalNode]);
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      setTimeout(() => zoomToNode(finalNode, 350, 1), 80);
    } catch (e) { toast.error(`Could not add blank website: ${e.message}`); }
  }

  async function handleUploadMd(file, opts = {}) {
    const text = await file.text();
    // Square node — the new MdPreviewBody renders a typography sample,
    // colour palette + lorem-ipsum stack inside a 1:1 frame.
    const width = 600, height = 600;
    const { posX, posY } = nextNodePosition({ ...opts, width, height });
    try {
      const created = await api.createNode({
        boardId: board.id, kind: 'designmd',
        posX, posY, width, height,
        meta: { name: file.name },
        designMd: text
      });
      setNodes((prev) => [...prev, { ...created.node, current_design_md: text }]);
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
    } catch (e) { toast.error(`Upload failed: ${e.message}`); }
  }

  async function handleUploadScreenshot(file, opts = {}) {
    // Read file as data URL — small enough images (a few MB) live in the
    // node meta directly. For larger / production use we'd upload to a
    // CDN, but for the canvas this keeps the node self-contained.
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('read failed'));
      fr.readAsDataURL(file);
    }).catch((e) => { toast.error(`Could not read image: ${e.message}`); return null; });
    if (!dataUrl) return;

    // Square frame by default; user can resize via the dash handles.
    const width = 600, height = 600;
    const { posX, posY } = nextNodePosition({ ...opts, width, height });
    try {
      const created = await api.createNode({
        boardId: board.id,
        kind: 'asset',
        posX, posY, width, height,
        meta: { name: file.name, dataUrl, mimeType: file.type || 'image/*' }
      });
      setNodes((prev) => [...prev, { ...created.node }]);
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
    } catch (e) { toast.error(`Upload failed: ${e.message}`); }
  }

  // Drag-from-asset drop (Slice B). Editor.js writes a JSON descriptor
  // into dataTransfer when a thumb in the layers Assets tab is dragged.
  // We translate the drop's client coords to canvas space and spawn an
  // 'asset' node centered on the cursor.
  async function handleAssetDrop(e) {
    const raw = (() => {
      try { return e.dataTransfer.getData('application/x-uncraft-asset'); } catch { return ''; }
    })();
    if (!raw) return;
    e.preventDefault();
    let asset;
    try { asset = JSON.parse(raw); } catch { return; }

    // Resolve a usable image source. The 'asset' node kind renders
    // <img src={meta.dataUrl}> so we need a fetchable URL or data URI.
    let imageSrc = null;
    const t = asset.type;
    if (t === 'image' || t === 'background-image' || t === 'video') {
      imageSrc = asset.thumb_url || asset.blob_url || asset.source_url;
    } else if (t === 'svg' || t === 'icon') {
      if (asset.source_url && asset.source_url.startsWith('data:')) {
        imageSrc = asset.source_url;
      } else if (asset.html) {
        try {
          imageSrc = 'data:image/svg+xml;base64,' +
            btoa(unescape(encodeURIComponent(asset.html)));
        } catch (err) { imageSrc = asset.source_url || asset.thumb_url; }
      } else {
        imageSrc = asset.source_url || asset.thumb_url;
      }
    }
    if (!imageSrc) {
      toast.error(`Drag for ${t} assets isn't supported yet.`);
      return;
    }

    // Inline as data URL so the node survives hotlink protection / strict
    // CORS on the original host (e.g. CDN-served images that refuse
    // cross-origin GETs without the original site's Referer). Falls back
    // to the URL when fetch can't read the body (no CORS headers, 403,
    // etc.) — the node still exists, the user just sees the broken-image
    // glyph and can replace the URL later.
    imageSrc = await tryInlineAsDataUrl(imageSrc);

    const w = clientToWorld(transformRef, e.clientX, e.clientY);
    const width = 600, height = 600;
    const posX = w.x - width / 2;
    const posY = w.y - height / 2;
    try {
      const created = await api.createNode({
        boardId: board.id,
        kind: 'asset',
        posX, posY, width, height,
        meta: { name: asset.name || 'asset', dataUrl: imageSrc, mimeType: 'image/*' }
      });
      setNodes((prev) => [...prev, { ...created.node }]);
    } catch (err) {
      toast.error(`Drop failed: ${err.message}`);
    }
  }

  // Two-tier inline: direct browser fetch first (CORS-friendly hosts —
  // fast, no server hop), then server-side proxy (handles hotlink
  // protection / strict CORS by synthesizing a same-origin Referer).
  // Falls back to the original URL when both fail — the node still
  // exists; the broken-image placeholder handler kicks in at render
  // time.
  async function tryInlineAsDataUrl(url) {
    if (!url || url.startsWith('data:')) return url;
    // Tier 1 — direct fetch with credentials omitted.
    try {
      const r = await fetch(url, { credentials: 'omit', mode: 'cors' });
      if (r.ok) {
        const blob = await r.blob();
        if (blob.size > 0) return await blobToDataUrl(blob);
      }
    } catch {}
    // Tier 2 — server-side proxy at /api/proxy/image (auth required).
    try {
      const r = await fetch('/api/proxy/image?url=' + encodeURIComponent(url), { credentials: 'include' });
      if (r.ok) {
        const blob = await r.blob();
        if (blob.size > 0) return await blobToDataUrl(blob);
      }
    } catch {}
    return url;
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function handleAddPrompt(opts = {}) {
    // 3:1 text-field node. Width chosen so it stays comfortable at 1× zoom.
    const width = 600, height = 200;
    const { posX, posY } = nextNodePosition({ ...opts, width, height });
    try {
      const created = await api.createNode({
        boardId: board.id, kind: 'prompt',
        posX, posY, width, height,
        meta: { name: 'prompt', prompt: '' }
      });
      setNodes((prev) => [...prev, { ...created.node }]);
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      setSelectedNodeId(created.node.id);
    } catch (e) { toast.error(`Could not add prompt: ${e.message}`); }
  }

  async function handleAddSkill(opts = {}) {
    // Skill is a small, square card with a file glyph + name. Default
    // dimensions read as a "tile" rather than a document.
    const width = 240, height = 280;
    const { posX, posY } = nextNodePosition({ ...opts, width, height });
    try {
      const created = await api.createNode({
        boardId: board.id, kind: 'skill',
        posX, posY, width, height,
        meta: { name: 'skill' }
      });
      setNodes((prev) => [...prev, { ...created.node }]);
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
    } catch (e) { toast.error(`Could not add skill: ${e.message}`); }
  }

  async function handlePromptTextChange(id, value) {
    setNodes((prev) => prev.map((n) =>
      n.id === id ? { ...n, meta: { ...(n.meta || {}), prompt: value } } : n
    ));
    if (String(id).startsWith('temp-')) return;
    try {
      const node = nodes.find((n) => n.id === id);
      const meta = { ...(node?.meta || {}), prompt: value };
      await api.updateNode(id, { meta });
    } catch (e) { console.warn('prompt persist failed', e); }
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      fileInputAcceptRef.current = accept;
      fileInputResolverRef.current = resolve;
      if (fileInputRef.current) {
        fileInputRef.current.accept = accept;
        fileInputRef.current.value = '';
        fileInputRef.current.click();
      }
    });
  }

  function onFileInputChange(e) {
    const file = e.target.files?.[0];
    const r = fileInputResolverRef.current;
    fileInputResolverRef.current = null;
    if (r) r(file || null);
  }

  async function handleDeleteNode(id) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source_node_id !== id && e.target_node_id !== id));
    if (id.startsWith?.('temp-')) return;
    await api.deleteNode(id).catch(console.warn);
  }

  async function handleResetNode(id) {
    if (String(id).startsWith('temp-')) return;
    try {
      const { html, snapshot_id } = await api.resetNode(id);
      // Force a fresh srcDoc by toggling _resetTick so React remounts the iframe.
      setNodes((prev) => prev.map((n) =>
        n.id === id
          ? { ...n, current_html: html, current_snapshot_id: snapshot_id || n.original_snapshot_id, _resetTick: (n._resetTick || 0) + 1 }
          : n
      ));
    } catch (e) {
      toast.error(`Reset failed: ${e.message}`);
    }
  }

  // Persist an in-editor edit as a new snapshot. After this fires, the node's
  // current_snapshot_id diverges from original_snapshot_id, which is what
  // unlocks the topbar Reset button (gated on `hasEdits`).
  async function handleSaveNodeEdit(id, html) {
    if (!html) return null;
    if (String(id).startsWith('temp-')) {
      // Temp nodes only live in local state; just persist the html locally.
      setNodes((prev) => prev.map((n) => n.id === id ? { ...n, current_html: html } : n));
      return null;
    }
    const { snapshotId } = await api.saveNodeEdit(id, html);
    setNodes((prev) => prev.map((n) =>
      n.id === id
        ? { ...n, current_html: html, current_snapshot_id: snapshotId }
        : n
    ));
    return snapshotId;
  }

  // Run flow — walk the graph, find every target with incoming edges,
  // call /api/nodes/[id]/run on each in parallel. The arrow button on
  // PromptDock fires this. Each target gets ONE LLM call that
  // composes all its incoming sources (html / md / prompt) per the
  // smart-compose preset matrix in lib/run-flow.js.
  const [runFlowBusy, setRunFlowBusy] = useState(false);
  const [runFlowError, setRunFlowError] = useState(null);
  // Per-target running status: id → { step: 1|2|3, label }. Drives a
  // small status chip below each running node so the user can see the
  // flow advancing instead of staring at a frozen UI for ~minute-long
  // LLM calls. Steps are advanced on a timer because the LLM call is
  // one opaque async block — the labels reflect what the engine is
  // CONCEPTUALLY doing, not what's literally observable.
  const [runStatus, setRunStatus] = useState(new Map());
  function setNodeRunStatus(id, status) {
    setRunStatus((prev) => {
      const next = new Map(prev);
      if (status === null) next.delete(id);
      else next.set(id, status);
      return next;
    });
  }
  async function runOneTarget(id, opts = {}) {
    setNodeRunStatus(id, { step: 1, label: 'Reading inputs…' });
    const advanceToStep2 = setTimeout(() => {
      setRunStatus((prev) => {
        const cur = prev.get(id);
        if (!cur || cur.step !== 1) return prev;
        const next = new Map(prev);
        next.set(id, { step: 2, label: 'Generating…' });
        return next;
      });
    }, 1500);
    try {
      const result = await api.runNode(id, opts);
      clearTimeout(advanceToStep2);
      setNodeRunStatus(id, { step: 3, label: 'Saving…' });
      // Hold the saving label briefly so the transition reads as a
      // resolved step rather than a flash.
      await new Promise((r) => setTimeout(r, 700));
      setNodeRunStatus(id, null);
      return result;
    } catch (e) {
      clearTimeout(advanceToStep2);
      setNodeRunStatus(id, null);
      throw e;
    }
  }
  async function handleRunFlow(opts = {}) {
    if (runFlowBusy) return;
    // Build a set of target ids — anything that has at least one
    // incoming edge AND already has a snapshot to operate on.
    const targets = new Set();
    for (const e of edges) {
      if (!e.target_node_id) continue;
      targets.add(e.target_node_id);
    }
    const runnable = [...targets].filter((id) => {
      if (String(id).startsWith('temp-')) return false;
      const n = nodes.find((x) => x.id === id);
      return !!n && !!n.current_html;
    });
    if (runnable.length === 0) {
      setRunFlowError('Connect at least one source node into a target with a snapshot, then try again.');
      setTimeout(() => setRunFlowError(null), 4000);
      return;
    }
    setRunFlowBusy(true);
    setRunFlowError(null);
    try {
      const results = await Promise.allSettled(runnable.map((id) => runOneTarget(id, opts)));
      const updates = new Map();
      let firstError = null;
      results.forEach((r, i) => {
        const id = runnable[i];
        if (r.status === 'fulfilled' && r.value?.snapshotId) {
          updates.set(id, { html: r.value.html, snapshotId: r.value.snapshotId });
        } else if (r.status === 'rejected') {
          firstError = firstError || r.reason?.message || String(r.reason);
          console.warn('run-flow target failed', id, r.reason);
        }
      });
      if (updates.size > 0) {
        setNodes((prev) => prev.map((n) => {
          const u = updates.get(n.id);
          if (!u) return n;
          return {
            ...n,
            current_html: u.html,
            current_snapshot_id: u.snapshotId,
            _resetTick: (n._resetTick || 0) + 1
          };
        }));
      }
      if (firstError) {
        setRunFlowError(firstError);
        setTimeout(() => setRunFlowError(null), 6000);
      }
    } finally {
      setRunFlowBusy(false);
    }
  }

  // Discard pending edits — bump _resetTick so React remounts the iframe
  // with the unmodified `current_html` (the last server-known state).
  function handleDiscardNodeEdit(id) {
    setNodes((prev) => prev.map((n) =>
      n.id === id
        ? { ...n, _resetTick: (n._resetTick || 0) + 1 }
        : n
    ));
  }

  // When a node grows (typically via the Expand floater) into space
  // already occupied by another node, push the overlapped neighbour out
  // along its edge-relationship direction:
  //   • donor (an edge points TO the expanding node) → push LEFT
  //   • receiver (an edge points FROM the expanding node) → push RIGHT
  //   • neither → use the neighbour's current side relative to centre
  // The shift is the MINIMUM displacement that clears the bbox plus a
  // small gap, so neighbours stay in roughly the same place rather than
  // teleporting flush to the expanding node's edge.
  function cascadeOverlapShift(expandingId, newW, newH) {
    const GAP = 64;
    setNodes((prev) => {
      const expanding = prev.find((n) => n.id === expandingId);
      if (!expanding) return prev;
      const ex = { x: expanding.pos_x, y: expanding.pos_y, w: newW || expanding.width, h: newH || expanding.height || 800 };
      const incomingFromExpanding = new Set(
        edges.filter((e) => e.source_node_id === expandingId).map((e) => e.target_node_id)
      ); // expanding → other (other is receiver)
      const outgoingToExpanding = new Set(
        edges.filter((e) => e.target_node_id === expandingId).map((e) => e.source_node_id)
      ); // other → expanding (other is donor)

      const updates = [];
      const next = prev.map((n) => {
        if (n.id === expandingId) return n;
        const nx = n.pos_x, ny = n.pos_y;
        const nw = n.width, nh = n.height || 800;
        // bbox overlap test (with gap as breathing room)
        const overlapX = nx < ex.x + ex.w && nx + nw > ex.x;
        const overlapY = ny < ex.y + ex.h && ny + nh > ex.y;
        if (!(overlapX && overlapY)) return n;

        let role = 'neither';
        if (outgoingToExpanding.has(n.id)) role = 'donor';
        else if (incomingFromExpanding.has(n.id)) role = 'receiver';
        else {
          const nCenter = nx + nw / 2;
          const eCenter = ex.x + ex.w / 2;
          role = nCenter < eCenter ? 'donor' : 'receiver';
        }

        let newX = nx;
        if (role === 'donor') {
          // Push left: new right edge sits at ex.x - GAP
          newX = ex.x - GAP - nw;
        } else {
          // Push right: new left edge sits at ex.x + ex.w + GAP
          newX = ex.x + ex.w + GAP;
        }
        if (newX === nx) return n;
        if (!String(n.id).startsWith('temp-')) {
          updates.push({ id: n.id, posX: newX, posY: ny });
        }
        return { ...n, pos_x: newX };
      });

      // Persist after the state commit so the API sees the same numbers
      // the user sees on screen.
      if (updates.length > 0) {
        Promise.allSettled(
          updates.map((u) => api.updateNode(u.id, { posX: u.posX, posY: u.posY }))
        ).catch(() => {});
      }
      return next;
    });
  }

  async function handleDuplicateNode(id) {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    // Anti-overlap: nextNodePosition slides the duplicate off any
    // collision (defaults at +offset of the original).
    const { posX, posY } = nextNodePosition({
      worldX: n.pos_x + 80,
      worldY: n.pos_y + 80,
      width: n.width,
      height: n.height || 800
    });
    try {
      const created = await api.createNode({
        boardId: board.id,
        kind: n.kind,
        originUrl: n.origin_url,
        templateSlug: n.template_slug,
        posX, posY,
        width: n.width,
        height: n.height || 800,
        meta: n.meta || {},
        html: n.current_html,
        designMd: n.current_design_md
      });
      setNodes((prev) => [...prev, {
        ...created.node,
        current_html: n.current_html,
        current_design_md: n.current_design_md
      }]);
      setSelectedNodeId(created.node.id);
    } catch (err) {
      toast.error(`Duplicate failed: ${err.message}`);
    }
  }

  function handleDownloadNode(id) {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const isMd = n.kind === 'designmd';
    const content = isMd ? (n.current_design_md || '') : (n.current_html || '');
    if (!content) { toast.info('Nothing to download yet.'); return; }
    const ext = isMd ? 'md' : 'html';
    const mime = isMd ? 'text/markdown' : 'text/html';
    const fname = (n.meta?.name || (n.origin_url ? new URL(n.origin_url).hostname : n.kind) || 'uncraft') + '.' + ext;
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname.replace(/[^a-zA-Z0-9._-]+/g, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  // Synchronous ref mirror of draftEdge — closure-captured state goes
  // stale between mousedown (which calls setDraftEdge) and the next
  // re-render. The first batch of mousemove events would otherwise read
  // `draftEdge === null` and early-return, leaving the cord invisible
  // until enough mouse movement happened for React to flush a render.
  // Updating the ref alongside setDraftEdge gives every handler the
  // latest value immediately.
  const draftEdgeRef = useRef(null);
  function setDraftEdgeSync(value) {
    draftEdgeRef.current = value;
    setDraftEdge(value);
  }

  function startEdgeFromNode(nodeId, mouseEvent, side = 'right') {
    setDraftEdgeSync({
      sourceNodeId: nodeId, sourceSide: side,
      mouseX: mouseEvent.clientX, mouseY: mouseEvent.clientY,
      // No `rerouteEdgeId` → this is a NEW connection from a port. Set
      // on the drag-to-disconnect path so handleGlobalMouseUp knows to
      // skip the empty-drop menu and just leave the edge deleted.
      rerouteEdgeId: null
    });
  }

  // Click-vs-drag race for incoming-slot circles. Click → select edge.
  // Drag past 5px → reroute (delete + start fresh draft). Same UX as the
  // cord click handler in EdgeLayer, but bound to the receiver dot so
  // the user can grab the cord by its endpoint to disconnect.
  function onSlotMouseDown(edgeId, mouseEvent) {
    mouseEvent.stopPropagation();
    const startX = mouseEvent.clientX, startY = mouseEvent.clientY;
    let started = false;
    function move(ev) {
      if (started) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
        started = true;
        cleanup();
        const edge = edges.find((x) => x.id === edgeId);
        if (edge) startEdgeReroute(edge, ev);
      }
    }
    function up() {
      if (!started) {
        setSelectedEdgeId(edgeId);
        setSelectedNodeId(null);
      }
      cleanup();
    }
    function cleanup() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // Drag-to-disconnect: pressing on an existing edge starts a draft cord
  // anchored to the source's right port, with the existing edge already
  // removed from the local list (the API delete fires here too). Drop on
  // another node → re-target. Drop on empty → stay disconnected.
  function startEdgeReroute(edge, mouseEvent) {
    // Locally remove the edge so the re-routing draft cord is the only
    // thing visible. Server delete fires async — if the user drops on a
    // new target, we'll create a fresh edge for that pair.
    setEdges((prev) => prev.filter((x) => x.id !== edge.id));
    api.deleteEdge(edge.id).catch(console.warn);
    setDraftEdgeSync({
      sourceNodeId: edge.source_node_id,
      sourceSide: 'right',
      mouseX: mouseEvent.clientX, mouseY: mouseEvent.clientY,
      rerouteEdgeId: edge.id
    });
  }

  // Magnetic snap: in moveDraftEdge we look at every other node's left
  // port stack and pick the nearest slot within SNAP_RADIUS_SCREEN px of
  // the cursor. The draft cord endpoint snaps to that slot's world coord
  // so the user gets clear visual confirmation that a drop will land.
  const SNAP_RADIUS_SCREEN = 56;
  const SLOT_SIZE = 24, SLOT_GAP = 8;
  function findSnapTarget(clientX, clientY, sourceNodeId) {
    if (!sourceNodeId) return null;
    const w = clientToWorld(transformRef, clientX, clientY);
    const scale = transformRef.current?.instance?.transformState?.scale || 1;
    const radiusWorld = SNAP_RADIUS_SCREEN / scale;
    // CSS sizes the circles in 1/scale world units (constant on screen).
    // Slot Y math has to do the same or the snap target lands between
    // circles instead of on them.
    const slotSize = SLOT_SIZE / scale;
    const slotGap = SLOT_GAP / scale;
    let best = null, bestDist = Infinity;
    for (const n of nodes) {
      if (n.id === sourceNodeId) continue;
      const el = typeof document !== 'undefined'
        ? document.querySelector(`[data-node-id="${n.id}"]`)
        : null;
      const h = (el && el.offsetHeight) || n.height || 800;
      const incoming = incomingByTarget.get(n.id) || [];
      const slotCount = incoming.length === 0 ? 1 : incoming.length;
      const midY = n.pos_y + h / 2;
      const totalH = slotCount * slotSize + Math.max(0, slotCount - 1) * slotGap;
      const stackTop = midY - totalH / 2;
      for (let i = 0; i < slotCount; i++) {
        const slotY = stackTop + i * (slotSize + slotGap) + slotSize / 2;
        const dx = n.pos_x - w.x;
        const dy = slotY - w.y;
        const dist = Math.hypot(dx, dy);
        if (dist < radiusWorld && dist < bestDist) {
          best = { nodeId: n.id, slotIndex: i, slotCount, x: n.pos_x, y: slotY };
          bestDist = dist;
        }
      }
    }
    return best;
  }

  function moveDraftEdge(e) {
    const draft = draftEdgeRef.current;
    if (!draft) return;
    const snap = findSnapTarget(e.clientX, e.clientY, draft.sourceNodeId);
    setDraftEdgeSync({ ...draft, mouseX: e.clientX, mouseY: e.clientY, snapTo: snap });
  }

  async function handleGlobalMouseUp(e) {
    const draft = draftEdgeRef.current;
    if (!draft) return;
    const src = draft.sourceNodeId;
    const isReroute = !!draft.rerouteEdgeId;
    // Snap target wins over closest('.cnode') so the magnetic affordance
    // is honoured even if the user's mouseup landed a few px off-target.
    let targetId = draft.snapTo?.nodeId || null;
    if (!targetId) {
      const cnode = e.target?.closest?.('.cnode');
      targetId = cnode?.dataset?.nodeId || null;
    }
    setDraftEdgeSync(null);

    if (targetId && targetId !== src) {
      // Dedup: if an edge already exists from this source to this target,
      // don't stack another circle on the receiver — just select the
      // existing edge so the user can act on it.
      const existing = edges.find(
        (x) => x.source_node_id === src && x.target_node_id === targetId
      );
      if (existing) {
        setSelectedEdgeId(existing.id);
        return;
      }
      try {
        const { edge } = await api.createEdge({
          boardId: board.id, sourceNodeId: src, targetNodeId: targetId,
          kind: 'transplant', payload: { sourceSelector: 'body', targetSelector: 'body' }
        });
        setEdges((prev) => [...prev, edge]);
        setSelectedEdgeId(edge.id);
      } catch (err) { toast.error(`Edge create failed: ${err.message}`); }
      return;
    }

    if (!targetId) {
      // Re-route → drop on empty just means "stay disconnected". The edge
      // was already removed in startEdgeReroute; do nothing else.
      if (isReroute) return;
      // Fresh port drag → empty drop opens the creation menu.
      const w = clientToWorld(transformRef, e.clientX, e.clientY);
      setEmptyDropMenu({ sourceNodeId: src, x: e.clientX, y: e.clientY, worldX: w.x, worldY: w.y });
    }
  }

  async function handleApplyEdge(edge) {
    try {
      const { snapshotId, targetNodeId } = await api.applyEdge(edge.id);
      // Refetch board for latest target node HTML
      const fresh = await api.getBoard(board.id);
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
      setSelectedEdgeId(null);
      setPopupPos(null);
    } catch (e) {
      toast.error(`Apply failed: ${e.message}`);
    }
  }

  async function handleUpdateEdge(edge, payload) {
    try {
      await api.updateEdge(edge.id, { payload });
      setEdges((prev) => prev.map((x) => (x.id === edge.id ? { ...x, payload } : x)));
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function handleDeleteEdge(edge) {
    setEdges((prev) => prev.filter((x) => x.id !== edge.id));
    setSelectedEdgeId(null);
    setPopupPos(null);
    await api.deleteEdge(edge.id).catch(console.warn);
  }

  async function persistBoardName(name) {
    // Empty / whitespace-only resets to 'Untitled' so the toolbar can't end
    // up as a blank slot (which also breaks the size-by-length input width).
    const clean = (name || '').trim() || 'Untitled';
    if (clean !== name) setBoardName(clean);
    if (clean === board.name) return;
    await api.renameBoard(board.id, clean).catch(console.warn);
  }

  function logout() {
    api.logout().catch(() => {});
    localStorage.removeItem('token');
    window.location.href = '/';
  }

  function zoomToNode(node, animationTime = 350, forcedScale = null) {
    const t = transformRef.current;
    if (!t || !node) return;
    const PAD = 80;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 48;
    let scale;
    if (forcedScale != null) {
      scale = forcedScale;
    } else {
      const nodeW = node.width + PAD * 2;
      const nodeH = (node.height || 800) + PAD * 2 + 60;
      scale = Math.min(vw / nodeW, vh / nodeH, 1.0);
    }
    const centerX = node.pos_x + node.width / 2;
    const centerY = node.pos_y + (node.height || 800) / 2;
    const posX = vw / 2 - centerX * scale;
    const posY = (vh / 2 + 48) - centerY * scale;
    t.setTransform(posX, posY, scale, animationTime);
  }

  // Width-fit framing for a node — used by edit-entry, frame-back, and
  // fit-to-view while editing. We deliberately ignore node height in the
  // scale math: in edit mode the user pans vertically via the scroll
  // wheel, so a tall (expanded) node should not collapse the zoom.
  function computeEditFrame(node) {
    const PAD = 40;
    const TOP_OFFSET = 30;
    const HEADER = 48;
    const vw = window.innerWidth;
    // Editor mounts layers panel (left) + inspector panel (right) into this
    // host doc; reserve their widths so the node frames between them
    // instead of slipping partially behind. Read live so panel resize /
    // hide / undock are respected. Defaults match editor.css when the
    // panels haven't mounted yet (first entry into edit).
    const layersEl = document.getElementById('rb-editor-layers');
    const inspEl = document.getElementById('rb-editor-inspector');
    const leftReserve = layersEl ? layersEl.getBoundingClientRect().width : 240;
    const rightReserve = inspEl ? inspEl.getBoundingClientRect().width : 260;
    const usableW = Math.max(320, vw - leftReserve - rightReserve);
    const nodeW = node.width + PAD * 2;
    const scale = Math.min(usableW / nodeW, 1.0);
    const centerX = node.pos_x + node.width / 2;
    const positionX = (leftReserve + usableW / 2) - centerX * scale;
    const positionY = (HEADER + TOP_OFFSET) - node.pos_y * scale;
    return { positionX, positionY, scale };
  }

  function handleEditingToggle(nodeId, willEdit) {
    if (willEdit) {
      setEditingNodeId(nodeId);
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        setTimeout(() => {
          const f = computeEditFrame(node);
          if (window.__uncraftZoom) {
            window.__uncraftZoom._editFrame = f;
            window.__uncraftZoom.setState?.(f, 350);
          }
        }, 50);
      }
    } else {
      setEditingNodeId(null);
      // Drop the saved frame so a re-entry into edit mode captures fresh.
      if (window.__uncraftZoom) window.__uncraftZoom._editFrame = null;
    }
  }

  // Frame ALL nodes into the viewport. Pure version — no
  // editing/selection branching, used by both fitToContent (smart
  // default) and the minimap's frame toggle (explicit user intent).
  function frameAll(animationTime = 350) {
    const t = transformRef.current;
    if (!t || nodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.pos_x);
      minY = Math.min(minY, n.pos_y);
      maxX = Math.max(maxX, n.pos_x + n.width);
      maxY = Math.max(maxY, n.pos_y + n.height);
    }
    const PADDING = 80;
    const bboxW = (maxX - minX) + PADDING * 2;
    const bboxH = (maxY - minY) + PADDING * 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 48;
    const scale = Math.min(vw / bboxW, vh / bboxH, 1.5);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const posX = vw / 2 - centerX * scale;
    const posY = (vh / 2 + 48) - centerY * scale;
    t.setTransform(posX, posY, scale, animationTime);
  }

  // Frame the selected node. Falls back to frameAll when no selection
  // exists — keeps the minimap toggle from feeling broken if the user
  // clicks it with nothing selected.
  function frameSelected(animationTime = 350) {
    if (!selectedNodeId) { frameAll(animationTime); return; }
    const sel = nodes.find((n) => n.id === selectedNodeId);
    if (sel) zoomToNode(sel, animationTime);
    else frameAll(animationTime);
  }

  // Toggle frame mode for the minimap button. State carries what'll
  // happen on the NEXT click (so the icon matches the action). Without
  // a selection we lock to 'all' because 'selected' is meaningless.
  const [frameMode, setFrameMode] = useState('selected');
  // If the user deselects (selection becomes null), the 'selected' mode
  // would no-op visually — collapse to 'all' so the icon stays honest.
  useEffect(() => {
    if (!selectedNodeId && frameMode === 'selected') setFrameMode('all');
  }, [selectedNodeId, frameMode]);
  function toggleFrame() {
    if (!selectedNodeId) {
      frameAll();
      return;
    }
    if (frameMode === 'selected') {
      frameSelected();
      setFrameMode('all');
    } else {
      frameAll();
      setFrameMode('selected');
    }
  }

  function fitToContent(animationTime = 350) {
    const t = transformRef.current;
    if (!t || nodes.length === 0) return;
    // While editing, fit-to-view re-frames the editing node using the
    // same width-fit framing as edit entry. The canvas may have drifted
    // (the user wheel-panned to inspect a section); this returns them
    // to "the view I started in". We also refresh _editFrame so the
    // frame-back button stays in sync.
    if (editingNodeId) {
      const node = nodes.find((n) => n.id === editingNodeId);
      if (node) {
        const f = computeEditFrame(node);
        if (window.__uncraftZoom) window.__uncraftZoom._editFrame = f;
        t.setTransform(f.positionX, f.positionY, f.scale, animationTime);
        return;
      }
    }
    // If a node is selected, fit-to-view zooms TO that node specifically.
    // This matches the user mental model that the action operates on
    // whatever they've focused on — same as Figma's "Zoom to selection".
    // No selection? Fall through to the all-nodes bbox path.
    if (selectedNodeId) {
      const sel = nodes.find((n) => n.id === selectedNodeId);
      if (sel) {
        zoomToNode(sel, animationTime);
        return;
      }
    }
    // Compute bounding box across all nodes (in world coords).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.pos_x);
      minY = Math.min(minY, n.pos_y);
      maxX = Math.max(maxX, n.pos_x + n.width);
      maxY = Math.max(maxY, n.pos_y + n.height);
    }
    const PADDING = 80;
    const bboxW = (maxX - minX) + PADDING * 2;
    const bboxH = (maxY - minY) + PADDING * 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 48; // header offset
    const scale = Math.min(vw / bboxW, vh / bboxH, 1.5);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    // setTransform expects positionX/Y of the TransformComponent content.
    const posX = vw / 2 - centerX * scale;
    const posY = (vh / 2 + 48) - centerY * scale;
    t.setTransform(posX, posY, scale, animationTime);
  }

  // Frame a set of nodes (a connection chain) at the maximum zoom that
  // still fits all of them inside the viewport with comfortable padding.
  // Used by the chain dropdown items in the toolbar-right widget.
  function zoomToConnection(nodeIds, animationTime = 350) {
    const t = transformRef.current;
    if (!t || !nodeIds?.length) return;
    const involved = nodes.filter((n) => nodeIds.includes(n.id));
    if (involved.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of involved) {
      minX = Math.min(minX, n.pos_x);
      minY = Math.min(minY, n.pos_y);
      maxX = Math.max(maxX, n.pos_x + n.width);
      maxY = Math.max(maxY, n.pos_y + (n.height || 800));
    }
    const PADDING = 120;
    const bboxW = (maxX - minX) + PADDING * 2;
    const bboxH = (maxY - minY) + PADDING * 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 48;
    const scale = Math.min(vw / bboxW, vh / bboxH, 1.5);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const posX = vw / 2 - centerX * scale;
    const posY = (vh / 2 + 48) - centerY * scale;
    t.setTransform(posX, posY, scale, animationTime);
  }

  // Canvas wheel routing (Figma-style):
  //   • plain wheel anywhere (canvas, node body, even inside the site iframe
  //     via the iframe-doc handler in CanvasNode) → pan canvas by screen
  //     deltas. Two-finger trackpad scroll and mouse wheel both feed this.
  //   • Cmd/Ctrl + wheel → cursor-anchored zoom in/out.
  // Native scroll is preserved for widgets that own their own overflow
  // (textareas, prompt dock, menus, toolbars, sidebar). TransformWrapper's
  // own wheel handling is disabled (see `wheel.disabled` below) so this is
  // the single source of truth.
  useEffect(() => {
    const NATIVE_WHEEL_SELECTOR = [
      '.cnode-prompt-textarea',
      '.cnode-prompt-body',
      '.cnode-body-prompt',
      '.edge-popup',
      '.superwidget',
      '.canvas-toolbar-left',
      '.canvas-toolbar-right',
      '.canvas-toolbars-left',
      '.canvas-toolbars-right',
      '.canvas-theme-floater',
      '.zoom-controls',
      '.zoom-menu',
      '.user-menu',
      '.reset-confirm-card',
      '.reset-confirm-overlay',
      '.canvas-context-menu',
      '.empty-drop-menu',
      '.prompt-dock',
      '.boards-sidebar',
      'textarea',
    ].join(', ');
    function onWheelCapture(e) {
      if (e.target?.closest?.(NATIVE_WHEEL_SELECTOR)) return;
      e.preventDefault();
      // Kill TransformWrapper's own wheel listener (attached on the wrapper
      // in bubble phase). Defensive — wheel.disabled:true should already
      // short-circuit it, but HMR can leave stale listeners around.
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      const z = window.__uncraftZoom;
      if (!z) return;
      if (e.metaKey || e.ctrlKey) {
        z.zoomAtPoint?.(e.deltaY || 0, e.clientX, e.clientY);
      } else {
        z.panBy?.(-(e.deltaX || 0), -(e.deltaY || 0));
      }
    }
    function onKeyZoom(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) {
        e.preventDefault();
      }
    }
    document.addEventListener('wheel', onWheelCapture, { passive: false, capture: true });
    document.addEventListener('keydown', onKeyZoom);
    return () => {
      document.removeEventListener('wheel', onWheelCapture, { capture: true });
      document.removeEventListener('keydown', onKeyZoom);
    };
  }, []);

  // Auto-fit when initial nodes are present (e.g. revisiting a board).
  useEffect(() => {
    if (initialNodes && initialNodes.length > 0) {
      const t = setTimeout(() => fitToContent(0), 50);
      return () => clearTimeout(t);
    }
  }, []); // intentional: only on first mount

  // Keyboard shortcuts: Esc clears selection. F fits all nodes. 0 resets to 1:1 center.
  // Delete/Backspace removes the selected node (or selected edge).
  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.target?.isContentEditable) return;
      if (e.key === 'Escape') {
        // Cancel an in-flight edge drag in isolation — keep the source
        // node selected so the viewport switcher / chrome stays put.
        if (draftEdge) { setDraftEdgeSync(null); return; }
        // Open menus take priority — first ESC closes the menu only, the
        // node selection (and its viewport switcher) stays put. Second
        // ESC then clears selection.
        if (emptyDropMenu || contextMenu) {
          if (emptyDropMenu) setEmptyDropMenu(null);
          if (contextMenu) setContextMenu(null);
          return;
        }
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setPopupPos(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't bother if we're inside the editor — its own Backspace logic
        // owns those keys.
        if (editingNodeId) return;
        if (selectedNodeId) {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
          setSelectedNodeId(null);
        } else if (selectedEdgeId) {
          const edge = edges.find((x) => x.id === selectedEdgeId);
          if (edge) {
            e.preventDefault();
            handleDeleteEdge(edge);
          }
        }
      } else if (e.key === 'f' || e.key === 'F') {
        fitToContent();
      } else if (e.key === '0') {
        const t = transformRef.current;
        if (t) t.setTransform(window.innerWidth / 2 - WORLD_WIDTH / 2, window.innerHeight / 2 - WORLD_HEIGHT / 2, 1, 250);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodes, edges, draftEdge, selectedNodeId, selectedEdgeId, editingNodeId, emptyDropMenu, contextMenu]);

  // Force-blur the project name input when the user clicks anywhere
  // outside the toolbar. react-zoom-pan-pinch calls preventDefault on
  // panning mousedowns, which blocks the browser's natural focus shift
  // — without this the cursor kept blinking inside the input even
  // after the user clicked on the canvas.
  useEffect(() => {
    function onDown(e) {
      const active = document.activeElement;
      if (!active || active.classList?.contains('canvas-board-name') !== true) return;
      if (e.target?.closest?.('.canvas-toolbar-left')) return;
      active.blur();
    }
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, []);

  // Group edges by target — each target node renders one input port circle
  // per incoming edge. Order is creation order (the array order from the
  // server / setEdges appends). The list lives here so EdgeLayer and
  // CanvasNode resolve the same slot index for any given edge.
  const incomingByTarget = useMemo(() => {
    const byNodeId = new Map(nodes.map((n) => [n.id, n]));
    const m = new Map();
    for (const e of edges) {
      const src = byNodeId.get(e.source_node_id);
      const list = m.get(e.target_node_id) || [];
      list.push({
        edgeId: e.id,
        sourceNodeId: e.source_node_id,
        sourceOrigin: src ? nodeOrigin(src) : 'unknown',
        sourceColor: src ? originColor(src) : '#94a3b8'
      });
      m.set(e.target_node_id, list);
    }
    return m;
  }, [edges, nodes]);

  return (
    <div
      className="canvas-shell"
      onMouseMove={moveDraftEdge}
      onMouseUp={handleGlobalMouseUp}
      onDragOver={(e) => {
        // Accept drags carrying our custom MIME — editor.js sets this on
        // asset-thumb dragstart. preventDefault is required to allow drop.
        const types = e.dataTransfer.types;
        if (types && (types.includes ? types.includes('application/x-uncraft-asset') : Array.prototype.indexOf.call(types, 'application/x-uncraft-asset') >= 0)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={handleAssetDrop}
      onContextMenu={(e) => {
        // Ignore right-clicks landed on a node, the prompt dock, edge popups,
        // header, or the existing empty-drop menu. The browser's default
        // context menu is suppressed only for the bare canvas.
        const t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        if (t.closest('.cnode, .prompt-dock, .empty-drop-menu, .canvas-context-menu, .edge-popup, .canvas-header')) return;
        e.preventDefault();
        const w = clientToWorld(transformRef, e.clientX, e.clientY);
        setContextMenu({ x: e.clientX, y: e.clientY, worldX: w.x, worldY: w.y });
      }}
    >
      <div className="canvas-bg" />

      <div className="canvas-toolbars-left">
        <div className="canvas-toolbar-left">
          <a href="/canvas" className="uncraft-mark" title="Boards">
            <span className="un">Un</span><span className="craft">craft</span>
          </a>
          <span className="canvas-toolbar-sep" aria-hidden="true" />
          <input
            className="canvas-board-name"
            value={boardName}
            onChange={(e) => setBoardName(e.target.value)}
            onBlur={(e) => persistBoardName(e.target.value)}
            onKeyDown={(e) => {
              // Enter / Esc commit + leave the field (browser default
              // doesn't blur on Enter, so do it explicitly).
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            spellCheck={false}
            size={Math.max(8, (boardName || '').length + 1)}
          />
        </div>
        <button
          type="button"
          className="canvas-theme-floater"
          onClick={() => setLightMode((v) => !v)}
          title={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
          aria-label="Toggle theme"
        >
          {lightMode ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
            </svg>
          )}
        </button>
      </div>

      <div className="canvas-toolbars-right">
        <ZoomControls scale={canvasScale} transformRef={transformRef} onFit={fitToContent} />
        <div className="canvas-toolbar-right">
          <CategoryCounts
            nodes={nodes}
            edges={edges}
            onZoomToConnection={(ids) => zoomToConnection(ids)}
          />
          <span className="canvas-toolbar-sep" aria-hidden="true" />
          <UserPill compact name={user?.name} email={user?.email} plan={user?.plan} onSignOut={logout} />
        </div>
      </div>
      <Minimap
        nodes={nodes}
        transformRef={transformRef}
        frameMode={frameMode}
        hasSelection={!!selectedNodeId}
        onToggleFrame={toggleFrame}
      />

      <TransformWrapper
        ref={transformRef}
        minScale={0.1}
        maxScale={2.5}
        initialScale={0.6}
        initialPositionX={-WORLD_WIDTH * 0.25}
        initialPositionY={-WORLD_HEIGHT * 0.25}
        limitToBounds={false}
        wheel={{ disabled: true }}
        panning={{ excluded: ['cnode', 'cnode-topbar', 'cnode-body', 'cnode-iframe', 'cnode-prompt-textarea', 'cnode-prompt-body', 'cnode-body-prompt', 'cnode-handle', 'cnode-viewport-switcher', 'cnode-vp-btn', 'cnode-port-right', 'cnode-port-left', 'edge-line', 'edge-popup', 'reset-confirm-card', 'reset-confirm-overlay', 'superwidget', 'canvas-toolbar-left', 'canvas-toolbar-right', 'canvas-toolbars-left', 'canvas-toolbars-right', 'canvas-theme-floater', 'zoom-controls', 'zoom-menu', 'user-menu'] }}
        doubleClick={{ disabled: true }}
        onPanningStart={() => { setSelectedNodeId(null); setSelectedEdgeId(null); setPopupPos(null); }}
        onTransformed={(_ref, state) => {
          // Expose current scale so node chrome (handle/buttons/edges) can stay
          // viewport-readable via inverse-scale in CSS.
          const scale = state.scale || 1;
          document.documentElement.style.setProperty('--canvas-scale', String(scale));
          // Below ~0.5 the topbar items overlap the centered grip; collapse
          // chrome so only the grip stays visible.
          document.documentElement.classList.toggle('canvas-zoom-low', scale < 0.5);
          // Below ~0.2 the ports start to dominate the tiny node frames —
          // shrink them 30% so the colour-coded squares stay readable.
          document.documentElement.classList.toggle('canvas-zoom-very-low', scale < 0.2);
          setCanvasScale(scale);
        }}
      >
        <TransformComponent wrapperStyle={{ width: '100vw', height: '100vh' }} contentStyle={{ width: WORLD_WIDTH, height: WORLD_HEIGHT }}>
          <EdgeLayer
            nodes={nodes} edges={edges}
            incomingByTarget={incomingByTarget}
            scale={canvasScale}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={(edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
            }}
            onEdgeDragStart={(edge, evt) => startEdgeReroute(edge, evt)}
          />
          {nodes.map((n) => (
            <CanvasNode
              key={n.id} node={n}
              incomingEdges={incomingByTarget.get(n.id) || []}
              selected={selectedNodeId === n.id}
              editing={editingNodeId === n.id}
              onEditingChange={(willEdit) => handleEditingToggle(n.id, willEdit)}
              onSelect={() => { setSelectedNodeId(n.id); setSelectedEdgeId(null); setPopupPos(null); }}
              onMove={(posX, posY) => {
                updateNodeLocal(n.id, { pos_x: posX, pos_y: posY });
                if (!String(n.id).startsWith('temp-')) persistNodePosition(n.id, posX, posY);
              }}
              onResize={(width, height, opts) => {
                const patch = { width };
                if (typeof height === 'number' && height > 0) patch.height = height;
                updateNodeLocal(n.id, patch);
                if (!String(n.id).startsWith('temp-')) {
                  api.updateNode(n.id, patch).catch(console.warn);
                }
                // Cascade flag is set by the Expand floater so that
                // expanding a node into another node's space pushes the
                // neighbour out (donors → left, receivers → right). Drag
                // resize doesn't cascade — that would feel jittery.
                if (opts?.cascade) cascadeOverlapShift(n.id, width, patch.height ?? n.height);
              }}
              onDelete={() => handleDeleteNode(n.id)}
              onReset={() => handleResetNode(n.id)}
              runStatus={runStatus.get(n.id) || null}
              onSaveEdit={(html) => handleSaveNodeEdit(n.id, html)}
              onDiscardEdit={() => handleDiscardNodeEdit(n.id)}
              onDuplicate={() => handleDuplicateNode(n.id)}
              onDownload={() => handleDownloadNode(n.id)}
              onStartEdge={(e, side) => startEdgeFromNode(n.id, e, side)}
              onSlotMouseDown={onSlotMouseDown}
              onPromptTextChange={(value) => handlePromptTextChange(n.id, value)}
              draftActive={!!draftEdge && draftEdge.sourceNodeId !== n.id}
            />
          ))}
          <DraftEdgeLayer
            nodes={nodes}
            scale={canvasScale}
            draftEdge={draftEdge && {
              sourceNodeId: draftEdge.sourceNodeId,
              sourceSide: draftEdge.sourceSide || 'right',
              x2: clientToWorld(transformRef, draftEdge.mouseX, draftEdge.mouseY).x,
              y2: clientToWorld(transformRef, draftEdge.mouseX, draftEdge.mouseY).y,
              snapTo: draftEdge.snapTo || null
            }}
          />
        </TransformComponent>
      </TransformWrapper>

      {nodes.length === 0 && (
        <div className="canvas-empty">
          Empty canvas. Add a URL or upload a design.md from the dock below to start.
        </div>
      )}

      {/* Legacy EdgePopup ('Edge configuration' panel with kind/source/target
          dropdowns) removed — the new model is: cord direction = semantic
          operation. No manual configuration. To remove an edge, click it
          and press Delete/Backspace. */}

      {emptyDropMenu && (
        <EmptyDropMenu
          x={emptyDropMenu.x}
          y={emptyDropMenu.y}
          onClose={() => setEmptyDropMenu(null)}
          onPickHtml={async () => {
            const m = emptyDropMenu;
            const file = await pickFile('.html,.htm,text/html');
            setEmptyDropMenu(null);
            if (file) await handleUploadHtml(file, { worldX: m.worldX, worldY: m.worldY, linkFromNodeId: m.sourceNodeId });
          }}
          onPickMd={async () => {
            const m = emptyDropMenu;
            const file = await pickFile('.md,.markdown,text/markdown,text/plain');
            setEmptyDropMenu(null);
            if (file) await handleUploadMd(file, { worldX: m.worldX, worldY: m.worldY, linkFromNodeId: m.sourceNodeId });
          }}
          onPickSkill={async () => {
            const m = emptyDropMenu;
            setEmptyDropMenu(null);
            await handleAddSkill({ worldX: m.worldX, worldY: m.worldY, linkFromNodeId: m.sourceNodeId });
          }}
        />
      )}

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPickUrl={async (url) => {
            const m = contextMenu;
            setContextMenu(null);
            await handleAddUrl(url, { worldX: m.worldX, worldY: m.worldY });
          }}
          onPickHtml={async () => {
            const m = contextMenu;
            const file = await pickFile('.html,.htm,text/html');
            setContextMenu(null);
            if (file) await handleUploadHtml(file, { worldX: m.worldX, worldY: m.worldY });
          }}
          onPickMd={async () => {
            const m = contextMenu;
            const file = await pickFile('.md,.markdown,text/markdown,text/plain');
            setContextMenu(null);
            if (file) await handleUploadMd(file, { worldX: m.worldX, worldY: m.worldY });
          }}
          onPickScreenshot={async () => {
            const m = contextMenu;
            const file = await pickFile('image/*');
            setContextMenu(null);
            if (file) await handleUploadScreenshot(file, { worldX: m.worldX, worldY: m.worldY });
          }}
          onPickPrompt={() => {
            setContextMenu(null);
            toast.info('Coming next: prompt → AI-generated node.');
          }}
          onPickCode={() => {
            setContextMenu(null);
            toast.info('Coming next: paste raw code → code node.');
          }}
          onPickBlankSite={() => {
            const m = contextMenu;
            setContextMenu(null);
            handleAddBlankSite({ worldX: m.worldX, worldY: m.worldY });
          }}
        />
      )}

      <input ref={fileInputRef} type="file" onChange={onFileInputChange} style={{ display: 'none' }} />

      <PromptDock
        boardId={board.id}
        onAddUrl={handleAddUrl}
        onUploadMd={handleUploadMd}
        onUploadHtml={handleUploadHtml}
        onAddPrompt={() => handleAddPrompt()}
        onAddSkill={() => handleAddSkill()}
        onAddBlankSite={() => handleAddBlankSite()}
        onRunFlow={handleRunFlow}
        runFlowBusy={runFlowBusy}
        runFlowError={runFlowError}
        nodeCount={nodes.length}
        onAgentMutatedGraph={async () => {
          // Agent created/deleted/updated a node or edge — refetch board
          // state so the canvas reflects it. Cheap (one query); we can
          // optimize to per-mutation patches later if it gets chatty.
          try {
            const res = await fetch(`/api/boards/${board.id}`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            if (Array.isArray(data.nodes)) setNodes(data.nodes);
            if (Array.isArray(data.edges)) setEdges(data.edges);
          } catch (e) { console.warn('[CanvasClient] agent-mutation refetch failed', e); }
        }}
      />

      {runFlowError && (
        <div className="run-flow-toast" role="status" aria-live="polite">
          {runFlowError}
        </div>
      )}

      <ToastRoot />

      {challenge && (
        <ChallengeModal
          challenge={challenge}
          onCancel={() => {
            // User opted out — drop the placeholder locally AND from
            // the server (the route pre-created it). DELETE is fire-
            // and-forget; if it fails the polling-timeout cleanup
            // catches the orphan eventually.
            const pid = challenge.placeholderId;
            if (pid) {
              stopHandoffPolling(pid);
              setNodes((prev) => prev.filter((n) => n.id !== pid));
              if (challenge.node) {
                fetch(`/api/nodes/${pid}`, { method: 'DELETE', credentials: 'include' })
                  .catch((err) => console.warn('challenge cancel delete failed', err));
              }
            }
            setChallenge(null);
          }}
          onOpenSite={() => {
            // Keep the placeholder + polling alive — the extension will
            // POST the verified DOM to /api/snapshot/handoff once the
            // user solves the challenge in the new tab, and the poll
            // loop swaps it for the real node.
            setChallenge(null);
          }}
        />
      )}
    </div>
  );
}

function CanvasContextMenu({ x, y, onClose, onPickUrl, onPickHtml, onPickMd, onPickScreenshot, onPickPrompt, onPickCode, onPickBlankSite }) {
  const [mode, setMode] = useState('choices');
  const [url, setUrl] = useState('');
  const left = Math.min(x + 8, window.innerWidth - 280);
  const top = Math.min(y + 8, window.innerHeight - 240);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    function onDown(e) {
      if (!e.target?.closest?.('.canvas-context-menu')) onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div
      className="popup-menu canvas-context-menu"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {mode === 'choices' ? (
        <>
          <div className="popup-menu-title">Add to canvas</div>
          <button className="popup-menu-btn" onClick={() => setMode('url')}><MenuIcon.Url /><span>Add URL</span></button>
          <button className="popup-menu-btn" onClick={onPickBlankSite}><MenuIcon.Blank /><span>Add blank website</span></button>
          <button className="popup-menu-btn" onClick={onPickHtml}><MenuIcon.Html /><span>Add HTML</span></button>
          <button className="popup-menu-btn" onClick={onPickMd}><MenuIcon.Md /><span>Add .md file</span></button>
          <button className="popup-menu-btn" onClick={onPickScreenshot}><MenuIcon.Image /><span>Add Screenshot</span></button>
          <button className="popup-menu-btn" onClick={onPickPrompt}><MenuIcon.Prompt /><span>Add Prompt</span></button>
          <button className="popup-menu-btn" onClick={onPickCode}><MenuIcon.Code /><span>Add Code</span></button>
          <button className="popup-menu-btn popup-menu-btn-cancel" onClick={onClose}>Cancel (Esc)</button>
        </>
      ) : (
        <>
          <div className="popup-menu-title">URL of website</div>
          <div className="popup-menu-input-row">
            <input
              autoFocus type="text" placeholder="example.com or full URL"
              className="popup-input"
              value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const norm = normalizeUrl(url);
                  if (norm) onPickUrl(norm);
                }
                if (e.key === 'Escape') onClose();
              }}
            />
          </div>
          <div className="popup-menu-input-row" style={{ paddingTop: 0, gap: 8 }}>
            <button className="popup-btn popup-btn-outline popup-btn-sm" onClick={() => setMode('choices')}>← Back</button>
            <button
              className="popup-btn popup-btn-primary popup-btn-sm"
              onClick={() => { const norm = normalizeUrl(url); if (norm) onPickUrl(norm); }}
              disabled={!looksLikeUrl(url)}
              style={{ flex: 1 }}
            >Capture →</button>
          </div>
        </>
      )}
    </div>
  );
}

// Drop-on-empty after dragging a cord from a node's right port. The menu
// asks the user what KIND of node to extract the source's content into.
// New types currently spawn empty placeholders + auto-link to the source;
// the actual extraction (URL → design.md tokens, etc) lands when the
// edge resolver is implemented (see HANDOFF_TECHNICAL §6).
function EmptyDropMenu({ x, y, onClose, onPickHtml, onPickMd, onPickSkill }) {
  const left = Math.min(x + 8, window.innerWidth - 280);
  const top = Math.min(y + 8, window.innerHeight - 200);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    function onDown(e) {
      if (e.target?.closest?.('.empty-drop-menu')) return;
      // Capture phase + stopPropagation: close the menu BEFORE the event
      // can reach react-zoom-pan-pinch's onPanningStart, which would
      // clear `selectedNodeId` and make the viewport switcher disappear.
      // Earlier symptom was: first click outside lost the switcher
      // instead of closing the menu (panning ate the event); a second
      // click was needed to dismiss the menu.
      e.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose]);

  return (
    <div className="popup-menu empty-drop-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="popup-menu-title">Extract to…</div>
      <button className="popup-menu-btn" onClick={onPickMd}><MenuIcon.Md /><span>design.md</span></button>
      <button className="popup-menu-btn" onClick={onPickSkill}><MenuIcon.Skill /><span>skill</span></button>
      <button className="popup-menu-btn" onClick={onPickHtml}><MenuIcon.Html /><span>.html</span></button>
      <button className="popup-menu-btn popup-menu-btn-cancel" onClick={onClose}>Cancel (Esc)</button>
    </div>
  );
}

function clientToWorld(transformRef, clientX, clientY) {
  const state = transformRef.current?.instance?.transformState;
  if (!state) return { x: clientX, y: clientY };
  const { positionX, positionY, scale } = state;
  return {
    x: (clientX - positionX) / scale,
    y: (clientY - positionY) / scale
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
