'use client';

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Check, CloudCheck, Monitor, Smartphone, Tablet, Workflow as WorkflowIcon, X } from 'lucide-react';
import { nodeOrigin, originColor } from '../lib/node-origin.js';
import { imageUrlFromPastedHtml, looksLikeImageUrl } from '../lib/pasted-image.js';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { api } from '../lib/canvas-api.js';
import CanvasNodeItem from './CanvasNodeItem.jsx';
import CanvasDotGrid from './CanvasDotGrid.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import EdgeLayer, { DraftEdgeLayer } from './EdgeLayer.jsx';
import ZoomControls from './ZoomControls.jsx';
import UserPill from './UserPill.jsx';
import CreditsPill from './CreditsPill.jsx';
import PlansModal from './PlansModal.jsx';
import { normalizeUrl, looksLikeUrl } from '../lib/url.js';
// EdgePopup removed — the per-edge config widget was the legacy "manual mode".
// Edges are now selected by click and deleted with the keyboard.
import PromptDock from './PromptDock.jsx';
import Minimap from './Minimap.jsx';
import CanvasSidebar from './CanvasSidebar.jsx';
import CanvasTools from './CanvasTools.jsx';
import CanvasInspector from './CanvasInspector.jsx';
import {
  NativeMotionEditSessionProvider,
  NativeMotionEditTopbarControls,
  nativeMotionEditShellLayout,
} from './motion-editor/NativeMotionEditChrome.jsx';
import ChallengeModal from './ChallengeModal.jsx';
import { ToastRoot, toast } from './Toast.jsx';
import { BLANK_SITE_HTML } from '../lib/blank-site-html.js';
import { findSectionTerminals, planIncrementalRun, planRunFromNode, nodeInputSignature, sectionRerunWouldOverwrite, chainSignature, sectionOps } from '../lib/section-run.js';
import { buildNodesClipboardPayload, parseNodesClipboardText, payloadToPasteItems } from '../lib/node-clipboard.js';
import { estimateChain } from '../lib/billing/pricing.js';
import { needsDeferredReconstruction } from '../lib/reconstruction-policy.js';
import DevWidget from './DevWidget.jsx';
import { canUseCloneEdit } from '../lib/clone-edit-access.js';
import { clampToViewport } from '../lib/menu-position.js';
import { readCanvasScale, chromeScale } from '../lib/canvas-scale.js';
import { createWheelBatcher } from '../lib/wheel-batch.js';
import {
  shouldTearOut, nodeCenter, pointInRect,
  selectGeometricMembersToLatch, TEAR_MARGIN,
} from '../lib/section-membership.js';
import { clampFrameToNeighbors, clampMoveToNeighbors, planChainLayout, planSectionDeoverlap } from '../lib/canvas-layout.js';
import { classifyDropFile, formatDropRejectMessage } from '../lib/drop-files.js';
import { captureMoveUndo, restoreMissingEdges, restoreMovedNodes } from '../lib/canvas-undo.js';
import {
  CANVAS_DEFAULT_SCALE,
  CANVAS_MAX_SCALE,
  CANVAS_MIN_SCALE,
  clampCanvasScale,
  parseCanvasView,
} from '../lib/canvas-view.js';
import { frameAgentNodes } from '../lib/agent-camera.js';
import {
  isLiveUrlReference,
  liveReferenceMeta,
  remapLiveReferenceSelection,
} from '../lib/url-reference.js';
import {
  applyReconstructionResultToNode,
  NODE_EDITOR_KIND,
  resolveNodeEditorKind,
  snapshotEditorMetadata,
} from '../lib/node-editor-kind.js';
import {
  canonicalNativeEditNode,
  computeNodeEditFrame,
  nativeEditDeviceForNode,
} from '../lib/node-viewport.js';
import { applyNativeCommitSnapshot } from '../lib/motion-editor/native-edit-api.js';

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
// Floating "run this flow" (canvas-level clone shown when a section's pill
// leaves the viewport) — HIDDEN for now per user call 2026-07-03; only the
// in-section pills stay. Flip to true to bring it back (all wiring intact).
const SHOW_FLOATING_RUN = false;
// Coin glyph for pre-flight cost tags — same convention as the CreditsPill
// (placeholder icon, to be swapped for the final credits glyph later).
// Order convention: icon BEFORE the numeral, no unit text, no "≈".
const CREDIT_COST_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M9 12h6" />
  </svg>
);
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

// Stable empty array for nodes without incoming edges — a fresh [] per
// render would defeat CanvasNodeItem's memo for every edge-less node.
const EMPTY_EDGES = [];
const NATIVE_MOTION_CANVAS_EDIT = /^(1|true)$/i.test(
  String(process.env.NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT || ''),
);

function editorKindForNode(node) {
  return resolveNodeEditorKind(
    node,
    snapshotEditorMetadata(node),
    { nativeMotionCanvasEdit: NATIVE_MOTION_CANVAS_EDIT },
  );
}

export default function CanvasClient({ board, initialNodes, initialEdges, user, initialFocusNodeId = null }) {
  const [nodes, setNodes] = useState(initialNodes || []);
  const [edges, setEdges] = useState(initialEdges || []);
  const [boardName, setBoardName] = useState(board.name || 'Untitled');
  const initialFocusedNode = initialFocusNodeId
    ? initialNodes.find((node) => node.id === initialFocusNodeId)
    : null;
  const [selectedNodeId, setSelectedNodeId] = useState(initialFocusedNode?.id || null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [draftEdge, setDraftEdge] = useState(null);  // {sourceNodeId, mouseX, mouseY}
  const [popupPos, setPopupPos] = useState(null);
  const [emptyDropMenu, setEmptyDropMenu] = useState(null);  // {sourceNodeId, x, y, worldX, worldY}
  const [contextMenu, setContextMenu] = useState(null);  // {x, y, worldX, worldY} — right-click on empty canvas
  const [editingNodeId, setEditingNodeId] = useState(null);
  const nativeEditRestoreRef = useRef(null);
  const editFrameTimerRef = useRef(null);
  const nativeViewportFrameRafRef = useRef(null);
  const [editorActionBusy, setEditorActionBusy] = useState(false);
  const [workflowSaveState, setWorkflowSaveState] = useState('idle');
  const [showFirstNodeCoachmark, setShowFirstNodeCoachmark] = useState(false);
  const [canvasScale, setCanvasScale] = useState(CANVAS_DEFAULT_SCALE);
  // Last scale we pushed into React state. onTransformed fires repeatedly as
  // TransformWrapper settles (and setTransform with anim=0 fires it inline);
  // pushing setCanvasScale on every fire re-renders → can re-enter the
  // transform → "Maximum update depth exceeded". We only setState when the
  // scale actually moved (epsilon), which breaks that feedback.
  const lastAppliedScaleRef = useRef(CANVAS_DEFAULT_SCALE);
  // Trailing timer for the `canvas-interacting` gesture class — set on every
  // transform tick, cleared 180ms after the last one. CSS uses it to pause
  // in-world cosmetic motion while zoom/pan is actively changing. The same
  // settle callback owns EVERYTHING deferred off the gesture hot path:
  // exact --canvas-scale write, threshold classes, the single React scale
  // push (re-renders all nodes ONCE per gesture, not mid-flight), and the
  // floating-run reanchor.
  const interactingTimerRef = useRef(null);
  // Canvas-drawn dot grid (replaces the CSS-gradient .canvas-bg — see
  // CanvasDotGrid.jsx). onTransformed feeds it the live transform.
  const dotGridRef = useRef(null);
  // Quantized --canvas-scale writes: setting the var on <html> invalidates
  // style + LAYOUT for every calc(--canvas-scale) consumer (≈220 rules
  // across all nodes). Per-tick writes made every zoom frame relayout the
  // whole board. The var now updates only on ≥1% scale change with ≥90ms
  // spacing; the gesture-end settle writes the exact value.
  const lastVarScaleRef = useRef(CANVAS_DEFAULT_SCALE);
  const lastVarWriteTimeRef = useRef(0);
  const lastTransformRef = useRef(null);
  const canvasViewReadyRef = useRef(false);
  const canvasViewSaveTimerRef = useRef(null);
  const CANVAS_VIEW_KEY = `uncraft-canvas-view:v2:${board.id}`;

  useEffect(() => () => {
    if (editFrameTimerRef.current) window.clearTimeout(editFrameTimerRef.current);
    if (nativeViewportFrameRafRef.current) window.cancelAnimationFrame(nativeViewportFrameRafRef.current);
    const session = nativeEditRestoreRef.current;
    if (!session?.camera) return;
    try {
      localStorage.setItem(CANVAS_VIEW_KEY, JSON.stringify(session.camera));
    } catch { /* best-effort route-change restoration */ }
    nativeEditRestoreRef.current = null;
  }, [CANVAS_VIEW_KEY]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowFirstNodeCoachmark(params.get('onboarding') === 'create-workflow' && nodes.length === 0);
  }, [nodes.length]);

  function dismissFirstNodeCoachmark() {
    setShowFirstNodeCoachmark(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('onboarding');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
  // Cursor is the permanent resting mode. Holding Space temporarily activates
  // pan; there is deliberately no persistent Hand state to get stuck in.
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
  // Undo stack for structural canvas actions. Each entry is one operation
  // the user can reverse with Cmd+Z. Keep this in a ref (not state) so the
  // keyboard handler always sees the latest stack without re-binding.
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
  // Section pending delete confirmation. Same ConfirmModal pattern as
  // playSection — { section, busy }.
  const [sectionDelete, setSectionDelete] = useState(null);
  // Severed cords linger briefly for the retract animation — see
  // handleDeleteEdge. Array of full edge objects (they're already gone
  // from `edges` when EdgeLayer draws them).
  const [dyingEdges, setDyingEdges] = useState([]);
  // Single-node pending delete confirmation (from the node ⋯ menu). Styled
  // ConfirmModal in place of the old native confirm() — { id, name }.
  const [nodeDelete, setNodeDelete] = useState(null);
  // Cross-section cord pending merge confirmation. A manual cord between two
  // DISTINCT sections fuses them into one — a big layout change for a small
  // drop, so it asks first. { src, targetId } holds the drop until the user
  // confirms; Cancel creates nothing.
  const [mergeConfirm, setMergeConfirm] = useState(null);
  // Section under the cursor — drives the show-on-hover run pill. Tracked via
  // a global mousemove (world coords) because the section frame/chrome are
  // pointer-events:none and can't :hover themselves.
  const [hoveredSectionId, setHoveredSectionId] = useState(null);
  // Files dragged in from the OS (Finder/Explorer) that have no node
  // representation — array of filenames driving the unsupported-format
  // error modal. Null when closed.
  const [dropRejects, setDropRejects] = useState(null);
  // Billing block — set when any api.* call throws code 'insufficient_credits'
  // ({ estimate, balance }); renders the "Not enough credits" modal. "Buy
  // credits" opens the PlansModal (v1 waitlist).
  const [insufficientCredits, setInsufficientCredits] = useState(null);
  const [plansOpen, setPlansOpen] = useState(false);
  // Guards the one paid preparation that can precede edit mode. URL capture
  // itself remains free; an animated capture is reconstructed only after the
  // user explicitly chooses Edit.
  const editPreparationRef = useRef(new Set());
  // Transient per-node debit chips — nodeId → credits, cleared after 2.5s.
  const [nodeDebits, setNodeDebits] = useState(new Map());
  function flashNodeDebit(nodeId, credits) {
    if (!credits || credits <= 0 || !nodeId) return;
    setNodeDebits((prev) => new Map(prev).set(nodeId, credits));
    setTimeout(() => {
      setNodeDebits((prev) => {
        if (!prev.has(nodeId)) return prev;
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
    }, 2500);
  }
  // Returns true when the error was a billing block (and the modal is now up).
  function handleBillingError(e) {
    if (e?.code !== 'insufficient_credits') return false;
    setInsufficientCredits({ estimate: e.estimate ?? 0, balance: e.balance ?? 0 });
    return true;
  }
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
  // Alt+drag duplicate: the optimistic local ghost copy that follows the cursor
  // during the gesture (rendered translucent like a placing node) until the
  // mouse is released, at which point it's persisted. Separate from
  // placingNodeId so it doesn't trip the click-to-drop placement effect.
  const [altDupGhostIds, setAltDupGhostIds] = useState(null); // Set<tempId> during an Alt+drag gesture
  // Multi-selection group drag — anchor node + followers' start offsets.
  const groupDragRef = useRef(null);
  // When a URL is added from the "+" toolbar, the temp placeholder is placed
  // with the ghost first; persistence starts only once it is dropped.
  const pendingUrlReferenceRef = useRef(null);
  // Embed-policy checks start while the URL ghost is being positioned. Most
  // complete before drop, hiding the iframe-vs-capture decision entirely.
  const urlEmbedChecksRef = useRef(new Map());
  const urlResolutionInFlightRef = useRef(new Set());
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
  //       initialScale=0.72 but onTransformed doesn't fire until the user
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
      document.documentElement.style.setProperty('--canvas-scale', String(CANVAS_DEFAULT_SCALE));
      document.documentElement.classList.remove('canvas-zoom-low', 'canvas-zoom-mid', 'canvas-zoom-very-low', 'canvas-zoom-min');
    };
    reset();
    return () => {
      document.documentElement.style.removeProperty('--canvas-scale');
      document.documentElement.classList.remove('canvas-zoom-low', 'canvas-zoom-mid', 'canvas-zoom-very-low', 'canvas-zoom-min');
    };
  }, []);

  // Canvas theme is DARK-ONLY (Working Table, unspirit 2026-07-12). The
  // canvas light mode was retired with its ~195 CSS overrides; the editor
  // keeps its own light mode for its panels while editing (editor-core CSS,
  // untouched) — the canvas chrome hides in edit mode anyway.

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

  // Paste clipboard content onto the canvas → nodes. Images / .md / .html (real
  // files OR a copied image blob) become ghost-placed nodes via the upload
  // queue; a pasted URL becomes a site node. Unsupported payloads are left
  // alone. The window listener is bound once and reads the latest handlers
  // through a ref so it never closes over stale `nodes`/state.
  const pasteFnsRef = useRef(null);
  pasteFnsRef.current = { handleQueueFiles, handleAddUrl, handlePasteNodes, handleAddImageUrl };
  // Consecutive pastes of the same payload step further out each time so
  // copies never stack invisibly. Reset on every fresh Cmd+C.
  const pasteSeqRef = useRef(0);

  // Cmd+C: copy the current selection — nodes AND the cords between them —
  // as an internal JSON payload on the SYSTEM clipboard. Riding the system
  // clipboard (instead of an app-local buffer) makes last-copy-wins natural
  // against external content and lets a chain paste into another board.
  const copyFnsRef = useRef(null);
  copyFnsRef.current = {
    buildSelectionClipboardPayload() {
      let ids = null;
      if (selectedNodeIds.size) ids = [...selectedNodeIds];
      else if (selectedNodeId) ids = [selectedNodeId];
      else if (selectedSectionId) {
        const s = sections.find((x) => x.id === selectedSectionId);
        ids = s ? [...s.memberIds] : null;
      }
      if (!ids || !ids.length) return null;
      return buildNodesClipboardPayload(nodes.filter((n) => ids.includes(n.id)), edges);
    },
  };
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onCopy(e) {
      // Never hijack a copy meant for text: focused fields, the chat dock,
      // or an actual text selection on the page keep native behavior.
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, .prompt-dock')) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length) return;
      const payload = copyFnsRef.current?.buildSelectionClipboardPayload?.();
      if (!payload || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', JSON.stringify(payload));
      pasteSeqRef.current = 0;
      toast.info(`Copied ${payload.nodes.length} node${payload.nodes.length > 1 ? 's' : ''}.`);
    }
    window.addEventListener('copy', onCopy);
    return () => window.removeEventListener('copy', onCopy);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onPaste(e) {
      // Don't hijack paste meant for a text field, the chat dock, or an
      // element being edited — only the bare canvas turns a clipboard payload
      // into nodes.
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, .prompt-dock')) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      const cd = e.clipboardData;
      if (!cd) return;
      const fns = pasteFnsRef.current || {};

      // 1) Real files copied from the OS (images, .md, .html).
      const files = cd.files && cd.files.length ? [...cd.files] : [];
      // 2) Image blobs not exposed as files (a copied screenshot, "copy image"
      //    from another page). getAsFile yields a nameless blob — give it a
      //    name so it classifies + displays.
      if (!files.length && cd.items) {
        for (const it of cd.items) {
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            const blob = it.getAsFile();
            if (blob) {
              const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
              files.push(new File([blob], `pasted-image.${ext}`, { type: blob.type }));
            }
          }
        }
      }
      if (files.length) { e.preventDefault(); fns.handleQueueFiles?.(files); return; }

      const text = ((cd.getData && cd.getData('text/plain')) || '').trim();

      // 3) An internal Uncraft payload (Cmd+C on a selection) → re-create
      //    the copied nodes + their cords, offset from the originals.
      const nodesPayload = parseNodesClipboardText(text);
      if (nodesPayload) {
        e.preventDefault();
        fns.handlePasteNodes?.(nodesPayload);
        return;
      }

      // 4) An image copied from a web page. MEDIDO num Chromium real: copiar a
      //    imagem SELECIONANDO-A não põe arquivo nenhum na área de
      //    transferência — põe `text/plain` com o texto alternativo e
      //    `text/html` com o `<img src>`. Sem ler o HTML, o único endereço
      //    disponível era ignorado e nada acontecia.
      const html = (cd.getData && cd.getData('text/html')) || '';
      const doHtml = imageUrlFromPastedHtml(html);
      if (doHtml) { e.preventDefault(); fns.handleAddImageUrl?.(doHtml); return; }

      // 5) "Copiar endereço da imagem" entrega a URL em texto. Ela caía na
      //    porta de qualquer link e virava node de SITE — o canvas tentava
      //    clonar a imagem como se fosse uma página.
      if (text && looksLikeImageUrl(text)) {
        e.preventDefault();
        fns.handleAddImageUrl?.(normalizeUrl(text) || text);
        return;
      }

      // 6) A pasted URL → site node. Arbitrary text is left for normal paste.
      if (text && looksLikeUrl(text)) {
        const url = normalizeUrl(text);
        if (url) { e.preventDefault(); fns.handleAddUrl?.(url); }
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // Mirror the temporary pan mode to <body> so CSS can swap the cursor
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
  // Expose a tiny zoom API so the in-editor inspector header can drive
  // the canvas TransformWrapper without React-bridging. Editor-core is
  // vanilla JS and lives inside the host doc — it picks this up off
  // window.__uncraftZoom on demand.
  useEffect(() => {
    const ZOOM_STEP = 1.2, MIN = editingNodeId ? 0.04 : 0.1, MAX = 2.5;
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
      let cx = rect.width / 2, cy = rect.height / 2;
      if (editingNodeId) {
        const editingNode = nodes.find((node) => node.id === editingNodeId);
        const { left, right } = editFrameReserves(editingNode);
        cx = left + Math.max(320, rect.width - left - right) / 2;
        cy = 46 + Math.max(240, rect.height - 64) / 2;
      }
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
        if (editingNodeId) return;
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
        if (editingNodeId) {
          const editingNode = nodes.find((node) => node.id === editingNodeId);
          const { left, right } = editFrameReserves(editingNode);
          cx = left + Math.max(320, window.innerWidth - left - right) / 2;
          cy = 46 + Math.max(240, window.innerHeight - 64) / 2;
        }
        // Wheel-zoom sensitivity — raised from 0.0015 → 0.0025 → 0.004
        // (2026-07-03, user request ×2): more zoom travel per wheel notch /
        // pinch distance.
        const factor = Math.exp(-deltaY * 0.004);
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
      fit: () => {
        if (editingNodeId) {
          const node = nodes.find((candidate) => candidate.id === editingNodeId);
          if (node) window.__uncraftZoom.frameNode(editingNodeId, 280);
          return;
        }
        fitToContent();
      }
    };
    // CRITICAL: this effect re-runs every time `canvasScale` or `nodes`
    // change (which is constantly — every pan/zoom updates canvasScale).
    // Without preserving _editFrame across re-runs the frame-back button
    // observes a fresh object and stays disabled forever.
    if (prevEditFrame !== undefined) window.__uncraftZoom._editFrame = prevEditFrame;
    return () => { try { delete window.__uncraftZoom; } catch (e) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasScale, nodes, editingNodeId]);

  const fileInputRef = useRef(null);
  const fileInputAcceptRef = useRef('');
  const fileInputResolverRef = useRef(null);

  const updateNodeLocal = useCallback((id, patch) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  // EdgeLayer is memoized — its callback props must keep a stable identity
  // or the memo never hits. Latest-ref idiom: the stable wrappers resolve
  // the CURRENT implementation off edgeHandlersRef at event time (the ref
  // is re-pointed every render), so there are no stale closures.
  const edgeHandlersRef = useRef({});
  edgeHandlersRef.current = {
    selectEdge: (edge) => {
      setSelectedEdgeId(edge.id);
      setSelectedNodeId(null);
    },
    edgeDragStart: (edge, evt) => startEdgeReroute(edge, evt),
    severEdge: (edge) => handleDeleteEdge(edge),
  };
  const onSelectEdgeStable = useCallback((edge) => edgeHandlersRef.current.selectEdge(edge), []);
  const onEdgeDragStartStable = useCallback((edge, evt) => edgeHandlersRef.current.edgeDragStart(edge, evt), []);
  const onSeverEdgeStable = useCallback((edge) => edgeHandlersRef.current.severEdge(edge), []);

  // Handler table for the memoized CanvasNodeItem wrappers. Re-pointed on
  // every render (assignment lives right before the JSX return, after all
  // handler consts are initialized); items resolve handlers through it at
  // event time, so memoized nodes never hold stale logic.
  const nodeHandlersRef = useRef({});

  const dragNodeServer = useRef(new Map());
  function persistNodePosition(id, posX, posY) {
    clearTimeout(dragNodeServer.current.get(id));
    const t = setTimeout(() => api.updateNode(id, { posX, posY }).catch(console.warn), 250);
    dragNodeServer.current.set(id, t);
  }

  // Bound the in-memory history so long design sessions do not retain an
  // unlimited number of node/edge snapshots.
  function pushUndoEntry(entry) {
    if (!entry) return;
    undoStackRef.current.push(entry);
    if (undoStackRef.current.length > 100) undoStackRef.current.splice(0, undoStackRef.current.length - 100);
  }

  // ⚠️ NAO EXISTE REFAZER, E E' DELIBERADO (2026-08-14).
  //
  // O Adilson pediu: desfez a imagem colada e o refazer nao a trouxe de volta.
  // Construi um, e DUAS rodadas de auditoria mostraram que nesta arquitetura ele
  // nao pode ser correto sem um historico transacional de verdade:
  //   - a entrada de criacao guarda a LINHA do momento da criacao, entao refazer
  //     um node editado depois traria a versao velha por cima da nova;
  //   - qualquer invalidacao por "algo mudou" nao ve edicao de CONTEUDO (html,
  //     meta, nome), que nao mexe em id nem posicao;
  //   - a tela confirma antes do servidor, e `ON CONFLICT DO NOTHING` faz um
  //     200 nao provar que o que voltou e' o que se pediu.
  // Cada um desses destroi trabalho em silencio. Um refazer meio-certo e' pior
  // do que nenhum: o usuario confia nele. Fazer direito e' um historico com
  // estado antes/depois por operacao e confirmacao por objeto — obra propria,
  // nao remendo. Ate' la', desfazer segue via unica.

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
    // Multi-selection drag: capture the followers' offsets relative to the
    // anchor at drag start; handleNodeMove applies the same delta to all.
    groupDragRef.current = (selectedNodeIds.size > 1 && selectedNodeIds.has(node.id))
      ? {
          anchorId: node.id,
          members: nodes
            .filter((n) => selectedNodeIds.has(n.id) && n.id !== node.id && !String(n.id).startsWith('temp-'))
            .map((n) => ({ id: n.id, dx: n.pos_x - node.pos_x, dy: n.pos_y - node.pos_y })),
        }
      : null;
    // onMoveStart fires only after CanvasNode crosses the drag threshold, so
    // a plain click never consumes an undo slot. Capture the whole selected
    // group and the structural state a section hand-off may mutate.
    const movingIds = new Set([
      node.id,
      ...(groupDragRef.current?.members || []).map((member) => member.id),
    ]);
    pushUndoEntry(captureMoveUndo(nodes, edges, movingIds, sectionFrames));
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
    //
    // SECOND trigger — frame touch (2026-07-07, user spec): sections must
    // never invade each other, so the MOMENT the stretch (own frame grown
    // to follow the dragged node) would touch ANOTHER section, the node
    // changes hands right there, mid-drag: it leaves A (which snaps back to
    // its without-the-node size, clearing the intersection) and is swallowed
    // by B (live engulf preview; the drop commits the hand-off).
    if (drag.ownSectionId && drag.remainingCore && !removingRef.current) {
      const { cx, cy } = nodeCenter(node, posX, posY);
      // Scale the tear threshold inversely with zoom so it takes the SAME
      // on-screen pull to detach at any zoom — the further out (smaller
      // scale), the larger the world-space margin.
      const scale = readCanvasScale();
      const margin = TEAR_MARGIN / (scale > 0 ? scale : 1);
      const tearOut = shouldTearOut(cx, cy, drag.remainingCore, margin);
      const touched = tearOut ? null : findFrameTouch(drag.ownSectionId, rect);
      if (tearOut || touched) {
        const sec = sections.find((s) => s.id === drag.ownSectionId);
        const siblingIds = sec ? sec.memberIds.filter((id) => id !== node.id) : [];
        setRemovingSync({ nodeId: node.id, sectionId: drag.ownSectionId, rootId: drag.ownRootId, siblingIds, armX: node.pos_x, armY: node.pos_y });
        if (touched) {
          // Swallowed at contact: B's engulf preview reaches out to the node
          // where it is (same clearance the committed grow path uses).
          setAdoptPreviewSync({ nodeId: node.id, sectionId: touched.id, rootId: touched.rootId, rect: engulfRect(touched, rect) });
        } else if (adoptPreviewRef.current) {
          setAdoptPreviewSync(null);
        }
      }
    }
    // While a removal is armed for THIS node, drive the canvas-lighten by
    // whether it's currently outside its (now member-fitted) section frame.
    if (removingRef.current && removingRef.current.nodeId === node.id) {
      const { cx, cy } = nodeCenter(node, posX, posY);
      const ownRect = removalSectionRect(removingRef.current);
      const inside = pointInRect(cx, cy, ownRect);
      // Dragged BACK inside before releasing → un-arm live so the node
      // returns to its natural colour immediately (no waiting for the drop).
      // Re-arms if pulled past the tear margin again. Menu-armed nodes stay
      // armed until an explicit Cancel/Escape/commit, so they're excluded.
      // CRITICAL (2026-07-07): a frame-touch hand-off arms while the node
      // centre is often STILL inside A's refitted frame — un-arming on
      // `inside` alone made the arm oscillate every mousemove (net effect:
      // nothing ever happened and A kept invading B). Only un-arm when
      // re-adopting the node into A would no longer touch another section.
      if (inside && !removingRef.current.fromMenu) {
        const stillTouches = drag.ownSectionId ? findFrameTouch(drag.ownSectionId, rect) : null;
        if (!stillTouches) {
          setRemovingSync(null);
          setRemovingOutside(false);
          if (adoptPreviewRef.current) setAdoptPreviewSync(null);
          return;
        }
        // Still in hand-off territory: stay armed, keep the receiving
        // section's engulf latched on the node.
        setRemovingOutside(false);
        updateAdoptCandidate(node, rect, { sticky: true, fallback: stillTouches });
        return;
      }
      setRemovingOutside(!inside);
      // Cross-section hand-off (2026-07-07, user spec): an armed member
      // dragged over ANOTHER section is swallowed by it DURING the drag —
      // section A has already let go (the arm re-fitted its frame), so
      // section B shows the live engulf preview and the drop commits the
      // hand-off (cut cords from A + adopt into B). Sticky: once swallowed,
      // B keeps the node (the engulf follows it) until it re-enters A or
      // overlaps a different section.
      if (!inside) updateAdoptCandidate(node, rect, { sticky: true });
      else if (adoptPreviewRef.current) setAdoptPreviewSync(null);
      return;
    }

    // Only loose nodes (no real edge) can be ADOPTED into another section by
    // dragging — edge-connected members already belong to their workflow
    // (an armed tear-out is the exception, handled above).
    if (!drag.isLoose) return;
    updateAdoptCandidate(node, rect);
  }

  // Frame-touch test (2026-07-07): would the OWN section's frame, stretched
  // to follow the dragged node (union + clearance), intersect ANOTHER
  // section? Returns the touched section or null. While the node is armed
  // for removal, the sections memo already excludes it from A, so `own`
  // here is A's REFITTED rect — the test stays stable across the arm.
  function findFrameTouch(ownSectionId, rect) {
    const own = sections.find((s) => s.id === ownSectionId);
    if (!own) return null;
    const CLEAR = SECTION_MEMBER_CLEARANCE;
    const stretched = {
      left:   Math.min(own.x, rect.left - CLEAR),
      top:    Math.min(own.y, rect.top - CLEAR),
      right:  Math.max(own.x + own.width, rect.right + CLEAR),
      bottom: Math.max(own.y + own.height, rect.bottom + CLEAR),
    };
    for (const s of sections) {
      if (s.id === ownSectionId) continue;
      if (String(s.rootId || '').startsWith('temp-')) continue;
      if (stretched.left < s.x + s.width && stretched.right > s.x &&
          stretched.top < s.y + s.height && stretched.bottom > s.y) return s;
    }
    return null;
  }

  // Engulf rect: section frame grown to contain the node with the same
  // clearance the committed grow path uses ⇒ zero snap on drop.
  function engulfRect(s, rect) {
    const CLEAR = SECTION_MEMBER_CLEARANCE;
    return {
      left:   Math.min(s.x, rect.left - CLEAR),
      top:    Math.min(s.y, rect.top - CLEAR),
      right:  Math.max(s.x + s.width, rect.right + CLEAR),
      bottom: Math.max(s.y + s.height, rect.bottom + CLEAR),
    };
  }

  // Scan for the section a dragged node would join and drive the live
  // engulf preview. Shared by the loose-node path and the armed cross-
  // section hand-off. `sticky`: when nothing overlaps but a preview is
  // already latched (the frame-touch hand-off), keep it and let its engulf
  // follow the node instead of dropping it.
  function updateAdoptCandidate(node, rect, opts = {}) {
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
      const latched = adoptPreviewRef.current;
      if (opts.sticky && latched && latched.nodeId === node.id) {
        // Frame-touch hand-off latched → the receiving section's engulf
        // keeps following the node even while it isn't overlapping it.
        const s = sections.find((x) => x.id === latched.sectionId);
        if (s) best = s;
      }
      // No overlap and nothing latched → the frame-touch target itself.
      if (!best && opts.fallback) best = opts.fallback;
      if (!best) {
        if (latched) setAdoptPreviewSync(null);
        return;
      }
    }
    const previewRect = engulfRect(best, rect);
    const cur = adoptPreviewRef.current;
    if (cur && cur.sectionId === best.id &&
        cur.rect.left === previewRect.left && cur.rect.top === previewRect.top &&
        cur.rect.right === previewRect.right && cur.rect.bottom === previewRect.bottom) return;
    setAdoptPreviewSync({ nodeId: node.id, sectionId: best.id, rootId: best.rootId, rect: previewRect });
  }

  function handleNodeSelect(n, e) {
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
  }

  function handleNodeResize(n, width, height, opts) {
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
    if (opts?.fitEditing && editingNodeId === n.id) {
      const expandedNode = { ...n, width, height: patch.height ?? n.height };
      window.requestAnimationFrame(() => {
        const frame = computeEditFrame(expandedNode);
        if (!window.__uncraftZoom) return;
        window.__uncraftZoom._editFrame = frame;
        window.__uncraftZoom.setState?.(frame, 280);
      });
    }
    if (opts?.restoreAfterEditing) {
      const restoredNode = { ...n, width, height: patch.height ?? n.height };
      window.requestAnimationFrame(() => zoomToNode(restoredNode, 260));
    }
  }

  function handleNodeDeleteRequest(n) {
    setNodeDelete({ id: n.id, name: (n.name || '').trim() });
  }

  function handleNodeMetaPatch(id, metaPatch) {
    setNodes((prev) => prev.map((nn) => (
      nn.id === id ? { ...nn, meta: { ...(nn.meta || {}), ...metaPatch } } : nn
    )));
  }

  function handleNodeMove(node, posX, posY) {
    updateNodeLocal(node.id, { pos_x: posX, pos_y: posY });
    if (!String(node.id).startsWith('temp-')) persistNodePosition(node.id, posX, posY);
    // Group drag: dragging a node that's part of a multi-selection moves
    // every selected node by the same delta (design-tool standard). The
    // followers move rigidly with the anchor; adoption preview / removal
    // arming stay anchor-only.
    const g = groupDragRef.current;
    if (g && g.anchorId === node.id) {
      for (const m of g.members) {
        updateNodeLocal(m.id, { pos_x: posX + m.dx, pos_y: posY + m.dy });
        if (!String(m.id).startsWith('temp-')) persistNodePosition(m.id, posX + m.dx, posY + m.dy);
      }
    }
    maybeUpdateAdoptPreview(node, posX, posY);
  }

  async function handleNodeMoveEnd(node, moved) {
    groupDragRef.current = null;
    // Unfreeze membership — from here the next render re-derives sections from
    // live positions (the node has settled), so adoption/release lands once.
    setDragFreeze(null);
    const drag = looseDragRef.current;
    looseDragRef.current = null;
    const preview = adoptPreviewRef.current;
    if (preview) setAdoptPreviewSync(null);

    // Armed removal — decide on drop: outside the section commits the removal
    // (break all edges + clear adoption); inside cancels (stays a member).
    // Dropped over ANOTHER section (cross-section hand-off, live preview
    // during the drag): commit the removal AND adopt into it in one gesture.
    const arm = removingRef.current;
    if (arm && arm.nodeId === node.id && moved) {
      const fx = drag ? drag.lastX : node.pos_x;
      const fy = drag ? drag.lastY : node.pos_y;
      const { cx, cy } = nodeCenter(node, fx, fy);
      // A latched hand-off WINS over the inside-cancel: a frame-touch
      // transfer often drops while the node centre is still technically
      // inside A's old area — the node already belongs to B at that point.
      const handOff = preview && preview.nodeId === node.id ? preview : null;
      if (handOff) { await commitNodeRemoval(node, fx, fy, arm, handOff); return; }
      const inside = pointInRect(cx, cy, removalSectionRect(arm));
      if (inside) { cancelNodeRemoval(); return; }
      await commitNodeRemoval(node, fx, fy, arm, null);
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

    // Adopt — dropped while a section preview was active. Re-joining
    // explicitly clears a previous removal opt-out.
    if (preview && preview.nodeId === node.id) {
      const meta = { ...(node.meta || {}), adoptedInto: preview.rootId };
      delete meta.sectionOptOut;
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
  // Lives in lib/drop-files.js (pure, shared with the OS-drop path).
  const classifyQueueFile = classifyDropFile;

  // Create one queued file's node on the server and RETURN it WITHOUT mounting
  // (no setNodes, no undo, no placement). Lets the queue pre-create the next
  // node in the background while the current one is being placed, so files
  // 2..N appear instantly instead of each waiting on a fresh round-trip.
  // Mirrors handleUpload{Screenshot,Md,Html}'s createNode params; kept separate
  // so those shared handlers stay untouched. Returns null on read/validation
  // failure (toast already shown).
  // `at` (optional): { x, y, adoptedInto } — world point to center the node
  // on (OS drag-and-drop already knows where it goes; the queue path passes
  // nothing and keeps the ghost-placement flow).
  async function createQueueNode(file, at = null) {
    const k = classifyQueueFile(file);
    const placeAt = (width, height) => (at
      ? { posX: at.x - width / 2, posY: at.y - height / 2 }
      : nextNodePosition({ width, height }));
    const adoptMeta = at?.adoptedInto ? { adoptedInto: at.adoptedInto } : {};
    try {
      if (k === 'html') {
        const html = await file.text();
        if (!/^<!doctype|<html/i.test(html.trim())) {
          toast.error(`${file.name}: not a complete HTML document.`);
          return null;
        }
        const width = 1280, height = Math.round(width * 9 / 16);
        const { posX, posY } = placeAt(width, height);
        const created = await api.createNode({
          boardId: board.id, kind: 'site', posX, posY, width, height,
          meta: { name: file.name, source: 'upload', ...adoptMeta }, html,
        });
        return { ...created.node, current_html: html };
      }
      if (k === 'md') {
        const text = await file.text();
        const width = 600, height = 600;
        const { posX, posY } = placeAt(width, height);
        const created = await api.createNode({
          boardId: board.id, kind: 'designmd', posX, posY, width, height,
          meta: { name: file.name, ...adoptMeta }, designMd: text,
        });
        return { ...created.node, current_design_md: text };
      }
      if (k === 'image' || k === 'media') {
        if (file.size > MAX_ASSET_UPLOAD_BYTES) {
          toast.error(`${file.name}: media too large (max 50MB).`);
          return null;
        }
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(fr.error || new Error('read failed'));
          fr.readAsDataURL(file);
        });
        const width = 600, height = 600;
        const { posX, posY } = placeAt(width, height);
        const created = await api.createNode({
          boardId: board.id, kind: 'asset', posX, posY, width, height,
          meta: { name: file.name, dataUrl, mimeType: file.type || (k === 'media' ? 'video/*' : 'image/*'), ...adoptMeta },
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
    if (skipped) toast.error(`${skipped} unsupported file${skipped > 1 ? 's' : ''} skipped (use images, videos, .md, or .html).`);
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

  // Read the SUPPORTED payloads the async Clipboard API exposes — an image
  // and/or a URL in the clipboard text. (Arbitrary OS files like .md/.html are
  // NOT reachable here; those paste via Cmd+V only.) Used by the context-menu
  // "Paste from clipboard" item for both its enabled state and the action.
  async function readClipboardSupported() {
    const out = { image: null, url: null };
    try {
      if (!navigator.clipboard) return out;
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find((t) => t.startsWith('image/'));
          if (imgType && !out.image) {
            const blob = await item.getType(imgType);
            const ext = (imgType.split('/')[1] || 'png').replace('jpeg', 'jpg');
            out.image = new File([blob], `pasted-image.${ext}`, { type: imgType });
          }
          if (item.types.includes('text/plain') && !out.url) {
            const txt = (await (await item.getType('text/plain')).text()).trim();
            if (txt && looksLikeUrl(txt)) out.url = normalizeUrl(txt);
          }
        }
      }
      if (!out.image && !out.url && navigator.clipboard.readText) {
        const txt = (await navigator.clipboard.readText()).trim();
        if (txt && looksLikeUrl(txt)) out.url = normalizeUrl(txt);
      }
    } catch { /* permission denied / not focused → treat as empty */ }
    return out;
  }

  async function clipboardHasSupported() {
    const { image, url } = await readClipboardSupported();
    return !!(image || url);
  }

  async function pasteFromClipboard(opts = {}) {
    const { image, url } = await readClipboardSupported();
    if (image) { handleQueueFiles([image]); return; }
    if (url) { await handleAddUrl(url, opts); return; }
    toast.error('Nothing supported on the clipboard (copy an image or a URL).');
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
    // Overwrite check mirrors the incremental plan: only nodes that will
    // actually RUN count (skipped nodes keep their result untouched).
    const sigs = cleanSectionIds.has(s.id) ? null : nodeRunSigs;
    if (skip || !sectionRerunWouldOverwrite(s, nodes, edges, sigs)) { runSectionRerun(s); return; }
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
  // Zoom-threshold chrome classes. Applied together with each quantized
  // --canvas-scale write (and at gesture settle) so the class state and
  // the var are ALWAYS mutually consistent — flipping them per-tick with
  // the live scale while the var lagged produced a one-frame mismatched
  // layout right at each threshold crossing (read as a glitch/blink).
  function applyZoomThresholds(html, s) {
    // Below ~0.5 the topbar items overlap the centered grip; collapse
    // chrome so only the grip stays visible.
    html.classList.toggle('canvas-zoom-low', s < 0.5);
    // At/below 25% the topbar grip compacts from 6 to 4 dots per row.
    html.classList.toggle('canvas-zoom-mid', s < 0.25);
    // Below ~0.2 ports shrink 30% so they don't dominate tiny frames.
    html.classList.toggle('canvas-zoom-very-low', s < 0.2);
    // Beyond 30% zoom-out the node corner radius tightens 20%.
    html.classList.toggle('canvas-zoom-below-30', s < 0.30);
    // Below the 0.15 chrome floor the grip compacts to 3×2 dots.
    html.classList.toggle('canvas-zoom-min', s < 0.15);
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
      // URL placeholder: it was placed before persistence. Commit the dropped
      // position locally, then turn it into a lightweight live reference.
      const pend = node ? pendingUrlReferenceRef.current : null;
      if (node && pend && pend.id === node.id) {
        const drag = looseDragRef.current;
        const fx = drag?.lastX ?? node.pos_x;
        const fy = drag?.lastY ?? node.pos_y;
        updateNodeLocal(node.id, { pos_x: fx, pos_y: fy });
        pendingUrlReferenceRef.current = null;
        placingNodeRef.current = null;
        setPlacingNodeId(null);
        persistUrlReference(pend.id, pend.url, { posX: fx, posY: fy, width: pend.width, height: pend.height, isMain: pend.isMain }, pend.opts);
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
      if (e.target?.closest?.('.prompt-dock, .canvas-header, .canvas-sidebar, .canvas-topbar, .canvas-tools, .canvas-zoomdock, .canvas-inspector, .canvas-toolbars-left, .canvas-toolbars-right, .canvas-toolbar-left, .canvas-toolbar-right, .empty-drop-menu, .canvas-context-menu, .zoom-controls, .zoom-menu, .user-menu, .boards-sidebar, .cnode-version-ctx-menu')) return;
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

  // Remove a node from its section (menu action). IMMEDIATE — no drag-to-place
  // (that re-adopted the node the moment it dropped back inside the frame).
  // We cut its edges and drop it just BELOW the section's frame, near its
  // current x, so it lands clearly outside and can't be re-latched.
  function armNodeRemoval(node) {
    const own = sections.find((s) => s.memberIds.includes(node.id) && s.memberIds.length > 1);
    if (!own) return;
    const siblingIds = own.memberIds.filter((id) => id !== node.id);
    const sibs = nodes.filter((n) => siblingIds.includes(n.id));
    const frame = sectionCoreRect(sibs);   // padded bbox of the REMAINING members
    // Land CLEAR of the geometric-absorption zone: the sections memo
    // re-swallows any component sitting within the core + default gaps
    // (SECTION_UNIFORM_GAP) — the old 80px drop was INSIDE that zone, so
    // the removed node re-joined on the next derive ("can't remove" bug).
    const GAP = SECTION_UNIFORM_GAP + 40;
    const finalX = Math.max(frame.left, node.pos_x);
    const finalY = frame.bottom + GAP;     // clear below the (shrunken) frame
    commitNodeRemoval(node, finalX, finalY, { sectionId: own.id, rootId: own.rootId });
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
  // `handOff` (optional, 2026-07-07): the adopt-preview of ANOTHER section
  // the node was dropped over — cross-section drag. The removal from its
  // old section and the adoption into the new one commit as ONE gesture.
  async function commitNodeRemoval(node, finalX, finalY, arm, handOff = null) {
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
    // Clear adoption + persist final position. The opt-out marker keeps the
    // geometric absorption in the sections memo from re-swallowing a node
    // the user EXPLICITLY removed (dropping near the frame lands inside the
    // default-gap absorption zone). Cleared on drag re-adoption / re-wire.
    const meta = { ...(node.meta || {}) };
    delete meta.adoptedInto;
    if (arm?.rootId && !String(arm.rootId).startsWith('temp-')) meta.sectionOptOut = arm.rootId;
    if (handOff?.rootId && !String(handOff.rootId).startsWith('temp-')) meta.adoptedInto = handOff.rootId;
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
    // Hand-off: the receiving section keeps the engulf rect the preview
    // showed, so the drop lands with zero snap (same as the adopt path).
    if (handOff?.sectionId) {
      setSectionFrames((prev) => {
        const next = { ...prev, [handOff.sectionId]: handOff.rect };
        delete next[`section-${node.id}`];
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

  /**
   * Uma imagem colada por ENDEREÇO. Quem busca é o servidor: o navegador
   * esbarraria em CORS na maioria dos sites, e o que interessa é o corpo.
   *
   * Se o endereço não for imagem de verdade, volta ao comportamento antigo em
   * vez de deixar a colagem morrer em silêncio — a extensão pode mentir.
   */
  async function handleAddImageUrl(url, opts = {}) {
    const aviso = toast.info('Bringing the image in…');
    try {
      const out = await api.addAssetFromUrl(url, board.id);
      toast.dismiss?.(aviso);
      // A rota devolve a LINHA criada, com os pixels em `meta.dataUrl` — que e'
      // de onde o canvas desenha um asset. Remontar o node aqui, sem eles,
      // daria um quadrado vazio ate' a proxima recarga.
      const node = out?.node;
      if (!node?.id) { toast.error("The image couldn't be brought in."); return; }
      setNodes((prev) => (prev.some((n) => n.id === node.id) ? prev : [...prev, node]));
      pushCreateUndo(node, null);
      setSelectedNodeId(node.id);
      toast.info('Image added.');
    } catch (erro) {
      toast.dismiss?.(aviso);
      const codigo = erro?.body?.error || erro?.message || '';
      if (/not_image|415/.test(String(codigo))) {
        // não era imagem: segue o caminho de sempre
        await handleAddUrl(url, opts);
        return;
      }
      toast.error(/blocked_host/.test(String(codigo))
        ? "That address isn't public, so the image can't be fetched."
        : "The image couldn't be brought in.");
    }
  }

  async function handleAddUrl(url, opts = {}) {
    const id = `temp-${Date.now()}`;
    const embedCheck = api.checkUrlEmbed(url).catch(() => ({
      embeddable: true,
      confidence: 'unknown',
    }));
    urlEmbedChecksRef.current.set(id, embedCheck);
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
      current_html: null,
      meta: liveReferenceMeta(url),
      _loading: true,
      _loadingStage: 'checking-embed',
    };
    setNodes((prev) => [...prev, placeholderNode]);
    // A URL node is useful only when its page is visible. Make the temporary
    // reference the primary selection immediately so it receives the single
    // live-iframe lease instead of rendering an instructional placeholder.
    setSelectedNodeId(id);
    setSelectedNodeIds((current) => (current.size ? new Set() : current));
    setSelectedEdgeId(null);
    setSelectedSectionId(null);
    setPopupPos(null);

    // "+" toolbar add (no anchored position, no cord) → place the node first,
    // ghost following the cursor, exactly like blank/md/screenshot adds. The
    // capture only starts once the user drops it (see the placement drop()).
    if (opts.worldX == null && !opts.linkFromNodeId) {
      pendingUrlReferenceRef.current = { id, url, width, height, isMain, opts };
      startPlacement(placeholderNode, { allowTemp: true });
      return;
    }
    await persistUrlReference(id, url, { posX, posY, width, height, isMain }, opts);
  }

  // Persist a URL as a lightweight reference. No Playwright capture happens
  // here: the selected node leases the canvas's one live iframe, and the real
  // clone begins only when the user chooses Edit.
  async function persistUrlReference(id, url, geom, opts = {}) {
    const { posX, posY, width, height, isMain } = geom;
    try {
      const meta = liveReferenceMeta(url);
      const created = await api.createNode({
        boardId: board.id, kind: 'site', originUrl: url,
        posX, posY, width, height,
        isMain,
        meta,
      });
      const finalNode = {
        ...created.node,
        current_html: null,
        current_screenshot: null,
        current_snapshot_source: null,
        meta: { ...(created.node.meta || {}), ...meta },
        _loading: true,
        _loadingStage: 'checking-embed',
      };
      setNodes((prev) => prev.map((n) => (n.id === id ? finalNode : n)));
      // Persistence replaces temp-* with the database ID. Move the active
      // selection in the same render so the iframe never falls back to the
      // "Select to browse" state. If the user selected something else while
      // the request was in flight, preserve that newer choice.
      setSelectedNodeId((currentId) => (
        remapLiveReferenceSelection(currentId, id, created.node.id)
      ));
      let linkEdge = null;
      if (opts.linkFromNodeId) linkEdge = await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
      // Undo entry only after the real persisted node exists.
      pushCreateUndo(created.node, linkEdge);
      // Frame the new node at 100% so it's the immediate focus.
      setTimeout(() => zoomToNode(finalNode, 350, 1), 80);

      const policyPromise = urlEmbedChecksRef.current.get(id) || api.checkUrlEmbed(url);
      const policy = await policyPromise.catch(() => ({ embeddable: true, confidence: 'unknown' }));
      urlEmbedChecksRef.current.delete(id);

      if (policy.embeddable !== false) {
        updateNodeLocal(created.node.id, {
          _loading: false,
          _loadingStage: undefined,
        });
        return;
      }

      await captureBlockedReference({ node: finalNode, url });
    } catch (e) {
      urlEmbedChecksRef.current.delete(id);
      console.warn('[url-reference] failed:', e?.message || e);
      setNodes((prev) => prev.filter((n) => n.id !== id));
      setSelectedNodeId((currentId) => (currentId === id ? null : currentId));
      toast.error(e.message || 'Could not add this URL.');
    }
  }

  async function captureBlockedReference({ node, url }) {
    const nodeId = node.id;
    const originalMeta = node.meta || {};
    const fallbackMeta = {
      ...originalMeta,
      referenceMode: 'captured-auto',
      embedFallbackReason: 'iframe-blocked',
    };
    updateNodeLocal(nodeId, {
      _loading: true,
      _loadingStage: 'iframe-blocked-shy',
      meta: fallbackMeta,
    });

    // Let the user actually read the reason before fast progress events move
    // to the next line. Capture starts immediately; only the copy transition
    // is held briefly, so this adds no latency to the work itself.
    let latestStage = 'launching';
    let shyReleased = false;
    let releaseShy = null;

    try {
      await api.updateNode(nodeId, { meta: fallbackMeta });
      releaseShy = setTimeout(() => {
        shyReleased = true;
        updateNodeLocal(nodeId, { _loadingStage: latestStage });
      }, 1800);
      const cap = await api.captureUrlStream(url, nodeId, (step) => {
        latestStage = step || latestStage;
        if (shyReleased) updateNodeLocal(nodeId, { _loadingStage: latestStage });
      });
      const nextMeta = {
        ...fallbackMeta,
        ...(cap.animatedDetected ? { animatedDetected: true } : {}),
      };
      await api.updateNode(nodeId, { meta: nextMeta });
      setNodes((prev) => prev.map((candidate) => candidate.id === nodeId ? {
        ...candidate,
        current_html: cap.html,
        current_screenshot: cap.screenshotDataUrl,
        current_snapshot_id: cap.snapshotId,
        current_snapshot_source: 'capture',
        meta: nextMeta,
        _loading: false,
        _loadingStage: undefined,
        _loadingError: false,
      } : candidate));
    } catch (e) {
      if (e?.challenge) {
        updateNodeLocal(nodeId, {
          _loading: true,
          _loadingStage: undefined,
          _loadingLabel: 'This website needs a quick word with you.',
          _challenge: true,
          _handoffPending: true,
        });
        startHandoffPolling(nodeId);
        setChallenge({ ...e.challenge, placeholderId: nodeId });
        return;
      }
      updateNodeLocal(nodeId, {
        _loading: false,
        _loadingStage: undefined,
        _loadingError: true,
        meta: originalMeta,
      });
      api.updateNode(nodeId, { meta: originalMeta }).catch(() => {});
      toast.error('This website slipped away before the curtain call.');
    } finally {
      if (releaseShy) clearTimeout(releaseShy);
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
      imageSrc = t === 'video'
        ? (asset.blob_url || asset.source_url || asset.thumb_url)
        : (asset.thumb_url || asset.blob_url || asset.source_url);
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
      const meta = {
        name: asset.name || 'asset',
        dataUrl: imageSrc,
        mimeType: t === 'video' ? (asset.meta?.mimeType || 'video/*') : 'image/*',
      };
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

  // OS file drop (drag from Finder/Explorer). Reuses the queue's
  // classify/create logic but places each node AT the drop point — the drop
  // gesture already said where it goes, so no ghost placement. Multiple files
  // fan out with a small progressive offset (same idea as paste). A drop
  // point inside a section frame adopts the node into that section, matching
  // the library-asset drop. Unsupported formats collect into an error modal
  // that names each rejected file and the accepted formats.
  async function handleOsFilesDrop(e) {
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    e.preventDefault();
    const w = clientToWorld(transformRef, e.clientX, e.clientY);
    const hit = sections.find((s) =>
      w.x >= s.x && w.x <= s.x + s.width && w.y >= s.y && w.y <= s.y + s.height);
    const adoptedInto = hit && !String(hit.rootId || '').startsWith('temp-') ? hit.rootId : null;
    const rejects = [];
    const jobs = [];
    const KIND = { image: 'asset', media: 'asset', md: 'designmd', html: 'site' };
    for (const f of files) {
      const k = classifyQueueFile(f);
      if (!k) { rejects.push(f.name || 'untitled'); continue; }
      const i = jobs.length;
      const width = k === 'html' ? 1280 : 600;
      const height = k === 'html' ? Math.round(width * 9 / 16) : 600;
      const at = { x: w.x + i * 32, y: w.y + i * 32, adoptedInto };
      const tempId = `temp-drop-${Date.now()}-${i}`;
      jobs.push({
        file: f, at, tempId,
        // Instant placeholder so the drop point reacts immediately — the
        // FileReader + createNode round-trip takes a beat and the canvas
        // shouldn't sit inert meanwhile. `_loading` drives the node
        // progress ring; meta.status keeps the asset body in its
        // generating state instead of the empty-upload prompt.
        ph: {
          id: tempId, kind: KIND[k],
          pos_x: at.x - width / 2, pos_y: at.y - height / 2, width, height,
          current_html: null, _loading: true,
          meta: { name: f.name, status: 'generating' },
        },
      });
    }
    if (jobs.length) {
      setNodes((prev) => [...prev, ...jobs.map((j) => j.ph)]);
      await Promise.all(jobs.map(async (j) => {
        const node = await createQueueNode(j.file, j.at);
        // Swap placeholder → real node. Dedup guard: a board refetch could
        // have pulled the created node into state already — then just drop
        // the placeholder instead of mounting a duplicate key.
        setNodes((prev) => {
          if (!node) return prev.filter((n) => n.id !== j.tempId);
          const exists = prev.some((n) => n.id === node.id);
          return prev
            .map((n) => (n.id === j.tempId ? (exists ? null : { ...node }) : n))
            .filter(Boolean);
        });
        if (node) pushCreateUndo(node, null);
      }));
    }
    if (rejects.length) setDropRejects(rejects);
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
    asset: 'image/*,video/*',
  };
  const MAX_ASSET_UPLOAD_BYTES = 50 * 1024 * 1024;

  function validFileForKind(kind, file) {
    const name = (file?.name || '').toLowerCase();
    if (kind === 'site') return /\.html?$/.test(name) || file?.type === 'text/html';
    if (kind === 'designmd') return /\.(md|markdown)$/.test(name);
    if (kind === 'asset') return /^(image|video)\//.test(file?.type || '');
    return false;
  }

  // Record a creation on the undo stack so Cmd+Z removes the node again
  // (plus its auto-link edge when the creation came from a connector).
  function pushCreateUndo(node, edge) {
    if (!node) return;
    pushUndoEntry({ type: 'createNodes', nodes: [node], edges: edge ? [edge] : [] });
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
    // MUST use the `temp-` prefix (not `tmp-`): every server-persist guard in
    // this file checks `startsWith('temp-')`, so a `tmp-extract-` id slipped
    // through and got PATCHed to the DB → 500 (invalid uuid) in a loop.
    const tmpId = `temp-extract-${sourceNodeId}-${to}`;
    const tmpEdgeId = `temp-extract-edge-${sourceNodeId}-${to}`;
    // The placeholder's KIND must match the FINAL node kind so it never appears
    // to "morph" (a .md that becomes .html) when the real node arrives — and so
    // its category colour-coding (border/ring/cord) reads correctly while it
    // loads. `to` maps: prompt → prompt, screenshot → asset, html/clone → site
    // (a clone produces a full site node), the rest (.md flavours:
    // designmd/content/style/tokens/styleclone) → designmd. (lib/extract.js.)
    const kind =
      to === 'prompt' ? 'prompt' :
      to === 'screenshot' ? 'asset' :
      to === 'html' || to === 'clone' ? 'site' :
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
      // extractTo lets nodeOrigin colour the placeholder like its FINAL node
      // (e.g. a clone reads blue, not the orange .html fallback) — no flash.
      meta: { name: `Extracting ${to}…`, extractTo: to }, current_html: null, _loading: true,
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
      if (handleBillingError(e)) {
        setNodes((prev) => prev.filter((n) => n.id !== tmpId));
        setEdges((prev) => prev.filter((e) => e.id !== tmpEdgeId));
        return;
      }
      // ⚠️ MEDIDO 2026-08-14 no log do servidor: um clone a partir de screenshot
      // estourou o prazo da rota (148,5s) e voltou 502 — com estorno e sem node
      // criado, que e' o desenho certo. Mas o placeholder era REMOVIDO e a
      // unica noticia era um aviso passageiro, depois de dois minutos e meio de
      // espera: da' exatamente a sensacao de "sumiu e nao disse nada".
      // O placeholder FICA, dizendo o que houve, ate' o usuario apaga-lo — mesmo
      // padrao ja usado quando a verificacao do site expira.
      // Duas coisas diferentes, e confundi-las mente para o usuario:
      //  - o SERVIDOR estourou o prazo -> ele aborta dentro do runBilledOperation,
      //    devolve o hold e nao cria node. Ai' da' para afirmar que nao cobrou.
      //  - o NAVEGADOR desistiu de esperar (AbortError) -> a rota pode estar
      //    viva ainda, podendo persistir e cobrar. Prometer estorno seria chute.
      // So o SERVIDOR sabe se cancelou antes de cobrar, e ele diz isso tipado
      // (`extract_timeout` + `refunded`). Ler a mensagem para adivinhar
      // classificava uma desistencia do navegador como cancelamento do servidor
      // e prometia estorno sem base (achado da auditoria).
      const cancelouLa = e?.code === 'extract_timeout' && e?.refunded === true;
      const desistiuAqui = e?.name === 'AbortError' || /aborted|network|failed to fetch/i.test(String(e?.message || ''));
      const rotulo = cancelouLa
        ? 'Took too long — cancelled, and you were not charged.'
        : desistiuAqui
          ? "The wait ended here — it may still be finishing. Reload before trying again."
          : `It did not work: ${String(e?.message || 'unknown').slice(0, 90)}`;
      // `_failed` (nao `_loading` sozinho) e' o que o node le para PARAR: sem
      // isso ele seguia com anel de progresso e mensagem animada por cima do
      // rotulo, ou seja, dizendo que ainda estava gerando (achado da auditoria).
      setNodes((prev) => prev.map((n) => (n.id === tmpId ? {
        ...n, _failed: true, _failedLabel: rotulo,
      } : n)));
      toast.error(rotulo);
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
      const expected = kind === 'asset' ? 'an image or video file'
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
          toast.error('Media too large (max 50MB).');
          return;
        }
        const dataUrl = await blobToDataUrl(file);
        const meta = { ...(node.meta || {}), name: file.name, dataUrl, mimeType: file.type || 'application/octet-stream' };
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
    pushUndoEntry(entry);
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
    pushUndoEntry(entry);
    setNodes((prev) => prev.filter((n) => !idSet.has(n.id)));
    setEdges((prev) => prev.filter((e) => !idSet.has(e.source_node_id) && !idSet.has(e.target_node_id)));
    await Promise.all(
      ids
        .filter((id) => !String(id).startsWith('temp-'))
        .map((id) => api.deleteNode(id).catch(console.warn))
    );
  }

  // Pop the latest undo entry and reverse it. Structural restores use the
  // /api/nodes/restore endpoint (ON CONFLICT DO NOTHING, safe under retries).
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

    if (entry.type === 'moveNodes') {
      // Stop queued drag PATCHes first; otherwise a trailing 250ms position
      // write can land after the undo and move the node forward again.
      for (const saved of entry.nodes) {
        clearTimeout(dragNodeServer.current.get(saved.id));
        dragNodeServer.current.delete(saved.id);
      }

      setNodes((prev) => restoreMovedNodes(prev, entry));
      setEdges((prev) => restoreMissingEdges(prev, entry.edges));
      const restoredFrames = entry.sectionFrames || {};
      setSectionFrames(restoredFrames);
      try { localStorage.setItem(SECTION_FRAMES_KEY, JSON.stringify(restoredFrames)); } catch {}

      // Positions and membership metadata live on the node row. Missing
      // incident cords (e.g. after tearing out of a section) are restored by
      // the same idempotent endpoint used by delete undo.
      await Promise.all(entry.nodes.map((saved) => (
        api.updateNode(saved.id, { posX: saved.pos_x, posY: saved.pos_y, meta: saved.meta }).catch((error) => {
          console.warn('[undo] move restore failed', saved.id, error);
        })
      )));
      const persistedEdges = (entry.edges || []).filter((edge) => !String(edge.id || '').startsWith('temp-'));
      if (persistedEdges.length) {
        try {
          await fetch('/api/nodes/restore', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ boardId: board.id, nodes: [], edges: persistedEdges }),
          });
        } catch (error) {
          console.warn('[undo] cord restore failed', error);
        }
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
    if (spaceDown) return; // temporary pan mode owns the gesture
    if (editingNodeId) return;
    if (challenge) return;
    if (emptyDropMenu || contextMenu) return;
    if (draftEdge) return;
    const t = ev.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('.cnode, .edge-line, .edge-popup, .canvas-sidebar, .canvas-topbar, .canvas-tools, .canvas-zoomdock, .canvas-inspector, .canvas-toolbar-left, .canvas-toolbar-right, .canvas-toolbars-left, .canvas-toolbars-right, .canvas-theme-floater, .prompt-dock, .empty-drop-menu, .canvas-context-menu, .canvas-header, .zoom-controls, .zoom-menu, .user-menu, .reset-confirm-card, .reset-confirm-overlay, .superwidget')) return;
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
      const restored = await api.restoreVersion(id, snapshotId);
      setNodes((prev) => prev.map((n) =>
        n.id === id
          ? {
            ...n,
            current_html: restored.html,
            current_snapshot_id: restored.snapshot_id,
            current_snapshot_source: restored.source || n.current_snapshot_source,
            current_native_bundle_id: restored.native_bundle_id || null,
            current_motion_manifest_version: restored.motion_manifest_version == null
              ? null
              : Number(restored.motion_manifest_version),
            _resetTick: (n._resetTick || 0) + 1,
          }
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
  // In-flight run AbortControllers, keyed by target node id. The Stop button
  // (section pill / floating / chat arrow) aborts these so the run halts and
  // the node keeps its pre-run state — runOneTarget only applies a result
  // AFTER the await resolves, so an aborted run never mutates the node.
  const runAbortRef = useRef(new Map());

  // The dock's model picker persists in localStorage (PromptDock owns the
  // state; MODEL_STORAGE_KEY there). Read it here so button-triggered runs
  // (section ▶ / Run from here) compose with the SAME model the user picked.
  function currentPickerModelId() {
    try { return localStorage.getItem('uncraft-model') || null; } catch { return null; }
  }

  async function runOneTarget(id, opts = {}) {
    const request = requestTextForTarget(id);
    setNodeRunStatus(id, { step: 1, label: 'Reading inputs…', request });
    const controller = new AbortController();
    runAbortRef.current.set(id, controller);
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
      const result = await api.runNode(id, opts, controller.signal);
      clearTimeout(advanceToStep2);
      const reconstructionCredits = (result?.reconstructions || []).reduce(
        (sum, item) => sum + Number(item.credits || 0),
        0,
      );
      for (const reconstructed of (result?.reconstructions || [])) {
        flashNodeDebit(reconstructed.nodeId, reconstructed.credits);
      }
      flashNodeDebit(id, Math.max(0, Number(result?.credits || 0) - reconstructionCredits));
      if (result?.reconstructions?.length) {
        const byId = new Map(result.reconstructions.map((item) => [item.nodeId, item]));
        setNodes((prev) => prev.map((node) => {
          const reconstructed = byId.get(node.id);
          if (!reconstructed) return node;
          return applyReconstructionResultToNode(node, reconstructed);
        }));
      }
      setNodeRunStatus(id, { step: 3, label: 'Saving…', request });
      // Hold the saving label briefly so the transition reads as a
      // resolved step rather than a flash.
      await new Promise((r) => setTimeout(r, 700));
      setNodeRunStatus(id, null);
      return result;
    } catch (e) {
      clearTimeout(advanceToStep2);
      setNodeRunStatus(id, null);
      // User pressed Stop → swallow so no error toast fires; the node was
      // never mutated (result not applied), so it shows its original state.
      if (e?.name === 'AbortError') return null;
      // Billing block → modal instead of an error toast; nothing ran.
      if (handleBillingError(e)) return null;
      throw e;
    } finally {
      runAbortRef.current.delete(id);
    }
  }

  // Abort a single target's in-flight run and clear its status chip. The node
  // reverts to its pre-run state because runOneTarget never applied a result.
  function stopTarget(id) {
    const c = runAbortRef.current.get(id);
    if (c) { try { c.abort(); } catch {} }
    setNodeRunStatus(id, null);
  }

  // Stop a section's run: abort whichever member is the active terminal.
  function stopSection(s) {
    if (!s) return;
    for (const mid of (s.memberIds || [])) {
      if (runAbortRef.current.has(mid)) stopTarget(mid);
    }
  }

  // Stop ALL in-flight flow runs (the chat arrow's bare run-flow Stop). Aborts
  // every controller and drops the busy state so the arrow returns to idle.
  function stopFlowRun() {
    for (const id of [...runAbortRef.current.keys()]) stopTarget(id);
    setRunFlowBusy(false);
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
          updates.set(id, { html: r.value.html, snapshotId: r.value.snapshotId, transplant: r.value.transplant });
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
            current_snapshot_source: 'demarcelizer-4',
            meta: {
              ...(n.meta || {}),
              ...(u.transplant ? { lastTransplant: u.transplant } : {}),
              ...(u.transplant?.motionPreserved ? { animatedRuntime: true } : {}),
            },
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

  // Materialize copies of a group of node-like objects on the board:
  // creates every node server-side at its given position, then re-creates
  // the cords BETWEEN copies (links reference item indexes — edges to nodes
  // outside the group are deliberately not copied). Selects the copies so
  // the user can immediately drag them as a unit. Shared by group duplicate
  // (right-click / Alt+drag on a multi-selection) and Cmd+V paste.
  async function materializeCopies(items, links) {
    const createdNodes = [];
    for (const { data, x, y } of items) {
      const created = await api.createNode({
        boardId: board.id,
        kind: data.kind,
        originUrl: data.origin_url || null,
        templateSlug: data.template_slug || null,
        posX: x, posY: y,
        width: data.width || 1280,
        height: data.height || 800,
        meta: data.meta || {},
        html: data.current_html || null,
        designMd: data.current_design_md || null,
      });
      createdNodes.push({
        ...created.node,
        current_html: data.current_html || null,
        current_design_md: data.current_design_md || null,
      });
    }
    const createdEdges = [];
    for (const l of links || []) {
      const s = createdNodes[l.from];
      const t = createdNodes[l.to];
      if (!s || !t) continue;
      try {
        const { edge } = await api.createEdge({
          boardId: board.id, sourceNodeId: s.id, targetNodeId: t.id, kind: l.kind || 'generic',
        });
        if (edge) createdEdges.push(edge);
      } catch { /* one failed cord must not sink the whole copy */ }
    }
    setNodes((prev) => [...prev, ...createdNodes]);
    if (createdEdges.length) setEdges((prev) => [...prev, ...createdEdges]);
    for (const n of createdNodes) pushCreateUndo(n, null);
    setSelectedNodeId(null);
    setSelectedNodeIds(new Set(createdNodes.map((n) => n.id)));
    return createdNodes;
  }

  // Group form of duplicate: the full node list + the cords among them,
  // offset so the copy lands beside the original (design-tool convention).
  async function duplicateGroup(groupNodes, { dx = 60, dy = 60 } = {}) {
    const group = groupNodes.filter((n) => !String(n.id).startsWith('temp-'));
    if (!group.length) return;
    const idx = new Map(group.map((n, i) => [n.id, i]));
    const links = edges
      .filter((e) => idx.has(e.source_node_id) && idx.has(e.target_node_id))
      .map((e) => ({ from: idx.get(e.source_node_id), to: idx.get(e.target_node_id), kind: e.kind || 'generic' }));
    try {
      await materializeCopies(group.map((n) => ({ data: n, x: n.pos_x + dx, y: n.pos_y + dy })), links);
    } catch (err) {
      toast.error(`Duplicate failed: ${err.message}`);
    }
  }

  // Cmd+V of an internal payload: re-create the copied nodes + cords. Each
  // consecutive paste of the same copy steps a bit further out.
  async function handlePasteNodes(payload) {
    const { items, links } = payloadToPasteItems(payload, ++pasteSeqRef.current);
    try {
      await materializeCopies(items, links);
    } catch (err) {
      toast.error(`Paste failed: ${err.message}`);
    }
  }

  /**
   * O iter9 pedido POR NOME (doutrina 2026-08-15: "clone" e' o animado; o
   * iter9 — clonador estatico historico — fica a disposicao nominalmente).
   * Converte ESTE node no clone iter9 — mesma semantica do Edit: o snapshot
   * novo entra na frente e o estado anterior fica no historico de versoes
   * (Saved versions), de onde se restaura.
   */
  async function handleCloneIter9(id) {
    const node = nodes.find((n) => n.id === id);
    if (!node?.origin_url) { toast.error('This node has no origin URL to clone.'); return; }
    setNodeRunStatus(id, { step: 1, label: 'Cloning with iter9 (static)…', request: '' });
    try {
      const result = await api.reconstructNode(id, { engine: 'iter9' });
      flashNodeDebit(id, result?.credits);
      const preparedNode = applyReconstructionResultToNode(node, result);
      setNodes((prev) => prev.map((candidate) => (candidate.id === id ? preparedNode : candidate)));
      toast.info('iter9 clone ready.');
    } catch (e) {
      if (!handleBillingError(e)) toast.error(`iter9 clone failed: ${e.message}`);
    } finally {
      setNodeRunStatus(id, null);
    }
  }

  async function handleDuplicateNode(id) {
    // Node inside a multi-selection → duplicate the WHOLE selection (nodes +
    // internal cords) as a unit; the copies land offset beside the originals.
    if (selectedNodeIds.size > 1 && selectedNodeIds.has(id)) {
      await duplicateGroup(nodes.filter((n) => selectedNodeIds.has(n.id)));
      return;
    }
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    try {
      // Create the copy server-side at the original's spot, then hand it to
      // mountAndPlace — the duplicate becomes a ghost the user drops where
      // they want (same as an upload/paste), instead of auto-landing at an
      // offset. mountAndPlace also registers the create on the undo stack.
      const created = await api.createNode({
        boardId: board.id,
        kind: n.kind,
        originUrl: n.origin_url,
        templateSlug: n.template_slug,
        posX: n.pos_x, posY: n.pos_y,
        width: n.width,
        height: n.height || 800,
        meta: n.meta || {},
        html: n.current_html,
        designMd: n.current_design_md
      });
      mountAndPlace({
        ...created.node,
        current_html: n.current_html,
        current_design_md: n.current_design_md
      });
    } catch (err) {
      toast.error(`Duplicate failed: ${err.message}`);
    }
  }

  // Alt + drag on a node → duplicate it. An optimistic local ghost copy follows
  // the cursor (translucent) from the first real drag movement until the mouse
  // is released, where it's persisted at the drop spot. Escape cancels. The
  // ghost is local-only during the gesture (no server round-trip → no lag); the
  // duplicate is created on release. Never duplicates on a bare alt-click (the
  // ghost only spawns once the drag passes the threshold).
  //
  // Alt+drag on a node that's part of a MULTI-SELECTION duplicates the whole
  // selection as a unit: every selected node ghosts along with the cursor,
  // and on release the copies are persisted WITH the cords between them.
  function startAltDuplicateDrag(srcNode, e) {
    if (!srcNode) return;
    const group = (selectedNodeIds.size > 1 && selectedNodeIds.has(srcNode.id))
      ? nodes.filter((n) => selectedNodeIds.has(n.id) && !String(n.id).startsWith('temp-'))
      : [srcNode];
    if (!group.length) return;
    const readScale = readCanvasScale;
    const start = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    let tempIds = null; // array parallel to `group`, set once the drag is real
    document.body.classList.add('alt-dup-dragging');
    const cleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('alt-dup-dragging');
    };
    const move = (ev) => {
      const scale = readScale();
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      if (!tempIds) {
        if (Math.hypot(dx, dy) * scale < 4) return;   // wait for a real drag
        tempIds = group.map((n, i) => `temp-altdup-${Date.now()}-${i}`);
        setNodes((prev) => [
          ...prev,
          ...group.map((n, i) => ({ ...n, id: tempIds[i], is_main: false })),
        ]);
        setAltDupGhostIds(new Set(tempIds));
      }
      start.dx = dx; start.dy = dy;
      setNodes((prev) => prev.map((n) => {
        const i = tempIds.indexOf(n.id);
        if (i === -1) return n;
        return { ...n, pos_x: group[i].pos_x + dx, pos_y: group[i].pos_y + dy };
      }));
    };
    const finalize = async (commit) => {
      cleanup();
      setAltDupGhostIds(null);
      const ids = tempIds;
      if (!ids) return;                      // never dragged → no duplicate
      setNodes((prev) => prev.filter((n) => !ids.includes(n.id)));
      if (!commit) return;
      const idx = new Map(group.map((n, i) => [n.id, i]));
      const links = edges
        .filter((ed) => idx.has(ed.source_node_id) && idx.has(ed.target_node_id))
        .map((ed) => ({ from: idx.get(ed.source_node_id), to: idx.get(ed.target_node_id), kind: ed.kind || 'generic' }));
      try {
        await materializeCopies(
          group.map((n) => ({ data: n, x: n.pos_x + start.dx, y: n.pos_y + start.dy })),
          links,
        );
      } catch (err) {
        toast.error(`Duplicate failed: ${err.message}`);
      }
    };
    const up = () => finalize(true);
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); finalize(false); } };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('keydown', onKey, true);
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
      if (!m) { toast.error('Could not read this media file.'); return; }
      const mime = m[1] || 'image/png';
      const base64 = m[2];
      // Map mime → file extension. Default to .png for unknowns.
      const ext = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg'
                : mime === 'image/webp' ? 'webp'
                : mime === 'image/gif'  ? 'gif'
                : mime === 'video/mp4' ? 'mp4'
                : mime === 'video/webm' ? 'webm'
                : mime === 'video/quicktime' ? 'mov'
                : 'png';
      const byteString = atob(base64);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      const baseName = (n.meta?.name || 'uncraft-media').toString().replace(/[^a-zA-Z0-9._-]+/g, '_');
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

    // Incremental by default: nodes whose inputs haven't changed since
    // their last run are SKIPPED (their current result is reused — no
    // credits burnt). A clean section's button reads "Reroll" and means
    // force: the whole cascade regenerates fresh.
    const force = cleanSectionIds.has(s.id);
    const { stages, skipped, unsupportedKind } = planIncrementalRun(
      s, nodes, edges, force ? null : nodeRunSigs
    );
    if (!stages.length) {
      if (unsupportedKind) {
        toast.info(`This workflow ends in a ${unsupportedKind === 'designmd' ? '.md' : unsupportedKind} node — re-running it isn't supported yet.`);
      } else if (skipped.length) {
        // All nodes reused → the section IS clean; flip the pill to Reroll
        // so the user's next click means "force a fresh generation".
        toast.info('Everything is up to date — nothing to run.');
        markSectionPendingClean(s.id);
      } else {
        toast.error('Could not find a result node to run in this workflow.');
      }
      return;
    }

    const allOk = await cascadeStages(stages);
    if (allOk) markSectionPendingClean(s.id);
  }

  // Cascade executor: dependency-ordered stages run in sequence, nodes
  // within a stage in parallel (each with its own progress affordance). A
  // failed stage ABORTS the cascade — downstream nodes would compose from
  // stale/failed inputs. Returns true when every node succeeded.
  //
  // `overlay` carries the content produced DURING this cascade (React
  // state commits async, so the `nodes` binding is stale mid-loop): each
  // node's input signature is captured against its sources' FRESH
  // content, so the next incremental run skips correctly. Signatures of
  // what DID run persist even on abort — a retry skips those stages.
  async function cascadeStages(stages) {
    const overlay = new Map();
    const newSigs = {};
    try {
      for (const stage of stages) {
        const outcomes = await Promise.all(stage.map(async (n) => {
          const effNodes = nodes.map((x) => overlay.get(x.id) || x);
          const sig = nodeInputSignature(n.id, effNodes, edges);
          const r = await runSectionNode(overlay.get(n.id) || n);
          if (r.ok) {
            newSigs[n.id] = sig;
            if (r.patch) overlay.set(n.id, { ...(overlay.get(n.id) || n), ...r.patch });
          }
          return r.ok;
        }));
        if (!outcomes.every(Boolean)) return false;
      }
      return true;
    } finally {
      if (Object.keys(newSigs).length) setNodeRunSigs((prev) => ({ ...prev, ...newSigs }));
    }
  }

  // "Run from here": force-run the pointed node and cascade ONLY through
  // its descendants — upstream and sibling branches untouched (and never
  // charged). Triggered by the hover pill above the node's right corner.
  async function runFromNode(nodeId) {
    const s = sections.find((x) => x.memberIds.includes(nodeId));
    if (!s) return;
    if ((s.memberIds || []).some((mid) => runStatus.has(mid))) return;
    const { stages } = planRunFromNode(nodeId, s, nodes, edges);
    if (!stages.length) { toast.info('Nothing runnable from this node.'); return; }
    await cascadeStages(stages);
  }

  // Stop control for the "Run from here" button while its cascade runs —
  // same semantics as the section pill's stop (aborts every member's run;
  // only one run at a time per section, so section-wide stop is exact).
  function stopFlowForNode(nodeId) {
    const s = sections.find((x) => x.memberIds.includes(nodeId));
    if (s) stopSection(s);
    else stopTarget(nodeId);
  }

  // Pre-flight estimate for the "Run from here" pill (computed on hover).
  function getRunFromHereEst(nodeId) {
    const s = sections.find((x) => x.memberIds.includes(nodeId));
    if (!s) return 0;
    const { runnable } = planRunFromNode(nodeId, s, nodes, edges);
    return estimateChain(runnable.map((t) => (t.kind === 'asset' ? 'image.generate' : 'compose')));
  }

  // ── Section layout actions (2026-07-06) ─────────────────────────────────
  // Fit to content: nothing moves — only the FRAME forgets its manually
  // stretched size and re-hugs the members (the stored frame is the
  // grow-only wall memory from resize gestures).
  function fitSectionToContent(s) {
    setSectionFrames((prev) => {
      if (!(s.id in prev)) return prev;
      const next = { ...prev };
      delete next[s.id];
      try { localStorage.setItem(SECTION_FRAMES_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // Auto-layout: re-arrange the members with the same dependency algorithm
  // that lays out agent-built chains (columns advance rightward, variants
  // stack), anchored at the group's current top-left corner. Best-effort
  // de-overlap shoves the re-shaped section down if it would now touch a
  // neighbour. The frame re-fits (stored stretch would lie about the new
  // shape).
  function autoLayoutSection(s) {
    const members = nodes.filter((n) => s.memberIds.includes(n.id) && !String(n.id).startsWith('temp-'));
    if (members.length < 2) return;
    const memberSet = new Set(members.map((n) => n.id));
    const specs = members.map((n) => ({ key: n.id, width: n.width || 1280, height: n.height || 800 }));
    const links = edges
      .filter((e) => memberSet.has(e.source_node_id) && memberSet.has(e.target_node_id))
      .map((e) => ({ from: e.source_node_id, to: e.target_node_id }));
    const plan = planChainLayout(specs, links);
    let minX = Infinity, minY = Infinity;
    for (const n of members) { minX = Math.min(minX, n.pos_x); minY = Math.min(minY, n.pos_y); }
    const pos = new Map(members.map((n) => {
      const p = plan.positions[n.id] || { x: n.pos_x - minX, y: n.pos_y - minY };
      return [n.id, { x: minX + p.x, y: minY + p.y }];
    }));
    // Sections never overlap: check the re-shaped section against the rest
    // of the board and push it down as a unit if it now intrudes.
    const rows = nodes.map((n) => {
      const p = pos.get(n.id);
      return { id: n.id, pos_x: p ? p.x : n.pos_x, pos_y: p ? p.y : n.pos_y, width: n.width, height: n.height };
    });
    const edgeRows = edges.map((e) => ({ source_node_id: e.source_node_id, target_node_id: e.target_node_id }));
    const shift = planSectionDeoverlap(rows, edgeRows, members[0].id);
    if (shift) {
      for (const id of shift.ids) {
        const p = pos.get(id);
        if (p) p.y += shift.delta;
      }
    }
    for (const [id, p] of pos) {
      updateNodeLocal(id, { pos_x: p.x, pos_y: p.y });
      persistNodePosition(id, p.x, p.y);
    }
    fitSectionToContent(s);
  }

  // Execute ONE node of a section run. Returns { ok, patch } — patch is the
  // freshly produced content (the cascade needs it to fingerprint downstream
  // inputs before React commits). Failures toast individually and return
  // { ok: false } (the section stays dirty).
  async function runSectionNode(terminal) {
    const terminalId = terminal.id;

    // Site terminal → compose engine. runOneTarget drives the 3-step
    // status chip below the node, exactly like the PromptDock arrow.
    // The user's dock picker rides along (same rule as the agent's
    // runFlow/editSite tools) — without it the server fell back to its
    // Claude default and billed the unfunded Anthropic account.
    if (terminal.kind === 'site') {
      try {
        const result = await runOneTarget(terminalId, { modelId: currentPickerModelId() || undefined });
        if (!result?.snapshotId) return { ok: false };
        setNodes((prev) => prev.map((n) => (
          n.id === terminalId
            ? {
                ...n,
                current_html: result.html,
                current_snapshot_id: result.snapshotId,
                current_snapshot_source: 'demarcelizer-4',
                meta: {
                  ...(n.meta || {}),
                  ...(result.transplant ? { lastTransplant: result.transplant } : {}),
                  ...(result.transplant?.motionPreserved ? { animatedRuntime: true } : {}),
                },
                _resetTick: (n._resetTick || 0) + 1,
              }
            : n
        )));
        return {
          ok: true,
          patch: {
            current_html: result.html,
            current_snapshot_id: result.snapshotId,
            current_snapshot_source: 'demarcelizer-4',
            meta: {
              ...(terminal.meta || {}),
              ...(result.transplant ? { lastTransplant: result.transplant } : {}),
              ...(result.transplant?.motionPreserved ? { animatedRuntime: true } : {}),
            },
          },
        };
      } catch (e) {
        console.warn('[section-rerun] site compose failed:', e?.message || e);
        toast.error(e?.message || 'Re-run failed.');
        return { ok: false };
      }
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
      return { ok: true, patch: { meta: { ...(terminal.meta || {}), dataUrl: body.dataUrl, mimeType: body.mimeType, status: 'done' } } };
    } catch (e) {
      console.warn('[section-rerun] failed:', e?.message || e);
      toast.error(e?.message || 'Re-run failed.');
      // Revert the optimistic generating flag so the existing image keeps showing.
      setNodes((prev) => prev.map((n) => (
        n.id === terminalId
          ? { ...n, meta: { ...(n.meta || {}), status: 'done' } }
          : n
      )));
      return { ok: false };
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

  // Replace node content with a freshly uploaded file. Accept media/html/md;
  // the endpoint figures out the new kind from the explicit `kind` we send
  // (derived from the file's mime + extension here) and patches the node row
  // accordingly. Border colour, body renderer, and tools all shift to match
  // the new media after refetch.
  async function handleReplaceContent(nodeId) {
    const file = await pickFile('image/*,video/*,.html,.htm,text/html,.md,.markdown,text/markdown,text/plain');
    if (!file) return;
    const name = file.name || 'replacement';
    const lowerName = name.toLowerCase();
    const mime = file.type || '';
    let payload = null;
    if (/^(image|video)\//.test(mime) || /\.(png|jpe?g|webp|gif|svg|mp4|webm|mov|m4v)$/i.test(lowerName)) {
      if (file.size > MAX_ASSET_UPLOAD_BYTES) {
        toast.error('Media too large (max 50MB).');
        return;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('Could not read media file'));
        fr.readAsDataURL(file);
      });
      const fallbackMime = /\.(mp4|m4v)$/i.test(lowerName) ? 'video/mp4'
        : /\.webm$/i.test(lowerName) ? 'video/webm'
        : /\.mov$/i.test(lowerName) ? 'video/quicktime'
        : 'image/png';
      payload = { kind: 'asset', dataUrl, mimeType: mime || fallbackMime, name };
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
      toast.error('Unsupported file type. Use image, video, .html, or .md.');
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
    // Snapshot node→section membership BEFORE the edge is removed — deleting
    // it can split one section into two, and the merge-confirm gate on drop
    // must judge against the PRE-gesture layout (re-attaching within what was
    // one section is a restore, not a merge).
    const sectionAtStart = new Map();
    for (const s of sections) for (const id of s.memberIds) sectionAtStart.set(id, s.id);
    // Locally remove the edge so the re-routing draft cord is the only
    // thing visible. Server delete fires async — if the user drops on a
    // new target, we'll create a fresh edge for that pair.
    setEdges((prev) => prev.filter((x) => x.id !== edge.id));
    api.deleteEdge(edge.id).catch(console.warn);
    setDraftEdgeSync({
      sourceNodeId: edge.source_node_id,
      sourceSide: 'right',
      mouseX: mouseEvent.clientX, mouseY: mouseEvent.clientY,
      rerouteEdgeId: edge.id,
      sectionAtStart
    });
  }

  // Magnetic snap: in moveDraftEdge we look at every other node's left
  // port stack and pick the nearest slot within SNAP_RADIUS_SCREEN px of
  // the cursor. The draft cord endpoint snaps to that slot's world coord
  // so the user gets clear visual confirmation that a drop will land.
  const SNAP_RADIUS_SCREEN = 56;
  const SLOT_SIZE = 14, SLOT_GAP = 9;
  // Receiver ports are centered on the node edge. Keep this in sync with
  // EdgeLayer.PORT_GAP and the .cnode-port-stack-left CSS offset.
  const PORT_GAP = 0;
  function findSnapTarget(clientX, clientY, sourceNodeId) {
    if (!sourceNodeId) return null;
    const w = clientToWorld(transformRef, clientX, clientY);
    const scale = transformRef.current?.instance?.transformState?.scale || 1;
    // Snap REACH stays screen-constant-with-floor (interaction feel), and
    // since 2026-07-07 the slot GEOMETRY is screen-constant again too (CSS
    // counter-scales the circles by --chrome-scale, floor 0.4) — divide by
    // the same chromeScale or the snap lands between circles.
    const cs = chromeScale(scale);
    const radiusWorld = SNAP_RADIUS_SCREEN / cs;
    const slotSize = SLOT_SIZE / cs;
    const slotGap = SLOT_GAP / cs;
    const gap = PORT_GAP / cs;
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
      // A cord between two DISTINCT sections fuses them into one — hold the
      // drop in the merge-confirm modal instead of wiring it straight away.
      // The optimistic cord is deliberately NOT drawn yet: confirm draws it,
      // cancel leaves both sections untouched. Reroutes judge against the
      // PRE-gesture membership snapshot (the drag already deleted the edge,
      // which can split one section into two — re-attaching inside what was
      // one section is a restore, not a merge).
      const secOf = (nodeId) => {
        if (draft.sectionAtStart) return draft.sectionAtStart.get(nodeId) || null;
        const s = sections.find((x) => x.memberIds.includes(nodeId));
        return s ? s.id : null;
      };
      // Real-edge component size on the CURRENT edge list. A cord only MERGES
      // sections when both endpoints sit in real chains of >= 2 — adopted or
      // geometrically-absorbed (virtual) members and severed reroute ends are
      // singletons that simply re-parent, no fusion, so no confirm.
      const realComponentSize = (nodeId) => {
        const adj = new Map();
        const link = (a, b) => {
          if (!adj.has(a)) adj.set(a, []);
          adj.get(a).push(b);
        };
        for (const ed of edges) {
          link(ed.source_node_id, ed.target_node_id);
          link(ed.target_node_id, ed.source_node_id);
        }
        const seen = new Set([nodeId]);
        const queue = [nodeId];
        while (queue.length) {
          const cur = queue.shift();
          for (const nb of adj.get(cur) || []) {
            if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
          }
        }
        return seen.size;
      };
      const srcSecId = secOf(src);
      const tgtSecId = secOf(targetId);
      if (srcSecId && tgtSecId && srcSecId !== tgtSecId &&
          realComponentSize(src) >= 2 && realComponentSize(targetId) >= 2) {
        setMergeConfirm({ src, targetId });
        return;
      }
      await commitEdgeCreate(src, targetId);
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

  // Shared tail of the manual cord drop — optimistic temp edge, create on the
  // server, reconcile or roll back. Called straight from the drop, or from the
  // merge-confirm modal's Yes.
  async function commitEdgeCreate(src, targetId) {
    // Re-validate at commit time — the merge-confirm modal can sit open while
    // background mutations (agent addEdge, board refetch, deletes) land under
    // it. A duplicate pair just selects the existing edge; a vanished node
    // aborts instead of firing a doomed POST.
    if (!nodes.some((n) => n.id === src) || !nodes.some((n) => n.id === targetId)) {
      toast.error('One of the connected nodes no longer exists.');
      return;
    }
    const dup = edges.find((x) => x.source_node_id === src && x.target_node_id === targetId);
    if (dup) {
      setSelectedEdgeId(dup.id);
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
    // Membership survives the scissors (2026-07-06, user rule): cutting a
    // cord must NOT expel anyone from the section. An endpoint left with
    // ZERO real edges would fall out of the connected component on the
    // next derive — latch it with meta.adoptedInto = the section's root
    // (the same virtual link drag-adoption uses) BEFORE the edge goes.
    const own = sections.find((s) =>
      s.memberIds.includes(edge.source_node_id) && s.memberIds.includes(edge.target_node_id));
    const remaining = edges.filter((x) => x.id !== edge.id);
    if (own && own.rootId && !String(own.rootId).startsWith('temp-')) {
      for (const endId of [edge.source_node_id, edge.target_node_id]) {
        if (endId === own.rootId || String(endId).startsWith('temp-')) continue;
        const stillWired = remaining.some((x) => x.source_node_id === endId || x.target_node_id === endId);
        if (stillWired) continue;
        const n = nodes.find((nn) => nn.id === endId);
        if (!n || n.meta?.adoptedInto === own.rootId) continue;
        const meta = { ...(n.meta || {}), adoptedInto: own.rootId };
        delete meta.sectionOptOut;
        setNodes((prev) => prev.map((nn) => (nn.id === endId ? { ...nn, meta } : nn)));
        api.updateNode(endId, { meta }).catch(console.warn);
      }
    }
    setEdges((prev) => prev.filter((x) => x.id !== edge.id));
    setSelectedEdgeId(null);
    setPopupPos(null);
    // Retract animation: the severed cord lingers ~300ms as a "dying" edge
    // (rendered by EdgeLayer with the retract keyframes) instead of
    // vanishing on the spot. Local-only — the server delete runs now.
    setDyingEdges((prev) => [...prev, edge]);
    setTimeout(() => {
      setDyingEdges((prev) => prev.filter((e) => e.id !== edge.id));
    }, 330);
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

  async function handleSaveWorkflow() {
    if (!nodes.length || workflowSaveState === 'saving') return;
    setWorkflowSaveState('saving');
    try {
      await api.saveWorkflow(
        board.id,
        boardName || 'Untitled workflow',
        `${nodes.length} reusable ${nodes.length === 1 ? 'node' : 'nodes'} with ${edges.length} ${edges.length === 1 ? 'connection' : 'connections'}.`
      );
      setWorkflowSaveState('saved');
      toast.success('Workflow saved without node content.');
      window.setTimeout(() => setWorkflowSaveState('idle'), 2200);
    } catch (error) {
      setWorkflowSaveState('idle');
      toast.error(error.message || 'Could not save workflow');
    }
  }

  // Usable viewport region for framing math — the Working Table chrome
  // (sidebar + topbar) overlays the full-viewport canvas, so optical
  // centering must happen in the region it leaves free. Read live so the
  // sidebar collapse (224 → 52) is respected; chrome is hidden in edit
  // mode but the edit path uses computeEditFrame, never this.
  function chromeInsets() {
    let left = 224;
    let right = 248;
    try {
      const cs = getComputedStyle(document.documentElement);
      const l = parseFloat(cs.getPropertyValue('--sidebar-w'));
      if (!Number.isNaN(l)) left = l;
      const r = parseFloat(cs.getPropertyValue('--inspector-w'));
      if (!Number.isNaN(r)) right = r;
    } catch { /* SSR */ }
    return { left, right, top: 46 };
  }

  function zoomToNode(node, animationTime = 350, forcedScale = null) {
    const t = transformRef.current;
    if (!t || !node) return;
    const PAD = 80;
    const ins = chromeInsets();
    const vw = window.innerWidth - ins.left - ins.right;
    const vh = window.innerHeight - ins.top;
    let scale;
    if (forcedScale != null) {
      scale = clampCanvasScale(forcedScale);
    } else {
      const nodeW = node.width + PAD * 2;
      const nodeH = (node.height || 800) + PAD * 2 + 60;
      scale = clampCanvasScale(Math.min(vw / nodeW, vh / nodeH, 1.0));
    }
    const centerX = node.pos_x + node.width / 2;
    const centerY = node.pos_y + (node.height || 800) / 2;
    const posX = ins.left + vw / 2 - centerX * scale;
    const posY = ins.top + vh / 2 - centerY * scale;
    t.setTransform(posX, posY, scale, animationTime);
  }

  function editFrameReserves(node) {
    if (editorKindForNode(node) === NODE_EDITOR_KIND.NATIVE) {
      return nativeMotionEditShellLayout(window.innerWidth);
    }
    const layersEl = document.getElementById('rb-editor-layers');
    const inspectorEl = document.getElementById('rb-editor-inspector');
    return {
      left: layersEl ? layersEl.getBoundingClientRect().width : 224,
      right: inspectorEl ? inspectorEl.getBoundingClientRect().width : 248,
    };
  }

  // Legacy Edit frames the complete expanded page between its two panels.
  // Native Edit keeps one canonical device rectangle and, until Task 7 adds
  // canvas-level panels, centers it in the full free area below the topbar.
  function computeEditFrame(node) {
    const reserves = editFrameReserves(node);
    return computeNodeEditFrame(node, {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      leftReserve: reserves.left,
      rightReserve: reserves.right,
      bottom: reserves.bottom ?? 18,
    });
  }

  function enterEditMode(node, editorKind = editorKindForNode(node)) {
    if (editFrameTimerRef.current) window.clearTimeout(editFrameTimerRef.current);
    let framedNode = node;
    if (editorKind === NODE_EDITOR_KIND.NATIVE) {
      const device = nativeEditDeviceForNode(node);
      framedNode = canonicalNativeEditNode(node, device.id);
      nativeEditRestoreRef.current = {
        nodeId: node.id,
        geometry: {
          pos_x: node.pos_x,
          pos_y: node.pos_y,
          width: node.width,
          height: node.height,
        },
        camera: window.__uncraftZoom?.getState?.() || null,
      };
      setNodes((current) => current.map((candidate) => (
        candidate.id === node.id ? framedNode : candidate
      )));
    }
    setEditingNodeId(node.id);
    editFrameTimerRef.current = window.setTimeout(() => {
      editFrameTimerRef.current = null;
      const f = computeEditFrame(framedNode);
      if (window.__uncraftZoom) {
        window.__uncraftZoom._editFrame = f;
        window.__uncraftZoom.setState?.(f, 350);
      }
    }, 50);
  }

  function exitEditMode(nodeId, { reason = 'exit' } = {}) {
    if (editFrameTimerRef.current) {
      window.clearTimeout(editFrameTimerRef.current);
      editFrameTimerRef.current = null;
    }
    if (nativeViewportFrameRafRef.current) {
      window.cancelAnimationFrame(nativeViewportFrameRafRef.current);
      nativeViewportFrameRafRef.current = null;
    }
    const session = nativeEditRestoreRef.current;
    if (session?.nodeId === nodeId) {
      if (session.camera) {
        try {
          localStorage.setItem(CANVAS_VIEW_KEY, JSON.stringify(session.camera));
        } catch { /* best-effort immediate restoration */ }
      }
      nativeEditRestoreRef.current = null;
      setNodes((current) => current.map((candidate) => (
        candidate.id === nodeId
          ? { ...candidate, ...session.geometry }
          : candidate
      )));
      if (session.camera) window.__uncraftZoom?.setState?.(session.camera, 280);
    }
    setEditingNodeId(null);
    if (window.__uncraftZoom) window.__uncraftZoom._editFrame = null;
    if (reason === 'runtime-unavailable') {
      toast.error("This website couldn't be opened for editing.");
    }
  }

  async function handleEditingToggle(nodeId, willEdit, details = {}) {
    if (willEdit) {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || editPreparationRef.current.has(nodeId)) return;
      if (isLiveUrlReference(node) && !canUseCloneEdit(user?.plan)) {
        setPlansOpen(true);
        return;
      }
      const editorKind = editorKindForNode(node);
      if (editorKind === NODE_EDITOR_KIND.NATIVE) {
        enterEditMode(node, editorKind);
        return;
      }
      if (!needsDeferredReconstruction(node)) {
        enterEditMode(node, editorKind);
        return;
      }

      editPreparationRef.current.add(nodeId);
      setNodeRunStatus(nodeId, { step: 1, label: 'Preparing editable site…', request: '' });
      try {
        const result = await api.reconstructNode(nodeId);
        flashNodeDebit(nodeId, result?.credits);
        const preparedNode = applyReconstructionResultToNode(node, result);
        setNodes((prev) => prev.map((candidate) => candidate.id === nodeId ? preparedNode : candidate));
        setNodeRunStatus(nodeId, null);
        enterEditMode(preparedNode, editorKindForNode(preparedNode));
      } catch (e) {
        setNodeRunStatus(nodeId, null);
        if (!handleBillingError(e)) toast.error(`Could not prepare this site for editing: ${e.message}`);
      } finally {
        editPreparationRef.current.delete(nodeId);
      }
    } else {
      exitEditMode(nodeId, details);
    }
  }

  function applySiteViewport(node, width, height) {
    if (editorKindForNode(node) === NODE_EDITOR_KIND.NATIVE) {
      const resizedNode = { ...node, width, height };
      setNodes((current) => current.map((candidate) => (
        candidate.id === node.id ? resizedNode : candidate
      )));
      if (nativeViewportFrameRafRef.current) {
        window.cancelAnimationFrame(nativeViewportFrameRafRef.current);
      }
      nativeViewportFrameRafRef.current = window.requestAnimationFrame(() => {
        nativeViewportFrameRafRef.current = null;
        const frame = computeEditFrame(resizedNode);
        if (!window.__uncraftZoom) return;
        window.__uncraftZoom._editFrame = frame;
        window.__uncraftZoom.setState?.(frame, 280);
      });
      return;
    }
    handleNodeResize(node, width, height);
    if (editingNodeId !== node.id) return;
    const resizedNode = { ...node, width, height };
    window.requestAnimationFrame(() => {
      const frame = computeEditFrame(resizedNode);
      if (!window.__uncraftZoom) return;
      window.__uncraftZoom._editFrame = frame;
      window.__uncraftZoom.setState?.(frame, 280);
    });
  }

  function sendEditorAction(action) {
    if (!editingNodeId || editorActionBusy) return;
    window.dispatchEvent(new CustomEvent('uncraft:editor-action', {
      detail: { nodeId: editingNodeId, action },
    }));
  }

  useEffect(() => {
    setEditorActionBusy(false);
    if (!editingNodeId) return undefined;
    function handleEditorBusy(event) {
      if (event.detail?.nodeId === editingNodeId) setEditorActionBusy(Boolean(event.detail.busy));
    }
    window.addEventListener('uncraft:editor-busy', handleEditorBusy);
    return () => window.removeEventListener('uncraft:editor-busy', handleEditorBusy);
  }, [editingNodeId]);

  useEffect(() => {
    if (!editingNodeId || nodes.some((node) => node.id === editingNodeId)) return;
    exitEditMode(editingNodeId, { reason: 'node-removed' });
  }, [editingNodeId, nodes]);

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
    const ins = chromeInsets();
    const vw = window.innerWidth - ins.left - ins.right;
    const vh = window.innerHeight - ins.top;
    const scale = clampCanvasScale(Math.min(vw / bboxW, vh / bboxH, CANVAS_MAX_SCALE));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const posX = ins.left + vw / 2 - centerX * scale;
    const posY = ins.top + vh / 2 - centerY * scale;
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
    const insFit = chromeInsets();
    const vw = window.innerWidth - insFit.left - insFit.right;
    const vh = window.innerHeight - insFit.top;
    const scale = clampCanvasScale(Math.min(vw / bboxW, vh / bboxH, CANVAS_MAX_SCALE));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    // setTransform expects positionX/Y of the TransformComponent content.
    const posX = insFit.left + vw / 2 - centerX * scale;
    const posY = insFit.top + vh / 2 - centerY * scale;
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
    const insCon = chromeInsets();
    const vw = window.innerWidth - insCon.left - insCon.right;
    const vh = window.innerHeight - insCon.top;
    const scale = clampCanvasScale(Math.min(vw / bboxW, vh / bboxH, CANVAS_MAX_SCALE));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const posX = insCon.left + vw / 2 - centerX * scale;
    const posY = insCon.top + vh / 2 - centerY * scale;
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
      '.canvas-sidebar',
      '.canvas-topbar',
      '.canvas-tools',
      '.canvas-zoomdock',
      '.canvas-inspector',
      '.canvas-theme-floater',
      '.zoom-controls',
      '.zoom-menu',
      '.user-menu',
      '.reset-confirm-card',
      '.reset-confirm-overlay',
      '.canvas-context-menu',
      '.empty-drop-menu',
      '#rb-editor-inspector',
      '#rb-editor-layers',
      '#rb-ed-insp-body',
      '#rb-ed-layers-body',
      '#rb-ed-sections-body',
      '#rb-ed-assets-body',
      '.cnode-version-menu',
      '.cnode-version-ctx-menu',
      '.prompt-dock',
      '.boards-sidebar',
      'textarea',
    ].join(', ');
    // Wheel events outpace the display — batch zoom/pan input and apply at
    // most one transform update per animation frame (see lib/wheel-batch.js).
    const batcher = createWheelBatcher({
      onPan: (dx, dy) => window.__uncraftZoom?.panBy?.(dx, dy),
      onZoom: (dz, cx, cy) => window.__uncraftZoom?.zoomAtPoint?.(dz, cx, cy),
    });
    function onWheelCapture(e) {
      const overNative = e.target?.closest?.(NATIVE_WHEEL_SELECTOR);
      // Ctrl/Cmd + wheel (incl. trackpad PINCH, which fires as ctrlKey+wheel)
      // must NEVER reach the browser — that's the page-zoom that blows the whole
      // UI up. Block it EVERYWHERE on the canvas page, including over the chat
      // dock / sidebar / menus (where we otherwise hand wheel to native scroll).
      // Only translate it into a canvas zoom when NOT over a native-scroll zone.
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        // Anywhere over the WORLD — bare canvas or any node, including
        // native-scroll zones like the prompt body (which owns only the
        // PLAIN wheel) — Ctrl/Cmd+wheel IS the canvas zoom. Only UI chrome
        // (dock / sidebar / menus) keeps it inert.
        const overWorld = !overNative || e.target?.closest?.('.cnode');
        if (overWorld) {
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          batcher.addZoom(e.deltaY || 0, e.clientX, e.clientY);
        }
        return;
      }
      // Plain wheel over a native-scroll region → let it scroll natively.
      if (overNative) return;
      e.preventDefault();
      // Kill TransformWrapper's own wheel listener (attached on the wrapper
      // in bubble phase). Defensive — wheel.disabled:true should already
      // short-circuit it, but HMR can leave stale listeners around.
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (editingNodeId) return;
      batcher.addPan(-(e.deltaX || 0), -(e.deltaY || 0));
    }
    function onKeyZoom(e) {
      // Block browser page-zoom keys (Ctrl/Cmd +, -, =). Leave Ctrl/Cmd+0
      // (reset) alone so the user can always undo an accidental zoom.
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) {
        e.preventDefault();
      }
      // ⌥W — world-lock chrome EXPERIMENT toggle (2026-07-06): pins the
      // --chrome-scale divisor to 1 so ALL canvas chrome scales with the
      // world (see :root note in globals.css). e.code because macOS Alt+W
      // types "∑" as e.key. Persisted so a reload keeps the mode.
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyW') {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        const on = document.documentElement.classList.toggle('canvas-worldlock');
        try { localStorage.setItem('uncraft-worldlock', on ? '1' : '0'); } catch {}
        toast.info(on
          ? 'World-lock experiment: ON — chrome scales with the world (⌥W to revert)'
          : 'World-lock experiment: OFF — chrome back to screen-constant');
      }
    }
    // Restore the world-lock experiment mode across reloads.
    try {
      if (localStorage.getItem('uncraft-worldlock') === '1') {
        document.documentElement.classList.add('canvas-worldlock');
      }
    } catch {}
    document.addEventListener('wheel', onWheelCapture, { passive: false, capture: true });
    document.addEventListener('keydown', onKeyZoom);
    return () => {
      batcher.cancel();
      document.removeEventListener('wheel', onWheelCapture, { capture: true });
      document.removeEventListener('keydown', onKeyZoom);
    };
  }, [editingNodeId]);

  // Restore a board-scoped viewport. A new board opens at the Working Table
  // reference scale (72%) around its main/first node instead of shrinking an
  // entire large project to unreadable thumbnails. Subsequent pan/zoom state
  // is saved below from onTransformed.
  useEffect(() => {
    canvasViewReadyRef.current = false;
    const timer = setTimeout(() => {
      const transform = transformRef.current;
      if (!transform?.setTransform) return;

      const requestedNode = initialFocusNodeId
        ? initialNodes.find((node) => node.id === initialFocusNodeId)
        : null;
      let saved = null;
      try { saved = parseCanvasView(localStorage.getItem(CANVAS_VIEW_KEY)); } catch {}
      if (requestedNode) {
        setSelectedNodeId(requestedNode.id);
        setSelectedNodeIds((current) => (current.size ? new Set() : current));
        zoomToNode(requestedNode, 0);
      } else if (saved) {
        transform.setTransform(saved.positionX, saved.positionY, saved.scale, 0);
      } else if (initialNodes?.length) {
        const focusNode = initialNodes.find((node) => node.is_main) || initialNodes[0];
        // Normal website nodes are much larger than the illustrative nodes in
        // the prototype. Fit the focused node to the same visible footprint;
        // the 72% default still applies to empty/new boards.
        zoomToNode(focusNode, 0);
      }

      requestAnimationFrame(() => { canvasViewReadyRef.current = true; });
    }, 80);

    return () => {
      clearTimeout(timer);
      clearTimeout(canvasViewSaveTimerRef.current);
    };
  }, [CANVAS_VIEW_KEY, initialFocusNodeId]);

  // Keyboard shortcuts: Esc clears selection. F fits all nodes. 0 resets to
  // 1:1 center. Pan is handled separately and exists only while Space is held.
  // Delete/Backspace removes the selected node (or selected edge).
  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.target?.isContentEditable) return;
      // A ConfirmModal owns the keyboard while open — without this, Delete
      // nukes the selected node BEHIND the frosted overlay, and Esc/Enter
      // double-fire (canvas handler + modal handler on the same keypress).
      if (mergeConfirm || nodeDelete || sectionDelete || playSection) return;
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
  }, [nodes, edges, draftEdge, selectedNodeId, selectedNodeIds, selectedEdgeId, editingNodeId, emptyDropMenu, contextMenu, mergeConfirm, nodeDelete, sectionDelete, playSection]);

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
            // Explicit-removal opt-out: a node the user pulled OUT of this
            // section must not be geometrically re-absorbed by it. The
            // marker stores the host's root (a member id); re-adoption by
            // drag or a new cord clears it.
            const optedOut = components[i].some((id) => {
              const oo = nodeById.get(id)?.meta?.sectionOptOut;
              return oo && components[j].includes(oo);
            });
            if (optedOut) continue;
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
      // Topbar HIDDEN (2026-07-03): the node renders as body-only, so there
      // is no in-flow chrome band above the body anymore and the visual
      // bottom = pos_y + height. If the topbar ever comes back, restore:
      //   const chromeWorld = 36 / Math.max(0.30, canvasScale || 1);
      // (the 0.30 floor matched the CSS `--tb` cap on .cnode-topbar).
      const chromeWorld = 0;
      for (const id of memberIds) {
        const n = nodeById.get(id);
        if (!n) continue;
        const isAsset = n.kind === 'asset' || n.kind === 'image';
        // A SELECTED site node sprouts a version-history floater BELOW it
        // (a 22px gap + square thumbnails that are 20% of the node width);
        // count it so the frame clears it at its bottom edge. The device/
        // viewport switcher ABOVE the node is deliberately NOT counted: the
        // stored frame is grow-only, so expanding the top on selection
        // permanently pushed the section's top edge — and near a neighbour
        // it made sections INTERSECT, which is forbidden. The switcher just
        // renders over the frame edge while the node is selected (transient
        // chrome, acceptable overlap).
        const selectedSite = n.kind === 'site' &&
          (n.id === selectedNodeId || (selectedNodeIds && selectedNodeIds.has && selectedNodeIds.has(n.id)));
        const historyOverflow = selectedSite
          ? 22 / Math.max(0.35, canvasScale || 1) + 0.20 * (n.width || 0)
          : 0;
        const bottomOverflow = chromeWorld + (isAsset ? ASSET_BOTTOM_OVERFLOW : 0) + historyOverflow;
        minX = Math.min(minX, n.pos_x || 0);
        minY = Math.min(minY, n.pos_y || 0);
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

  // Track which section the cursor is inside (world coords) — the frame and
  // chrome are pointer-events:none, so :hover can't do it. Drives the
  // show-on-hover run pill. rAF-coalesced; setState only fires on change.
  const hoverSectionsRef = useRef(sections);
  hoverSectionsRef.current = sections;
  useEffect(() => {
    let raf = 0;
    let lastEvt = null;
    const resolve = () => {
      raf = 0;
      if (!lastEvt) return;
      const { x, y } = clientToWorld(transformRef, lastEvt.clientX, lastEvt.clientY);
      let hit = null;
      for (const s of hoverSectionsRef.current) {
        if (x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height) { hit = s.id; break; }
      }
      setHoveredSectionId((prev) => (prev === hit ? prev : hit));
    };
    const onMove = (e) => {
      lastEvt = e;
      if (!raf) raf = requestAnimationFrame(resolve);
    };
    document.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      document.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // nodeRunSigs maps a node id → the fingerprint of its INPUTS at its last
  // successful run (incremental cascade: matching inputs + existing result
  // → the node is skipped and its result reused, no credits burnt).
  // Persisted per board so the savings survive reloads.
  const [nodeRunSigs, setNodeRunSigs] = useState(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(`rb-node-run-sigs-${board.id}`) || '{}'); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(`rb-node-run-sigs-${board.id}`, JSON.stringify(nodeRunSigs)); } catch {}
  }, [nodeRunSigs, board.id]);
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
  // Ops a section's run would ACTUALLY execute right now: incremental
  // (skipped-clean nodes cost nothing) unless the section is fully clean —
  // there the button is "Reroll" = force-everything, so estimate the lot.
  const opsFor = (sec) => sectionOps(sec, nodes, edges, cleanSectionIds.has(sec.id) ? null : nodeRunSigs);
  // Section layout button states (2026-07-07): each button disables when
  // its result is already in effect and re-enables the moment something
  // moves out of place. "Fitted" = no stored manual frame (the frame
  // naturally hugs the members — resize gestures and engulf commits store
  // one). "Laid out" = every member sits where planChainLayout would put
  // it (±1px, anchored at the group's bbox corner — shift-invariant, so
  // moving the whole section doesn't re-enable it).
  const sectionLayoutState = useMemo(() => {
    const out = new Map();
    for (const s of sections) {
      const fitted = !(s.id in sectionFrames);
      let laidOut = false;
      const members = nodes.filter((n) => s.memberIds.includes(n.id) && !String(n.id).startsWith('temp-'));
      if (members.length >= 2) {
        const memberSet = new Set(members.map((n) => n.id));
        const specs = members.map((n) => ({ key: n.id, width: n.width || 1280, height: n.height || 800 }));
        const links = edges
          .filter((e) => memberSet.has(e.source_node_id) && memberSet.has(e.target_node_id))
          .map((e) => ({ from: e.source_node_id, to: e.target_node_id }));
        const plan = planChainLayout(specs, links);
        let minX = Infinity, minY = Infinity;
        for (const n of members) { minX = Math.min(minX, n.pos_x); minY = Math.min(minY, n.pos_y); }
        laidOut = members.every((n) => {
          const p = plan.positions[n.id];
          return p && Math.abs(minX + p.x - n.pos_x) <= 1 && Math.abs(minY + p.y - n.pos_y) <= 1;
        });
      }
      out.set(s.id, { fitted, laidOut });
    }
    return out;
  }, [sections, nodes, edges, sectionFrames]);

  // Nodes that show the "Run from here" hover pill: section members with
  // something DOWNSTREAM of them (an outgoing cord to another member).
  // Terminals don't need it — the section pill already covers them.
  const runFromHereIds = useMemo(() => {
    const memberOf = new Map();
    for (const s of sections) for (const id of s.memberIds) memberOf.set(id, s.id);
    const out = new Set();
    for (const e of edges) {
      const sid = memberOf.get(e.source_node_id);
      if (sid && memberOf.get(e.target_node_id) === sid) out.add(e.source_node_id);
    }
    return out;
  }, [sections, edges]);
  // Terminal node ids of clean sections — the bare chat-arrow run-flow skips
  // these (re-running a clean chain produces the same result).
  const cleanTerminalIds = useMemo(() => {
    const out = new Set();
    for (const s of sections) {
      if (!cleanSectionIds.has(s.id)) continue;
      const { terminals } = findSectionTerminals(s, nodes, edges);
      for (const t of terminals) out.add(t.id);
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
  // Nodes whose SECTION has a running member — flips their "Run from here"
  // button into its Stop state (mirrors the section pill's stop).
  const flowRunningNodeIds = new Set();
  for (const s of sections) {
    if ((s.memberIds || []).some((mid) => runningNodeIds.has(mid))) {
      for (const id of s.memberIds) flowRunningNodeIds.add(id);
    }
  }

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
    // Move set = the section's REAL members only. A section move must never
    // carry a foreign element that merely sits inside its frame — a loose
    // node or another section is its own thing, not cargo. Intentionally
    // adopted nodes (dropped INTO the section by their own drag) are already
    // in memberIds via meta.adoptedInto / absorption, so they still travel.
    const moveIds = new Set(section.memberIds);
    const memberNodes = [...moveIds]
      .map((id) => nodes.find((n) => n.id === id))
      .filter(Boolean);
    if (memberNodes.length === 0) return;
    // Walls for the drag: neighbouring sections' frames and every non-member
    // node that isn't inside one of those frames. The dragged frame slides
    // along them and stops at the gap — it can never end ON TOP of another
    // element, so dropping a section over things can't absorb them.
    const moveObstacles = [
      ...sections.filter((s) => s.id !== sectionId)
        .map((s) => ({ left: s.x, top: s.y, right: s.x + s.width, bottom: s.y + s.height })),
      ...nodes.filter((n) => !moveIds.has(n.id) &&
          !sections.some((s) => s.id !== sectionId && s.memberIds.includes(n.id)))
        .map((n) => ({
          left: n.pos_x || 0,
          top: n.pos_y || 0,
          right: (n.pos_x || 0) + (n.width || 0),
          bottom: (n.pos_y || 0) + (n.height || 0),
        })),
    ];
    // Per-gesture wall hysteresis — same pattern as the resize wall.
    const wallMemory = new Map();
    // Second, tighter wall: geometric absorption adopts a foreign node when
    // its CENTER ends inside the moved section's CORE — and the frame wall
    // passes through obstacles that already overlapped the frame at gesture
    // start (legacy layouts). So every non-member center is a point obstacle
    // for the CORE rect. A center already inside the core would have been
    // absorbed into memberIds, so this wall always qualifies: no pass-through,
    // rule "a section never absorbs by being dropped over things" holds even
    // from overlapping starts.
    const foreignCenters = nodes
      .filter((n) => !moveIds.has(n.id))
      .map((n) => {
        const cx = (n.pos_x || 0) + (n.width || 0) / 2;
        const cy = (n.pos_y || 0) + (n.height || 0) / 2;
        return { left: cx, top: cy, right: cx, bottom: cy };
      });
    const coreWallMemory = new Map();
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
    // The absorption core at gesture start — translates rigidly with the
    // members, mirroring what the sections memo will test after the drop.
    const startCore = sectionCoreRect(memberNodes);
    const startScale = readCanvasScale();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    function onMove(ev) {
      let dx = (ev.clientX - startMouseX) / startScale;
      let dy = (ev.clientY - startMouseY) / startScale;
      // Hold the walls: the frame slides along neighbours, never onto them.
      if (moveObstacles.length) {
        ({ dx, dy } = clampMoveToNeighbors(startFrame, dx, dy, moveObstacles, undefined, wallMemory));
      }
      // Core wall: no foreign center may end inside the moved core (gap 1 —
      // the absorption test is inclusive at the boundary).
      if (startCore && foreignCenters.length) {
        ({ dx, dy } = clampMoveToNeighbors(startCore, dx, dy, foreignCenters, 1, coreWallMemory));
      }
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
      setDragFreeze(null);   // release — lets the latch/frame effects settle once
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
    // Freeze membership/frame effects for the duration of the section drag —
    // mirrors the node drag. Without this the geometric-latch effect ran on
    // every mousemove's setNodes and re-set state in a loop → "Maximum update
    // depth exceeded". id = sectionId matches no node, so no member is pinned.
    setDragFreeze({ id: sectionId, startX: 0, startY: 0 });
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

    const startScale = readCanvasScale();
    // Mirror the rendered-frame bbox overflow (the `sections` useMemo): the
    // resize must clear the SAME node chrome the frame wraps, not just the
    // raw member box — asset dims, and (for a SELECTED site node) the
    // history floater BELOW. Without this the handle clips an open history
    // when dragged in. Keep in SYNC with the memo: topbar hidden
    // (chromeWorld 0) and the device switcher deliberately not counted.
    const chromeWorld = 0;
    let memMinX = Infinity, memMinY = Infinity, memMaxX = -Infinity, memMaxY = -Infinity;
    for (const m of memberNodes) {
      const isAsset = m.kind === 'asset' || m.kind === 'image';
      const selectedSite = m.kind === 'site' &&
        (m.id === selectedNodeId || (selectedNodeIds && selectedNodeIds.has && selectedNodeIds.has(m.id)));
      const historyOverflow = selectedSite ? 22 / Math.max(0.35, startScale) + 0.20 * (m.width || 0) : 0;
      const bottomOverflow = chromeWorld + (isAsset ? ASSET_BOTTOM_OVERFLOW : 0) + historyOverflow;
      memMinX = Math.min(memMinX, m.pos_x || 0);
      memMinY = Math.min(memMinY, m.pos_y || 0);
      memMaxX = Math.max(memMaxX, (m.pos_x || 0) + (m.width || 0));
      memMaxY = Math.max(memMaxY, (m.pos_y || 0) + (m.height || 0) + bottomOverflow);
    }
    // Resizing the frame in can't cross the SAME safety margin a node keeps
    // when dragged toward the section edges (SECTION_MEMBER_CLEARANCE) — so the
    // frame never hugs a member tighter than a drop would allow.
    const MIN_CLEARANCE = SECTION_MEMBER_CLEARANCE;
    const startFrame = { left: section.x, top: section.y, right: section.x + section.width, bottom: section.y + section.height };
    // Other sections' frames AND loose nodes are hard WALLS — the resize can
    // grow this frame up to a small gap short of them, never over them. Loose
    // nodes matter: a frame resized over a loose node sets up the overlapping
    // start that would let a later section MOVE swallow it.
    const resizeMemberIds = new Set(section.memberIds);
    const neighborFrames = [
      ...sections.filter((s) => s.id !== sectionId)
        .map((s) => ({ left: s.x, top: s.y, right: s.x + s.width, bottom: s.y + s.height })),
      ...nodes.filter((n) => !resizeMemberIds.has(n.id) &&
          !sections.some((s) => s.id !== sectionId && s.memberIds.includes(n.id)))
        .map((n) => ({
          left: n.pos_x || 0,
          top: n.pos_y || 0,
          right: (n.pos_x || 0) + (n.width || 0),
          bottom: (n.pos_y || 0) + (n.height || 0),
        })),
    ];
    // Per-gesture wall hysteresis: once a diagonal neighbour picks its wall
    // axis, it keeps it for the rest of the drag (no mid-gesture flip).
    const wallMemory = new Map();
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
      // Single-axis edge handles (2026-07-04): the four frame edges resize
      // too — lateral edges move only X, top/bottom only Y. Same member-
      // containment + neighbor-wall clamps as the corners below.
      else if (corner === 'n') { newTop = startFrame.top + dy; }
      else if (corner === 's') { newBottom = startFrame.bottom + dy; }
      else if (corner === 'w') { newLeft = startFrame.left + dx; }
      else if (corner === 'e') { newRight = startFrame.right + dx; }
      // Hold the wall against neighbouring sections FIRST; the member-
      // containment clamp below runs last so it outranks the wall (a frame
      // must always contain its members even when the layout is tight).
      if (neighborFrames.length) {
        ({ left: newLeft, top: newTop, right: newRight, bottom: newBottom } = clampFrameToNeighbors(
          { left: newLeft, top: newTop, right: newRight, bottom: newBottom },
          startFrame, neighborFrames, undefined, wallMemory
        ));
      }
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
        // Distinct category colours of the section's members — the "chain"
        // colours the working-text gradient flows through during a run.
        const memberColors = [...new Set(
          s.memberIds
            .map((mid) => nodes.find((x) => x.id === mid))
            .filter(Boolean)
            .map((n) => originColor(n))
            .filter(Boolean)
        )];
        return [{
          kind: 'section',
          id: s.id,
          name: s.name,
          theme: s.theme,
          memberIds: s.memberIds,
          memberCount: s.memberIds.length,
          memberColors,
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

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedSiteNode = selectedNode?.kind === 'site' ? selectedNode : null;
  const editingNode = nodes.find((node) => node.id === editingNodeId) || null;

  nodeHandlersRef.current = {
    handleEditingToggle,
    handleNodeSelect,
    handleNodeMove,
    handleNodeMoveStart,
    handleNodeMoveEnd,
    startAltDuplicateDrag,
    runFromNode,
    getRunFromHereEst,
    stopFlowForNode,
    handleNodeResize,
    handleNodeDeleteRequest,
    handleResetNode,
    handleRestoreVersion,
    handleSaveNodeEdit,
    handleDiscardNodeEdit,
    handleDuplicateNode,
    handleCloneIter9,
    handleDownloadNode,
    startEdgeFromNode,
    onSlotMouseDown,
    handlePromptTextChange,
    handleNodeMetaPatch,
    handleReplaceContent,
    handlePopulateNode,
    zoomToNode,
    armNodeRemoval,
    cancelNodeRemoval,
  };

  const nativeEditing = Boolean(
    editingNode && editorKindForNode(editingNode) === NODE_EDITOR_KIND.NATIVE
  );

  function finishNativeCommit(result) {
    if (!editingNode?.id || !result?.snapshot?.id) return;
    const nodeId = editingNode.id;
    setNodes((current) => current.map((node) => (
      node.id === nodeId
        ? applyNativeCommitSnapshot(node, result)
        : node
    )));
    exitEditMode(nodeId, { reason: 'native-commit' });
  }

  function finishNativeDiscard() {
    if (editingNode?.id) exitEditMode(editingNode.id, { reason: 'native-discard' });
  }

  return (
    <NativeMotionEditSessionProvider
      active={nativeEditing}
      nodeId={nativeEditing ? editingNode.id : null}
      onCommitted={finishNativeCommit}
      onDiscarded={finishNativeDiscard}
    >
    <div
      className={`canvas-shell${removingOutside ? ' removing-outside' : ''}`}
      onMouseDown={maybeStartMarquee}
      onMouseMove={moveDraftEdge}
      onMouseUp={handleGlobalMouseUp}
      onDragOver={(e) => {
        // Accept drags carrying our custom MIME (editor.js sets this on
        // asset-thumb dragstart) AND real files dragged in from the OS.
        // preventDefault is required to allow drop — and, for OS files,
        // stops the browser from navigating to the dropped file.
        const types = e.dataTransfer.types;
        const has = (t) => !!types && (types.includes ? types.includes(t) : Array.prototype.indexOf.call(types, t) >= 0);
        if (has('application/x-uncraft-asset') || has('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        // Internal asset-thumb drags carry our MIME; anything else with
        // real files is an OS drag (Finder/Explorer).
        let raw = '';
        try { raw = e.dataTransfer.getData('application/x-uncraft-asset'); } catch {}
        if (raw) { handleAssetDrop(e); return; }
        handleOsFilesDrop(e);
      }}
      onContextMenu={(e) => {
        // Ignore right-clicks landed on a node, the prompt dock, edge popups,
        // header, or the existing empty-drop menu. The browser's default
        // context menu is suppressed only for the bare canvas.
        const t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        if (t.closest('.cnode, .prompt-dock, .empty-drop-menu, .canvas-context-menu, .edge-popup, .canvas-header, .canvas-sidebar, .canvas-topbar, .canvas-tools, .canvas-zoomdock, .canvas-inspector')) return;
        e.preventDefault();
        const w = clientToWorld(transformRef, e.clientX, e.clientY);
        setContextMenu({ x: e.clientX, y: e.clientY, worldX: w.x, worldY: w.y });
      }}
    >
      <CanvasDotGrid ref={dotGridRef} />

      {/* ── Working Table fixed chrome (unspirit import, 2026-07-12) ──
          Sidebar + topbar + tool rail OVERLAY the full-viewport canvas
          world (never inset it — all client↔world math assumes the
          transform wrapper starts at viewport 0,0). All of it hides in
          edit mode via CSS (the editor brings its own panels). */}
      <CanvasSidebar
        user={user}
        onSignOut={logout}
        newNodeOpen={Boolean(contextMenu)}
        showFirstNodeCoachmark={showFirstNodeCoachmark}
        onNewNode={(event) => {
          dismissFirstNodeCoachmark();
          const rect = event.currentTarget.getBoundingClientRect();
          const clientX = (rect.right + window.innerWidth - 248) / 2;
          const clientY = window.innerHeight / 2;
          const world = clientToWorld(transformRef, clientX, clientY);
          setContextMenu({
            x: rect.right,
            y: rect.top,
            worldX: world.x,
            worldY: world.y,
          });
        }}
      />

      <header className={`canvas-topbar${editingNode ? ' editing' : ''}`}>
        {editingNode ? (
          <>
            <div className="canvas-edit-context">
              <span>Editing website</span>
              <b title={editingNode.meta?.name || editingNode.origin_url || 'Untitled website'}>
                {editingNode.meta?.name || editingNode.origin_url || 'Untitled website'}
              </b>
            </div>
            <div className="canvas-topbar-viewports canvas-edit-viewports" role="group" aria-label="Editing viewport">
              {[
                { label: 'Desktop', width: 1280, height: 800, Icon: Monitor },
                { label: 'Tablet', width: 768, height: 920, Icon: Tablet },
                { label: 'Mobile', width: 390, height: 844, Icon: Smartphone },
              ].map(({ label, width, height, Icon }) => (
                <button
                  key={label}
                  type="button"
                  className={Math.abs(editingNode.width - width) < 4 ? 'active' : ''}
                  onClick={() => applySiteViewport(editingNode, width, height)}
                  title={`${label} · ${width}px`}
                  aria-label={`${label} editing viewport`}
                  aria-pressed={Math.abs(editingNode.width - width) < 4}
                  disabled={editorActionBusy}
                >
                  <Icon aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="canvas-edit-actions">
              {nativeEditing && <NativeMotionEditTopbarControls />}
              <button type="button" className="canvas-edit-cancel" onClick={() => sendEditorAction('cancel')} disabled={editorActionBusy}>
                <X aria-hidden="true" />
                Cancel
              </button>
              <button type="button" className="canvas-edit-done" onClick={() => sendEditorAction('save')} disabled={editorActionBusy}>
                <Check aria-hidden="true" />
                {editorActionBusy ? 'Saving…' : 'Done'}
              </button>
            </div>
          </>
        ) : (
          <>
        <div className="canvas-topbar-crumb">
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
          <span className="canvas-topbar-separator">/</span>
          <span className="canvas-topbar-location">Canvas</span>
          <span className="canvas-topbar-save" title="Changes are persisted as you work">
            <CloudCheck aria-hidden="true" />
            Saved
          </span>
        </div>
        {selectedSiteNode && (
          <div className="canvas-topbar-viewports canvas-resting-viewports" role="group" aria-label="Website viewport">
            {[
              { label: 'Desktop', width: 1280, height: 800, Icon: Monitor },
              { label: 'Tablet', width: 768, height: 920, Icon: Tablet },
              { label: 'Mobile', width: 390, height: 844, Icon: Smartphone },
            ].map(({ label, width, height, Icon }) => (
              <button
                key={label}
                type="button"
                className={Math.abs(selectedSiteNode.width - width) < 4 ? 'active' : ''}
                onClick={() => applySiteViewport(selectedSiteNode, width, height)}
                title={`${label} · ${width}px`}
                aria-label={`${label} viewport`}
                aria-pressed={Math.abs(selectedSiteNode.width - width) < 4}
              >
                <Icon aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <div className="canvas-topbar-actions">
          <button
            type="button"
            className="canvas-topbar-btn canvas-save-workflow"
            onClick={handleSaveWorkflow}
            disabled={!nodes.length || workflowSaveState === 'saving'}
            title={nodes.length ? 'Save this node structure as a reusable workflow' : 'Add a node before saving a workflow'}
          >
            {workflowSaveState === 'saved' ? <Check aria-hidden="true" /> : <WorkflowIcon aria-hidden="true" />}
            {workflowSaveState === 'saving' ? 'Saving…' : workflowSaveState === 'saved' ? 'Workflow saved' : 'Save workflow'}
          </button>
          <CreditsPill />
          <button type="button" className="canvas-topbar-btn canvas-topbar-share" disabled title="Share — coming soon">
            Share
          </button>
        </div>
          </>
        )}
      </header>

      {editingNode && typeof document !== 'undefined' && createPortal(
        <div className="canvas-sidebar-user canvas-editor-user">
          <UserPill
            name={user?.name}
            email={user?.email}
            plan={user?.plan}
            role={user?.role}
            onSignOut={logout}
            workspaceMode
          />
        </div>,
        document.body
      )}

      <CanvasTools
        panActive={spaceDown}
        onUndo={handleUndo}
        canUndo={undoStackRef.current.length > 0}
      />

      <div className="canvas-zoomdock">
        <ZoomControls scale={canvasScale} transformRef={transformRef} onFit={fitToContent} />
        {user?.role === 'admin' && <DevWidget nodes={nodes} />}
      </div>

      <CanvasInspector
        node={selectedNode}
        plan={user?.plan}
        // Busy = the same predicate the progress ring uses (active run,
        // generating, or loading), plus an unpersisted temp placeholder whose
        // /preview route has no row yet — "Open in Browser" is disabled then.
        busy={Boolean(selectedNode && (
          runStatus.has(selectedNode.id)
          || selectedNode.meta?.status === 'generating'
          || (selectedNode._loading && !selectedNode._challenge)
          || String(selectedNode.id).startsWith('temp-')
        ))}
        onEditSite={() => selectedSiteNode && handleEditingToggle(selectedSiteNode.id, true)}
        onUpgradeRequired={() => setPlansOpen(true)}
        onFrameChange={(id, patch) => {
          // Same path a drag/resize commit takes: optimistic local update +
          // debounced-enough single PATCH (field commits are discrete).
          const local = {};
          if (patch.posX != null) local.pos_x = patch.posX;
          if (patch.posY != null) local.pos_y = patch.posY;
          if (patch.width != null) local.width = patch.width;
          if (patch.height != null) local.height = patch.height;
          updateNodeLocal(id, local);
          api.updateNode(id, patch).catch(console.warn);
        }}
      />

      <div className="canvas-toolbars-right">
        {/* Floating run button — anchored left of the zoom widget; crossfades in
            when a section's in-place run-pill rises into the top chrome zone. */}
        {SHOW_FLOATING_RUN && floatRunSec && (() => {
          // While running, the button becomes a STOP control — click aborts the
          // section's run and the node drops back to its pre-run state.
          const runFloat = (e) => {
            e.stopPropagation();
            if (floatRunRunning) { stopSection(floatRunSec); return; }
            setSelectedSectionId(floatRunSec.id);
            setSelectedNodeId(null);
            setSelectedNodeIds(new Set());
            runSectionFlow(floatRunSec);
          };
          const floatLabel = floatRunRunning ? 'stop' : (floatRunClean ? 'Reroll' : 'Run this flow');
          const floatAria = floatRunRunning ? 'Stop this flow' : (floatRunClean ? 'Reroll this flow' : 'Run this flow');
          // Structure mirrors the in-section run pill EXACTLY (label + black
          // circular play button) so the two are visually identical.
          return (
            <div
              className={`canvas-floating-run${floatingSection ? ' visible' : ''}${floatRunRunning ? ' running' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={floatAria}
              onClick={runFloat}
            >
              {/* row-reverse: DOM-before-label = visually right of the label. */}
              {!floatRunRunning && floatRunSec.hasEdges && (() => {
                const est = estimateChain(opsFor(floatRunSec));
                return est > 0 ? <span className="canvas-section-est">{CREDIT_COST_ICON}{est}</span> : null;
              })()}
              <span className="canvas-floating-run-label">{floatLabel}</span>
              <button
                type="button"
                className="canvas-floating-run-play"
                onClick={runFloat}
                aria-label={floatAria}
              >
                {floatRunRunning ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="6" width="12" height="12" rx="1.5" />
                  </svg>
                ) : floatRunClean ? (
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
      </div>
      <Minimap
        nodes={nodes}
        transformRef={transformRef}
        frameMode={frameMode}
        hasSelection={!!selectedNodeId}
        onToggleFrame={toggleFrame}
        onSelectNode={(nodeId) => {
          const node = nodes.find((candidate) => candidate.id === nodeId);
          if (!node) return;
          setSelectedSectionId(null);
          setSelectedNodeIds(new Set());
          setSelectedNodeId(nodeId);
          setSelectedEdgeId(null);
          setPopupPos(null);
          zoomToNode(node, 280);
        }}
      />

      <TransformWrapper
        ref={transformRef}
        minScale={editingNodeId ? 0.04 : CANVAS_MIN_SCALE}
        maxScale={CANVAS_MAX_SCALE}
        initialScale={CANVAS_DEFAULT_SCALE}
        initialPositionX={-WORLD_WIDTH * 0.25}
        initialPositionY={-WORLD_HEIGHT * 0.25}
        limitToBounds={false}
        wheel={{ disabled: true }}
        panning={{ disabled: Boolean(editingNodeId) || !spaceDown, excluded: ['cnode', 'cnode-topbar', 'cnode-body', 'cnode-iframe', 'cnode-prompt-textarea', 'cnode-prompt-body', 'cnode-body-prompt', 'cnode-handle', 'cnode-viewport-switcher', 'cnode-vp-btn', 'cnode-port-right', 'cnode-port-left', 'edge-line', 'edge-popup', 'reset-confirm-card', 'reset-confirm-overlay', 'superwidget', 'canvas-toolbar-left', 'canvas-toolbar-right', 'canvas-toolbars-left', 'canvas-toolbars-right', 'canvas-sidebar', 'canvas-topbar', 'canvas-tools', 'canvas-zoomdock', 'canvas-inspector', 'canvas-theme-floater', 'zoom-controls', 'zoom-menu', 'user-menu'] }}
        doubleClick={{ disabled: true }}
        onPanningStart={() => { setSelectedNodeId(null); setSelectedEdgeId(null); setPopupPos(null); }}
        onTransformed={(_ref, state) => {
          // Expose current scale so node chrome (handle/buttons/edges) can stay
          // viewport-readable via inverse-scale in CSS.
          const scale = state.scale || 1;
          lastTransformRef.current = { scale, x: state.positionX || 0, y: state.positionY || 0 };
          if (canvasViewReadyRef.current) {
            clearTimeout(canvasViewSaveTimerRef.current);
            const view = {
              positionX: state.positionX || 0,
              positionY: state.positionY || 0,
              scale: clampCanvasScale(scale),
            };
            canvasViewSaveTimerRef.current = setTimeout(() => {
              try { localStorage.setItem(CANVAS_VIEW_KEY, JSON.stringify(view)); } catch {}
            }, 220);
          }
          // Gesture window: while the transform is actively changing, CSS
          // pauses in-world animations/transitions (see canvas-interacting
          // rules in globals.css). Cleared 180ms after the last tick; the
          // settle callback also lands the EXACT --canvas-scale value and
          // re-anchors the floating run pill (both deferred off the hot
          // path — see the quantized-write note on lastVarScaleRef).
          const html = document.documentElement;
          html.classList.add('canvas-interacting');
          clearTimeout(interactingTimerRef.current);
          interactingTimerRef.current = setTimeout(() => {
            html.classList.remove('canvas-interacting');
            const t = lastTransformRef.current;
            if (t) {
              lastVarScaleRef.current = t.scale;
              html.style.setProperty('--canvas-scale', String(t.scale));
              applyZoomThresholds(html, t.scale);
              // Keep the edge layer in lockstep with the CSS chrome — see
              // useLiveCanvasScale in EdgeLayer.jsx.
              window.dispatchEvent(new CustomEvent('uncraft:canvas-scale', { detail: t.scale }));
              if (Math.abs(t.scale - lastAppliedScaleRef.current) > 0.0005) {
                lastAppliedScaleRef.current = t.scale;
                setCanvasScale(t.scale);
              }
            }
            scheduleReanchorPills();
          }, 180);
          // Quantized var write during the gesture: counter-scaled chrome
          // (borders, ports, pills) drifts at most ~1%/90ms from its ideal
          // constant-screen size mid-motion — imperceptible — instead of
          // forcing a whole-board relayout on every tick.
          {
            const nowT = performance.now();
            const rel = Math.abs(scale - lastVarScaleRef.current) / (lastVarScaleRef.current || 1);
            if (rel > 0.01 && nowT - lastVarWriteTimeRef.current > 90) {
              lastVarScaleRef.current = scale;
              lastVarWriteTimeRef.current = nowT;
              html.style.setProperty('--canvas-scale', String(scale));
              applyZoomThresholds(html, scale);
              // Edge layer moves in the SAME step as the CSS port balls.
              window.dispatchEvent(new CustomEvent('uncraft:canvas-scale', { detail: scale }));
            }
          }
          // Dot-grid backdrop: canvas-drawn OUTSIDE the transform (it must
          // cover the whole viewport at any world coord). Feeding it the
          // transform directly replaces the old --canvas-tx/-ty CSS-var
          // writes, whose background-position/-size mutations repainted the
          // entire viewport gradient on every tick.
          dotGridRef.current?.update(scale, state.positionX || 0, state.positionY || 0);
          // Zoom-threshold chrome classes flip inside the quantized
          // var-write block + at settle (applyZoomThresholds) so class
          // state and --canvas-scale are always mutually consistent.
          // The React scale push (setCanvasScale → re-render of the whole
          // board) and the floating-run reanchor (getBoundingClientRect
          // over every section) BOTH happen only in the settle callback —
          // during the gesture the canvas moves on transform + CSS alone.
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
                className={`canvas-section-frame${(selectedSectionId === s.id || (SHOW_FLOATING_RUN && floatingRunSectionId === s.id)) ? ' selected' : ''}${pv ? ' adopt-preview' : ''}`}
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
            dyingEdges={dyingEdges}
            incomingByTarget={incomingByTarget}
            scale={canvasScale}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={onSelectEdgeStable}
            onEdgeDragStart={onEdgeDragStartStable}
            onSeverEdge={onSeverEdgeStable}
          />
          {nodes.map((n) => (
            <CanvasNodeItem
              key={n.id}
              node={n}
              scale={canvasScale}
              debit={nodeDebits.get(n.id)}
              incomingEdges={incomingByTarget.get(n.id) || EMPTY_EDGES}
              hasOutgoingEdges={hasOutgoingBySource.has(n.id)}
              selected={selectedNodeId === n.id || selectedNodeIds.has(n.id)}
              livePreviewActive={selectedNodeId === n.id}
              placing={placingNodeId === n.id || (altDupGhostIds?.has(n.id) ?? false)}
              editing={editingNodeId === n.id}
              editorKind={editorKindForNode(n)}
              runStatus={runStatus.get(n.id) || null}
              draftActive={!!draftEdge && draftEdge.sourceNodeId !== n.id}
              removing={removing?.nodeId === n.id}
              removingOutside={removing?.nodeId === n.id && removingOutside}
              removeFromMenu={removing?.nodeId === n.id && !!removing.fromMenu}
              inSection={sectionMemberIds.has(n.id)}
              canRunFromHere={runFromHereIds.has(n.id)}
              flowRunning={flowRunningNodeIds.has(n.id)}
              handlersRef={nodeHandlersRef}
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
            // Running → the pill is a STOP control: click aborts the run and
            // the node falls back to its pre-run state.
            const triggerRun = () => { if (sectionRunning) { stopSection(s); return; } runSectionFlow(s); };
            return (
            <div
              key={`chrome-${s.id}`}
              className={`canvas-section-chrome${hoveredSectionId === s.id ? ' sec-hovered' : ''}`}
              data-section-id={s.id}
              style={{
                left: pv ? pv.left : s.x,
                top: pv ? pv.top : s.y,
                width: pv ? pv.right - pv.left : s.width,
                height: pv ? pv.bottom - pv.top : s.height,
              }}
            >
              <div
                className={`canvas-section-name-tag${s.hasEdges ? '' : ' disabled'}${sectionRunning ? ' running' : ''}${SHOW_FLOATING_RUN && floatingRunSectionId === s.id ? ' floated-away' : ''}`}
                role="button"
                tabIndex={0}
                title={s.hasEdges ? `${estimateChain(opsFor(s))} credits` : undefined}
                aria-label={!s.hasEdges ? 'Connect nodes to run this flow' : (sectionRunning ? 'Stop this flow' : (isClean ? 'Reroll this flow' : 'Run this flow'))}
                onClick={(e) => {
                  // Clicking ANYWHERE on the pill runs the flow (not just the
                  // play icon). Also selects the section so its controls show.
                  e.stopPropagation();
                  setSelectedSectionId(s.id);
                  setSelectedNodeId(null);
                  setSelectedNodeIds(new Set());
                  triggerRun();
                }}
                onMouseMove={!s.hasEdges ? (e) => {
                  // Cursor-follow "No connected nodes" hint on the disabled
                  // pill — same transform recipe as the prompt node's
                  // double-click tag (screen-constant, direct DOM writes).
                  const el = e.currentTarget.querySelector('.canvas-noconn-hint');
                  if (!el) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const scale = Math.max(0.4, readCanvasScale());
                  el.style.transform = `translate(${(e.clientX - r.left + 14) / scale}px, ${(e.clientY - r.top + 16) / scale}px) scale(${1 / scale})`;
                } : undefined}
              >
                {/* Run label — becomes "Reroll" once the flow has run and
                    nothing but node positions has changed (isClean). With no
                    edges the flow can't run, so it reads "run this flow" and
                    the whole pill renders disabled (dark grey). */}
                {/* Pre-flight cost — sum of the CONNECTED chain's ops (the
                    terminal reached by edges; loose nodes don't count).
                    NOTE: the pill is flex row-reverse (play circle LEFT),
                    so DOM-before-label renders VISUALLY RIGHT of the label. */}
                {!sectionRunning && s.hasEdges && (() => {
                  const est = estimateChain(opsFor(s));
                  return est > 0 ? <span className="canvas-section-est">{CREDIT_COST_ICON}{est}</span> : null;
                })()}
                <span className="canvas-section-name-label">{sectionRunning ? 'stop' : (s.hasEdges && isClean ? 'Reroll' : 'Run this flow')}</span>
                {/* Play button ALWAYS renders. Without edges it stays visible
                    but disabled — the pill goes dark grey, the play icon light
                    grey — so the affordance never vanishes when nodes get
                    disconnected. */}
                <button
                  type="button"
                  className={`canvas-section-play-btn${s.hasEdges ? '' : ' disabled'}`}
                  onClick={(e) => { e.stopPropagation(); triggerRun(); }}
                  disabled={!s.hasEdges}
                  aria-label={!s.hasEdges ? 'Connect nodes to run this flow' : (sectionRunning ? 'Stop this flow' : (isClean ? 'Reroll this flow' : `Run this flow`))}
                  data-tooltip={!sectionRunning && s.hasEdges && isClean ? 'Reroll — regenerate a fresh result' : undefined}
                >
                  {sectionRunning ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="6" y="6" width="12" height="12" rx="1.5" />
                    </svg>
                  ) : s.hasEdges && isClean ? (
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
                {/* Disabled pill (no cords between members): cursor-follow
                    hint explaining WHY it can't run. */}
                {!s.hasEdges && (
                  <span className="canvas-noconn-hint" aria-hidden="true">No connected nodes</span>
                )}
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
              {/* Edge strips — full-side resize bands (single axis). DOM-
                  before the corner handles and z-index below them, so the
                  diagonal cursors win where they overlap at the corners. */}
              {['n', 's', 'w', 'e'].map((edge) => (
                <div
                  key={edge}
                  className={`canvas-section-edge canvas-section-edge-${edge}`}
                  onMouseDown={(e) => startSectionResize(s.id, edge, e)}
                  aria-hidden="true"
                />
              ))}
              {/* Section layout actions (2026-07-06) — bottom-right icon
                  cluster in the expand-floater visual family. The SE handle
                  ICON was removed so the corner doesn't crowd (the resize
                  hit area itself still works). */}
              <div className="canvas-section-layout-btns" onMouseDown={(e) => e.stopPropagation()}>
                {(() => {
                  const ls = sectionLayoutState.get(s.id) || {};
                  return (<>
                    <button
                      type="button"
                      className={`canvas-section-layout-btn${ls.laidOut ? ' disabled' : ''}`}
                      disabled={!!ls.laidOut}
                      data-tooltip={ls.laidOut ? 'Already auto-laid out' : 'Auto-layout'}
                      aria-label="Auto-layout this section"
                      onClick={(e) => { e.stopPropagation(); if (!ls.laidOut) autoLayoutSection(s); }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="4" width="6" height="7" rx="1.5" />
                        <rect x="15" y="4" width="6" height="7" rx="1.5" />
                        <rect x="9" y="15" width="6" height="6" rx="1.5" />
                        <path d="M6 11v2.5h12V11" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`canvas-section-layout-btn${ls.fitted ? ' disabled' : ''}`}
                      disabled={!!ls.fitted}
                      data-tooltip={ls.fitted ? 'Already fits its content' : 'Fit to content'}
                      aria-label="Fit section frame to its content"
                      onClick={(e) => { e.stopPropagation(); if (!ls.fitted) fitSectionToContent(s); }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="9 3 9 9 3 9" />
                        <polyline points="15 3 15 9 21 9" />
                        <polyline points="9 21 9 15 3 15" />
                        <polyline points="15 21 15 15 21 15" />
                      </svg>
                    </button>
                  </>);
                })()}
              </div>
              {['nw', 'ne', 'sw', 'se'].map((corner) => (
                <div
                  key={corner}
                  className={`canvas-section-handle canvas-section-handle-${corner}`}
                  onMouseDown={(e) => startSectionResize(s.id, corner, e)}
                  aria-hidden="true"
                >
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
          checkClipboard={clipboardHasSupported}
          copyEnabled={!!(selectedNodeId || selectedNodeIds.size)}
          onPickCopy={() => {
            setContextMenu(null);
            // Mesmo caminho do Cmd+C: o payload dos nodes vai para a area de
            // transferencia como texto, e o `paste` do canvas o reconhece.
            const payload = copyFnsRef.current?.buildSelectionClipboardPayload?.();
            if (!payload) { toast.error('Select a node first.'); return; }
            navigator.clipboard?.writeText?.(JSON.stringify(payload))
              .then(() => toast.info(`Copied ${payload.nodes.length} node${payload.nodes.length > 1 ? 's' : ''}.`))
              .catch(() => toast.error("Couldn't reach the clipboard."));
          }}
          onPickPaste={async () => {
            const m = contextMenu;
            setContextMenu(null);
            await pasteFromClipboard({ worldX: m.worldX, worldY: m.worldY });
          }}
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
        onStopFlow={stopFlowRun}
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
                  if (isLiveUrlReference(n)) {
                    return { ...n, _loading: true, _loadingStage: 'checking-embed' };
                  }
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
                if (!snapshot || (!snapshot.html && !snapshot.native_bundle_id)) return;
                setNodes((prev) => prev.map((n) =>
                  n.id === nodeId ? {
                    ...n,
                    current_html: snapshot.html || null,
                    current_screenshot: snapshot.screenshot_url || null,
                    current_snapshot_source: snapshot.source || null,
                    current_native_bundle_id: snapshot.native_bundle_id || null,
                    current_motion_manifest_version: snapshot.motion_manifest_version == null
                      ? null
                      : Number(snapshot.motion_manifest_version),
                  } : n
                ));
              }).catch(() => {});
            }

            // Agent-created URL references use the same zero-choice resolver
            // as pasted URLs. A small in-flight registry prevents repeated
            // graph_mutated events from launching duplicate checks/captures.
            for (const newNode of newNodes) {
              if (!isLiveUrlReference(newNode) || urlResolutionInFlightRef.current.has(newNode.id)) continue;
              urlResolutionInFlightRef.current.add(newNode.id);
              api.checkUrlEmbed(newNode.origin_url)
                .then(async (policy) => {
                  if (policy?.embeddable === false) {
                    await captureBlockedReference({ node: newNode, url: newNode.origin_url });
                  } else {
                    updateNodeLocal(newNode.id, { _loading: false, _loadingStage: undefined });
                  }
                })
                .catch(() => {
                  updateNodeLocal(newNode.id, { _loading: false, _loadingStage: undefined });
                })
                .finally(() => urlResolutionInFlightRef.current.delete(newNode.id));
            }

            // Track every node created across this run so framing can fit
            // the full workflow even if intermediate refetches only saw it
            // piece by piece.
            if (!agentRunNewNodesRef.current) agentRunNewNodesRef.current = new Map();
            for (const n of newNodes) agentRunNewNodesRef.current.set(n.id, n);

            const accumulated = Array.from(agentRunNewNodesRef.current.values());
            if (frame) agentRunNewNodesRef.current = new Map();  // reset at end of run
            if (accumulated.length === 0) return;

            // Chat-created nodes are persisted directly, never handed to the
            // user's cursor as placement ghosts. Mid-run mutations only reveal
            // the work. Camera movement happens ONCE, at run end, so a chain
            // assembles without repeated jumps and then lands as one composed
            // view. A single node uses the standard node-centering frame.
            if (!frame) return;

            // A URL created through chat follows the same contract as one
            // pasted manually: it is visible and browsable as soon as the
            // camera lands. The last URL wins, preserving the one-live-frame
            // performance ceiling when a run creates more than one.
            const newestLiveReference = [...accumulated].reverse().find(isLiveUrlReference);
            if (newestLiveReference) {
              setSelectedNodeId(newestLiveReference.id);
              setSelectedNodeIds((current) => (current.size ? new Set() : current));
              setSelectedEdgeId(null);
              setSelectedSectionId(null);
            }

            setTimeout(() => {
              if (accumulated.length === 1) {
                zoomToNode(accumulated[0], 500);
                return;
              }
              const ins = chromeInsets();
              const camera = frameAgentNodes(accumulated, {
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                insets: ins,
              });
              if (camera) transformRef.current?.setTransform(camera.positionX, camera.positionY, camera.scale, 500);
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
        open={!!insufficientCredits}
        title="Not enough credits"
        message={insufficientCredits ? `This run needs ~${insufficientCredits.estimate} credits — you have ${insufficientCredits.balance}.` : ''}
        confirmLabel="Buy credits"
        cancelLabel="Cancel"
        onConfirm={() => {
          setInsufficientCredits(null);
          setPlansOpen(true);
        }}
        onCancel={() => setInsufficientCredits(null)}
      />
      <PlansModal open={plansOpen} currentPlan={user?.plan} onClose={() => setPlansOpen(false)} />

      <ConfirmModal
        open={!!dropRejects}
        title={dropRejects?.length > 1 ? 'Unsupported files' : 'Unsupported file'}
        message={dropRejects ? formatDropRejectMessage(dropRejects) : ''}
        confirmLabel="OK"
        cancelLabel={null}
        onConfirm={() => setDropRejects(null)}
        onCancel={() => setDropRejects(null)}
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
        message={playSection ? `Re-execute "${playSection.section.name}" with the same inputs. The new result will replace the current one and consumes ≈ ${estimateChain(opsFor(playSection.section))} credits.` : ''}
        confirmLabel="Run"
        cancelLabel="Cancel"
        busy={!!playSection?.busy}
        checkboxLabel="Don't ask again"
        onConfirm={(skipFuture) => handleConfirmPlaySection(skipFuture)}
        onCancel={() => { if (!playSection?.busy) setPlaySection(null); }}
      />

      <ConfirmModal
        open={!!mergeConfirm}
        title="Merge sections?"
        message="The node position will blend different sections. Proceed?"
        confirmLabel="Yes"
        cancelLabel="Cancel"
        onConfirm={() => {
          const mc = mergeConfirm;
          setMergeConfirm(null);
          if (mc) commitEdgeCreate(mc.src, mc.targetId);
        }}
        onCancel={() => setMergeConfirm(null)}
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
    </NativeMotionEditSessionProvider>
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

function CanvasContextMenu({ x, y, onClose, onPickUrl, onPickHtml, onPickMd, onPickScreenshot, onPickPrompt, onPickCode, onPickBlankSite, onPickPaste, onPickCopy, copyEnabled = false, checkClipboard }) {
  const [mode, setMode] = useState('choices');
  const [url, setUrl] = useState('');
  // null = still probing the clipboard; true/false = supported payload present.
  // Stays clickable while probing (the probe is fast and the click re-reads).
  const [pasteEnabled, setPasteEnabled] = useState(null);
  const [menuRef, { left, top }] = useClampedMenuPos(x + 8, y + 8, [mode]);

  useEffect(() => {
    let cancelled = false;
    if (!checkClipboard) { setPasteEnabled(false); return; }
    checkClipboard()
      .then((ok) => { if (!cancelled) setPasteEnabled(!!ok); })
      .catch(() => { if (!cancelled) setPasteEnabled(false); });
    return () => { cancelled = true; };
  }, [checkClipboard]);

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
          {/* Colar nao e' "adicionar ao quadro": e' trazer o que ja esta na
              area de transferencia. Misturado com os "Add ...", a acao some no
              meio de uma lista de coisas para CRIAR. Categoria propria. */}
          <div className="popup-menu-sep" role="separator" />
          <div className="popup-menu-title">Clipboard</div>
          <button
            className="popup-menu-btn"
            onClick={onPickCopy}
            disabled={!copyEnabled}
            title={copyEnabled ? 'Copy the selected nodes' : 'Select a node first'}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
            <span>Copy selection</span>
          </button>
          {/* Enabled only when the clipboard holds a supported payload (an image
              or a URL the async Clipboard API can read). Files like .md/.html
              paste via Cmd+V only. */}
          <button
            className="popup-menu-btn"
            onClick={onPickPaste}
            disabled={pasteEnabled === false}
            title={pasteEnabled === false ? 'No supported content on the clipboard' : 'Paste an image or URL from the clipboard'}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="8" y="2" width="8" height="4" rx="1" />
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            </svg>
            <span>Paste from clipboard</span>
          </button>
          <div className="popup-menu-sep" role="separator" />
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
  // "clone website" (asset only): the image is reproduced as a full site node.
  { key: 'clone',  label: 'clone website', Icon: MenuIcon.Blank, to: { asset: 'clone' } },
  { key: 'prompt', label: 'prompt', Icon: MenuIcon.Prompt, to: { site: 'prompt',   asset: 'prompt' } },
  { key: 'html',   label: '.html',  Icon: MenuIcon.Html,   to: { site: 'html' } },
  // From an asset, .md runs the clone in the background and derives the style
  // spec from it (extract-to 'styleclone'); from a site it's the design.md.
  { key: 'md',     label: '.md',    Icon: MenuIcon.Md,     to: { site: 'designmd', asset: 'styleclone' } },
  { key: 'image',  label: 'image',  Icon: MenuIcon.Image,  to: { site: 'screenshot' } },
];

function EmptyDropMenu({ x, y, sourceKind, onClose, onPick, onExtract }) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [menuRef, { left, top }] = useClampedMenuPos(x + 8, y + 8, [connectOpen]);
  // Normalised source kind for the extract `to` mapping. Extract is the PRIMARY
  // action for site + asset sources (where a generator exists), with Connect-to
  // tucked into a submenu. Other source kinds have no extract → Connect-to stays
  // the primary (and only) list.
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
      {showExtract ? (
        <>
          {/* Extract-to is the PRIMARY action for site/asset sources. */}
          <div className="popup-menu-title">Extract to…</div>
          {EXTRACT_ITEMS.map(({ key, label, Icon, to }) => {
            const target = to[srcKind];
            const disabled = !target;
            return (
              <button
                key={key}
                type="button"
                className="popup-menu-btn"
                disabled={disabled}
                title={disabled ? `Not available from a ${srcKind === 'asset' ? 'image' : srcKind} node` : undefined}
                onClick={disabled ? undefined : () => onExtract?.(target)}
              >
                <Icon /><span>{label}</span>
              </button>
            );
          })}
          {/* Connect-to moves into a submenu. */}
          <div className="empty-drop-extract">
            <button
              type="button"
              className="popup-menu-btn empty-drop-submenu-trigger"
              onMouseEnter={() => setConnectOpen(true)}
              onClick={() => setConnectOpen((v) => !v)}
            >
              <span>Connect to</span>
              <svg className="empty-drop-chevron" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>
            {connectOpen && (
              <div className="empty-drop-submenu" onMouseLeave={() => setConnectOpen(false)}>
                {EMPTY_DROP_ITEMS.map(({ kind, label, Icon }) => (
                  <button key={kind} type="button" className="popup-menu-btn" onClick={() => onPick(kind)}>
                    <Icon /><span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* No extract generator for this source kind → Connect-to stays primary. */}
          <div className="popup-menu-title">Connect to…</div>
          {EMPTY_DROP_ITEMS.map(({ kind, label, Icon }) => (
            <button key={kind} className="popup-menu-btn" onClick={() => onPick(kind)}>
              <Icon /><span>{label}</span>
            </button>
          ))}
        </>
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
