'use client';

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { nodeOrigin, originColor } from '../lib/node-origin.js';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { api } from '../lib/canvas-api.js';
import CanvasNode from './CanvasNode.jsx';
import ConfirmModal from './ConfirmModal.jsx';
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
import { BLANK_SITE_HTML } from '../lib/blank-site-html.js';
import { findSectionTerminal, sectionRerunWouldOverwrite, chainSignature } from '../lib/section-run.js';
import { clampToViewport } from '../lib/menu-position.js';
import {
  shouldTearOut, nodeCenter, pointInRect,
  selectGeometricMembersToLatch, TEAR_MARGIN,
} from '../lib/section-membership.js';

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

// Section frame breathing room (world px). Sides + bottom share the
// uniform gap; the top reserves extra space for the name tag + play
// button which keep a stable on-screen size across zoom levels. Shared
// by the sections derivation (frame defaults + geometric-absorption core
// rects) and the drag-release logic in handleNodeMoveEnd, which must
// agree on the SAME core area or nodes get stuck half-released.
const SECTION_UNIFORM_GAP = 165;
const SECTION_TOP_GAP = 260;
// Breathing margin kept between a member node's edge and the section frame.
// Used both by the live adopt-preview engulf and the committed grow path —
// they MUST share this value so dropping a node in causes zero snap. Bumped
// up so a node transported into a section lands with comfortable room around
// it, not hugging the frame edge.
const SECTION_MEMBER_CLEARANCE = 288;   // node↔frame-edge clearance +300% (was 72)
// "Don't ask again" pref for the section re-run confirm modal.
const RERUN_CONFIRM_SKIP_KEY = 'rb-rerun-confirm-skip';
// Asset cards draw their dims label below the body — counted in every
// section bbox so frames wrap the full visual footprint.
const ASSET_BOTTOM_OVERFLOW = 80;

// Core area of a section = members' bbox + default gaps. The STORED
// frame is grow-only and chases dragged members, so membership tests
// must use this stable core instead.
function sectionCoreRect(memberNodes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of memberNodes) {
    if (!n) continue;
    const overflow = (n.kind === 'asset' || n.kind === 'image') ? ASSET_BOTTOM_OVERFLOW : 0;
    minX = Math.min(minX, n.pos_x || 0);
    minY = Math.min(minY, n.pos_y || 0);
    maxX = Math.max(maxX, (n.pos_x || 0) + (n.width || 0));
    maxY = Math.max(maxY, (n.pos_y || 0) + (n.height || 0) + overflow);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    left: minX - SECTION_UNIFORM_GAP,
    top: minY - SECTION_TOP_GAP,
    right: maxX + SECTION_UNIFORM_GAP,
    bottom: maxY + SECTION_UNIFORM_GAP,
  };
}

// Empty scaffold for the "Add blank website" flow. Renders as a calm
// near-white page with a dashed-frame hint so the empty state reads as
// intentional ("compose here") rather than a broken capture. Designed
// to work inside our srcDoc iframe — no external resources, no scripts,
// system font fallback (the UI font isn't loaded inside iframes).

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
  // Last scale we pushed into React state. onTransformed fires repeatedly as
  // TransformWrapper settles (and setTransform with anim=0 fires it inline);
  // pushing setCanvasScale on every fire re-renders → can re-enter the
  // transform → "Maximum update depth exceeded". We only setState when the
  // scale actually moved (epsilon), which breaks that feedback.
  const lastAppliedScaleRef = useRef(0.6);
  const [lightMode, setLightMode] = useState(false);
  // Pan-on-space mode. Default cursor is the arrow + drag = marquee select.
  // Holding Space switches to grab cursor + drag = pan canvas (Figma /
  // Linear convention). `spaceDown` toggles TransformWrapper panning.disabled
  // and adds a `canvas-pan-mode` class to <body> for cursor + UX hints.
  const [spaceDown, setSpaceDown] = useState(false);
  // Marquee selection rect — viewport coords while drawing, set to null when
  // not active. Drawn as a fixed overlay; on mouseup we convert to world
  // coords and intersect with each node's rect to pick the selection set.
  const [marquee, setMarquee] = useState(null);
  // Multi-selection lives alongside the single `selectedNodeId` so all the
  // single-select code (inspector, popup, edit-mode entry) keeps working.
  // selectedNodeIds is the source of truth for batch ops (Delete, future
  // multi-move). When non-empty AND no single selection, render highlights
  // on every member.
  const [selectedNodeIds, setSelectedNodeIds] = useState(() => new Set());
  // Undo stack for destructive canvas actions. Each entry is one operation
  // the user can reverse with Cmd+Z. Keep this in a ref (not state) so the
  // keyboard handler always sees the latest stack without re-binding.
  // Entry shape: { type: 'deleteNodes', nodes: [...rows], edges: [...rows] }.
  const undoStackRef = useRef([]);
  // Accumulator of nodes the agent created across a single run. Each
  // graph_mutated refetch appends new node IDs/rows here. RUN_FINISHED
  // reads + clears so the end-of-run camera frame can fit the entire
  // workflow at once instead of jumping per-node mid-run.
  const agentRunNewNodesRef = useRef(new Map());
  // Bot-protection interstitial state. When captureSnapshot returns 409
  // challenge_required, we stash {kind, url, signals, placeholderId} here
  // so <ChallengeModal /> mounts. placeholderId lets the modal's cancel /
  // open-site handlers clean up the temp node from the canvas.
  const [challenge, setChallenge] = useState(null);
  // Active section selection — the workflow the user is currently operating
  // on. When set, the PromptDock surfaces a ContextPill, the section frame
  // gets an accent border, and the agent receives section context with every
  // chat message it sends.
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  // Play-section confirm modal: holds the section being re-executed while
  // the user confirms in the modal.
  const [playSection, setPlaySection] = useState(null); // { section, busy }
  // Right-click context menu over a section. Holds the section id + the
  // viewport coords where the menu should anchor.
  const [sectionMenu, setSectionMenu] = useState(null); // { sectionId, x, y }
  // Measured viewport-clamp for the (inline) section context menu — same
  // robustness as the EmptyDropMenu / CanvasContextMenu hook, but the menu
  // is rendered inline via a portal so it can't use the hook directly.
  const sectionMenuRef = useRef(null);
  const [sectionMenuPos, setSectionMenuPos] = useState(null);
  useLayoutEffect(() => {
    if (!sectionMenu) { setSectionMenuPos(null); return; }
    const el = sectionMenuRef.current;
    if (el) setSectionMenuPos(clampToViewport(sectionMenu.x, sectionMenu.y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
  }, [sectionMenu]);
  // Section pending delete confirmation. Same ConfirmModal pattern as
  // playSection — { section, busy }.
  const [sectionDelete, setSectionDelete] = useState(null);
  // Single-node pending delete confirmation (from the node ⋯ menu). Styled
  // ConfirmModal in place of the old native confirm() — { id, name }.
  const [nodeDelete, setNodeDelete] = useState(null);
  // Custom section names — sections are derived from connected components,
  // so the id is stable as long as members don't change. We keep overrides
  // in localStorage keyed by that id; the auto-generated theme name is the
  // fallback when no override exists.
  //
  // Initial state MUST be {} on both server + first client render to avoid
  // hydration mismatch (server has no localStorage; client would otherwise
  // populate with stored values and the sections useMemo would compute
  // different x/y/width/height between render passes). The useEffect below
  // hydrates from localStorage AFTER the first paint, scheduling a normal
  // re-render with the real values.
  const [sectionNameOverrides, setSectionNameOverrides] = useState({});
  // Section frames — absolute coords per section. Replaces the older
  // delta-based size override. The frame "sticks" at its initial / last
  // user-positioned size; node drags only push the frame outward when a
  // member node gets within MIN_FRAME_CLEARANCE (40px) of the frame edge.
  // {sectionId: {left, top, right, bottom}}. Same hydration-safe pattern
  // as sectionNameOverrides — populated post-mount via useEffect.
  const [sectionFrames, setSectionFrames] = useState({});
  // Post-mount hydration of the override maps from localStorage. Running
  // once after the first render keeps SSR + first client paint identical
  // (both start with {}); the stored values land on the SECOND paint, so
  // React's hydration tree comparison never sees a mismatch.
  // Storage keys are board-scoped — the old global keys meant visiting
  // board B wiped board A's frames via the orphan cleanup. One-time
  // orphaning of the legacy global keys is accepted (plan A1).
  const SECTION_NAMES_KEY = `rb-section-names:${board.id}`;
  const SECTION_FRAMES_KEY = `rb-section-frames:${board.id}`;
  useEffect(() => {
    try {
      const namesRaw = localStorage.getItem(SECTION_NAMES_KEY);
      if (namesRaw) {
        const parsed = JSON.parse(namesRaw);
        if (parsed && typeof parsed === 'object') setSectionNameOverrides(parsed);
      }
    } catch {}
    try {
      const framesRaw = localStorage.getItem(SECTION_FRAMES_KEY);
      if (framesRaw) {
        const parsed = JSON.parse(framesRaw);
        if (parsed && typeof parsed === 'object') setSectionFrames(parsed);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function setSectionNameOverride(sectionId, name) {
    setSectionNameOverrides((prev) => {
      const next = { ...prev };
      const trimmed = (name || '').trim();
      if (trimmed) next[sectionId] = trimmed;
      else delete next[sectionId];
      try { localStorage.setItem(SECTION_NAMES_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  // ── Drag-adoption state (plan A4) ──────────────────────────────────
  // While a LOOSE node (no real edges) is dragged over another section's
  // frame, that section live-expands to engulf it. adoptPreview carries the
  // candidate + the engulfed rect; the ref mirrors state synchronously so
  // the mouseup commit never reads a stale closure (same pattern as
  // draftEdgeRef).
  const [adoptPreview, setAdoptPreview] = useState(null); // {nodeId, sectionId, rootId, rect:{left,top,right,bottom}}
  const adoptPreviewRef = useRef(null);
  // Drag-to-place: a freshly-added node (from the + menu) follows the cursor as
  // a semi-transparent ghost until the user clicks to drop it. Implemented as a
  // SYNTHETIC loose-drag so it reuses the exact section-adoption machinery
  // (maybeUpdateAdoptPreview / handleNodeMoveEnd). placingNodeRef mirrors the
  // node object synchronously for the window listeners; lastPointerRef seeds the
  // initial position under the cursor.
  const [placingNodeId, setPlacingNodeId] = useState(null);
  const placingNodeRef = useRef(null);
  // When a URL is added from the "+" toolbar, the temp placeholder is placed
  // with the ghost first; this stashes the capture to fire once it's dropped.
  const pendingUrlCaptureRef = useRef(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  // Multi-file placement queue ("Add multiple files"): files are placed one at
  // a time, each reusing the single-node placement ghost. A cursor-anchored
  // pill shows "current/total files". placeQueue (state) drives the pill;
  // placeQueueRef (sync) holds the remaining files for the window listeners.
  const [placeQueue, setPlaceQueue] = useState(null); // { current, total } | null
  const placeQueueRef = useRef(null); // { files, index, total } | null
  const placePillRef = useRef(null);
  // rAF coalescer + state for the FLOATING "run this flow" button. When a
  // section's in-place run-pill rises into the top viewport zone, it crossfades
  // to a button anchored in the canvas UI (left of the zoom widget) instead of
  // scrolling away / hiding behind other elements.
  const reanchorRafRef = useRef(0);
  const [floatingRunSectionId, setFloatingRunSectionId] = useState(null);
  const lastFloatingSectionRef = useRef(null);
  function setAdoptPreviewSync(v) {
    adoptPreviewRef.current = v;
    setAdoptPreview(v);
  }
  // Pre-drag snapshot for loose-node drags: lets the node's own singleton
  // frame TRANSLATE with the drag (instead of being stretched by the
  // grow-only frame logic) and gives the drop handler the start position.
  const looseDragRef = useRef(null); // {nodeId, startX, startY, lastX, lastY, ownSectionId, ownRectAtStart}
  // While a node is being dragged, its membership in the section graph must
  // stay FROZEN — otherwise the geometric-absorption step recomputes from the
  // node's live position every frame, so pushing a node around its section's
  // edge makes loose members fall in/out and whole sections merge/split
  // mid-drag (the erratic "node leaves / section vanishes / others expelled"
  // behaviour). The frame still follows the node live (grow-only bbox); only
  // the absorption GEOMETRY uses this frozen start position. Adoption/release
  // is decided once, on drop, by the move-end handler.
  const [dragFreeze, setDragFreeze] = useState(null); // { id, startX, startY }
  // Organic node removal. `removing` holds the node that is "armed" to leave
  // its section (entered by an elastic pull-out past the tear margin, or via
  // the node menu). While armed the node shows the red removal state; dropping
  // it OUTSIDE the section commits (breaks all its edges + clears adoption),
  // dropping it back INSIDE — or the Cancel button — cancels.
  const [removing, setRemoving] = useState(null); // { nodeId, sectionId, rootId }
  const removingRef = useRef(null);
  function setRemovingSync(v) { removingRef.current = v; setRemoving(v); }
  // True while an armed node is currently dragged outside its section — drives
  // the subtle canvas lighten.
  const [removingOutside, setRemovingOutside] = useState(false);
  // Close the section context menu on outside click or Escape.
  useEffect(() => {
    if (!sectionMenu) return;
    function onDown(e) {
      if (!e.target?.closest?.('.section-context-menu')) setSectionMenu(null);
    }
    function onKey(e) { if (e.key === 'Escape') setSectionMenu(null); }
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [sectionMenu]);
  // Imperative ref to the PromptDock so the canvas can fire chat sends
  // from the section play button without round-tripping through props.
  const promptDockRef = useRef(null);
  const transformRef = useRef(null);

  // ── HMR / refresh hard reset of canvas-scale state ────────────────────
  // `--canvas-scale` lives as an inline style on <html>, and the two
  // `canvas-zoom-low` / `canvas-zoom-very-low` classes follow it. Both are
  // only WRITTEN by TransformWrapper's onTransformed callback — never
  // cleared. That leaves three failure modes:
  //   (1) Next.js Fast Refresh swaps the component but leaves the previous
  //       inline style on <html>. The new TransformWrapper mounts at
  //       initialScale=0.6 but onTransformed doesn't fire until the user
  //       interacts, so the stale value (e.g. 0.1 from a zoomed-out session)
  //       is what CSS reads — inverse-scaled chrome becomes 10× bigger.
  //   (2) React StrictMode double-invokes effects in dev; if the previous
  //       cycle's class state lingers across the remount cycle the same
  //       "huge chrome" symptom appears.
  //   (3) Cross-refresh — Chrome occasionally preserves inline style on
  //       html across navigations in dev (Fast Navigation cache). User-
  //       reported symptom: "tudo aumenta a cada refresh."
  // Defensive cleanup: remove the property + classes on mount AND unmount
  // so every mount starts with a clean baseline. The next onTransformed
  // fire (which TransformWrapper triggers when it settles initialScale)
  // restores the correct value.
  useLayoutEffect(() => {
    const reset = () => {
      // Pin the baseline to match `initialScale` below so the chrome
      // doesn't flash native-sized between mount and the first
      // onTransformed fire. If you change initialScale, update this too.
      document.documentElement.style.setProperty('--canvas-scale', '0.6');
      document.documentElement.classList.remove('canvas-zoom-low', 'canvas-zoom-mid', 'canvas-zoom-very-low', 'canvas-zoom-min');
    };
    reset();
    return () => {
      document.documentElement.style.removeProperty('--canvas-scale');
      document.documentElement.classList.remove('canvas-zoom-low', 'canvas-zoom-mid', 'canvas-zoom-very-low', 'canvas-zoom-min');
    };
  }, []);

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

  // Space-to-pan: while the user holds Space, switch from marquee-select
  // mode (default) to drag-to-pan mode. Skip when the focus is inside an
  // editable field so we don't break typing. Also reset on blur so the
  // user can't get stuck in pan mode if they Cmd+Tabbed out mid-hold.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function isTypingTarget(el) {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }
    function onKeyDown(e) {
      if (e.code !== 'Space') return;
      if (isTypingTarget(e.target)) return;
      if (e.repeat) return;
      e.preventDefault();
      setSpaceDown(true);
    }
    function onKeyUp(e) {
      if (e.code !== 'Space') return;
      setSpaceDown(false);
    }
    function onBlur() { setSpaceDown(false); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Mirror spaceDown to a <body> class so CSS can swap the cursor
  // (default arrow ↔ grab) without prop-drilling.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('canvas-pan-mode', spaceDown);
    return () => document.body.classList.remove('canvas-pan-mode');
  }, [spaceDown]);

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

    // Section frames are placement obstacles too (plan A5): a standalone
    // node must never spawn on top of someone else's workflow frame. Two
    // exemptions keep creation flows sane:
    //  - connector flows (linkFromNodeId) — the source's section is the
    //    one the node is JOINING; treating it as an obstacle would push
    //    the node out of its own section.
    //  - explicit world-coord creations (context menu / cord drop) whose
    //    anchor lands INSIDE a frame — the user aimed there, so the node
    //    is adopted into that section instead of being shoved away.
    //    Returned as `adoptInto` for the caller to persist.
    let allowedSectionId = null;
    let adoptInto = null;
    if (opts.linkFromNodeId) {
      const src = sections.find((s) => s.memberIds.includes(opts.linkFromNodeId));
      if (src) allowedSectionId = src.id;
    } else if (opts.worldX != null && opts.worldY != null) {
      const hit = sections.find((s) =>
        opts.worldX >= s.x && opts.worldX <= s.x + s.width &&
        opts.worldY >= s.y && opts.worldY <= s.y + s.height);
      if (hit && !String(hit.rootId || '').startsWith('temp-')) {
        allowedSectionId = hit.id;
        adoptInto = { sectionId: hit.id, rootId: hit.rootId };
      }
    }
    const sectionObstacles = sections.filter((s) => s.id !== allowedSectionId);

    // Find a non-overlapping (x, y) starting from a desired anchor. Walks
    // right first (raster), drops a row when no x fits, eventually returns
    // the desired anchor verbatim if 2k iterations didn't find space (unrealistic).
    function settle(desiredX, desiredY) {
      function overlaps(testX, testY) {
        const nodeHit = nodes.some((n) => {
          if (n._loading && !n.width) return false;
          const nx = n.pos_x, ny = n.pos_y;
          const nw = n.width || 1280, nh = n.height || 800;
          return !(testX + newW + GAP <= nx ||
                   nx + nw + GAP <= testX ||
                   testY + newH + GAP <= ny ||
                   ny + nh + GAP <= testY);
        });
        if (nodeHit) return true;
        return sectionObstacles.some((s) =>
          !(testX + newW + GAP <= s.x ||
            s.x + s.width + GAP <= testX ||
            testY + newH + GAP <= s.y ||
            s.y + s.height + GAP <= testY));
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
    // the anchor but slide off any collision. When the anchor sits inside an
    // adopting section we skip the obstacle dance entirely: the frame will
    // grow around the node, overlap with members is still avoided.
    if (opts.worldX != null && opts.worldY != null) {
      const s = settle(opts.worldX, opts.worldY);
      return { posX: s.x, posY: s.y, adoptInto };
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
    if (!sourceNodeId || !newNodeId) return null;
    // Mark membership intent BEFORE the edge round-trip so the sections
    // memo unions the new node with its source immediately — no one-render
    // singleton-frame flash while the edge is in flight (plan A3).
    const clearPending = () => setNodes((prev) => prev.map((n) => {
      if (n.id !== newNodeId || n._pendingLinkFrom === undefined) return n;
      const next = { ...n };
      delete next._pendingLinkFrom;
      return next;
    }));
    setNodes((prev) => prev.map((n) => (n.id === newNodeId ? { ...n, _pendingLinkFrom: sourceNodeId } : n)));
    try {
      const { edge } = await api.createEdge({
        boardId: board.id, sourceNodeId, targetNodeId: newNodeId,
        kind: 'transplant', payload: { sourceSelector: 'body', targetSelector: 'body' }
      });
      setEdges((prev) => [...prev, edge]);
      clearPending();
      return edge;
    } catch (e) {
      console.warn('auto-link failed', e);
      clearPending();
      return null;
    }
  }

  // ── Drag adoption (plan A4) ─────────────────────────────────────────
  // Nodes touched by at least one REAL edge (both endpoints present).
  // Mirrors the sections derivation rule — adoption only applies to
  // edge-less ("loose") nodes; connectivity membership always wins.
  const edgeTouchedIds = useMemo(() => {
    const present = new Set(nodes.map((n) => n.id));
    const s = new Set();
    for (const e of edges) {
      if (present.has(e.source_node_id) && present.has(e.target_node_id)) {
        s.add(e.source_node_id);
        s.add(e.target_node_id);
      }
    }
    return s;
  }, [nodes, edges]);

  function nodeWorldRect(node, posX, posY) {
    const isAsset = node.kind === 'asset' || node.kind === 'image';
    return {
      left: posX,
      top: posY,
      right: posX + (node.width || 600),
      // Same visual overflow assets get in the section bbox math, so the
      // preview rect exactly equals the post-commit grow result.
      bottom: posY + (node.height || 600) + (isAsset ? ASSET_BOTTOM_OVERFLOW : 0),
    };
  }

  function handleNodeMoveStart(node) {
    if (String(node.id).startsWith('temp-')) return;
    // Freeze this node's absorption geometry for the whole drag so a member's
    // live movement never reshapes its section's core (which would expel/absorb
    // other nodes mid-drag).
    setDragFreeze({ id: node.id, startX: node.pos_x, startY: node.pos_y });
    // Track EVERY dragged node — edge-connected members included — so the
    // elastic tear-out gesture works the same for all of them. `isLoose` gates
    // the adopt-into-ANOTHER-section preview (only loose nodes join a new
    // section by drag); tear-out (leaving the OWN section) applies to all.
    const own = sections.find((s) => s.memberIds.includes(node.id) && s.memberIds.length > 1) || null;
    // Core of the REMAINING members (stable — excludes the dragged node), the
    // reference the tear-out threshold is measured against.
    const remainingCore = own
      ? sectionCoreRect(own.memberIds.filter((id) => id !== node.id).map((id) => nodes.find((n) => n.id === id)).filter(Boolean))
      : null;
    looseDragRef.current = {
      nodeId: node.id,
      startX: node.pos_x,
      startY: node.pos_y,
      lastX: node.pos_x,
      lastY: node.pos_y,
      isLoose: !edgeTouchedIds.has(node.id),
      ownSectionId: own?.id || null,
      ownRootId: own?.rootId || null,
      remainingCore,
    };
  }

  function maybeUpdateAdoptPreview(node, posX, posY) {
    const drag = looseDragRef.current;
    if (!drag || drag.nodeId !== node.id) return;
    drag.lastX = posX;
    drag.lastY = posY;
    const rect = nodeWorldRect(node, posX, posY);

    // ── Elastic tear-out ────────────────────────────────────────────────
    // A member detaches from its OWN section when its center is pulled past
    // the remaining-members core by TEAR_MARGIN. Until then the frame just
    // stretches (grow-only). Once armed, it stays armed for the rest of the
    // drag; the drop decides commit (outside) vs cancel (inside).
    if (drag.ownSectionId && drag.remainingCore) {
      const { cx, cy } = nodeCenter(node, posX, posY);
      // Scale the tear threshold inversely with zoom so it takes the SAME
      // on-screen pull to detach at any zoom — the further out (smaller
      // scale), the larger the world-space margin.
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale')) || 1;
      const margin = TEAR_MARGIN / (scale > 0 ? scale : 1);
      if (!removingRef.current && shouldTearOut(cx, cy, drag.remainingCore, margin)) {
        const sec = sections.find((s) => s.id === drag.ownSectionId);
        const siblingIds = sec ? sec.memberIds.filter((id) => id !== node.id) : [];
        setRemovingSync({ nodeId: node.id, sectionId: drag.ownSectionId, rootId: drag.ownRootId, siblingIds, armX: node.pos_x, armY: node.pos_y });
        if (adoptPreviewRef.current) setAdoptPreviewSync(null);
      }
    }
    // While a removal is armed for THIS node, drive the canvas-lighten by
    // whether it's currently outside its (now member-fitted) section frame,
    // and skip the join-another-section preview entirely.
    if (removingRef.current && removingRef.current.nodeId === node.id) {
      const { cx, cy } = nodeCenter(node, posX, posY);
      const rect = removalSectionRect(removingRef.current);
      const inside = pointInRect(cx, cy, rect);
      // Dragged BACK inside before releasing → un-arm live so the node
      // returns to its natural colour immediately (no waiting for the drop).
      // Re-arms if pulled past the tear margin again. Menu-armed nodes stay
      // armed until an explicit Cancel/Escape/commit, so they're excluded.
      if (inside && !removingRef.current.fromMenu) {
        setRemovingSync(null);
        setRemovingOutside(false);
        return;
      }
      setRemovingOutside(!inside);
      return;
    }

    // Only loose nodes (no real edge) can be ADOPTED into another section by
    // dragging — edge-connected members already belong to their workflow.
    if (!drag.isLoose) return;
    // NOTE: a node drag must NEVER translate a section frame. The frame only
    // expands/retracts to fit its members (grow-only derivation + shrink on
    // membership change) — moving the WHOLE section is a separate gesture via
    // the grip handle (startSectionMove).
    // Candidate = the section whose BASE rendered rect intersects the
    // dragged node (testing the base rect — not the expanded preview —
    // avoids the "once engulfed, can never leave" trap). Largest
    // intersection wins when frames overlap.
    let best = null, bestArea = 0;
    for (const s of sections) {
      if (s.memberIds.includes(node.id)) continue;
      if (String(s.rootId || '').startsWith('temp-')) continue;
      const ix = Math.min(rect.right, s.x + s.width) - Math.max(rect.left, s.x);
      const iy = Math.min(rect.bottom, s.y + s.height) - Math.max(rect.top, s.y);
      if (ix <= 0 || iy <= 0) continue;
      const area = ix * iy;
      if (area > bestArea) { best = s; bestArea = area; }
    }
    if (!best) {
      if (adoptPreviewRef.current) setAdoptPreviewSync(null);
      return;
    }
    // Engulf rect = section frame grown to contain the node with the same
    // clearance the committed grow path uses ⇒ zero snap on drop.
    const CLEAR = SECTION_MEMBER_CLEARANCE;
    const previewRect = {
      left:   Math.min(best.x, rect.left - CLEAR),
      top:    Math.min(best.y, rect.top - CLEAR),
      right:  Math.max(best.x + best.width, rect.right + CLEAR),
      bottom: Math.max(best.y + best.height, rect.bottom + CLEAR),
    };
    const cur = adoptPreviewRef.current;
    if (cur && cur.sectionId === best.id &&
        cur.rect.left === previewRect.left && cur.rect.top === previewRect.top &&
        cur.rect.right === previewRect.right && cur.rect.bottom === previewRect.bottom) return;
    setAdoptPreviewSync({ nodeId: node.id, sectionId: best.id, rootId: best.rootId, rect: previewRect });
  }

  function handleNodeMove(node, posX, posY) {
    updateNodeLocal(node.id, { pos_x: posX, pos_y: posY });
    if (!String(node.id).startsWith('temp-')) persistNodePosition(node.id, posX, posY);
    maybeUpdateAdoptPreview(node, posX, posY);
  }

  async function handleNodeMoveEnd(node, moved) {
    // Unfreeze membership — from here the next render re-derives sections from
    // live positions (the node has settled), so adoption/release lands once.
    setDragFreeze(null);
    const drag = looseDragRef.current;
    looseDragRef.current = null;
    const preview = adoptPreviewRef.current;
    if (preview) setAdoptPreviewSync(null);

    // Armed removal — decide on drop: outside the section commits the removal
    // (break all edges + clear adoption); inside cancels (stays a member).
    const arm = removingRef.current;
    if (arm && arm.nodeId === node.id && moved) {
      const fx = drag ? drag.lastX : node.pos_x;
      const fy = drag ? drag.lastY : node.pos_y;
      const { cx, cy } = nodeCenter(node, fx, fy);
      const inside = pointInRect(cx, cy, removalSectionRect(arm));
      if (inside) cancelNodeRemoval();
      else await commitNodeRemoval(node, fx, fy, arm);
      return;
    }

    if (!moved || !drag || drag.nodeId !== node.id) return;
    const finalX = drag.lastX;
    const finalY = drag.lastY;

    // Combined position+meta PATCH for both commit paths below — the
    // debounced position PATCH must be cancelled first, otherwise its
    // delayed write reads the node row server-side and clobbers the meta
    // we just committed (plan A4's subtlest race).
    const commitMeta = async (meta) => {
      clearTimeout(dragNodeServer.current.get(node.id));
      dragNodeServer.current.delete(node.id);
      setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, meta } : n)));
      await api.updateNode(node.id, { posX: finalX, posY: finalY, meta });
    };

    // Adopt — dropped while a section preview was active.
    if (preview && preview.nodeId === node.id) {
      const meta = { ...(node.meta || {}), adoptedInto: preview.rootId };
      setSectionFrames((prev) => {
        const next = { ...prev, [preview.sectionId]: preview.rect };
        // Retire the node's singleton frame; if it came from ANOTHER
        // section, drop that section's stored frame too so it re-fits to
        // its remaining members instead of keeping the drag-stretched rect.
        delete next[`section-${node.id}`];
        if (drag.ownSectionId && drag.ownSectionId !== preview.sectionId) delete next[drag.ownSectionId];
        try { localStorage.setItem(SECTION_FRAMES_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
      try {
        await commitMeta(meta);
      } catch (e) {
        console.warn('adopt failed', e);
        toast.error('Could not attach the node to the section.');
        setNodes((prev) => prev.map((n) => {
          if (n.id !== node.id) return n;
          const m = { ...(n.meta || {}) };
          delete m.adoptedInto;
          return { ...n, meta: m };
        }));
      }
      return;
    }

    // NOTE: there is no silent "release on drop outside" anymore. A member
    // stays a member when simply dragged around — leaving a section is an
    // explicit gesture (elastic tear-out) or menu action, handled by the
    // armed-removal branch above. This is what makes every in-section node
    // behave consistently.
    //
    // Eager latch: if the moved node was a member only geometrically (no real
    // edge, no adoption marker yet), persist meta.adoptedInto NOW — in the same
    // batched update as dragFreeze clearing — so the post-drop re-derivation
    // never sees it briefly leave the section. Without this, a geometric member
    // could drop for one render (section vanishes → its manually-resized frame
    // gets GC'd → reappears fit-to-content), wiping a manual resize.
    if (drag.ownSectionId && drag.ownRootId &&
        !edgeTouchedIds.has(node.id) && !node.meta?.adoptedInto) {
      const meta = { ...(node.meta || {}), adoptedInto: drag.ownRootId };
      setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, meta } : n)));
      if (!String(node.id).startsWith('temp-')) {
        api.updateNode(node.id, { meta }).catch(() => {});
      }
    }
  }

  // ── Drag-to-place a freshly added node ─────────────────────────────────
  // Starts a SYNTHETIC loose-drag of `node` so it tracks the cursor and reuses
  // the section-adoption preview + commit. Called by the + menu add handlers.
  function startPlacement(node, { allowTemp = false } = {}) {
    // Persisted nodes only by default. A URL placeholder is a temp- node that
    // gets placed BEFORE it's captured/persisted, so it opts in via allowTemp;
    // handleNodeMove/End already skip the server PATCH for temp- ids.
    if (!node || (!allowTemp && String(node.id).startsWith('temp-'))) return;
    // Seed under the cursor (centered) so it appears at the mouse immediately
    // instead of flashing at its auto-computed slot.
    const p = lastPointerRef.current;
    const w = clientToWorld(transformRef, p.x, p.y);
    const px = w.x - (node.width || 1280) / 2;
    const py = w.y - (node.height || 720) / 2;
    placingNodeRef.current = { ...node, pos_x: px, pos_y: py };
    updateNodeLocal(node.id, { pos_x: px, pos_y: py });
    setDragFreeze({ id: node.id, startX: px, startY: py });
    looseDragRef.current = {
      nodeId: node.id, startX: px, startY: py, lastX: px, lastY: py,
      isLoose: true, ownSectionId: null, ownRootId: null, remainingCore: null,
    };
    setPlacingNodeId(node.id);
  }

  // ── Multi-file placement queue ────────────────────────────────────────────
  // Map a picked file to the node kind it becomes on the canvas.
  function classifyQueueFile(file) {
    const name = (file.name || '').toLowerCase();
    const type = file.type || '';
    if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/.test(name)) return 'image';
    if (/\.(md|markdown)$/.test(name) || type === 'text/markdown') return 'md';
    if (/\.html?$/.test(name) || type === 'text/html') return 'html';
    return null;
  }

  // Create one queued file's node on the server and RETURN it WITHOUT mounting
  // (no setNodes, no undo, no placement). Lets the queue pre-create the next
  // node in the background while the current one is being placed, so files
  // 2..N appear instantly instead of each waiting on a fresh round-trip.
  // Mirrors handleUpload{Screenshot,Md,Html}'s createNode params; kept separate
  // so those shared handlers stay untouched. Returns null on read/validation
  // failure (toast already shown).
  async function createQueueNode(file) {
    const k = classifyQueueFile(file);
    try {
      if (k === 'html') {
        const html = await file.text();
        if (!/^<!doctype|<html/i.test(html.trim())) {
          toast.error(`${file.name}: not a complete HTML document.`);
          return null;
        }
        const width = 1280, height = Math.round(width * 9 / 16);
        const { posX, posY } = nextNodePosition({ width, height });
        const created = await api.createNode({
          boardId: board.id, kind: 'site', posX, posY, width, height,
          meta: { name: file.name, source: 'upload' }, html,
        });
        return { ...created.node, current_html: html };
      }
      if (k === 'md') {
        const text = await file.text();
        const width = 600, height = 600;
        const { posX, posY } = nextNodePosition({ width, height });
        const created = await api.createNode({
          boardId: board.id, kind: 'designmd', posX, posY, width, height,
          meta: { name: file.name }, designMd: text,
        });
        return { ...created.node, current_design_md: text };
      }
      if (k === 'image') {
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(fr.error || new Error('read failed'));
          fr.readAsDataURL(file);
        });
        const width = 600, height = 600;
        const { posX, posY } = nextNodePosition({ width, height });
        const created = await api.createNode({
          boardId: board.id, kind: 'asset', posX, posY, width, height,
          meta: { name: file.name, dataUrl, mimeType: file.type || 'image/*' },
        });
        return { ...created.node };
      }
    } catch (e) {
      toast.error(`Upload failed: ${e.message}`);
    }
    return null;
  }

  // Mount a pre-created node and start placing it (ghost follows the cursor).
  // Dedup guard: a board refetch mid-queue could already have pulled the
  // server-created node into state — don't add it twice (duplicate key).
  function mountAndPlace(node) {
    setNodes((prev) => (prev.some((n) => n.id === node.id) ? prev : [...prev, node]));
    pushCreateUndo(node, null);
    startPlacement(node);
  }

  // Enter the queue: stash placeable files and start placing the first.
  function handleQueueFiles(files) {
    const placeable = [];
    let skipped = 0;
    for (const f of files) { if (classifyQueueFile(f)) placeable.push(f); else skipped += 1; }
    if (skipped) toast.error(`${skipped} unsupported file${skipped > 1 ? 's' : ''} skipped (use images, .md, or .html).`);
    if (!placeable.length) return;
    placeQueueRef.current = { files: placeable, index: 0, total: placeable.length, prefetch: null };
    startNextQueued();
  }

  // Place the next queued file. Uses the background-prefetched node when ready;
  // otherwise creates it now (showing the cursor spinner via placeQueue.loading)
  // and kicks off prefetch for the file after it. The drop handler advances the
  // index and calls back here; an empty queue clears the pill.
  async function startNextQueued() {
    const q = placeQueueRef.current;
    if (!q || q.index >= q.total) { placeQueueRef.current = null; setPlaceQueue(null); return; }
    const i = q.index;
    setPlaceQueue({ current: i + 1, total: q.total, loading: true });
    const pending = q.prefetch || createQueueNode(q.files[i]);
    q.prefetch = null;
    const node = await pending;
    // Cancelled (Escape) while awaiting — discard the orphan and stop.
    if (placeQueueRef.current !== q) {
      if (node?.id) api.deleteNode(node.id).catch(() => {});
      return;
    }
    // Creation failed/unsupported → skip on, keep the queue moving.
    if (!node) { q.index += 1; return startNextQueued(); }
    mountAndPlace(node);
    setPlaceQueue({ current: i + 1, total: q.total, loading: false });
    // Pre-create the NEXT file in the background so its ghost is instant.
    if (i + 1 < q.total) q.prefetch = createQueueNode(q.files[i + 1]);
  }

  // Tear down the queue: clear pill/state and reap any prefetched-but-unplaced
  // node (created on the server, never mounted) so it doesn't orphan.
  function cancelQueue() {
    const q = placeQueueRef.current;
    placeQueueRef.current = null;
    setPlaceQueue(null);
    if (q?.prefetch) {
      q.prefetch.then((n) => { if (n?.id) api.deleteNode(n.id).catch(() => {}); }).catch(() => {});
    }
  }

  // Run a section's flow — the shared logic behind the in-place run-pill and
  // the floating run button (confirm only when a result would be overwritten).
  function runSectionFlow(s) {
    if (!s || !s.hasEdges) return;
    // Already producing → ignore. Button runs and agent runs both register the
    // target in runStatus, so this blocks a second run on a busy section.
    if ((s.memberIds || []).some((mid) => runStatus.has(mid))) return;
    let skip = false;
    try { skip = localStorage.getItem(RERUN_CONFIRM_SKIP_KEY) === '1'; } catch {}
    if (skip || !sectionRerunWouldOverwrite(s, nodes, edges)) { runSectionRerun(s); return; }
    setPlaySection({ section: s, busy: false });
  }

  // ── Floating run button ─────────────────────────────────────────────────
  // When a section's in-place run-pill leaves the comfortable viewport — off
  // the TOP (into the chrome zone) OR off either SIDE — float a button anchored
  // beside the zoom widget. Detection uses the pill's OWN rect (it keeps its
  // natural layout even while faded out), so it covers every edge, not just the
  // top. The most-visible section wins; the in-place pill fades out in tandem.
  function updateFloatingRun() {
    if (typeof document === 'undefined') return;
    const ANCHOR_TOP = 70;  // top chrome zone — pill above this counts as "off"
    const vh = window.innerHeight, vw = window.innerWidth;
    let best = null, bestArea = -1;
    const chromes = document.querySelectorAll('.canvas-section-chrome[data-section-id]');
    chromes.forEach((chrome) => {
      // Clear any stale inline offsets from older builds (the in-place pill is
      // no longer repositioned — the floating button owns the off-screen case).
      const pill = chrome.querySelector('.canvas-section-name-tag');
      if (pill && (pill.style.top || pill.style.right)) { pill.style.top = ''; pill.style.right = ''; }
      // Only float RUNNABLE sections (a disabled pill = no cords) so the in-place
      // pill never fades away without a floating button to replace it.
      if (!pill || pill.classList.contains('disabled')) return;
      const cr = chrome.getBoundingClientRect();
      // Section body must still be on-screen for running it to be relevant.
      if (cr.bottom <= 0 || cr.top >= vh || cr.right <= 0 || cr.left >= vw) return;
      // Pill clipped by ANY viewport edge → it's out of reach, so float.
      const pr = pill.getBoundingClientRect();
      const clipped = pr.top < ANCHOR_TOP || pr.right > vw || pr.left < 0;
      if (!clipped) return;
      const visW = Math.min(cr.right, vw) - Math.max(cr.left, 0);
      const visH = Math.min(cr.bottom, vh) - Math.max(cr.top, 0);
      const area = Math.max(0, visW) * Math.max(0, visH);
      if (area > bestArea) { bestArea = area; best = chrome.getAttribute('data-section-id'); }
    });
    setFloatingRunSectionId((cur) => (cur === best ? cur : best));
  }
  function scheduleReanchorPills() {
    if (reanchorRafRef.current) return;
    reanchorRafRef.current = requestAnimationFrame(() => {
      reanchorRafRef.current = 0;
      updateFloatingRun();
    });
  }

  // Keep the last cursor position so a placement can seed under the mouse.
  useEffect(() => {
    const onMove = (e) => { lastPointerRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // While placing: the ghost node follows the cursor (handleNodeMove drives the
  // adopt preview + position persistence); the next canvas click drops it
  // (handleNodeMoveEnd commits adoption + final position); Escape drops it where
  // it sits. The triggering + menu click is long gone by the time placement
  // starts (node creation awaits the server), so it never self-drops.
  useEffect(() => {
    if (!placingNodeId) return;
    const onMove = (e) => {
      const node = placingNodeRef.current;
      if (!node) return;
      const w = clientToWorld(transformRef, e.clientX, e.clientY);
      const px = w.x - (node.width || 1280) / 2;
      const py = w.y - (node.height || 720) / 2;
      handleNodeMove(node, px, py);
    };
    const drop = () => {
      const node = placingNodeRef.current;
      // URL placeholder: it was placed BEFORE capture. Commit the dropped
      // position locally (no server call — it's still a temp- node) and kick
      // off the capture there instead of the normal move-end persist.
      const pend = node ? pendingUrlCaptureRef.current : null;
      if (node && pend && pend.id === node.id) {
        const drag = looseDragRef.current;
        const fx = drag?.lastX ?? node.pos_x;
        const fy = drag?.lastY ?? node.pos_y;
        updateNodeLocal(node.id, { pos_x: fx, pos_y: fy });
        pendingUrlCaptureRef.current = null;
        placingNodeRef.current = null;
        setPlacingNodeId(null);
        runUrlCapture(pend.id, pend.url, { posX: fx, posY: fy, width: pend.width, height: pend.height, isMain: pend.isMain }, pend.opts);
        return;
      }
      if (node) {
        const drag = looseDragRef.current;
        handleNodeMoveEnd(
          { ...node, pos_x: drag?.lastX ?? node.pos_x, pos_y: drag?.lastY ?? node.pos_y },
          true,
        );
      }
      placingNodeRef.current = null;
      setPlacingNodeId(null);
      // Multi-file queue: this file is placed — advance to the next one. The
      // pill updates via setPlaceQueue inside startNextQueued.
      const q = placeQueueRef.current;
      if (q) { q.index += 1; startNextQueued(); }
    };
    const onClick = (e) => {
      // Drop only on the canvas — ignore clicks that land on chrome.
      if (e.target?.closest?.('.prompt-dock, .canvas-header, .canvas-toolbars-left, .canvas-toolbars-right, .canvas-toolbar-left, .canvas-toolbar-right, .empty-drop-menu, .canvas-context-menu, .zoom-controls, .zoom-menu, .user-menu, .boards-sidebar, .cnode-version-ctx-menu')) return;
      e.preventDefault();
      e.stopPropagation();
      drop();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Escape cancels the rest of the queue (reaping any prefetched node);
        // the current ghost still drops where it sits (drop() sees the cleared
        // queue and stops advancing).
        if (placeQueueRef.current) cancelQueue();
        drop();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [placingNodeId]);

  // While a multi-file queue is active, anchor the "current/total files" pill
  // to the cursor. Position is written straight to the DOM (no re-render per
  // mousemove) — the React state only carries the counter text, which changes
  // once per file, not per frame.
  useEffect(() => {
    if (!placeQueue) return;
    const place = (x, y) => {
      const el = placePillRef.current;
      if (el) el.style.transform = `translate(${x + 18}px, ${y + 18}px)`;
    };
    const seed = lastPointerRef.current;
    place(seed.x, seed.y);
    const move = (e) => place(e.clientX, e.clientY);
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [placeQueue]);

  // The live "inside" region for an armed removal: the section frame derived
  // from the remaining siblings (robust to the section re-rooting when the
  // armed node was its root), falling back to the siblings' core when the
  // section dissolved (e.g. a 2-member section losing one).
  function removalSectionRect(arm) {
    if (!arm) return null;
    const sibIds = arm.siblingIds || [];
    const sec = sections.find((s) => sibIds.some((id) => s.memberIds.includes(id)));
    if (sec) return { left: sec.x, top: sec.y, right: sec.x + sec.width, bottom: sec.y + sec.height };
    const sibs = sibIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean);
    return sectionCoreRect(sibs);
  }

  // Arm a node for removal from its section (menu action). The node enters the
  // red removal state; the user then drags it outside to commit (or Cancel).
  function armNodeRemoval(node) {
    const own = sections.find((s) => s.memberIds.includes(node.id) && s.memberIds.length > 1);
    if (!own) return;
    const siblingIds = own.memberIds.filter((id) => id !== node.id);
    setRemovingSync({ nodeId: node.id, sectionId: own.id, rootId: own.rootId, siblingIds, fromMenu: true, armX: node.pos_x, armY: node.pos_y });
    setRemovingOutside(false);
  }

  // Cancel an armed removal — the node stays a member, edges + adoption intact.
  function cancelNodeRemoval() {
    setRemovingSync(null);
    setRemovingOutside(false);
  }

  // Commit removal — the node leaves the section: all of its edges are cut and
  // its adoption marker cleared, so it becomes a free standalone node at its
  // dropped position. The abandoned section's stored frame is reset so it
  // re-fits its remaining members.
  async function commitNodeRemoval(node, finalX, finalY, arm) {
    setRemovingSync(null);
    setRemovingOutside(false);
    // Cut every edge touching this node.
    const touching = edges.filter((e) => e.source_node_id === node.id || e.target_node_id === node.id);
    if (touching.length) {
      setEdges((prev) => prev.filter((e) => e.source_node_id !== node.id && e.target_node_id !== node.id));
      for (const e of touching) {
        if (!String(e.id).startsWith('temp-')) api.deleteEdge(e.id).catch(console.warn);
      }
    }
    // Clear adoption + persist final position.
    const meta = { ...(node.meta || {}) };
    delete meta.adoptedInto;
    clearTimeout(dragNodeServer.current.get(node.id));
    dragNodeServer.current.delete(node.id);
    setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, pos_x: finalX, pos_y: finalY, meta } : n)));
    if (!String(node.id).startsWith('temp-')) {
      api.updateNode(node.id, { posX: finalX, posY: finalY, meta }).catch(console.warn);
    }
    // Reset the abandoned section's frame so it shrinks to its remaining members.
    if (arm?.sectionId) {
      setSectionFrames((prev) => {
        const next = { ...prev };
        delete next[arm.sectionId];
        try { localStorage.setItem(SECTION_FRAMES_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    }
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
        // Cheap probe — ~30 bytes vs ~85KB when the route streams snapshot.html
        // on every 3s tick. We only do the full GET once `ready:true` lands.
        const probe = await api.getNode(nodeId, { readyCheck: true });
        if (probe?.ready) {
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
    const isMain = nodes.length === 0;
    const { posX, posY } = nextNodePosition({ ...opts, placeLeftOfUrlNodes: true, width });
    const placeholderNode = {
      id, kind: 'site', origin_url: url,
      pos_x: posX, pos_y: posY, width, height,
      is_main: isMain,
      current_html: null, _loading: true
    };
    setNodes((prev) => [...prev, placeholderNode]);

    // "+" toolbar add (no anchored position, no cord) → place the node first,
    // ghost following the cursor, exactly like blank/md/screenshot adds. The
    // capture only starts once the user drops it (see the placement drop()).
    if (opts.worldX == null && !opts.linkFromNodeId) {
      pendingUrlCaptureRef.current = { id, url, width, height, isMain, opts };
      startPlacement(placeholderNode, { allowTemp: true });
      return;
    }
    await runUrlCapture(id, url, { posX, posY, width, height, isMain }, opts);
  }

  // Runs the (2-3 min) capture for a URL placeholder already on the canvas and
  // swaps it for the real persisted node. Split out of handleAddUrl so the "+"
  // path can defer it until the ghost is dropped.
  async function runUrlCapture(id, url, geom, opts = {}) {
    const { posX, posY, width, height, isMain } = geom;
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
        isMain
      };
      const cap = await api.captureUrlStream(url, null, (step) => {
        setNodes((prev) => prev.map((n) =>
          n.id === id ? { ...n, _loadingLabel: STAGE_LABEL[step] || step } : n
        ));
      }, placement);
      const created = await api.createNode({
        boardId: board.id, kind: 'site', originUrl: url,
        posX, posY, width, height,
        isMain,
        html: cap.html
      });
      const finalNode = {
        ...created.node,
        current_html: cap.html,
        current_screenshot: cap.screenshotDataUrl,
        _loading: false
      };
      setNodes((prev) => prev.map((n) => (n.id === id ? finalNode : n)));
      let linkEdge = null;
      if (opts.linkFromNodeId) linkEdge = await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      // Undo entry only AFTER the real (persisted) node exists — undoing
      // a creation mid-capture would orphan the placeholder swap.
      pushCreateUndo(created.node, linkEdge);
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
      // Use console.warn instead of console.error so Next.js's dev-server
      // doesn't surface the red full-screen error overlay for an expected
      // outcome (unreachable host, bot-policy block on the CDN, etc).
      // The toast already conveys the failure to the user.
      console.warn('[capture-url] failed:', e?.message || e);
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
    const { posX, posY, adoptInto } = nextNodePosition(opts);
    try {
      const meta = { name: file.name, source: 'upload' };
      if (adoptInto && !opts.linkFromNodeId) meta.adoptedInto = adoptInto.rootId;
      const created = await api.createNode({
        boardId: board.id, kind: 'site',
        posX, posY, width: 1280, height: Math.round(1280 * 9 / 16),
        meta,
        html
      });
      const finalNode = { ...created.node, current_html: html };
      setNodes((prev) => [...prev, finalNode]);
      let linkEdge = null;
      if (opts.linkFromNodeId) linkEdge = await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      pushCreateUndo(created.node, linkEdge);
      if (!opts.linkFromNodeId && opts.worldX == null) startPlacement(finalNode);
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
    const { posX, posY, adoptInto } = nextNodePosition({ ...opts, width });
    try {
      const meta = { source: 'blank', name: 'Blank website' };
      if (adoptInto && !opts.linkFromNodeId) meta.adoptedInto = adoptInto.rootId;
      const created = await api.createNode({
        boardId: board.id, kind: 'site',
        posX, posY, width, height,
        isMain: nodes.length === 0,
        meta,
        html: BLANK_SITE_HTML
      });
      const finalNode = { ...created.node, current_html: BLANK_SITE_HTML };
      setNodes((prev) => [...prev, finalNode]);
      let linkEdge = null;
      if (opts.linkFromNodeId) linkEdge = await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      pushCreateUndo(created.node, linkEdge);
      // + menu add → let the user place it (ghost follows the cursor). Cord/
      // context-menu adds keep their anchored position + zoom.
      if (!opts.linkFromNodeId && opts.worldX == null) startPlacement(finalNode);
      else setTimeout(() => zoomToNode(finalNode, 350, 1), 80);
    } catch (e) { toast.error(`Could not add blank website: ${e.message}`); }
  }

  async function handleUploadMd(file, opts = {}) {
    const text = await file.text();
    // Square node — the new MdPreviewBody renders a typography sample,
    // colour palette + lorem-ipsum stack inside a 1:1 frame.
    const width = 600, height = 600;
    const { posX, posY, adoptInto } = nextNodePosition({ ...opts, width, height });
    try {
      const meta = { name: file.name };
      if (adoptInto && !opts.linkFromNodeId) meta.adoptedInto = adoptInto.rootId;
      const created = await api.createNode({
        boardId: board.id, kind: 'designmd',
        posX, posY, width, height,
        meta,
        designMd: text
      });
      const finalNode = { ...created.node, current_design_md: text };
      setNodes((prev) => [...prev, finalNode]);
      let linkEdge = null;
      if (opts.linkFromNodeId) linkEdge = await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      pushCreateUndo(created.node, linkEdge);
      if (!opts.linkFromNodeId && opts.worldX == null) startPlacement(finalNode);
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
    const { posX, posY, adoptInto } = nextNodePosition({ ...opts, width, height });
    try {
      const meta = { name: file.name, dataUrl, mimeType: file.type || 'image/*' };
      if (adoptInto && !opts.linkFromNodeId) meta.adoptedInto = adoptInto.rootId;
      const created = await api.createNode({
        boardId: board.id,
        kind: 'asset',
        posX, posY, width, height,
        meta
      });
      const finalNode = { ...created.node };
      setNodes((prev) => [...prev, finalNode]);
      let linkEdge = null;
      if (opts.linkFromNodeId) linkEdge = await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      pushCreateUndo(created.node, linkEdge);
      if (!opts.linkFromNodeId && opts.worldX == null) startPlacement(finalNode);
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
      const meta = { name: asset.name || 'asset', dataUrl: imageSrc, mimeType: 'image/*' };
      // Library drops keep the cursor-centered position; when that point
      // lands inside a section frame the node joins that section instead
      // of overlapping it as a stranger.
      const hit = sections.find((s) =>
        w.x >= s.x && w.x <= s.x + s.width && w.y >= s.y && w.y <= s.y + s.height);
      if (hit && !String(hit.rootId || '').startsWith('temp-')) meta.adoptedInto = hit.rootId;
      const created = await api.createNode({
        boardId: board.id,
        kind: 'asset',
        posX, posY, width, height,
        meta
      });
      setNodes((prev) => [...prev, { ...created.node }]);
      pushCreateUndo(created.node, null);
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
    const { posX, posY, adoptInto } = nextNodePosition({ ...opts, width, height });
    try {
      const meta = { name: 'prompt', prompt: '' };
      if (adoptInto && !opts.linkFromNodeId) meta.adoptedInto = adoptInto.rootId;
      const created = await api.createNode({
        boardId: board.id, kind: 'prompt',
        posX, posY, width, height,
        meta
      });
      const finalNode = { ...created.node };
      setNodes((prev) => [...prev, finalNode]);
      let linkEdge = null;
      if (opts.linkFromNodeId) linkEdge = await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      pushCreateUndo(created.node, linkEdge);
      setSelectedNodeId(created.node.id);
      if (!opts.linkFromNodeId && opts.worldX == null) startPlacement(finalNode);
    } catch (e) { toast.error(`Could not add prompt: ${e.message}`); }
  }

  async function handleAddSkill(opts = {}) {
    // Skill is a small, square card with a file glyph + name. Default
    // dimensions read as a "tile" rather than a document.
    const width = 240, height = 280;
    const { posX, posY, adoptInto } = nextNodePosition({ ...opts, width, height });
    try {
      const meta = { name: 'skill' };
      if (adoptInto && !opts.linkFromNodeId) meta.adoptedInto = adoptInto.rootId;
      const created = await api.createNode({
        boardId: board.id, kind: 'skill',
        posX, posY, width, height,
        meta
      });
      const finalNode = { ...created.node };
      setNodes((prev) => [...prev, finalNode]);
      let linkEdge = null;
      if (opts.linkFromNodeId) linkEdge = await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      pushCreateUndo(created.node, linkEdge);
      if (!opts.linkFromNodeId && opts.worldX == null) startPlacement(finalNode);
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

  // Per-kind upload accept filters (plan C). One map drives the empty
  // node's center upload button AND the connect-to/context pickers, so a
  // node kind can never ingest the wrong format. accept= on the input is
  // advisory only — validFileForKind re-checks after the pick.
  const ACCEPT_BY_KIND = {
    site: '.html,.htm,text/html',
    designmd: '.md,.markdown,text/markdown',
    asset: 'image/*',
  };
  const MAX_ASSET_UPLOAD_BYTES = 10 * 1024 * 1024;

  function validFileForKind(kind, file) {
    const name = (file?.name || '').toLowerCase();
    if (kind === 'site') return /\.html?$/.test(name) || file?.type === 'text/html';
    if (kind === 'designmd') return /\.(md|markdown)$/.test(name);
    if (kind === 'asset') return (file?.type || '').startsWith('image/');
    return false;
  }

  // Record a creation on the undo stack so Cmd+Z removes the node again
  // (plus its auto-link edge when the creation came from a connector).
  function pushCreateUndo(node, edge) {
    if (!node) return;
    undoStackRef.current.push({ type: 'createNodes', nodes: [node], edges: edge ? [edge] : [] });
  }

  // "Connect to" flow (plan B): create an UNPOPULATED node of the picked
  // category at the cord-drop point, auto-linked to its source node. The
  // body renders a centered upload button (prompt is the exception — it
  // opens as an inline-editable textarea); content arrives later through
  // handlePopulateNode.
  async function handleCreateEmptyNode(kind, opts = {}) {
    const DIMS = {
      site:     { width: 1280, height: Math.round(1280 * 9 / 16) },
      designmd: { width: 600,  height: 600 },
      asset:    { width: 600,  height: 600 },
      prompt:   { width: 600,  height: 200 },
    };
    const { width, height } = DIMS[kind] || DIMS.designmd;
    const { posX, posY, adoptInto } = nextNodePosition({ ...opts, width, height });
    const NAME = { site: 'Untitled.html', designmd: 'Untitled.md', asset: 'Untitled image', prompt: 'prompt' };
    const meta = { name: NAME[kind] || 'Untitled' };
    if (kind === 'site') meta.source = 'empty';
    if (kind === 'prompt') meta.prompt = '';
    if (adoptInto && !opts.linkFromNodeId) meta.adoptedInto = adoptInto.rootId;
    try {
      const created = await api.createNode({
        boardId: board.id, kind,
        posX, posY, width, height,
        meta
      });
      setNodes((prev) => [...prev, { ...created.node }]);
      let linkEdge = null;
      if (opts.linkFromNodeId) linkEdge = await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      pushCreateUndo(created.node, linkEdge);
      if (kind === 'prompt') setSelectedNodeId(created.node.id);
    } catch (e) { toast.error(`Could not create node: ${e.message}`); }
  }

  // "Extract to" flow: derive a NEW node from a source node (site/asset).
  // Unlike Connect-to (empty node to fill later), extract runs a generator
  // and lands a populated node. Shows a loading placeholder while the
  // generator runs (LLM / screenshot can take a few seconds).
  async function handleExtractTo(to, { sourceNodeId, worldX, worldY }) {
    const tmpId = `tmp-extract-${sourceNodeId}-${to}`;
    const tmpEdgeId = `tmp-extract-edge-${sourceNodeId}-${to}`;
    // The placeholder's KIND must match the node being extracted so its
    // category colour-coding (border/ring/cord) reads correctly while it loads
    // — `to` maps: prompt → prompt, screenshot → asset, html → site, the rest
    // (.md flavours: designmd/content/style/tokens) → designmd. (lib/extract.js.)
    const kind =
      to === 'prompt' ? 'prompt' :
      to === 'screenshot' ? 'asset' :
      to === 'html' ? 'site' :
      'designmd';
    const width = kind === 'site' ? 1280 : 600;
    const height = kind === 'prompt' ? 200 : kind === 'site' ? Math.round(1280 * 9 / 16) : 600;
    const { posX, posY } = nextNodePosition({ worldX, worldY, width, height });
    const placeholder = {
      id: tmpId, board_id: board.id, kind,
      pos_x: posX, pos_y: posY, width, height,
      // _pendingLinkFrom unions the placeholder with its source in the
      // sections memo immediately — no singleton-frame flash while the
      // real edge round-trips.
      _pendingLinkFrom: sourceNodeId,
      meta: { name: `Extracting ${to}…` }, current_html: null, _loading: true,
      _loadingLabel: 'Extracting…',
    };
    // Optimistic cord source → placeholder so the derived node reads as
    // CONNECTED from the first frame (the real edge replaces it on refetch).
    const tmpEdge = {
      id: tmpEdgeId, board_id: board.id,
      source_node_id: sourceNodeId, target_node_id: tmpId, kind: 'generic',
    };
    setNodes((prev) => [...prev, placeholder]);
    setEdges((prev) => [...prev, tmpEdge]);
    try {
      // Persist the derived node at the SAME spot the placeholder occupies
      // so it doesn't jump on refetch (was stacked at the board bottom).
      const { node } = await api.extractNode(sourceNodeId, { to, posX, posY });
      // Pull the full board so the derived node arrives POPULATED (its
      // content lives in the snapshot the route created, not in the INSERT
      // RETURNING row). The fresh list omits the temp placeholder + temp
      // edge, so both are dropped in the same swap. Real edges bring the
      // source→derived cord.
      const fresh = await api.getBoard(board.id);
      if (Array.isArray(fresh.nodes)) setNodes(fresh.nodes);
      else setNodes((prev) => prev.filter((n) => n.id !== tmpId));
      if (Array.isArray(fresh.edges)) setEdges(fresh.edges);
      else setEdges((prev) => prev.filter((e) => e.id !== tmpEdgeId));
      setTimeout(() => zoomToNode(node, 350, 1), 80);
    } catch (e) {
      setNodes((prev) => prev.filter((n) => n.id !== tmpId));
      setEdges((prev) => prev.filter((e) => e.id !== tmpEdgeId));
      toast.error(`Could not extract: ${e.message}`);
    }
  }

  // Center upload button on an unpopulated node — opens the kind-scoped
  // picker and persists the content into the EXISTING node (snapshot for
  // site/designmd, meta.dataUrl for asset).
  async function handlePopulateNode(node) {
    const kind = node.kind === 'image' ? 'asset' : node.kind;
    const accept = ACCEPT_BY_KIND[kind];
    if (!accept) return;
    const file = await pickFile(accept);
    if (!file) return;
    if (!validFileForKind(kind, file)) {
      const expected = kind === 'asset' ? 'an image file'
        : kind === 'designmd' ? 'a .md file'
        : 'an .html file';
      toast.error(`This node only accepts ${expected}.`);
      return;
    }
    try {
      if (kind === 'site') {
        const html = await file.text();
        if (!/^<!doctype|<html/i.test(html.trim())) {
          toast.error('File does not look like a complete HTML document.');
          return;
        }
        await api.saveNodeContent(node.id, { html });
        const meta = { ...(node.meta || {}), name: file.name, source: 'upload' };
        setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, current_html: html, meta } : n)));
        api.updateNode(node.id, { meta }).catch(() => {});
      } else if (kind === 'designmd') {
        const text = await file.text();
        await api.saveNodeContent(node.id, { designMd: text });
        const meta = { ...(node.meta || {}), name: file.name };
        setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, current_design_md: text, meta } : n)));
        api.updateNode(node.id, { meta }).catch(() => {});
      } else {
        if (file.size > MAX_ASSET_UPLOAD_BYTES) {
          toast.error('Image too large (max 10MB).');
          return;
        }
        const dataUrl = await blobToDataUrl(file);
        const meta = { ...(node.meta || {}), name: file.name, dataUrl, mimeType: file.type || 'image/*' };
        setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, meta } : n)));
        await api.updateNode(node.id, { meta });
      }
    } catch (e) { toast.error(`Upload failed: ${e.message}`); }
  }

  // Capture a node + its incident edges for the undo stack BEFORE we strip
  // them from local state. Snapshot the *current* nodes/edges arrays since
  // setNodes/setEdges queue updates asynchronously.
  function captureForUndo(idSet) {
    const idsArr = Array.from(idSet);
    const snapshotNodes = nodes.filter((n) => idSet.has(n.id));
    const snapshotEdges = edges.filter((e) => idSet.has(e.source_node_id) || idSet.has(e.target_node_id));
    if (snapshotNodes.length === 0 && snapshotEdges.length === 0) return null;
    return { type: 'deleteNodes', nodes: snapshotNodes, edges: snapshotEdges };
  }

  async function handleDeleteNode(id) {
    const entry = captureForUndo(new Set([id]));
    if (entry) undoStackRef.current.push(entry);
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source_node_id !== id && e.target_node_id !== id));
    if (id.startsWith?.('temp-')) return;
    await api.deleteNode(id).catch(console.warn);
  }

  // Batch delete used by the Delete key when a multi-selection is active.
  // Updates local state once with a single pass, then fires the server
  // deletes in parallel so the canvas feels instant even on a big batch.
  async function handleDeleteNodes(ids) {
    if (!ids?.length) return;
    const idSet = new Set(ids);
    const entry = captureForUndo(idSet);
    if (entry) undoStackRef.current.push(entry);
    setNodes((prev) => prev.filter((n) => !idSet.has(n.id)));
    setEdges((prev) => prev.filter((e) => !idSet.has(e.source_node_id) && !idSet.has(e.target_node_id)));
    await Promise.all(
      ids
        .filter((id) => !String(id).startsWith('temp-'))
        .map((id) => api.deleteNode(id).catch(console.warn))
    );
  }

  // Pop the latest undo entry and reverse it. Only deleteNodes is supported
  // right now — restores both the nodes and any incident edges via the
  // /api/nodes/restore endpoint (uses ON CONFLICT DO NOTHING so it's safe
  // to invoke multiple times if the user spams Cmd+Z).
  async function handleUndo() {
    const entry = undoStackRef.current.pop();
    if (!entry) return;

    if (entry.type === 'createNodes') {
      // Reverse a creation — remove the created node(s) plus the auto-link
      // edge(s). No new undo entry is pushed (that would loop). Server-side
      // edge rows cascade away with the node delete.
      const ids = new Set(entry.nodes.map((n) => n.id));
      setNodes((prev) => prev.filter((n) => !ids.has(n.id)));
      setEdges((prev) => prev.filter((e) => !ids.has(e.source_node_id) && !ids.has(e.target_node_id)));
      for (const n of entry.nodes) {
        if (String(n.id).startsWith('temp-')) continue;
        api.deleteNode(n.id).catch(console.warn);
      }
      return;
    }

    if (entry.type === 'deleteNodes') {
      // Optimistic local restore first so the canvas snaps back instantly,
      // then send the server request. If the server fails, the local state
      // will get corrected on the next refetch / page reload.
      setNodes((prev) => {
        const ids = new Set(prev.map((n) => n.id));
        return [...prev, ...entry.nodes.filter((n) => !ids.has(n.id))];
      });
      setEdges((prev) => {
        // Dedup by edge id AND endpoint pair — an undo arriving after the
        // same pair was reconnected manually must not double the cord.
        const keys = new Set(prev.map((e) => `${e.source_node_id}::${e.target_node_id}`));
        const ids = new Set(prev.map((e) => e.id));
        return [...prev, ...entry.edges.filter((e) =>
          !ids.has(e.id) && !keys.has(`${e.source_node_id}::${e.target_node_id}`))];
      });
      // Skip server call for temp- ids (never persisted).
      const persistedNodes = entry.nodes.filter((n) => !String(n.id).startsWith('temp-'));
      const persistedEdges = entry.edges.filter((e) => !String(e.id || '').startsWith('temp-'));
      if (persistedNodes.length === 0 && persistedEdges.length === 0) return;
      try {
        await fetch('/api/nodes/restore', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            boardId: board.id,
            // Ship the snapshot content along — deleting the node cascaded
            // its snapshots away, so the restore route must RECREATE one
            // (otherwise the node comes back hollow after a reload).
            nodes: persistedNodes.map((n) => ({
              ...n,
              html: typeof n.current_html === 'string' ? n.current_html : null,
              design_md: typeof n.current_design_md === 'string' ? n.current_design_md : null,
            })),
            edges: persistedEdges,
          }),
        });
      } catch (e) {
        console.warn('[undo] restore call failed', e);
      }
    }
  }

  // Compute the set of nodes whose rects overlap a viewport-space marquee
  // rectangle. Shared between live mousemove updates (highlight nodes
  // before mouseup) and the final commit step.
  function hitsForMarqueeRect(clientX0, clientY0, clientX1, clientY1) {
    const a = clientToWorld(transformRef, Math.min(clientX0, clientX1), Math.min(clientY0, clientY1));
    const b = clientToWorld(transformRef, Math.max(clientX0, clientX1), Math.max(clientY0, clientY1));
    const hits = new Set();
    for (const n of nodes) {
      const nL = n.pos_x ?? 0, nT = n.pos_y ?? 0;
      const nR = nL + (n.width || 0), nB = nT + (n.height || 0);
      // Standard AABB intersection: hit when the marquee overlaps the
      // node rect at all (not just contains it — that matches Figma).
      if (nR < a.x || nL > b.x || nB < a.y || nT > b.y) continue;
      hits.add(n.id);
    }
    return hits;
  }

  // Marquee start: called from canvas-shell mousedown when (a) Space is NOT
  // held, (b) the click landed on the canvas background, not on a node /
  // edge / chrome. Tracks the rect + the live selection set in viewport
  // coords while drawing; nodes light up the instant the marquee touches
  // them, so the gesture has the same immediate feedback as in Figma.
  function startMarquee(ev) {
    const x0 = ev.clientX, y0 = ev.clientY;
    setMarquee({ x0, y0, x1: x0, y1: y0 });
    // Clear stale single-selection so visual feedback is unambiguous while
    // the user is drawing the marquee.
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPopupPos(null);
    setSelectedNodeIds((s) => (s.size ? new Set() : s));
    // Move keyboard focus off the prompt-dock textarea (or any input)
    // so the Delete key reaches the canvas keydown handler after the
    // marquee commits. Without this, focus stays in the textarea and
    // Delete just edits the input.
    if (typeof document !== 'undefined') {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') && typeof ae.blur === 'function') {
        ae.blur();
      }
    }
    let moved = false;
    function move(e) {
      moved = true;
      setMarquee({ x0, y0, x1: e.clientX, y1: e.clientY });
      // Live highlight: recompute hits each move so any node the marquee
      // currently overlaps shows the selection ring while the drag is in
      // flight. Cheap enough — N nodes × constant work, runs at mousemove
      // frequency.
      const hits = hitsForMarqueeRect(x0, y0, e.clientX, e.clientY);
      setSelectedNodeIds(hits);
    }
    function up(e) {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setMarquee(null);
      // Click-without-drag → treat as a "click on empty canvas" — clear
      // multi-select and leave it at that.
      if (!moved) {
        setSelectedNodeIds((s) => (s.size ? new Set() : s));
        return;
      }
      const hits = hitsForMarqueeRect(x0, y0, e.clientX, e.clientY);
      setSelectedNodeIds(hits);
      // Mirror the first hit into selectedNodeId so single-select consumers
      // (inspector / popup / focus targets) still see something selected.
      if (hits.size > 0) setSelectedNodeId(hits.values().next().value);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // Decide whether a canvas-shell mousedown should kick off a marquee.
  // Skip when the user is holding Space (pan mode), when they hit a node /
  // edge / chrome, or when an edit / modal is already in flight. Otherwise
  // call startMarquee with the event.
  function maybeStartMarquee(ev) {
    if (ev.button !== 0) return;            // left click only
    if (spaceDown) return;                  // pan mode owns the gesture
    if (editingNodeId) return;
    if (challenge) return;
    if (emptyDropMenu || contextMenu) return;
    if (draftEdge) return;
    const t = ev.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('.cnode, .edge-line, .edge-popup, .canvas-toolbar-left, .canvas-toolbar-right, .canvas-toolbars-left, .canvas-toolbars-right, .canvas-theme-floater, .prompt-dock, .empty-drop-menu, .canvas-context-menu, .canvas-header, .zoom-controls, .zoom-menu, .user-menu, .reset-confirm-card, .reset-confirm-overlay, .superwidget')) return;
    startMarquee(ev);
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

  // Restore a chosen PAST version (version-history floater). Moves
  // current_snapshot_id to that snapshot; non-destructive. Mirrors reset:
  // patch current_html + bump _resetTick so the iframe remounts.
  async function handleRestoreVersion(id, snapshotId) {
    if (String(id).startsWith('temp-') || !snapshotId) return;
    try {
      const { html, snapshot_id } = await api.restoreVersion(id, snapshotId);
      setNodes((prev) => prev.map((n) =>
        n.id === id
          ? { ...n, current_html: html, current_snapshot_id: snapshot_id, _resetTick: (n._resetTick || 0) + 1 }
          : n
      ));
    } catch (e) {
      toast.error(`Restore failed: ${e.message}`);
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
  // The real "client request" driving a run = the text of the prompt sources
  // wired into this target. Surfaced in the generating node's status line.
  function requestTextForTarget(id) {
    const srcIds = new Set(
      edges.filter((e) => e.target_node_id === id).map((e) => e.source_node_id)
    );
    const texts = nodes
      .filter((n) => srcIds.has(n.id) && n.meta?.prompt)
      .map((n) => String(n.meta.prompt).trim())
      .filter(Boolean);
    return texts.join(' ');
  }
  async function runOneTarget(id, opts = {}) {
    const request = requestTextForTarget(id);
    setNodeRunStatus(id, { step: 1, label: 'Reading inputs…', request });
    const advanceToStep2 = setTimeout(() => {
      setRunStatus((prev) => {
        const cur = prev.get(id);
        if (!cur || cur.step !== 1) return prev;
        const next = new Map(prev);
        next.set(id, { step: 2, label: 'Generating…', request });
        return next;
      });
    }, 1500);
    try {
      const result = await api.runNode(id, opts);
      clearTimeout(advanceToStep2);
      setNodeRunStatus(id, { step: 3, label: 'Saving…', request });
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
    const allRunnable = [...targets].filter((id) => {
      if (String(id).startsWith('temp-')) return false;
      const n = nodes.find((x) => x.id === id);
      if (!n) return false;
      // Site targets are runnable even WITHOUT content: an empty .html
      // node (from the Connect-to menu) is a composition target — the
      // server seeds it with the blank scaffold and the LLM builds the
      // page from the connected sources.
      return !!n.current_html || (n.kind === 'site' && !n._loading);
    });
    if (allRunnable.length === 0) {
      setRunFlowError('Connect at least one source node into a target with a snapshot, then try again.');
      setTimeout(() => setRunFlowError(null), 4000);
      return;
    }
    // Skip targets whose chain hasn't changed since its last run — re-running
    // a clean chain would just reproduce the same result and burn credits.
    // Editing a node or asking again in chat re-enables it.
    const runnable = allRunnable.filter((id) => !cleanTerminalIds.has(id));
    if (runnable.length === 0) {
      setRunFlowError('Nothing changed since the last run — edit a node or ask in chat to run a workflow again.');
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
          // Ran clean — gate this chain's run buttons until it changes again.
          const sec = sections.find((s) => s.memberIds.includes(id));
          if (sec) markSectionPendingClean(sec.id);
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

    // Asset nodes hold their data as a base64 data URL in meta.dataUrl.
    // Decode → blob → trigger download with the correct mime + extension
    // pulled from the data URL header (typically image/png from gpt-image-1
    // and Imagen; JPEG/WebP also supported).
    if (n.kind === 'asset' || n.kind === 'image') {
      const dataUrl = n.meta?.dataUrl;
      if (!dataUrl) { toast.info('Nothing to download yet.'); return; }
      const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (!m) { toast.error('Could not read this image.'); return; }
      const mime = m[1] || 'image/png';
      const base64 = m[2];
      // Map mime → file extension. Default to .png for unknowns.
      const ext = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg'
                : mime === 'image/webp' ? 'webp'
                : mime === 'image/gif'  ? 'gif'
                : 'png';
      const byteString = atob(base64);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      const baseName = (n.meta?.name || 'uncraft-image').toString().replace(/[^a-zA-Z0-9._-]+/g, '_');
      const fname = baseName.endsWith('.' + ext) ? baseName : `${baseName}.${ext}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      return;
    }

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

  // Play a section: execute whatever chain lives in it. The terminal
  // node's kind decides the engine (helpers in lib/section-run.js):
  //   - asset → deterministic image re-run, NO agent involved — the
  //     terminal asset stores everything we need (prompt, mode, aspect,
  //     base + style ref asset ids, provider) so the rerun is a pure
  //     data op. Same graph, new pixels.
  //   - site → compose engine (/api/nodes/[id]/run), the same call the
  //     PromptDock arrow makes. Works on a blank scaffold too.
  //   - designmd / others → honest "not supported yet" toast.

  async function handleConfirmPlaySection(skipFutureConfirms = false) {
    if (!playSection) return;
    const s = playSection.section;
    setPlaySection(null);
    if (skipFutureConfirms) {
      try { localStorage.setItem(RERUN_CONFIRM_SKIP_KEY, '1'); } catch {}
    }
    await runSectionRerun(s);
  }

  async function runSectionRerun(s) {
    // Edge-less sections (purely-adopted groups) have no flow to re-run;
    // the play button is hidden for them, this is the backstop.
    if (s.hasEdges === false) return;

    const { terminal, terminalId, count, unsupportedKind } = findSectionTerminal(s, nodes, edges);
    if (!terminal) {
      if (unsupportedKind) {
        toast.info(`This workflow ends in a ${unsupportedKind === 'designmd' ? '.md' : unsupportedKind} node — re-running it isn't supported yet.`);
      } else {
        toast.error(count === 0
          ? 'Could not find a terminal node to re-run in this workflow.'
          : 'This workflow has multiple terminal nodes; ambiguous re-run.');
      }
      return;
    }

    // Site terminal → compose engine. runOneTarget drives the 3-step
    // status chip below the node, exactly like the PromptDock arrow.
    if (terminal.kind === 'site') {
      try {
        const result = await runOneTarget(terminalId);
        if (result?.snapshotId) {
          setNodes((prev) => prev.map((n) => (
            n.id === terminalId
              ? {
                  ...n,
                  current_html: result.html,
                  current_snapshot_id: result.snapshotId,
                  _resetTick: (n._resetTick || 0) + 1,
                }
              : n
          )));
          // Ran clean — disable the run buttons until the chain changes.
          markSectionPendingClean(s.id);
        }
      } catch (e) {
        console.warn('[section-rerun] site compose failed:', e?.message || e);
        toast.error(e?.message || 'Re-run failed.');
      }
      return;
    }

    // Asset terminal → deterministic image re-run.
    // Optimistic: flip the terminal into the generating state right away
    // so the canvas card shows the same spinner the first run did. If
    // the server call errors we revert below.
    setNodes((prev) => prev.map((n) => (
      n.id === terminalId
        ? { ...n, meta: { ...(n.meta || {}), status: 'generating' } }
        : n
    )));

    try {
      const res = await fetch('/api/sections/rerun', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ terminalNodeId: terminalId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);

      // Patch the node in place with the new image data.
      setNodes((prev) => prev.map((n) => (
        n.id === terminalId
          ? {
              ...n,
              meta: {
                ...(n.meta || {}),
                dataUrl: body.dataUrl,
                mimeType: body.mimeType,
                provider: body.provider,
                status: 'done',
              },
            }
          : n
      )));
      // Ran clean — disable the run buttons until the chain changes.
      markSectionPendingClean(s.id);
    } catch (e) {
      console.warn('[section-rerun] failed:', e?.message || e);
      toast.error(e?.message || 'Re-run failed.');
      // Revert the optimistic generating flag so the existing image keeps showing.
      setNodes((prev) => prev.map((n) => (
        n.id === terminalId
          ? { ...n, meta: { ...(n.meta || {}), status: 'done' } }
          : n
      )));
    }
  }

  function handleClearActiveContext(nodeId) {
    // Without a target id, clears the entire context (section + all
    // selected nodes). With a target id, drops just that one node from
    // the multi-selection so the user can curate which pills stay.
    if (!nodeId) {
      setSelectedSectionId(null);
      setSelectedNodeId(null);
      setSelectedNodeIds((s) => (s.size ? new Set() : s));
      return;
    }
    setSelectedNodeId((cur) => (cur === nodeId ? null : cur));
    setSelectedNodeIds((s) => {
      if (!s.has(nodeId)) return s;
      const next = new Set(s);
      next.delete(nodeId);
      return next;
    });
  }

  // Replace node content with a freshly uploaded file. Accept image/html/md;
  // the endpoint figures out the new kind from the explicit `kind` we send
  // (derived from the file's mime + extension here) and patches the node row
  // accordingly. Border colour, body renderer, and tools all shift to match
  // the new media after refetch.
  async function handleReplaceContent(nodeId) {
    const file = await pickFile('image/*,.html,.htm,text/html,.md,.markdown,text/markdown,text/plain');
    if (!file) return;
    const name = file.name || 'replacement';
    const lowerName = name.toLowerCase();
    const mime = file.type || '';
    let payload = null;
    if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(lowerName)) {
      // Image → base64 data URL
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('Could not read image file'));
        fr.readAsDataURL(file);
      });
      payload = { kind: 'asset', dataUrl, mimeType: mime || 'image/png', name };
    } else if (/\.(html?|xhtml)$/i.test(lowerName) || mime === 'text/html') {
      const html = await file.text();
      if (!/<!doctype|<html|<body|<div|<section/i.test(html.trim())) {
        toast.error('File does not look like HTML.');
        return;
      }
      payload = { kind: 'site', html, name };
    } else if (/\.(md|markdown)$/i.test(lowerName) || mime === 'text/markdown' || mime === 'text/plain') {
      const designMd = await file.text();
      payload = { kind: 'designmd', designMd, name };
    } else {
      toast.error('Unsupported file type. Use image, .html, or .md.');
      return;
    }

    try {
      const res = await fetch(`/api/nodes/${nodeId}/replace-content`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      // Patch local state: new kind, new meta, new content fields. The
      // current_html / current_design_md come from a fresh snapshot the
      // endpoint just created.
      setNodes((prev) => prev.map((n) => {
        if (n.id !== nodeId) return n;
        const next = {
          ...n,
          kind: body.kind,
          meta: body.meta || n.meta,
        };
        if (body.kind === 'site') {
          next.current_html = payload.html;
          next.current_snapshot_id = body.snapshotId;
        }
        if (body.kind === 'designmd') {
          next.current_design_md = payload.designMd;
          next.current_snapshot_id = body.snapshotId;
        }
        if (body.kind === 'asset') {
          // No HTML/MD content fields apply to asset nodes.
          next.current_html = null;
          next.current_design_md = null;
          next.current_snapshot_id = null;
        }
        return next;
      }));
      toast.info('Content replaced.');
    } catch (e) {
      console.warn('[replace-content] failed:', e?.message || e);
      toast.error(e?.message || 'Replace failed.');
    }
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
        // Same focus steal as node selection — let Delete reach the canvas
        // keydown handler instead of dying inside the PromptDock textarea.
        if (typeof document !== 'undefined') {
          const ae = document.activeElement;
          if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') && typeof ae.blur === 'function') {
            ae.blur();
          }
        }
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
  const SLOT_SIZE = 19, SLOT_GAP = 6;
  // Receiver ports sit PORT_GAP screen px OUTSIDE the node's left edge — must
  // match EdgeLayer.PORT_GAP and the .cnode-port-stack-left CSS offset.
  const PORT_GAP = 11.385;
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
    const gap = PORT_GAP / scale;   // receiver ports float left of the edge
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
        const dx = (n.pos_x - gap) - w.x;
        const dy = slotY - w.y;
        const dist = Math.hypot(dx, dy);
        if (dist < radiusWorld && dist < bestDist) {
          best = { nodeId: n.id, slotIndex: i, slotCount, x: n.pos_x - gap, y: slotY };
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
    // An OUTPUT port can never receive a cord. Dropping on one cancels the
    // draft outright — otherwise the snap radius (or the .cnode fallback
    // below) would happily wire output→output, attaching the cord to the
    // target's LEFT slots while the user aimed at its right port.
    if (e.target?.closest?.('.cnode-port-right')) {
      setDraftEdgeSync(null);
      return;
    }
    // Snap target wins over closest('.cnode') so the magnetic affordance
    // is honoured even if the user's mouseup landed a few px off-target.
    let targetId = draft.snapTo?.nodeId || null;
    if (!targetId) {
      const cnode = e.target?.closest?.('.cnode');
      targetId = cnode?.dataset?.nodeId || null;
    }
    setDraftEdgeSync(null);

    if (targetId && targetId !== src) {
      // Optimistic (temp-) nodes have no DB row yet — the UUID columns reject
      // them (409). Hint and bail instead of firing a doomed request.
      if (String(src).startsWith('temp-') || String(targetId).startsWith('temp-')) {
        toast.error('That node is still being created — try again in a moment.');
        return;
      }
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
      // Optimistic: draw the cord INSTANTLY (temp id) instead of waiting on the
      // createEdge round-trip — the network latency was the "lag" before the
      // connection showed up. Reconcile to the real edge on success; roll back
      // on failure.
      const tempId = `temp-edge-${Date.now()}`;
      const optimisticEdge = {
        id: tempId, board_id: board.id,
        source_node_id: src, target_node_id: targetId,
        kind: 'transplant', status: 'pending',
        payload: { sourceSelector: 'body', targetSelector: 'body' },
      };
      setEdges((prev) => [...prev, optimisticEdge]);
      setSelectedEdgeId(tempId);
      try {
        const { edge } = await api.createEdge({
          boardId: board.id, sourceNodeId: src, targetNodeId: targetId,
          kind: 'transplant', payload: { sourceSelector: 'body', targetSelector: 'body' }
        });
        setEdges((prev) => prev.map((x) => (x.id === tempId ? edge : x)));
        setSelectedEdgeId((cur) => (cur === tempId ? edge.id : cur));
      } catch (err) {
        setEdges((prev) => prev.filter((x) => x.id !== tempId));
        setSelectedEdgeId((cur) => (cur === tempId ? null : cur));
        toast.error(`Edge create failed: ${err.message}`);
      }
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
      '.cnode-version-menu',
      '.cnode-version-ctx-menu',
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
        // Cancel an armed node removal first — Esc is the keyboard twin of the
        // red topbar's Cancel button.
        if (removingRef.current) { cancelNodeRemoval(); return; }
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
        setSelectedSectionId(null);
        setSelectedNodeIds((s) => (s.size ? new Set() : s));
        setPopupPos(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't bother if we're inside the editor — its own Backspace logic
        // owns those keys.
        if (editingNodeId) return;
        // Selected section wins first — Del nukes the WHOLE workflow
        // (every member node + every edge incident to it). One confirm.
        if (selectedSectionId) {
          const s = sections.find((x) => x.id === selectedSectionId);
          if (s) {
            e.preventDefault();
            setSectionDelete({ section: s, busy: false });
          }
          return;
        }
        // Multi-selection wins next — batch-delete every node in the set
        // so a marquee selection can be cleared in one keystroke.
        if (selectedNodeIds.size > 0) {
          e.preventDefault();
          handleDeleteNodes(Array.from(selectedNodeIds));
          setSelectedNodeIds(new Set());
          setSelectedNodeId(null);
          return;
        }
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
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        // Cmd+Z / Ctrl+Z → undo the latest destructive canvas action
        // (currently delete-nodes only). Don't fire when editing inside a
        // node — its iframe owns Cmd+Z for in-document edits.
        if (editingNodeId) return;
        e.preventDefault();
        handleUndo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodes, edges, draftEdge, selectedNodeId, selectedNodeIds, selectedEdgeId, editingNodeId, emptyDropMenu, contextMenu]);

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

  // Set of node IDs that already source at least one outgoing edge. Used
  // by CanvasNode to freeze the right-port emitter ball at its default
  // position — once a node is wired as a source, the "cursor-tracks-port"
  // slide animation stops adding value (user already has visual proof the
  // node connects) and the moving ball becomes noise.
  const hasOutgoingBySource = useMemo(() => {
    const s = new Set();
    for (const e of edges) s.add(e.source_node_id);
    return s;
  }, [edges]);

  // ── Sections (auto-derived workflow groups) ───────────────────────────
  // Every set of >=2 connected nodes is automatically encapsulated as a
  // "section" — a discrete frosted frame with a name tag in the upper-right.
  // No DB schema: components are derived from nodes+edges on every render
  // via union-find / BFS. Renames + manual splits/merges are Phase 2 and
  // would persist as overrides; this MVP is fully derived.
  const sections = useMemo(() => {
    if (!nodes || nodes.length === 0) return [];
    // A node armed for removal is excluded from section membership/geometry so
    // the frame snaps back to the remaining members while it floats free in the
    // red removal state. Its edges still render until the drop commits.
    const excludedId = removing?.nodeId || null;
    const memberPool = excludedId ? nodes.filter((n) => n.id !== excludedId) : nodes;
    // Sides + bottom use a uniform 165px gap. The TOP gap is larger
    // (260px) because the name tag's play button is stable-sized on
    // screen, so at moderate zoom-out it occupies more world space —
    // 260px reserves enough room that nodes can't visually overlap
    // the play button across the typical zoom range.
    const UNIFORM_GAP = SECTION_UNIFORM_GAP;
    const TOP_GAP = SECTION_TOP_GAP;
    const nodeById = new Map(memberPool.map((n) => [n.id, n]));
    // Build adjacency map. Skip edges whose endpoints aren't both in the
    // current nodes array (e.g. mid-flight temp edges that haven't synced),
    // and skip the removal-armed node so it doesn't anchor a component.
    const adj = new Map();
    for (const n of memberPool) adj.set(n.id, []);
    for (const e of edges) {
      const a = e.source_node_id;
      const b = e.target_node_id;
      if (adj.has(a) && adj.has(b)) {
        adj.get(a).push(b);
        adj.get(b).push(a);
      }
    }
    // Adoption virtual links (plan A3): a LOOSE node (no real edges) that
    // carries meta.adoptedInto — or the transient _pendingLinkFrom while
    // its auto-link edge is in flight — attaches to its anchor's component.
    // Real edges always win: a node with real adjacency ignores stale
    // adoption pointers, and a dangling anchor (deleted node) simply adds
    // no link, so the node falls back to its own singleton section.
    const fullAdj = new Map();
    for (const [k, v] of adj) fullAdj.set(k, v.slice());
    for (const n of memberPool) {
      if ((adj.get(n.id) || []).length > 0) continue;
      const anchor = n._pendingLinkFrom || n.meta?.adoptedInto;
      if (!anchor || anchor === n.id || !fullAdj.has(anchor)) continue;
      fullAdj.get(n.id).push(anchor);
      fullAdj.get(anchor).push(n.id);
    }
    // Connected components via iterative BFS (avoid recursion depth on
    // large boards).
    const visited = new Set();
    let components = [];
    for (const n of memberPool) {
      if (visited.has(n.id)) continue;
      const members = [];
      const queue = [n.id];
      while (queue.length) {
        const cur = queue.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);
        members.push(cur);
        for (const nb of fullAdj.get(cur) || []) {
          if (!visited.has(nb)) queue.push(nb);
        }
      }
      components.push(members);
    }
    if (components.length === 0) return [];
    // Geometric absorption — no nested sections, EVER. A component (of ANY
    // size) whose members ALL sit inside another component's core area
    // belongs to THAT section: its members are merged in rather than drawing
    // a frame nested inside the other. This keeps a freshly-DISCONNECTED node
    // — OR a whole sub-chain left behind by a disconnect (e.g. .md→site after
    // unhooking the image) — a member of the section it's still standing in,
    // instead of spawning a section-within-a-section. The host core is the
    // members' bbox + default gaps (NOT the grown stored frame, which would
    // trap nodes forever). Fixed-point: merging grows a host core, which can
    // then swallow more; bounded by component count.
    {
      // Absorption geometry uses the dragged node's FROZEN start position so
      // dragging a node never reshapes section cores mid-drag (see dragFreeze).
      const geomNode = (id) => {
        const n = nodeById.get(id);
        if (n && dragFreeze && id === dragFreeze.id) {
          return { ...n, pos_x: dragFreeze.startX, pos_y: dragFreeze.startY };
        }
        return n;
      };
      const centerInside = (n, r) => {
        if (!n || !r) return false;
        const cx = (n.pos_x || 0) + (n.width || 0) / 2;
        const cy = (n.pos_y || 0) + (n.height || 0) / 2;
        return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      };
      for (let guard = 0; guard < 64; guard++) {
        const coreRects = components.map((c) =>
          c.length >= 2 ? sectionCoreRect(c.map((id) => geomNode(id))) : null);
        let pick = null; // { i, j } — absorb i into host j
        for (let i = 0; i < components.length && !pick; i++) {
          let bestJ = -1, bestArea = Infinity;
          for (let j = 0; j < components.length; j++) {
            if (j === i) continue;
            const r = coreRects[j];
            if (!r) continue;
            // Every member of i must sit inside host j's core.
            const allIn = components[i].every((id) => centerInside(geomNode(id), r));
            if (!allIn) continue;
            // Smallest containing core = the most specific host.
            const area = (r.right - r.left) * (r.bottom - r.top);
            if (area < bestArea) { bestArea = area; bestJ = j; }
          }
          if (bestJ !== -1) pick = { i, j: bestJ };
        }
        if (!pick) break;
        components[pick.j] = components[pick.j].concat(components[pick.i]);
        components.splice(pick.i, 1);
      }
    }
    // Sections exist only for RELATIONSHIPS — a lone node renders no
    // frame. A new/standalone node stays frameless until it's connected,
    // dropped inside a section, or adopted by drag.
    components = components.filter((c) => c.length >= 2);
    if (components.length === 0) return [];
    // Auto-name by content: count kinds present in each component, pick the
    // dominant theme. Number sections by appearance order in top-left → bot-
    // right reading (sort by min member pos_x + pos_y).
    components.sort((a, b) => {
      const aMin = Math.min(...a.map((id) => (nodeById.get(id)?.pos_x || 0) + (nodeById.get(id)?.pos_y || 0)));
      const bMin = Math.min(...b.map((id) => (nodeById.get(id)?.pos_x || 0) + (nodeById.get(id)?.pos_y || 0)));
      return aMin - bMin;
    });
    const themeCount = { image: 0, site: 0, designmd: 0, prompt: 0, mixed: 0 };
    function themeOf(memberIds) {
      let hasImage = 0, hasSite = 0, hasMd = 0, hasPrompt = 0;
      for (const id of memberIds) {
        const k = nodeById.get(id)?.kind;
        if (k === 'asset' || k === 'image') hasImage++;
        else if (k === 'site') hasSite++;
        else if (k === 'designmd') hasMd++;
        else if (k === 'prompt') hasPrompt++;
      }
      const variety = [hasImage, hasSite, hasMd, hasPrompt].filter((n) => n > 0).length;
      if (variety >= 2 && hasSite > 0 && hasImage > 0) return 'site-with-image';
      if (variety >= 2) return 'mixed';
      if (hasImage > 0) return 'image';
      if (hasSite > 0) return 'site';
      if (hasMd > 0) return 'designmd';
      if (hasPrompt > 0) return 'prompt';
      return 'mixed';
    }
    const THEME_LABEL = {
      'image':           'Image flow',
      'site':            'Site flow',
      'site-with-image': 'Site + image',
      'designmd':        'Design spec',
      'prompt':          'Prompt chain',
      'mixed':           'Workflow',
    };
    const themeCounter = {};
    // Section identity = the OLDEST member (earliest created_at, tiebreak
    // smallest id) — plan A1. Adding members never changes the root (new
    // nodes are always newer), so stored frames + name overrides keyed by
    // `section-<rootId>` survive adoption and new connections. created_at
    // arrives as a Date (RSC) or ISO string (JSON refetch); temp- rows
    // have none and sort last (Infinity) so they can never out-root a
    // real node.
    function rootOf(memberIds) {
      let best = null, bestKey = Infinity, bestId = '';
      for (const id of memberIds) {
        const t = +new Date(nodeById.get(id)?.created_at);
        const key = Number.isFinite(t) ? t : Infinity;
        if (best === null || key < bestKey || (key === bestKey && String(id) < bestId)) {
          best = id; bestKey = key; bestId = String(id);
        }
      }
      return best;
    }
    const out = [];
    for (const memberIds of components) {
      const t = themeOf(memberIds);
      themeCounter[t] = (themeCounter[t] || 0) + 1;
      // Bounding box of member nodes. Asset nodes extend visually below
      // their height (aspect pill half-outside + dims label below);
      // counting that overflow in the bbox keeps the chain centered in
      // the frame instead of pushing it to the top.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      // The topbar renders ABOVE the declared body height and inflates
      // inversely with zoom (36px on screen), so the node's true visual
      // bottom = pos_y + topbarWorld + height. Without counting it, nodes
      // bleed past the frame bottom by 36/scale − clearance. The 0.15
      // floor matches the CSS `--tb` cap on .cnode-topbar EXACTLY — below
      // 30% zoom the rendered chrome stops inflating in world space, so
      // measured and rendered heights agree at every zoom level.
      const chromeWorld = 36 / Math.max(0.30, canvasScale || 1);
      for (const id of memberIds) {
        const n = nodeById.get(id);
        if (!n) continue;
        const isAsset = n.kind === 'asset' || n.kind === 'image';
        // A SELECTED site node sprouts chrome OUTSIDE its frame: the version-
        // history floater BELOW it (a 22px gap + square thumbnails that are 20%
        // of the node width) and the device/viewport switcher ABOVE it (a ~32px
        // gap + ~32px bar). Count BOTH so the frame clears them at its bottom AND
        // top edges instead of clipping. Extents mirror the CSS (history floored
        // at 0.35 zoom; switcher tracks 1/scale like `bottom: 100% + 32px/scale`).
        const selectedSite = n.kind === 'site' &&
          (n.id === selectedNodeId || (selectedNodeIds && selectedNodeIds.has && selectedNodeIds.has(n.id)));
        const historyOverflow = selectedSite
          ? 22 / Math.max(0.35, canvasScale || 1) + 0.20 * (n.width || 0)
          : 0;
        const switcherOverflow = selectedSite ? 68 / (canvasScale || 1) : 0;
        const bottomOverflow = chromeWorld + (isAsset ? ASSET_BOTTOM_OVERFLOW : 0) + historyOverflow;
        minX = Math.min(minX, n.pos_x || 0);
        minY = Math.min(minY, (n.pos_y || 0) - switcherOverflow);
        maxX = Math.max(maxX, (n.pos_x || 0) + (n.width || 0));
        maxY = Math.max(maxY, (n.pos_y || 0) + (n.height || 0) + bottomOverflow);
      }
      const rootId = rootOf(memberIds);
      const sectionId = `section-${rootId}`;
      // Sections with no real edge have nothing to run — the play button
      // is hidden for them (singletons + purely-adopted groups).
      const hasEdges = memberIds.some((id) => (adj.get(id) || []).length > 0);
      const fallbackName = `${THEME_LABEL[t]} #${themeCounter[t]}`;
      // Frame coords: prefer the stored sectionFrame if present, expanded
      // to maintain MIN_FRAME_CLEARANCE (40px) from every member edge.
      // First-time sections fall back to the auto-bbox + UNIFORM_GAP /
      // TOP_GAP defaults — captured by the useEffect below on next tick.
      const MIN_FRAME_CLEARANCE = SECTION_MEMBER_CLEARANCE;
      const stored = sectionFrames[sectionId];
      let frameLeft, frameTop, frameRight, frameBottom;
      if (stored) {
        frameLeft   = Math.min(stored.left,   minX - MIN_FRAME_CLEARANCE);
        frameTop    = Math.min(stored.top,    minY - MIN_FRAME_CLEARANCE);
        frameRight  = Math.max(stored.right,  maxX + MIN_FRAME_CLEARANCE);
        frameBottom = Math.max(stored.bottom, maxY + MIN_FRAME_CLEARANCE);
      } else {
        frameLeft   = minX - UNIFORM_GAP;
        frameTop    = minY - TOP_GAP;
        frameRight  = maxX + UNIFORM_GAP;
        frameBottom = maxY + UNIFORM_GAP;
      }
      out.push({
        id: sectionId,
        rootId,
        hasEdges,
        memberIds,
        theme: t,
        name: sectionNameOverrides[sectionId] || fallbackName,
        x: frameLeft,
        y: frameTop,
        width: frameRight - frameLeft,
        height: frameBottom - frameTop,
      });
    }
    return out;
  }, [nodes, edges, sectionNameOverrides, sectionFrames, canvasScale, dragFreeze, removing, selectedNodeId, selectedNodeIds]);

  // Re-anchor section run-pills whenever the sections change (new section,
  // resized frame, scale tick) or the window resizes — pan/zoom already
  // triggers this via onTransformed.
  useEffect(() => {
    scheduleReanchorPills();
    const onResize = () => scheduleReanchorPills();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, canvasScale]);

  // ── Re-run gating (clean vs dirty) ─────────────────────────────────────
  // After a workflow runs, its run buttons (section ▶ + the bare chat-arrow
  // run-flow) go DISABLED until the chain CHANGES — so the user can't burn
  // credits regenerating an identical result. A chain re-enables when its
  // content signature changes: editing a prompt, swapping an image, rewiring
  // an edge, or the user asking for it again in chat (any typed message keeps
  // the arrow live and the resulting mutation flips the signature). Moving
  // nodes around the canvas does NOT count — chainSignature ignores position.
  //
  // cleanSigs maps a section id → the signature captured the moment its run
  // completed. The section is "clean" while its live signature still matches.
  const [cleanSigs, setCleanSigs] = useState({});
  // Sections whose run just finished and need their post-run signature
  // captured once React commits the new content. Holds ids until the effect
  // below snapshots them against settled state.
  const pendingCleanRef = useRef(new Set());
  const markSectionPendingClean = useCallback((sectionId) => {
    if (!sectionId) return;
    pendingCleanRef.current.add(sectionId);
  }, []);
  // Snapshot pending signatures after content commits. Runs on every
  // nodes/edges/sections change; only does work when something is pending.
  useEffect(() => {
    if (pendingCleanRef.current.size === 0) return;
    const captured = {};
    let any = false;
    for (const id of pendingCleanRef.current) {
      const s = sections.find((x) => x.id === id);
      if (!s) continue; // section dissolved (members changed) — drop it
      captured[id] = chainSignature(s, nodes, edges);
      any = true;
    }
    pendingCleanRef.current = new Set();
    if (any) setCleanSigs((prev) => ({ ...prev, ...captured }));
  }, [nodes, edges, sections]);

  // Safety net: a node must never get stuck in the white "removing" state once
  // it settles back INSIDE its section. The drop handler already resolves an
  // armed removal (cancel inside / commit outside), but if a node ends a drag
  // still armed while its center sits inside the section, restore it to its
  // normal colour/state here. Gated on `!dragFreeze` so it never fights an
  // in-progress tear-out (the frame stretches with the node mid-drag).
  // Menu-armed nodes (`fromMenu`) are intentionally persistent — they stay
  // white until the user drags them out, hits Cancel, or presses Escape — so
  // they're only cleared once they've actually been moved back inside.
  // Placed AFTER the `sections` memo so its dependency list can reference it.
  useEffect(() => {
    if (dragFreeze) return;
    const arm = removingRef.current;
    if (!arm) return;
    const node = nodes.find((n) => n.id === arm.nodeId);
    if (!node) return;
    const { cx, cy } = nodeCenter(node, node.pos_x, node.pos_y);
    const rect = removalSectionRect(arm);
    if (!rect || !pointInRect(cx, cy, rect)) return;
    // Inside the section. For elastic arms that's always "back home". For
    // menu arms, only clear if the node was actually dragged from where it
    // was armed (a stray re-render shouldn't cancel an idle menu-arm).
    if (arm.fromMenu && arm.armX != null) {
      const movedBack = Math.hypot(node.pos_x - arm.armX, node.pos_y - arm.armY) > 4;
      if (!movedBack) return;
    }
    cancelNodeRemoval();
  }, [dragFreeze, nodes, sections]);

  // Live clean state: a section id is clean when its stored signature still
  // equals the current one. Recomputed against live nodes/edges so any
  // content edit (but not a move) re-enables the run on the next render.
  const cleanSectionIds = useMemo(() => {
    const out = new Set();
    for (const s of sections) {
      if (!s.hasEdges) continue;
      const stored = cleanSigs[s.id];
      if (stored && stored === chainSignature(s, nodes, edges)) out.add(s.id);
    }
    return out;
  }, [sections, nodes, edges, cleanSigs]);
  // Terminal node ids of clean sections — the bare chat-arrow run-flow skips
  // these (re-running a clean chain produces the same result).
  const cleanTerminalIds = useMemo(() => {
    const out = new Set();
    for (const s of sections) {
      if (!cleanSectionIds.has(s.id)) continue;
      const { terminalId } = findSectionTerminal(s, nodes, edges);
      if (terminalId) out.add(terminalId);
    }
    return out;
  }, [sections, cleanSectionIds, nodes, edges]);

  // Floating run button: resolve the section, keeping the last one during the
  // fade-out so the button keeps its label while it collapses out.
  const floatingSection = floatingRunSectionId ? sections.find((x) => x.id === floatingRunSectionId) : null;
  if (floatingSection) lastFloatingSectionRef.current = floatingSection;
  const floatRunSec = floatingSection || lastFloatingSectionRef.current;
  const floatRunClean = floatRunSec ? (cleanSectionIds.has(floatRunSec.id) && floatRunSec.hasEdges) : false;
  // Nodes currently producing content (run-flow status, agent run, capture, or
  // image gen) — drives the filling ring (CanvasNode mirrors this) AND disables
  // the run button of any section whose member is busy.
  const runningNodeIds = new Set(
    nodes
      .filter((n) => runStatus.has(n.id) || n.meta?.status === 'generating' || (n._loading && !n._challenge))
      .map((n) => n.id)
  );
  const floatRunRunning = floatRunSec ? (floatRunSec.memberIds || []).some((mid) => runningNodeIds.has(mid)) : false;

  // The bare chat-arrow run-flow processes every runnable target on the
  // board. When they're ALL clean there's nothing new to produce, so the
  // arrow's run-flow shortcut goes disabled (typing a message keeps it live —
  // text in the field is a chat request, never a bare re-run).
  const runFlowAllClean = useMemo(() => {
    const targets = new Set();
    for (const e of edges) { if (e.target_node_id) targets.add(e.target_node_id); }
    const runnable = [...targets].filter((id) => {
      if (String(id).startsWith('temp-')) return false;
      const n = nodes.find((x) => x.id === id);
      if (!n) return false;
      return !!n.current_html || (n.kind === 'site' && !n._loading);
    });
    if (runnable.length === 0) return false;
    return runnable.every((id) => cleanTerminalIds.has(id));
  }, [edges, nodes, cleanTerminalIds]);

  // Capture / grow sectionFrames after each sections render. New sections
  // initialise their stored frame from the default-padded coords; existing
  // sections only update when the constraint expansion (max with auto+40)
  // pushed the frame past the stored coords. Old entries for removed
  // sections are cleaned up. Persisted to localStorage so a refresh
  // restores the same frames.
  //
  // Migration pass (plan A1/7b): when a section re-roots (its oldest member
  // was deleted → new id) the frame + custom name of the vanished id are
  // inherited by the new id, matched via member overlap. prevSectionsRef
  // remembers last render's id → memberIds for that detection.
  const prevSectionsRef = useRef({});
  useEffect(() => {
    // Skip while a node is actively dragged. This effect writes sectionFrames,
    // which is a dependency of the `sections` memo — running it every drag
    // frame creates a setState↔recompute feedback loop that trips React's
    // "maximum update depth". The frame still visually grows during the drag
    // (the derivation grows against live member positions); we persist the
    // captured frame once the drag settles (dragFreeze clears → sections
    // recompute → this effect runs).
    if (dragFreeze) return;
    const activeIds = new Set(sections.map((s) => s.id));
    const prevMap = prevSectionsRef.current;
    const inherit = {}; // newId -> vanished oldId
    for (const s of sections) {
      if (prevMap[s.id]) continue; // id existed last render — not a re-root
      for (const [oldId, oldMembers] of Object.entries(prevMap)) {
        if (activeIds.has(oldId)) continue;
        if (oldMembers.some((id) => s.memberIds.includes(id))) { inherit[s.id] = oldId; break; }
      }
    }
    if (Object.keys(inherit).length) {
      setSectionNameOverrides((prevNames) => {
        let touched = false;
        const nextNames = { ...prevNames };
        for (const [newId, oldId] of Object.entries(inherit)) {
          if (nextNames[oldId] != null) {
            if (nextNames[newId] == null) nextNames[newId] = nextNames[oldId];
            delete nextNames[oldId];
            touched = true;
          }
        }
        if (!touched) return prevNames;
        try { localStorage.setItem(SECTION_NAMES_KEY, JSON.stringify(nextNames)); } catch {}
        return nextNames;
      });
    }
    // Sections that LOST a member since last render (e.g. a disconnect split
    // the workflow, or a node was dragged out). Their grow-only stored frame
    // was sized for the bigger member set and would keep engulfing the
    // departed nodes — which renders as a section sitting INSIDE another.
    // Reset those frames so they recompute tight around the current members.
    const shrunk = new Set();
    for (const s of sections) {
      const prevMembers = prevMap[s.id];
      if (prevMembers && prevMembers.some((id) => !s.memberIds.includes(id))) {
        shrunk.add(s.id);
      }
    }
    setSectionFrames((prev) => {
      const next = {};
      let changed = false;
      for (const s of sections) {
        // Drop the stale frame for a shrunk section: omit it from `next` so
        // the next derivation falls back to the default (members + gap) box.
        if (shrunk.has(s.id)) { changed = true; continue; }
        const inherited = inherit[s.id] ? prev[inherit[s.id]] : null;
        const target = { left: s.x, top: s.y, right: s.x + s.width, bottom: s.y + s.height };
        // Union with the inherited frame so a re-rooted section keeps any
        // user-resized extent while still containing all current members.
        const merged = inherited ? {
          left:   Math.min(inherited.left,   target.left),
          top:    Math.min(inherited.top,    target.top),
          right:  Math.max(inherited.right,  target.right),
          bottom: Math.max(inherited.bottom, target.bottom),
        } : target;
        const cur = prev[s.id];
        if (!cur || cur.left !== merged.left || cur.top !== merged.top || cur.right !== merged.right || cur.bottom !== merged.bottom) {
          next[s.id] = merged;
          changed = true;
        } else {
          next[s.id] = cur;
        }
      }
      for (const id of Object.keys(prev)) {
        if (!activeIds.has(id)) changed = true;
      }
      if (changed) {
        try { localStorage.setItem(SECTION_FRAMES_KEY, JSON.stringify(next)); } catch {}
        return next;
      }
      return prev;
    });
    const memo = {};
    for (const s of sections) memo[s.id] = s.memberIds;
    prevSectionsRef.current = memo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, dragFreeze]);

  // Sticky membership latch. A node that belongs to a section ONLY
  // geometrically (it was engulfed when a neighbour got connected — no edge of
  // its own, no adoption marker yet) has fragile, position-derived membership
  // and would silently fall out when moved. Persist meta.adoptedInto = section
  // root ONCE so its membership becomes permanent, like every other member.
  // From then on membership is edges ∪ adoptedInto — both position-independent.
  // Skipped during a drag (dragFreeze) and while a removal is armed so we never
  // latch mid-gesture.
  useEffect(() => {
    if (dragFreeze || removing) return;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const toLatch = selectGeometricMembersToLatch({
      sections, nodeById, edgeTouchedSet: edgeTouchedIds,
    });
    if (!toLatch.length) return;
    setNodes((prev) => prev.map((n) => {
      const hit = toLatch.find((t) => t.nodeId === n.id);
      if (!hit) return n;
      return { ...n, meta: { ...(n.meta || {}), adoptedInto: hit.rootId } };
    }));
    for (const { nodeId, rootId } of toLatch) {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || String(nodeId).startsWith('temp-')) continue;
      const meta = { ...(node.meta || {}), adoptedInto: rootId };
      api.updateNode(nodeId, { meta }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, dragFreeze, removing]);

  // Set of node ids that belong to a section — drives the "Remove from this
  // section" menu item (only shown for actual members).
  const sectionMemberIds = useMemo(() => {
    const s = new Set();
    for (const sec of sections) for (const id of sec.memberIds) s.add(id);
    return s;
  }, [sections]);

  // Section drag — grabbing the dot-grid handle at the top of a section
  // translates ALL member nodes by the same delta so the workflow moves
  // as a group. No resize math, no scaling; just translate. Persists each
  // member's new position via api.updateNode on mouseup.
  function startSectionMove(sectionId, e) {
    e.stopPropagation();
    e.preventDefault();
    const section = sections.find((x) => x.id === sectionId);
    if (!section) return;
    // Move set = graph members UNION every node whose center sits inside the
    // section's rendered frame. Rule: "everything within a section's
    // demarcation belongs to the section" — so an image (or any) node that
    // visually lives inside the frame travels with it even if it isn't a
    // graph member yet (e.g. dropped in, or created from a member but not
    // edge-linked). Without this, the purple image nodes were left behind
    // while the connected (teal) ones moved.
    const fL = section.x, fT = section.y;
    const fR = section.x + section.width, fB = section.y + section.height;
    const moveIds = new Set(section.memberIds);
    for (const n of nodes) {
      if (moveIds.has(n.id)) continue;
      if (String(n.id).startsWith('temp-')) continue;
      const cx = (n.pos_x || 0) + (n.width || 0) / 2;
      const cy = (n.pos_y || 0) + (n.height || 0) / 2;
      if (cx >= fL && cx <= fR && cy >= fT && cy <= fB) moveIds.add(n.id);
    }
    const memberNodes = [...moveIds]
      .map((id) => nodes.find((n) => n.id === id))
      .filter(Boolean);
    if (memberNodes.length === 0) return;
    const startMembers = memberNodes.map((m) => ({ id: m.id, pos_x: m.pos_x, pos_y: m.pos_y }));
    // Snapshot the section's current frame so we can translate it
    // alongside its members. Without this, the stored frame (when
    // present) stays anchored while the content slides — the user
    // sees "content moves but the section doesn't".
    const startFrame = {
      left:   section.x,
      top:    section.y,
      right:  section.x + section.width,
      bottom: section.y + section.height,
    };
    const readScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale')) || 1;
    const startScale = readScale();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    function onMove(ev) {
      const dx = (ev.clientX - startMouseX) / startScale;
      const dy = (ev.clientY - startMouseY) / startScale;
      setNodes((prev) => prev.map((n) => {
        const orig = startMembers.find((m) => m.id === n.id);
        if (!orig) return n;
        return { ...n, pos_x: Math.round(orig.pos_x + dx), pos_y: Math.round(orig.pos_y + dy) };
      }));
      // Translate the section frame by the same delta so it travels
      // with its members as a single unit.
      setSectionFrames((prev) => ({
        ...prev,
        [sectionId]: {
          left:   Math.round(startFrame.left   + dx),
          top:    Math.round(startFrame.top    + dy),
          right:  Math.round(startFrame.right  + dx),
          bottom: Math.round(startFrame.bottom + dy),
        },
      }));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setNodes((cur) => {
        for (const m of startMembers) {
          const node = cur.find((n) => n.id === m.id);
          if (node && !String(node.id).startsWith('temp-')) {
            api.updateNode(node.id, { posX: node.pos_x, posY: node.pos_y }).catch(console.warn);
          }
        }
        return cur;
      });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Section corner resize — pure FRAME resize. Members NEVER move. Drags
  // update sectionFrames absolute coords directly. Frame is clamped to
  // contain all member nodes + MIN_FRAME_CLEARANCE (40px) so resizing
  // inward can't push a node out of the frame.
  function startSectionResize(sectionId, corner, e) {
    e.stopPropagation();
    e.preventDefault();
    const section = sections.find((x) => x.id === sectionId);
    if (!section) return;
    const memberNodes = section.memberIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter(Boolean);
    if (memberNodes.length === 0) return;

    const readScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale')) || 1;
    const startScale = readScale();
    // Mirror the rendered-frame bbox overflow (the `sections` useMemo): the
    // resize must clear the SAME node chrome the frame wraps, not just the raw
    // member box — the topbar that renders past the body, asset dims, and (for
    // a SELECTED site node) the history floater BELOW + device switcher ABOVE.
    // Without this the handle clips an open history when dragged in.
    const chromeWorld = 36 / Math.max(0.30, startScale);
    let memMinX = Infinity, memMinY = Infinity, memMaxX = -Infinity, memMaxY = -Infinity;
    for (const m of memberNodes) {
      const isAsset = m.kind === 'asset' || m.kind === 'image';
      const selectedSite = m.kind === 'site' &&
        (m.id === selectedNodeId || (selectedNodeIds && selectedNodeIds.has && selectedNodeIds.has(m.id)));
      const historyOverflow = selectedSite ? 22 / Math.max(0.35, startScale) + 0.20 * (m.width || 0) : 0;
      const switcherOverflow = selectedSite ? 68 / startScale : 0;
      const bottomOverflow = chromeWorld + (isAsset ? ASSET_BOTTOM_OVERFLOW : 0) + historyOverflow;
      memMinX = Math.min(memMinX, m.pos_x || 0);
      memMinY = Math.min(memMinY, (m.pos_y || 0) - switcherOverflow);
      memMaxX = Math.max(memMaxX, (m.pos_x || 0) + (m.width || 0));
      memMaxY = Math.max(memMaxY, (m.pos_y || 0) + (m.height || 0) + bottomOverflow);
    }
    // Resizing the frame in can't cross the SAME safety margin a node keeps
    // when dragged toward the section edges (SECTION_MEMBER_CLEARANCE) — so the
    // frame never hugs a member tighter than a drop would allow.
    const MIN_CLEARANCE = SECTION_MEMBER_CLEARANCE;
    const startFrame = { left: section.x, top: section.y, right: section.x + section.width, bottom: section.y + section.height };
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    // Latest clamped frame, committed to React state once on mouseup.
    let liveFrame = { ...startFrame };

    function onMove(ev) {
      const dx = (ev.clientX - startMouseX) / startScale;
      const dy = (ev.clientY - startMouseY) / startScale;
      let newLeft = startFrame.left, newTop = startFrame.top, newRight = startFrame.right, newBottom = startFrame.bottom;
      if (corner === 'nw')      { newLeft = startFrame.left + dx; newTop = startFrame.top + dy; }
      else if (corner === 'ne') { newRight = startFrame.right + dx; newTop = startFrame.top + dy; }
      else if (corner === 'sw') { newLeft = startFrame.left + dx; newBottom = startFrame.bottom + dy; }
      else if (corner === 'se') { newRight = startFrame.right + dx; newBottom = startFrame.bottom + dy; }
      // Clamp so frame always contains members + 40px clearance.
      newLeft   = Math.min(newLeft,   memMinX - MIN_CLEARANCE);
      newTop    = Math.min(newTop,    memMinY - MIN_CLEARANCE);
      newRight  = Math.max(newRight,  memMaxX + MIN_CLEARANCE);
      newBottom = Math.max(newBottom, memMaxY + MIN_CLEARANCE);
      liveFrame = { left: newLeft, top: newTop, right: newRight, bottom: newBottom };
      // Drive geometry STRAIGHT to the DOM during the gesture and DO NOT touch
      // React state per-move. Calling setSectionFrames on every mousemove
      // re-runs the `sections` memo and re-renders the whole canvas (every
      // node + EdgeLayer) each frame — the resulting frame-drops make the
      // section area visibly trail the cursor while the handle (driven here)
      // stays current. Direct writes alone keep frame + chrome pixel-locked to
      // the cursor; state is committed once on release below.
      const w = newRight - newLeft, h = newBottom - newTop;
      if (typeof document !== 'undefined') {
        document.querySelectorAll(`[data-section-id="${sectionId}"]`).forEach((el) => {
          el.style.left = `${newLeft}px`;
          el.style.top = `${newTop}px`;
          el.style.width = `${w}px`;
          el.style.height = `${h}px`;
        });
      }
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Commit the final geometry to React state once, then persist.
      setSectionFrames((prev) => {
        const next = { ...prev, [sectionId]: liveFrame };
        // Persist under the BOARD-SCOPED key the loader reads (line ~250) —
        // the old plain 'rb-section-frames' key was never restored on reload.
        try { localStorage.setItem(SECTION_FRAMES_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Active chat context — derived from selectedSectionId (preferred) or
  // selectedNodeId. PromptDock renders a pill for this; sending a chat
  // message prepends the context hint so the agent operates in scope.
  // Lives AFTER `sections` because it reads `sections` in its body — moving
  // it above the `sections` useMemo would TDZ-fail on first render.
  const activeContexts = useMemo(() => {
    if (selectedSectionId) {
      const s = sections.find((x) => x.id === selectedSectionId);
      if (s) {
        return [{
          kind: 'section',
          id: s.id,
          name: s.name,
          theme: s.theme,
          memberIds: s.memberIds,
          memberCount: s.memberIds.length,
        }];
      }
    }
    // Union of the primary selection + shift-multi selection. Dedup
    // and preserve insertion order so the user reads pills left-to-right
    // matching the click order (primary first, then additions).
    const ids = [];
    if (selectedNodeId) ids.push(selectedNodeId);
    for (const id of selectedNodeIds) if (id !== selectedNodeId) ids.push(id);
    const out = [];
    for (const id of ids) {
      const n = nodes.find((x) => x.id === id);
      if (!n) continue;
      out.push({
        kind: 'node',
        id: n.id,
        name: n.meta?.name || n.kind,
        nodeKind: n.kind,
        origin: nodeOrigin(n),
        color: originColor(n),
      });
    }
    return out.length ? out : null;
  }, [selectedSectionId, selectedNodeId, selectedNodeIds, sections, nodes]);

  return (
    <div
      className={`canvas-shell${removingOutside ? ' removing-outside' : ''}`}
      onMouseDown={maybeStartMarquee}
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
        {/* Floating run button — anchored left of the zoom widget; crossfades in
            when a section's in-place run-pill rises into the top chrome zone. */}
        {floatRunSec && (() => {
          const runFloat = (e) => {
            e.stopPropagation();
            setSelectedSectionId(floatRunSec.id);
            setSelectedNodeId(null);
            setSelectedNodeIds(new Set());
            runSectionFlow(floatRunSec);
          };
          // Structure mirrors the in-section run pill EXACTLY (label + black
          // circular play button) so the two are visually identical.
          return (
            <div
              className={`canvas-floating-run${floatingSection ? ' visible' : ''}${floatRunRunning ? ' running' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={floatRunClean ? 'Reroll this flow' : 'Run this flow'}
              onClick={runFloat}
            >
              <span className="canvas-floating-run-label">{floatRunClean ? 'Reroll' : 'run this flow'}</span>
              <button
                type="button"
                className="canvas-floating-run-play"
                onClick={runFloat}
                aria-label={floatRunClean ? 'Reroll this flow' : 'Run this flow'}
              >
                {floatRunClean ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <polygon points="6,4 20,12 6,20" />
                  </svg>
                )}
              </button>
            </div>
          );
        })()}
        <ZoomControls scale={canvasScale} transformRef={transformRef} onFit={fitToContent} />
        <div className="canvas-toolbar-right">
          <UserPill compact name={user?.name} email={user?.email} plan={user?.plan} onSignOut={logout} />
        </div>
      </div>
      <Minimap
        nodes={nodes}
        edges={edges}
        transformRef={transformRef}
        frameMode={frameMode}
        hasSelection={!!selectedNodeId}
        onToggleFrame={toggleFrame}
        onZoomToConnection={(ids) => zoomToConnection(ids)}
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
        panning={{ disabled: !spaceDown, excluded: ['cnode', 'cnode-topbar', 'cnode-body', 'cnode-iframe', 'cnode-prompt-textarea', 'cnode-prompt-body', 'cnode-body-prompt', 'cnode-handle', 'cnode-viewport-switcher', 'cnode-vp-btn', 'cnode-port-right', 'cnode-port-left', 'edge-line', 'edge-popup', 'reset-confirm-card', 'reset-confirm-overlay', 'superwidget', 'canvas-toolbar-left', 'canvas-toolbar-right', 'canvas-toolbars-left', 'canvas-toolbars-right', 'canvas-theme-floater', 'zoom-controls', 'zoom-menu', 'user-menu'] }}
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
          // At/below 25% the topbar grip compacts from 6 to 4 dots per row so
          // it doesn't crowd the shrinking node.
          document.documentElement.classList.toggle('canvas-zoom-mid', scale < 0.25);
          // Below ~0.2 the ports start to dominate the tiny node frames —
          // shrink them 30% so the colour-coded squares stay readable.
          document.documentElement.classList.toggle('canvas-zoom-very-low', scale < 0.2);
          // Beyond 30% zoom-out the node corner radius tightens 20% so the
          // rounding doesn't read as oversized on the shrinking frames.
          document.documentElement.classList.toggle('canvas-zoom-below-30', scale < 0.30);
          // Below the 0.15 chrome floor (--tb) the topbar shrinks with the
          // zoom; narrow nodes also compact the grip to 3×2 dots so it
          // never grazes the node's left edge at minimum zoom.
          document.documentElement.classList.toggle('canvas-zoom-min', scale < 0.15);
          // Only push React state when the scale truly moved — see
          // lastAppliedScaleRef note. Idempotent DOM writes above stay
          // unguarded so chrome sizing always tracks the live transform.
          if (Math.abs(scale - lastAppliedScaleRef.current) > 0.0005) {
            lastAppliedScaleRef.current = scale;
            setCanvasScale(scale);
          }
          // Keep each section's run-pill pinned within the viewport as the
          // user pans/zooms (rAF-coalesced; reads layout once per frame).
          scheduleReanchorPills();
        }}
      >
        <TransformComponent wrapperStyle={{ width: '100vw', height: '100vh' }} contentStyle={{ width: WORLD_WIDTH, height: WORLD_HEIGHT }}>
          {/* Section frames render BEHIND edges + nodes (z-index handled via
              DOM order + low z-index on the frame element). pointer-events:
              none on the frame so it doesn't intercept canvas clicks; the
              name tag has its own pointer-events:auto. */}
          {/* Section BACKGROUND pass — frosted glass + selected outline
              only. Paints BEFORE nodes so the glass sits behind them.
              The chrome (grip / name tag / corner handles) renders in
              a separate pass AFTER nodes so hit-testing reaches it
              regardless of whether the section frame's backdrop-filter
              creates a stacking context. */}
          {sections.map((s) => {
            // While a loose node is being offered to another section, its
            // own singleton frame hides (two frames fighting over one node
            // reads as a glitch) and the candidate paints the engulfed
            // preview rect instead of its base rect.
            if (adoptPreview && s.memberIds.length === 1 && s.memberIds[0] === adoptPreview.nodeId) return null;
            const pv = adoptPreview?.sectionId === s.id ? adoptPreview.rect : null;
            return (
              <div
                key={`bg-${s.id}`}
                className={`canvas-section-frame${(selectedSectionId === s.id || floatingRunSectionId === s.id) ? ' selected' : ''}${pv ? ' adopt-preview' : ''}`}
                style={{
                  left: pv ? pv.left : s.x,
                  top: pv ? pv.top : s.y,
                  width: pv ? pv.right - pv.left : s.width,
                  height: pv ? pv.bottom - pv.top : s.height,
                }}
                data-section-id={s.id}
              />
            );
          })}
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
            onSeverEdge={(edge) => handleDeleteEdge(edge)}
          />
          {nodes.map((n) => (
            <CanvasNode
              key={n.id} node={n}
              scale={canvasScale}
              incomingEdges={incomingByTarget.get(n.id) || []}
              hasOutgoingEdges={hasOutgoingBySource.has(n.id)}
              selected={selectedNodeId === n.id || selectedNodeIds.has(n.id)}
              placing={placingNodeId === n.id}
              editing={editingNodeId === n.id}
              onEditingChange={(willEdit) => handleEditingToggle(n.id, willEdit)}
              onSelect={(e) => {
                const shift = !!e?.shiftKey;
                if (shift) {
                  // Shift-click toggles this node in the multi-select set —
                  // add if absent, remove if already there. Matches Figma /
                  // Linear additive selection convention.
                  //
                  // Important: when toggling OFF, do NOT promote this node
                  // to selectedNodeId. The `selected` prop on CanvasNode
                  // is the OR of (selectedNodeId === id, selectedNodeIds
                  // has id), so setting selectedNodeId to a node we just
                  // removed from the set keeps it visually selected on
                  // half the clicks. Only set selectedNodeId when adding.
                  const alreadyIn = selectedNodeIds.has(n.id) || selectedNodeId === n.id;
                  if (alreadyIn) {
                    setSelectedNodeIds((s) => {
                      if (!s.has(n.id)) return s;
                      const next = new Set(s);
                      next.delete(n.id);
                      return next;
                    });
                    if (selectedNodeId === n.id) setSelectedNodeId(null);
                  } else {
                    setSelectedNodeIds((s) => {
                      const next = new Set(s);
                      next.add(n.id);
                      return next;
                    });
                    setSelectedNodeId(n.id);
                  }
                } else {
                  setSelectedNodeId(n.id);
                  // Single-click clears any prior marquee selection so the
                  // click is unambiguous.
                  setSelectedNodeIds((s) => (s.size ? new Set() : s));
                }
                setSelectedEdgeId(null);
                setSelectedSectionId(null);
                setPopupPos(null);
                // Steal focus from any text input (notably the PromptDock
                // textarea) so a follow-up Delete keypress reaches the
                // canvas keydown handler instead of falling through to a
                // character delete inside the input. Matches Figma /
                // Linear behaviour where clicking a node moves keyboard
                // focus to the canvas.
                if (typeof document !== 'undefined') {
                  const ae = document.activeElement;
                  if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') && typeof ae.blur === 'function') {
                    ae.blur();
                  }
                }
              }}
              onMove={(posX, posY) => handleNodeMove(n, posX, posY)}
              onMoveStart={() => handleNodeMoveStart(n)}
              onMoveEnd={(moved) => handleNodeMoveEnd(n, moved)}
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
              onDelete={() => setNodeDelete({ id: n.id, name: (n.name || '').trim() })}
              onReset={() => handleResetNode(n.id)}
              onVersionRestore={(snapshotId) => handleRestoreVersion(n.id, snapshotId)}
              runStatus={runStatus.get(n.id) || null}
              onSaveEdit={(html) => handleSaveNodeEdit(n.id, html)}
              onDiscardEdit={() => handleDiscardNodeEdit(n.id)}
              onDuplicate={() => handleDuplicateNode(n.id)}
              onDownload={() => handleDownloadNode(n.id)}
              onStartEdge={(e, side) => startEdgeFromNode(n.id, e, side)}
              onSlotMouseDown={onSlotMouseDown}
              onPromptTextChange={(value) => handlePromptTextChange(n.id, value)}
              onMetaPatch={(metaPatch) => {
                setNodes((prev) => prev.map((nn) => (
                  nn.id === n.id ? { ...nn, meta: { ...(nn.meta || {}), ...metaPatch } } : nn
                )));
              }}
              onReplaceContent={handleReplaceContent}
              onRequestUpload={() => handlePopulateNode(n)}
              onFrameZoom={() => zoomToNode(n, 350, 1)}
              draftActive={!!draftEdge && draftEdge.sourceNodeId !== n.id}
              removing={removing?.nodeId === n.id}
              removingOutside={removing?.nodeId === n.id && removingOutside}
              removeFromMenu={removing?.nodeId === n.id && !!removing.fromMenu}
              inSection={sectionMemberIds.has(n.id)}
              onRemoveFromSection={() => armNodeRemoval(n)}
              onCancelRemove={cancelNodeRemoval}
            />
          ))}
          {/* Section CHROME pass — name tag, grip, corner handles.
              Renders AFTER nodes so hit-testing lands here even when
              a node visually overlaps the chrome position. The wrapper
              is pointer-events:none so the empty space around the
              chrome elements still passes clicks through to the canvas
              / nodes underneath. */}
          {sections.map((s) => {
            if (adoptPreview && s.memberIds.length === 1 && s.memberIds[0] === adoptPreview.nodeId) return null;
            const pv = adoptPreview?.sectionId === s.id ? adoptPreview.rect : null;
            // Clean = nothing changed since the last run (node POSITION doesn't
            // count). The pill stays actionable as a "Reroll" — re-running the
            // same chain to get a fresh result — instead of going dead. Shared
            // by the WHOLE pill (click anywhere) and the play button.
            const isClean = cleanSectionIds.has(s.id);
            const sectionRunning = (s.memberIds || []).some((mid) => runningNodeIds.has(mid));
            const triggerRun = () => { if (sectionRunning) return; runSectionFlow(s); };
            return (
            <div
              key={`chrome-${s.id}`}
              className="canvas-section-chrome"
              data-section-id={s.id}
              style={{
                left: pv ? pv.left : s.x,
                top: pv ? pv.top : s.y,
                width: pv ? pv.right - pv.left : s.width,
                height: pv ? pv.bottom - pv.top : s.height,
              }}
            >
              <div
                className={`canvas-section-name-tag${s.hasEdges && !sectionRunning ? '' : ' disabled'}${sectionRunning ? ' running' : ''}${floatingRunSectionId === s.id ? ' floated-away' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={!s.hasEdges ? 'Connect nodes to run this flow' : (isClean ? 'Reroll this flow' : 'Run this flow')}
                onClick={(e) => {
                  // Clicking ANYWHERE on the pill runs the flow (not just the
                  // play icon). Also selects the section so its controls show.
                  e.stopPropagation();
                  setSelectedSectionId(s.id);
                  setSelectedNodeId(null);
                  setSelectedNodeIds(new Set());
                  triggerRun();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSectionMenu({ sectionId: s.id, x: e.clientX, y: e.clientY });
                }}
              >
                {/* Run label — becomes "Reroll" once the flow has run and
                    nothing but node positions has changed (isClean). With no
                    edges the flow can't run, so it reads "run this flow" and
                    the whole pill renders disabled (dark grey). */}
                <span className="canvas-section-name-label">{s.hasEdges && isClean ? 'Reroll' : 'run this flow'}</span>
                {/* Play button ALWAYS renders. Without edges it stays visible
                    but disabled — the pill goes dark grey, the play icon light
                    grey — so the affordance never vanishes when nodes get
                    disconnected. */}
                <button
                  type="button"
                  className={`canvas-section-play-btn${s.hasEdges && !sectionRunning ? '' : ' disabled'}`}
                  onClick={(e) => { e.stopPropagation(); triggerRun(); }}
                  disabled={!s.hasEdges || sectionRunning}
                  aria-label={!s.hasEdges ? 'Connect nodes to run this flow' : (isClean ? 'Reroll this flow' : `Run this flow`)}
                  data-tooltip={s.hasEdges && isClean ? 'Reroll — regenerate a fresh result' : undefined}
                >
                  {s.hasEdges && isClean ? (
                    // Two arrows looping into each other — "reroll" the chain.
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <polygon points="6,4 20,12 6,20" />
                    </svg>
                  )}
                </button>
              </div>
              <div
                className="canvas-section-grip"
                onMouseDown={(e) => startSectionMove(s.id, e)}
                data-tooltip="Drag to move workflow"
                aria-label="Drag workflow"
              >
                <span /><span /><span /><span /><span /><span />
                <span /><span /><span /><span /><span /><span />
              </div>
              {['nw', 'ne', 'sw', 'se'].map((corner) => (
                <div
                  key={corner}
                  className={`canvas-section-handle canvas-section-handle-${corner}`}
                  onMouseDown={(e) => startSectionResize(s.id, corner, e)}
                  aria-hidden="true"
                >
                  {corner === 'se' && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
                      <line x1="8" y1="20" x2="20" y2="8" />
                      <line x1="12" y1="20" x2="20" y2="12" />
                      <line x1="16" y1="20" x2="20" y2="16" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
            );
          })}
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

      {marquee && (
        <div
          className="canvas-marquee"
          style={{
            left:   Math.min(marquee.x0, marquee.x1) + 'px',
            top:    Math.min(marquee.y0, marquee.y1) + 'px',
            width:  Math.abs(marquee.x1 - marquee.x0) + 'px',
            height: Math.abs(marquee.y1 - marquee.y0) + 'px',
          }}
        />
      )}

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
          sourceKind={nodes.find((n) => n.id === emptyDropMenu.sourceNodeId)?.kind || null}
          onClose={() => setEmptyDropMenu(null)}
          onPick={async (kind) => {
            // "Connect to" — spawn an UNPOPULATED node of the picked
            // category at the drop point, auto-linked to the cord's source.
            // Content arrives later via the node's center upload button
            // (prompt opens as an inline textarea instead).
            const m = emptyDropMenu;
            setEmptyDropMenu(null);
            await handleCreateEmptyNode(kind, { worldX: m.worldX, worldY: m.worldY, linkFromNodeId: m.sourceNodeId });
          }}
          onExtract={async (to) => {
            const m = emptyDropMenu;
            setEmptyDropMenu(null);
            await handleExtractTo(to, { sourceNodeId: m.sourceNodeId, worldX: m.worldX, worldY: m.worldY });
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
            const file = await pickFile(ACCEPT_BY_KIND.designmd);
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

      {/* Multi-file queue pill — anchored to the cursor while placing a batch
          of dropped files, showing how many are placed vs queued (e.g. 2/5).
          While the node for the current slot is still being created, a circular
          spinner shows so the wait reads as "loading", not frozen. */}
      {placeQueue && typeof document !== 'undefined' && createPortal(
        <div className="canvas-place-pill" ref={placePillRef} aria-hidden="true">
          {placeQueue.loading && <span className="canvas-place-pill-spinner" />}
          <span>{placeQueue.current}/{placeQueue.total} files</span>
        </div>,
        document.body,
      )}

      <PromptDock
        ref={promptDockRef}
        activeContexts={activeContexts}
        onClearActiveContext={handleClearActiveContext}
        onAgentNodeRunStart={(nid) => setNodeRunStatus(nid, { step: 2, label: 'Generating…', request: requestTextForTarget(nid) })}
        onAgentNodeRunEnd={(nid) => setNodeRunStatus(nid, null)}
        boardId={board.id}
        onAddUrl={handleAddUrl}
        onUploadMd={handleUploadMd}
        onUploadHtml={handleUploadHtml}
        onQueueFiles={handleQueueFiles}
        onAddPrompt={() => handleAddPrompt()}
        onAddSkill={() => handleAddSkill()}
        onAddBlankSite={() => handleAddBlankSite()}
        onRunFlow={handleRunFlow}
        runFlowBusy={runFlowBusy}
        runFlowDisabled={runFlowAllClean}
        runFlowError={runFlowError}
        nodeCount={nodes.length}
        onAgentMutatedGraph={async ({ frame = false } = {}) => {
          // Agent emitted a graph mutation. Refetch board state so the
          // canvas reflects creates/updates/deletes. We DON'T frame on
          // every mid-run mutation — that made the camera jump per
          // tool call as the workflow was being assembled. The single
          // framing pass happens when `frame: true` is set (end of run).
          try {
            // Light refetch — metadata only, no snapshot HTML/design_md JOIN.
            // Most agent mutations are creates/deletes/position moves that
            // don't touch snapshots, so dragging the heavy payload on every
            // refetch is pure waste. We then targeted-fetch ONLY the nodes
            // whose current_snapshot_id actually changed (runFlow/editSite/
            // createNode-with-content), preserving the rendered HTML for all
            // unchanged nodes.
            const data = await api.getBoard(board.id, { light: true }).catch(() => null);
            if (!data || !Array.isArray(data.nodes)) return;

            // Diff inside the setNodes callback so we don't race against
            // the queued state update. We MERGE light metadata into the
            // existing nodes instead of replacing — replacing would wipe
            // current_html for every existing site node and force iframes
            // to remount empty until the next full GET.
            let newNodes = [];
            const stalenessByNode = new Map(); // nodeId → true when snapshot needs fetch
            setNodes((prev) => {
              const prevById = new Map(prev.map((n) => [n.id, n]));
              newNodes = data.nodes.filter((n) => !prevById.has(n.id));
              return data.nodes.map((n) => {
                const old = prevById.get(n.id);
                if (!old) {
                  // Brand-new node — if it already has a snapshot id
                  // (agent created with content), we need its html.
                  if (n.current_snapshot_id) stalenessByNode.set(n.id, true);
                  return n;
                }
                const snapChanged = old.current_snapshot_id !== n.current_snapshot_id;
                if (snapChanged) stalenessByNode.set(n.id, true);
                return {
                  ...old,                                          // preserve client-only fields (_loading, etc.)
                  ...n,                                            // overwrite with fresh metadata
                  current_html:        snapChanged ? null : old.current_html,
                  current_design_md:   snapChanged ? null : old.current_design_md,
                  current_screenshot:  snapChanged ? null : old.current_screenshot,
                };
              });
            });
            if (Array.isArray(data.edges)) setEdges(data.edges);

            // For each node whose snapshot id changed (or new node with a
            // snapshot), fire a targeted full GET to load the html. Runs
            // in parallel; failures are silent (next mutation refetches).
            for (const nodeId of stalenessByNode.keys()) {
              api.getNode(nodeId).then(({ snapshot }) => {
                if (!snapshot?.html) return;
                setNodes((prev) => prev.map((n) =>
                  n.id === nodeId ? {
                    ...n,
                    current_html: snapshot.html,
                    current_screenshot: snapshot.screenshot_url || null,
                  } : n
                ));
              }).catch(() => {});
            }

            // Track every node created across this run so framing can fit
            // the full workflow even if intermediate refetches only saw it
            // piece by piece.
            if (!agentRunNewNodesRef.current) agentRunNewNodesRef.current = new Map();
            for (const n of newNodes) agentRunNewNodesRef.current.set(n.id, n);

            const accumulated = Array.from(agentRunNewNodesRef.current.values());
            if (frame) agentRunNewNodesRef.current = new Map();  // reset at end of run
            if (accumulated.length === 0) return;

            // Focus the camera on the new content the moment it lands on the
            // canvas (loading state included) so the user never has to hunt
            // for where it appeared. We fit the ACCUMULATED bbox (not each
            // node), so as more nodes arrive the frame expands smoothly to
            // include them instead of hard-jumping per tool call. Only frame
            // when something new actually appeared this tick (or at run end),
            // so plain updates/deletes don't move the camera.
            if (newNodes.length === 0 && !frame) return;

            setTimeout(() => {
              const PAD = 160;
              const minX = Math.min(...accumulated.map((n) => n.pos_x));
              const minY = Math.min(...accumulated.map((n) => n.pos_y));
              const maxX = Math.max(...accumulated.map((n) => n.pos_x + (n.width || 1280)));
              const maxY = Math.max(...accumulated.map((n) => n.pos_y + (n.height || 800)));
              const cx = (minX + maxX) / 2;
              const cy = (minY + maxY) / 2;
              const vw = window.innerWidth;
              const vh = window.innerHeight - 48;
              const scale = Math.min(vw / (maxX - minX + PAD * 2), vh / (maxY - minY + PAD * 2), 1.0);
              const posX = vw / 2 - cx * scale;
              const posY = (vh / 2 + 48) - cy * scale;
              transformRef.current?.setTransform(posX, posY, scale, frame ? 500 : 420);
            }, 80);
          } catch (e) { console.warn('[CanvasClient] agent-mutation refetch failed', e); }
        }}
      />

      {runFlowError && (
        <div className="run-flow-toast" role="status" aria-live="polite">
          {runFlowError}
        </div>
      )}

      <ToastRoot />

      {sectionMenu && typeof document !== 'undefined' && (() => {
        const s = sections.find((x) => x.id === sectionMenu.sectionId);
        if (!s) return null;
        const title = s.name.length > 15 ? s.name.slice(0, 12) + '...' : s.name;
        return createPortal(
          <div
            ref={sectionMenuRef}
            className="empty-drop-menu cnode-topbar-menu section-context-menu"
            style={sectionMenuPos || { left: sectionMenu.x, top: sectionMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* Trash button in the top-left corner — quick-delete affordance
                with a confirmation modal. Sits absolutely above the title /
                items so it doesn't shift their layout. */}
            <button
              type="button"
              className="section-context-menu-trash"
              data-tooltip="Delete workflow"
              aria-label="Delete workflow"
              onClick={() => {
                setSectionMenu(null);
                setSectionDelete({ section: s, busy: false });
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
            <div className="section-context-menu-title" title={s.name}>{title}</div>
          </div>,
          document.body
        );
      })()}

      <ConfirmModal
        open={!!sectionDelete}
        title="Delete workflow?"
        message={sectionDelete ? `Delete the "${sectionDelete.section.name}" workflow? All ${sectionDelete.section.memberIds.length} member nodes will be removed.` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        busy={!!sectionDelete?.busy}
        onConfirm={() => {
          if (!sectionDelete) return;
          const s = sectionDelete.section;
          handleDeleteNodes(s.memberIds);
          if (selectedSectionId === s.id) setSelectedSectionId(null);
          setSectionDelete(null);
        }}
        onCancel={() => { if (!sectionDelete?.busy) setSectionDelete(null); }}
      />

      <ConfirmModal
        open={!!nodeDelete}
        title="Delete node?"
        message={nodeDelete?.name ? `"${nodeDelete.name}" will be removed from the canvas.` : 'This node will be removed from the canvas.'}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          if (nodeDelete) {
            handleDeleteNode(nodeDelete.id);
            if (selectedNodeId === nodeDelete.id) setSelectedNodeId(null);
          }
          setNodeDelete(null);
        }}
        onCancel={() => setNodeDelete(null)}
      />

      <ConfirmModal
        open={!!playSection}
        title="Re-run workflow?"
        message={playSection ? `Re-execute "${playSection.section.name}" with the same inputs. The new result will replace the current one and consumes credits.` : ''}
        confirmLabel="Run"
        cancelLabel="Cancel"
        busy={!!playSection?.busy}
        checkboxLabel="Don't ask again"
        onConfirm={(skipFuture) => handleConfirmPlaySection(skipFuture)}
        onCancel={() => { if (!playSection?.busy) setPlaySection(null); }}
      />

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

// Measure a menu after mount and clamp it to the viewport. Re-runs when the
// anchor or any `deps` (e.g. a submenu toggling height) change. useLayoutEffect
// repositions before paint, so there's no visible jump.
function useClampedMenuPos(x, y, deps = []) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setPos(clampToViewport(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, ...deps]);
  return [ref, pos];
}

function CanvasContextMenu({ x, y, onClose, onPickUrl, onPickHtml, onPickMd, onPickScreenshot, onPickPrompt, onPickCode, onPickBlankSite }) {
  const [mode, setMode] = useState('choices');
  const [url, setUrl] = useState('');
  const [menuRef, { left, top }] = useClampedMenuPos(x + 8, y + 8, [mode]);

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
      ref={menuRef}
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

// Drop-on-empty after dragging a cord from a node's right port. "Connect
// to…" — picking a category spawns an UNPOPULATED node of that kind at the
// drop point, auto-linked to the source. The new node carries a center
// upload button (kind-scoped formats); prompt opens as an inline textarea.
const EMPTY_DROP_ITEMS = [
  { kind: 'prompt',   label: 'prompt', Icon: MenuIcon.Prompt },
  { kind: 'site',     label: '.html',  Icon: MenuIcon.Html },
  { kind: 'designmd', label: '.md',    Icon: MenuIcon.Md },
  { kind: 'asset',    label: 'image',  Icon: MenuIcon.Image },
];

// Extract-to mirrors Connect-to's four kinds (same icons + labels). Each maps
// to the backend `to` per SOURCE kind; an absent mapping renders the item
// DISABLED (faded). `.html` + `image` only make sense FROM a site/URL node
// (image = a screenshot of the site); `.md` + `prompt` work from site AND asset.
const EXTRACT_ITEMS = [
  { key: 'prompt', label: 'prompt', Icon: MenuIcon.Prompt, to: { site: 'prompt',   asset: 'prompt' } },
  { key: 'html',   label: '.html',  Icon: MenuIcon.Html,   to: { site: 'html' } },
  { key: 'md',     label: '.md',    Icon: MenuIcon.Md,     to: { site: 'designmd', asset: 'tokens' } },
  { key: 'image',  label: 'image',  Icon: MenuIcon.Image,  to: { site: 'screenshot' } },
];

function EmptyDropMenu({ x, y, sourceKind, onClose, onPick, onExtract }) {
  const [extractOpen, setExtractOpen] = useState(false);
  const [menuRef, { left, top }] = useClampedMenuPos(x + 8, y + 8, [extractOpen]);
  // Normalised source kind for the extract `to` mapping. The Extract-to submenu
  // exists for site + asset sources (where a generator exists); other kinds
  // don't show it. Within it, items disable when their `to[srcKind]` is absent.
  const srcKind = sourceKind === 'image' ? 'asset' : sourceKind;
  const showExtract = srcKind === 'site' || srcKind === 'asset';

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
    <div ref={menuRef} className="popup-menu empty-drop-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="popup-menu-title">Connect to…</div>
      {EMPTY_DROP_ITEMS.map(({ kind, label, Icon }) => (
        <button key={kind} className="popup-menu-btn" onClick={() => onPick(kind)}>
          <Icon /><span>{label}</span>
        </button>
      ))}
      {showExtract && (
        <div className="empty-drop-extract">
          <button
            type="button"
            className="popup-menu-btn empty-drop-submenu-trigger"
            onMouseEnter={() => setExtractOpen(true)}
            onClick={() => setExtractOpen((v) => !v)}
          >
            <span>Extract to</span>
            <svg className="empty-drop-chevron" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
          {extractOpen && (
            <div className="empty-drop-submenu" onMouseLeave={() => setExtractOpen(false)}>
              {EXTRACT_ITEMS.map(({ key, label, Icon, to }) => {
                const target = to[srcKind];
                const disabled = !target;
                return (
                  <button
                    key={key}
                    type="button"
                    className="popup-menu-btn"
                    disabled={disabled}
                    title={disabled ? 'Only available from a website/URL node' : undefined}
                    onClick={disabled ? undefined : () => onExtract?.(target)}
                  >
                    <Icon /><span>{label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
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
