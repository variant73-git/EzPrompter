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
      <path d="M12 22a10 10 0 1 1 0-20c5.5 0 10 4 10 9 0 3-2.5 5.5-5.5 5.5h-2a1.7 1.7 0 0 0 0 3.4c.7 0 1.5.4 1.5 1.3 0 .9-.7 1.6-1.5 1.6-.8.1-1.7.2-2.5.2z"/>
      <circle cx="6.5" cy="12" r="1.2" fill="currentColor" stroke="none"/>
      <circle cx="9.5" cy="7"  r="1.2" fill="currentColor" stroke="none"/>
      <circle cx="14"  cy="7"  r="1.2" fill="currentColor" stroke="none"/>
      <circle cx="17"  cy="11.5" r="1.2" fill="currentColor" stroke="none"/>
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
  )
};

const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 6000;

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
      fit: () => fitToContent()
    };
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

  async function handleAddUrl(url, opts = {}) {
    const id = `temp-${Date.now()}`;
    const width = 1280, height = 800;
    const { posX, posY } = nextNodePosition({ ...opts, placeLeftOfUrlNodes: true, width });
    const placeholderNode = {
      id, kind: 'site', origin_url: url,
      pos_x: posX, pos_y: posY, width, height,
      is_main: nodes.length === 0,
      current_html: null, _loading: true
    };
    setNodes((prev) => [...prev, placeholderNode]);

    try {
      const cap = await api.captureUrl(url);
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
      console.error(e);
      setNodes((prev) => prev.filter((n) => n.id !== id));
      alert(e.message || 'Could not add this URL.');
    }
  }

  async function handleUploadHtml(file, opts = {}) {
    const html = await file.text();
    if (!/^<!doctype|<html/i.test(html.trim())) {
      alert('File does not look like a complete HTML document.');
      return;
    }
    const { posX, posY } = nextNodePosition(opts);
    try {
      const created = await api.createNode({
        boardId: board.id, kind: 'site',
        posX, posY, width: 1280, height: 800,
        meta: { name: file.name, source: 'upload' },
        html
      });
      setNodes((prev) => [...prev, { ...created.node, current_html: html }]);
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
    } catch (e) { alert(`Upload failed: ${e.message}`); }
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
    } catch (e) { alert(`Upload failed: ${e.message}`); }
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
    } catch (e) { alert(`Could not add prompt: ${e.message}`); }
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
    } catch (e) { alert(`Could not add skill: ${e.message}`); }
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
      alert(`Reset failed: ${e.message}`);
    }
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
      alert(`Duplicate failed: ${err.message}`);
    }
  }

  function handleDownloadNode(id) {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const isMd = n.kind === 'designmd';
    const content = isMd ? (n.current_design_md || '') : (n.current_html || '');
    if (!content) { alert('Nothing to download yet.'); return; }
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
      } catch (err) { alert(`Edge create failed: ${err.message}`); }
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
      alert(`Apply failed: ${e.message}`);
    }
  }

  async function handleUpdateEdge(edge, payload) {
    try {
      await api.updateEdge(edge.id, { payload });
      setEdges((prev) => prev.map((x) => (x.id === edge.id ? { ...x, payload } : x)));
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleDeleteEdge(edge) {
    setEdges((prev) => prev.filter((x) => x.id !== edge.id));
    setSelectedEdgeId(null);
    setPopupPos(null);
    await api.deleteEdge(edge.id).catch(console.warn);
  }

  async function persistBoardName(name) {
    if (name === board.name) return;
    await api.renameBoard(board.id, name).catch(console.warn);
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

  function handleEditingToggle(nodeId, willEdit) {
    if (willEdit) {
      setEditingNodeId(nodeId);
      const node = nodes.find((n) => n.id === nodeId);
      if (node) setTimeout(() => zoomToNode(node), 50);
    } else {
      setEditingNodeId(null);
    }
  }

  function fitToContent(animationTime = 350) {
    const t = transformRef.current;
    if (!t || nodes.length === 0) return;
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

  // Block browser-level zoom (Cmd/Ctrl + wheel, trackpad pinch sends ctrlKey)
  // so it doesn't compete with the canvas's own pan/zoom.
  useEffect(() => {
    function onWheelCapture(e) {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
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
      <Minimap nodes={nodes} transformRef={transformRef} />

      <TransformWrapper
        ref={transformRef}
        minScale={0.1}
        maxScale={2.5}
        initialScale={0.6}
        initialPositionX={-WORLD_WIDTH * 0.25}
        initialPositionY={-WORLD_HEIGHT * 0.25}
        limitToBounds={false}
        wheel={{ step: 0.08, excluded: ['cnode-iframe', 'cnode-handle', 'edge-popup', 'superwidget', 'canvas-toolbar-left', 'canvas-toolbar-right', 'canvas-toolbars-left', 'canvas-toolbars-right', 'canvas-theme-floater', 'zoom-controls', 'zoom-menu'] }}
        panning={{ excluded: ['cnode', 'cnode-topbar', 'cnode-body', 'cnode-iframe', 'cnode-handle', 'cnode-viewport-switcher', 'cnode-vp-btn', 'cnode-port-right', 'cnode-port-left', 'edge-line', 'edge-popup', 'reset-confirm-card', 'reset-confirm-overlay', 'superwidget', 'canvas-toolbar-left', 'canvas-toolbar-right', 'canvas-toolbars-left', 'canvas-toolbars-right', 'canvas-theme-floater', 'zoom-controls', 'zoom-menu', 'user-menu'] }}
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
              onResize={(width) => {
                updateNodeLocal(n.id, { width });
                if (!String(n.id).startsWith('temp-')) {
                  api.updateNode(n.id, { width }).catch(console.warn);
                }
              }}
              onDelete={() => handleDeleteNode(n.id)}
              onReset={() => handleResetNode(n.id)}
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
            const file = await pickFile('image/*');
            setContextMenu(null);
            if (file) alert('Coming next: screenshot → image node.\nPicked: ' + file.name);
          }}
          onPickPrompt={() => {
            setContextMenu(null);
            alert('Coming next: prompt → AI-generated node.');
          }}
          onPickCode={() => {
            setContextMenu(null);
            alert('Coming next: paste raw code → code node.');
          }}
        />
      )}

      <input ref={fileInputRef} type="file" onChange={onFileInputChange} style={{ display: 'none' }} />

      <PromptDock
        onAddUrl={handleAddUrl}
        onUploadMd={handleUploadMd}
        onUploadHtml={handleUploadHtml}
        onAddPrompt={() => handleAddPrompt()}
        onAddSkill={() => handleAddSkill()}
        nodeCount={nodes.length}
      />
    </div>
  );
}

function CanvasContextMenu({ x, y, onClose, onPickUrl, onPickHtml, onPickMd, onPickScreenshot, onPickPrompt, onPickCode }) {
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
      className="empty-drop-menu canvas-context-menu"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {mode === 'choices' ? (
        <>
          <div className="edm-title">Add to canvas</div>
          <button onClick={() => setMode('url')}><MenuIcon.Url /><span>Add URL</span></button>
          <button onClick={onPickHtml}><MenuIcon.Html /><span>Add HTML</span></button>
          <button onClick={onPickMd}><MenuIcon.Md /><span>Add .md file</span></button>
          <button onClick={onPickScreenshot}><MenuIcon.Image /><span>Add Screenshot</span></button>
          <button onClick={onPickPrompt}><MenuIcon.Prompt /><span>Add Prompt</span></button>
          <button onClick={onPickCode}><MenuIcon.Code /><span>Add Code</span></button>
          <button className="edm-cancel" onClick={onClose}>Cancel (Esc)</button>
        </>
      ) : (
        <>
          <div className="edm-title">URL of website</div>
          <input
            autoFocus type="text" placeholder="example.com or full URL"
            value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const norm = normalizeUrl(url);
                if (norm) onPickUrl(norm);
              }
              if (e.key === 'Escape') onClose();
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setMode('choices')} className="edm-cancel">← Back</button>
            <button onClick={() => { const norm = normalizeUrl(url); if (norm) onPickUrl(norm); }} disabled={!looksLikeUrl(url)} className="edm-primary">Capture →</button>
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
    <div className="empty-drop-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="edm-title">Extract to…</div>
      <button onClick={onPickMd}><MenuIcon.Md /><span>design.md</span></button>
      <button onClick={onPickSkill}><MenuIcon.Skill /><span>skill</span></button>
      <button onClick={onPickHtml}><MenuIcon.Html /><span>.html</span></button>
      <button className="edm-cancel" onClick={onClose}>Cancel (Esc)</button>
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
