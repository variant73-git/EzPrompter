'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import CanvasEditorCore from './editor/CanvasEditorCore.jsx';
import { nodeOrigin } from '../lib/node-origin.js';
import MdPreviewBody from './node-bodies/MdPreviewBody.jsx';
import PromptBody from './node-bodies/PromptBody.jsx';
import SkillBody from './node-bodies/SkillBody.jsx';

const DRAG_THRESHOLD = 4;

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
);

const ResetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7"/>
    <path d="M3 4v5h5"/>
  </svg>
);

// Globe icon — same shape as the "Add URL" pill in PromptDock so the
// "site" tag visually echoes the host shell's URL affordance.
const GlobeIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>
    <path d="M12 3a13 13 0 0 1 4 9 13 13 0 0 1-4 9 13 13 0 0 1-4-9 13 13 0 0 1 4-9z"/>
  </svg>
);

// Per-origin glyph used by the anchored zoom-out title. Each is sized at
// 11px so it sits flush with the wordmark inside `.cnode-anchor-title`.
const HtmlIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>
    <path d="M14 3v5h5"/><path d="m9 14-1.5 2L9 18"/><path d="m13.5 14 1.5 2-1.5 2"/>
  </svg>
);
const MdIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10 1.66 0 3-1.34 3-3 0-.78-.29-1.49-.78-2.04-.17-.19-.32-.41-.32-.66 0-.55.45-1 1-1H17c2.76 0 5-2.24 5-5 0-4.98-4.48-9-10-9z"/>
    <circle cx="6.5"  cy="11.5" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="9.5"  cy="7.5"  r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="14.5" cy="7.5"  r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="17.5" cy="11.5" r="1.2" fill="currentColor" stroke="none"/>
  </svg>
);
const ScreenshotIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2"/>
    <circle cx="9" cy="10.5" r="1.5"/><path d="m21 16-5-5L5 19"/>
  </svg>
);
const PromptIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    <path d="M8 10h8M8 13h5"/>
  </svg>
);
const SkillIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3 2.5 5 5.5.8-4 3.9.95 5.5L12 15.6 7.05 18.2 8 12.7 4 8.8 9.5 8z"/>
  </svg>
);

const ORIGIN_ICON = {
  url: GlobeIcon,
  html: HtmlIcon,
  md: MdIcon,
  screenshot: ScreenshotIcon,
  prompt: PromptIcon,
  skill: SkillIcon
};

const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

// Capture the iframe's current document as a clean HTML string — strips
// editor-only markers so the saved snapshot doesn't carry stale data-rb-*
// attributes or rb-ed-* classes from the previous edit session. The next
// edit re-tags from scratch via rebuild.js so dropping these is safe.
// Tiny inline component for asset-kind nodes. Falls back to the
// /api/proxy/image route on first load error (hotlink-protected hosts
// that refuse cross-origin GETs from the canvas) and finally to a
// clean placeholder card if the proxy can't recover it either.
function AssetNodeImage({ dataUrl, name }) {
  const [src, setSrc] = useState(dataUrl);
  const [phase, setPhase] = useState('loading'); // loading | ok | proxy | broken
  // dataUrl can change when the node row is updated; resync.
  useEffect(() => {
    setSrc(dataUrl);
    setPhase('loading');
  }, [dataUrl]);

  function onError() {
    if (phase === 'loading' && src && !/^data:/.test(src)) {
      setSrc('/api/proxy/image?url=' + encodeURIComponent(src));
      setPhase('proxy');
      return;
    }
    setPhase('broken');
  }
  function onLoad() {
    setPhase((p) => (p === 'broken' ? p : 'ok'));
  }

  if (phase === 'broken') {
    return (
      <div className="cnode-asset-broken" aria-label={name}>
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="9" cy="9" r="2"/>
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
        </svg>
        <span>Image unavailable</span>
      </div>
    );
  }
  return (
    <img
      className="cnode-asset-img"
      src={src}
      alt={name}
      draggable={false}
      onError={onError}
      onLoad={onLoad}
    />
  );
}

function captureCleanHtml(iframe) {
  const doc = iframe?.contentDocument;
  if (!doc?.documentElement) return null;
  const clone = doc.documentElement.cloneNode(true);
  clone.querySelectorAll('[data-rb-node]').forEach((el) => el.removeAttribute('data-rb-node'));
  clone.querySelectorAll('[data-rb-editing]').forEach((el) => el.removeAttribute('data-rb-editing'));
  clone.querySelectorAll('.rb-ed-movable, .rb-ed-text-hint').forEach((el) => {
    el.classList.remove('rb-ed-movable', 'rb-ed-text-hint');
  });
  const body = clone.querySelector('body');
  if (body) body.classList.remove('rb-ed-active');
  clone.querySelectorAll('#rb-hover-kill, #rb-override-sheet, #rb-cursor-style').forEach((el) => el.remove());
  return '<!DOCTYPE html>\n' + clone.outerHTML;
}

const DownloadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const DuplicateIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const MoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5"/>
    <circle cx="7"  cy="12" r="0.7" fill="currentColor"/>
    <circle cx="12" cy="12" r="0.7" fill="currentColor"/>
    <circle cx="17" cy="12" r="0.7" fill="currentColor"/>
  </svg>
);

const ExpandIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 3 21 3 21 9"/>
    <polyline points="9 21 3 21 3 15"/>
    <line x1="21" y1="3" x2="14" y2="10"/>
    <line x1="3" y1="21" x2="10" y2="14"/>
  </svg>
);

const CollapseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="4 14 10 14 10 20"/>
    <polyline points="20 10 14 10 14 4"/>
    <line x1="14" y1="10" x2="21" y2="3"/>
    <line x1="3" y1="21" x2="10" y2="14"/>
  </svg>
);

const VIEWPORTS = [
  { id: 'mobile',  label: 'Mobile',  width: 390,  icon: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/>
    </svg>
  )},
  { id: 'tablet',  label: 'Tablet',  width: 768,  icon: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/>
    </svg>
  )},
  { id: 'desktop', label: 'Desktop', width: 1280, icon: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="13" rx="2"/><line x1="9" y1="21" x2="15" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  )}
];

function activeViewportId(width) {
  let best = null, bestDiff = Infinity;
  for (const v of VIEWPORTS) {
    const diff = Math.abs(v.width - width);
    if (diff < bestDiff && diff <= 24) { best = v.id; bestDiff = diff; }
  }
  return best;
}

export default function CanvasNode({
  node, selected, editing = false, onEditingChange,
  onSelect, onMove, onResize, onDelete, onReset, onSaveEdit, onDiscardEdit,
  onDuplicate, onDownload,
  onStartEdge, onSlotMouseDown, onPromptTextChange,
  incomingEdges = [], draftActive, runStatus = null
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [menuPos, setMenuPos] = useState(null); // {x, y} for topbar context menu
  // Cancel-with-unsaved-edits prompt. Shown when user clicks Cancel from
  // edit mode; offers Save / Discard / Continue editing.
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const iframeRef = useRef(null);
  // Wrapper + right-port refs for the cursor-follows-port behaviour
  // (mousemove over the node slides the emitter ball up/down the right
  // edge so it sits at the cursor's Y — short reach to drag a cord
  // toward whatever you're aiming at).
  const cnodeRef = useRef(null);
  const portRightRef = useRef(null);
  const [editorBusy, setEditorBusy] = useState(false);
  // Captures iframe scrollWidth/scrollHeight on load — used by Expand to
  // grow the viewport to fit full content without an extra DOM read.
  const contentSizeRef = useRef({ w: null, h: null });
  // Pre-expand size memory: lets the toggle restore the user's chosen
  // viewport height when collapsing. Defaults to current node h on
  // first toggle so an instant expand→collapse round-trips correctly.
  const preExpandRef = useRef({ w: null, h: null });
  const [isExpanded, setIsExpanded] = useState(false);

  // Save the current iframe state as a snapshot, then exit edit mode.
  // Used by the Done button and by "Save and exit" inside the cancel
  // prompt. We capture BEFORE unmounting the editor — the editor's
  // teardown is async (50ms StrictMode grace), so capturing first gives
  // us the user's edits while the iframe DOM is still authoritative.
  async function saveAndExit() {
    if (!onSaveEdit || !iframeRef.current) {
      onEditingChange?.(false);
      return;
    }
    setEditorBusy(true);
    try {
      const html = captureCleanHtml(iframeRef.current);
      if (html) await onSaveEdit(html);
    } catch (e) {
      console.warn('save-edit failed', e);
      alert(`Save failed: ${e.message || e}`);
      setEditorBusy(false);
      return;
    }
    onEditingChange?.(false);
    // Editor unmounts asynchronously; clear the busy spinner once the
    // editing flag flips back via the parent prop.
  }

  // Discard: exit edit mode WITHOUT saving, then ask the parent to bump
  // _resetTick so the iframe remounts with the unmodified server html.
  async function discardAndExit() {
    onEditingChange?.(false);
    // Wait one tick so the editor unmounts before we yank the iframe — same
    // 120ms grace ResetConfirm uses to avoid a stale targetDoc reference.
    await new Promise((r) => setTimeout(r, 120));
    onDiscardEdit?.();
  }

  // Read full content size from the iframe — first try the cached value
  // that onIframeLoad stamped, fall back to measuring fresh. The load
  // handler can miss the capture if the iframe rendered before the
  // useCallback dep changed (StrictMode + hot-reload). This also covers
  // the case where the user clicks Expand the very first time before
  // any sizing was recorded.
  function readContentSize() {
    let cs = contentSizeRef.current;
    if (cs?.w && cs?.h) return cs;
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc?.documentElement) {
        const w = Math.min(
          Math.max(doc.documentElement.scrollWidth, doc.body?.scrollWidth || 0, node.width || 1280),
          4000
        );
        const h = Math.min(
          Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0, 800),
          12000
        );
        if (w > 0 && h > 0) {
          cs = { w, h };
          contentSizeRef.current = cs;
          return cs;
        }
      }
    } catch (e) { /* cross-origin */ }
    return null;
  }

  // Expand toggle — grow the body to fit the full iframe content
  // (scrollWidth × scrollHeight) on first click, restore the
  // previously-known size on second click. The `cascade: true` flag
  // tells the parent to push overlapping neighbours out (donors→left,
  // receivers→right). Collapse never cascades — shrinking can't create
  // new overlap.
  function handleExpandToggle() {
    if (!isExpanded) {
      const cs = readContentSize();
      if (!cs) return;
      preExpandRef.current = { w: node.width, h: node.height };
      onResize?.(cs.w, cs.h, { cascade: true });
      setIsExpanded(true);
    } else {
      const pe = preExpandRef.current;
      const w = pe?.w || node.width;
      const h = pe?.h || Math.round((node.width || 1280) * 9 / 16);
      onResize?.(w, h);
      setIsExpanded(false);
    }
  }

  // Dash-handle resize — vertical drag on the bottom edge adjusts node
  // height, horizontal drag on the right edge adjusts node width. Both
  // commit live during drag (parent debounces persistence). Scale-aware
  // so the displacement matches cursor movement at any canvas zoom.
  const startDashResize = useCallback((axis) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    const readScale = () => {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale'));
      return v > 0 ? v : 1;
    };
    const start = {
      x: e.clientX, y: e.clientY,
      w: node.width || 1280,
      h: node.height || 800
    };
    function move(ev) {
      const scale = readScale();
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      const nextW = axis === 'x' ? Math.max(280, start.w + dx) : start.w;
      const nextH = axis === 'y' ? Math.max(120, start.h + dy) : start.h;
      onResize?.(nextW, nextH);
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      // Manual resize means the user moved away from the
      // "expanded" state — drop the toggle so the icon flips back
      // to Expand.
      setIsExpanded(false);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [node.width, node.height, onResize]);

  // Cursor-tracks-port — slide the right emitter ball up/down along
  // the right edge so it sits at the cursor's Y over the node. Cuts
  // the reach needed to grab a cord (especially on tall expanded nodes).
  // Disabled in edit mode (port is non-interactive then) and skipped
  // while the cursor is over the port itself (so the hover scale-up +
  // click target stay stable when the user reaches for it).
  // Direct DOM writes (no React state) — mousemove fires 60+ Hz and a
  // re-render per frame would tank perf.
  //
  // Advisory values (draftActive, node.height) live in a ref synced
  // every render. Keeps the effect's dep array stable at [editing] so
  // toggling draft state / resizing the node doesn't detach+reattach
  // the listener — and so future edits don't trip React's "dep array
  // size changed" HMR error.
  const cursorTrackAdvisory = useRef({ draftActive, height: node.height });
  cursorTrackAdvisory.current = { draftActive, height: node.height };
  useEffect(() => {
    const cnode = cnodeRef.current;
    const port = portRightRef.current;
    if (!cnode || !port || editing) return;

    function readScale() {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale'));
      return v > 0 ? v : 1;
    }
    function onMove(e) {
      const { draftActive: isDrafting, height } = cursorTrackAdvisory.current;
      // While a draft cord is being drawn FROM this node, freezing the
      // port keeps the cord origin stable — moving it mid-drag would
      // make the line whip around as the user moves the mouse.
      if (isDrafting) return;
      // Hands off while cursor is over the port — let CSS hover take over.
      if (e.target === port || port.contains(e.target)) return;
      const rect = cnode.getBoundingClientRect();
      const scale = readScale();
      // Screen → node-local CSS coords (.cnode children live in the
      // pre-scale space; only the canvas wrapper applies the transform).
      const localY = (e.clientY - rect.top) / scale;
      // Clamp inside the node body with a small margin so the port can't
      // slide outside the visible card edges.
      const margin = 14;
      const clamped = Math.max(margin, Math.min((height || 800) - margin, localY));
      port.style.top = `${clamped}px`;
    }
    function onLeave() {
      // Clearing the inline `top` restores the CSS default (50%).
      port.style.top = '';
    }
    cnode.addEventListener('mousemove', onMove);
    cnode.addEventListener('mouseleave', onLeave);
    return () => {
      cnode.removeEventListener('mousemove', onMove);
      cnode.removeEventListener('mouseleave', onLeave);
      port.style.top = '';
    };
  }, [editing]);

  // Close the topbar context menu on Esc / click outside.
  useEffect(() => {
    if (!menuPos) return;
    function onDown(e) {
      if (!e.target?.closest?.('.cnode-topbar-menu')) setMenuPos(null);
    }
    function onKey(e) { if (e.key === 'Escape') setMenuPos(null); }
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuPos]);

  const onTopbarMouseDown = useCallback((e) => {
    if (e.target?.closest?.('button')) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    // Pos lives in world coords, but mouse moves in screen coords. At
    // canvas scale 0.5, moving the mouse 1px must shift the node by 2px in
    // world space, otherwise the node lags behind the cursor.
    const readScale = () => {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale'));
      return v > 0 ? v : 1;
    };
    const start = { x: e.clientX, y: e.clientY, ox: node.pos_x, oy: node.pos_y, moved: false };
    function move(ev) {
      const scale = readScale();
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      if (!start.moved && Math.hypot(dx, dy) * scale < DRAG_THRESHOLD) return;
      start.moved = true;
      onMove(start.ox + dx, start.oy + dy);
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [node.pos_x, node.pos_y, onMove, onSelect]);

  const onBodyMouseDown = useCallback((e) => {
    if (editing) return;
    if (e.target?.closest?.('.cnode-topbar')) return;
    if (e.target?.closest?.('.cnode-port-right')) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const start = { x: e.clientX, y: e.clientY, started: false };
    function move(ev) {
      if (start.started) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      start.started = true;
      onStartEdge(ev);
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [editing, onStartEdge, onSelect]);

  const onPortMouseDown = useCallback((e, side = 'right') => {
    if (editing) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    // Side tells the canvas WHICH port spawned the cord. The draft path
    // anchors to that port instead of always assuming right.
    onStartEdge(e, side);
  }, [editing, onStartEdge, onSelect]);

  // Capture the iframe content's natural size so the Expand button can
  // grow the viewport to fit the whole site without re-measuring on
  // click. Also clamps to a sane upper bound — sites that report
  // 50000px scrollHeight (sticky parallax, infinite-scroll mocks)
  // would push the canvas off-screen otherwise.
  const onIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) return;
      const h = Math.min(
        Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0, 800),
        12000
      );
      const w = Math.min(
        Math.max(doc.documentElement.scrollWidth, doc.body?.scrollWidth || 0, node.width || 1280),
        4000
      );
      contentSizeRef.current = { w, h };
    } catch (e) { /* cross-origin */ }
  }, [node.width]);

  const html = node.current_html;
  const kindLabel =
    node.kind === 'site' ? 'site' :
    node.kind === 'template' ? 'template' :
    node.kind === 'designmd' ? 'design.md' :
    node.kind === 'prompt' ? 'prompt' :
    node.kind === 'skill' ? 'skill' :
    (node.kind === 'asset' || node.kind === 'image') ? 'screenshot / asset' :
    'chunk';
  const title = node.origin_url || node.meta?.name || node.template_slug || 'untitled';
  const hasEdits = !!(node.current_snapshot_id && node.original_snapshot_id && node.current_snapshot_id !== node.original_snapshot_id);
  const activeVp = activeViewportId(node.width);
  // Below ~520px even at 1× zoom the topbar can't fit pill + title +
  // 3 buttons + grip without overlap. Collapse non-essentials.
  const narrowTopbar = (node.width || 0) < 520;

  // Body switches on kind — site/template/chunk render the iframe path
  // (existing). designmd/prompt/skill render bespoke bodies and don't
  // need the iframe at all.
  const renderIframeBody = node.kind === 'site' || node.kind === 'template' || node.kind === 'chunk';
  const renderMdBody = node.kind === 'designmd';
  const renderPromptBody = node.kind === 'prompt';
  const renderSkillBody = node.kind === 'skill';
  const renderAssetBody = node.kind === 'asset' || node.kind === 'image';

  // Wheel routing when the mouse is over the iframe (edit-mode only — in
  // rest mode the iframe has pointer-events:none so wheel hits .cnode-body
  // in the host doc and the canvas-level capture handler takes it).
  //   • plain wheel → pan canvas (deltaX/deltaY in screen px). Same Figma
  //     feel everywhere, including over the captured site.
  //   • Cmd/Ctrl + wheel → cursor-anchored canvas zoom. Iframe-local
  //     coords (e.clientX/Y) are translated to host viewport coords via
  //     the iframe's bounding rect.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let doc = null;
    let handler = null;
    function detach() {
      try {
        if (doc && doc._uncraftWheel) {
          doc.removeEventListener('wheel', doc._uncraftWheel, { capture: true });
          delete doc._uncraftWheel;
        }
      } catch (err) {}
    }
    function attach() {
      try {
        doc = iframe.contentDocument;
        if (!doc) return;
        if (doc._uncraftWheel) {
          try { doc.removeEventListener('wheel', doc._uncraftWheel, { capture: true }); } catch (err) {}
        }
        handler = (e) => {
          const z = window.__uncraftZoom;
          if (!z) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.metaKey || e.ctrlKey) {
            const rect = iframe.getBoundingClientRect();
            const s = z.getScale ? z.getScale() : 1;
            const cx = rect.left + (e.clientX || 0) * s;
            const cy = rect.top + (e.clientY || 0) * s;
            z.zoomAtPoint?.(e.deltaY || 0, cx, cy);
          } else {
            z.panBy?.(-(e.deltaX || 0), -(e.deltaY || 0));
          }
        };
        doc._uncraftWheel = handler;
        doc.addEventListener('wheel', handler, { passive: false, capture: true });
      } catch (err) { /* cross-origin / not ready */ }
    }
    attach();
    iframe.addEventListener('load', attach);
    return () => {
      iframe.removeEventListener('load', attach);
      detach();
    };
  }, [editing, html]);

  // Editor mounts via <CanvasEditorCore> below — host=parent, target=iframe.
  useEffect(() => {
    if (!editing) setEditorBusy(false);
  }, [editing]);

  const origin = nodeOrigin(node);
  const KindIcon = ORIGIN_ICON[origin] || null;

  return (
    <div
      ref={cnodeRef}
      className={`cnode origin-${origin}${selected ? ' selected' : ''}${node.is_main ? ' is-main' : ''}${editing ? ' editing' : ''}${narrowTopbar ? ' narrow' : ''}`}
      style={{ left: node.pos_x, top: node.pos_y, width: node.width }}
      data-node-id={node.id}
    >
      {/* Anchored title — only visible when the canvas is zoomed-out enough
          that the topbar collapses (`body.canvas-zoom-low`). Sits above the
          node at top-left so the user can still tell what each node is. */}
      <div className="cnode-anchor-title" aria-hidden={!selected}>
        {KindIcon && <KindIcon />}
        <span className="cnode-anchor-title-text">{title}</span>
      </div>

      {/* Run-flow status chip — appears below the node while a target is
          being processed. Drives a 3-step animation so the user knows
          the system is alive during the long LLM call. */}
      {runStatus && (
        <div className="cnode-run-status" aria-live="polite">
          <svg className="cnode-run-spin" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" opacity="0.25"/>
            <path d="M21 12a9 9 0 0 1-9 9"/>
          </svg>
          <span className="cnode-run-step">{runStatus.step}/3</span>
          <span className="cnode-run-label">{runStatus.label}</span>
        </div>
      )}
      {selected && onResize && node.kind === 'site' && (
        <div
          className={`cnode-viewport-switcher${editing ? ' disabled' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
          title={editing ? 'disabled on edit mode' : undefined}
        >
          {VIEWPORTS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`cnode-vp-btn${activeVp === v.id ? ' active' : ''}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                if (editing) return;
                e.stopPropagation();
                onResize(v.width);
              }}
              disabled={editing}
              title={editing ? 'disabled on edit mode' : `${v.label} — ${v.width}px`}
              aria-label={`Resize to ${v.label} (${v.width}px)`}
            >
              {v.icon}
            </button>
          ))}
        </div>
      )}
      <div
        className="cnode-topbar"
        onMouseDown={onTopbarMouseDown}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuPos({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="topbar-left">
          <span className={`kind-pill kind-${kindLabel === 'site' ? 'site' : 'other'}`}>
            {KindIcon && <KindIcon />}
            <span className="kind-pill-lbl">{kindLabel}</span>
          </span>
          {node.kind !== 'prompt' && (
            <span className="title" title={title}>{title}</span>
          )}
        </div>
        <div className="topbar-grip" aria-hidden>
          <span /><span /><span /><span /><span /><span />
          <span /><span /><span /><span /><span /><span />
        </div>
        <div className="topbar-right">
          {renderIframeBody && html && editing && (
            <button
              className="btn-cancel"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (editorBusy) return;
                setShowCancelPrompt(true);
              }}
              title="Cancel — exit edit mode (you'll be asked to save)"
              aria-label="Cancel edit"
              disabled={editorBusy}
            >
              <CloseIcon />
              <span className="btn-edit-lbl">Cancel</span>
            </button>
          )}
          {renderIframeBody && html && (
            <button
              className={editing ? 'btn-edit active' : 'btn-edit'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (editorBusy) return;
                if (editing) saveAndExit();
                else onEditingChange?.(true);
              }}
              title={editing ? 'Save and exit edit mode' : 'Open editor (layers + inspector + guides)'}
              disabled={editorBusy}
            >
              {editing ? <CheckIcon /> : <EditIcon />}
              <span className="btn-edit-lbl">{editing ? (editorBusy ? 'Saving…' : 'Done') : 'Edit'}</span>
            </button>
          )}
          {/* Vertical separator that fills the topbar's full vertical
              extent — visually splits the primary action (Edit/Done)
              from the More dropdown. */}
          <span className="topbar-sep" aria-hidden="true" />
          <button
            className="btn-more"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setMenuPos({ x: r.right + 6, y: r.top });
            }}
            title="More actions"
            aria-label="Open node actions menu"
          >
            <MoreIcon />
          </button>
        </div>
      </div>
      {node._loading ? (
        <div className={`cnode-loading${node._challenge ? ' cnode-loading-challenge' : ''}`}>
          {node._challenge ? (
            // Shield icon — same family as the ChallengeModal, signals
            // "this is paused waiting for human verification" rather
            // than "we're working on it"; spinner would be misleading.
            <svg className="cnode-loading-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
          ) : (
            <div className="cnode-spinner" />
          )}
          <span>{node._loadingLabel || (node.kind === 'site' ? 'Capturing…' : 'Loading…')}</span>
        </div>
      ) : renderIframeBody ? (
        html ? (
          <div
            className="cnode-body"
            onMouseDown={onBodyMouseDown}
            onDoubleClick={(e) => {
              if (editing) return;
              e.stopPropagation();
              onEditingChange?.(true);
            }}
            style={{ height: (node.height || 800) + 'px' }}
          >
            <iframe
              key={node._resetTick || 0}
              ref={iframeRef}
              className="cnode-iframe"
              title={title}
              srcDoc={html}
              sandbox="allow-same-origin allow-scripts"
              onLoad={onIframeLoad}
              style={{
                pointerEvents: editing ? 'auto' : 'none',
                height: '100%'
              }}
            />
            {/* Dash resize handles — bottom drags height, right drags
                width. Visible as a thin centred bar; the surrounding
                hit area is wider so the user doesn't have to aim.
                Only rendered for site/html iframe nodes — md/prompt/
                skill bodies size themselves to their own content. */}
            <button
              type="button"
              className="cnode-resize-dash cnode-resize-dash-bottom"
              onMouseDown={startDashResize('y')}
              title="Drag to resize viewport height"
              aria-label="Resize node height"
            />
            <button
              type="button"
              className="cnode-resize-dash cnode-resize-dash-right"
              onMouseDown={startDashResize('x')}
              title="Drag to resize viewport width"
              aria-label="Resize node width"
            />
            {/* Expand/Collapse floater — sits at the bottom-right of the
                viewport. Toggles between hero proportion and full
                content size. Lives inside .cnode-body so it inherits
                the body's clip and stays anchored to the bottom-right
                even when the user resizes via dash handles. */}
            <button
              type="button"
              className="cnode-expand-float"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); handleExpandToggle(); }}
              title={isExpanded ? 'Collapse to default viewport' : 'Expand viewport to fit full content'}
              aria-label={isExpanded ? 'Collapse viewport' : 'Expand viewport to full content'}
            >
              {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          </div>
        ) : (
          <div className="cnode-loading">
            <div className="cnode-spinner" />
            <span>Loading…</span>
          </div>
        )
      ) : renderMdBody ? (
        <div className="cnode-body cnode-body-md" onMouseDown={onBodyMouseDown}>
          <MdPreviewBody node={node} />
        </div>
      ) : renderPromptBody ? (
        <div className="cnode-body cnode-body-prompt" onMouseDown={onBodyMouseDown}>
          <PromptBody
            node={node}
            onChange={(value) => onPromptTextChange?.(value)}
          />
        </div>
      ) : renderSkillBody ? (
        <div className="cnode-body cnode-body-skill" onMouseDown={onBodyMouseDown}>
          <SkillBody node={node} />
        </div>
      ) : renderAssetBody ? (
        <div
          className="cnode-body cnode-body-asset"
          onMouseDown={onBodyMouseDown}
          style={{ height: (node.height || 600) + 'px' }}
        >
          {node.meta?.dataUrl ? (
            <AssetNodeImage
              dataUrl={node.meta.dataUrl}
              name={node.meta?.name || 'asset'}
            />
          ) : (
            <div className="cnode-loading"><span>No image data</span></div>
          )}
        </div>
      ) : null}
      <>
        {/* Left side = receiver. Stack of circles, one per incoming edge.
            Empty default = single white circle. Each connected circle takes
            the colour of its emitter. New connections append a new circle
            below the existing stack. */}
        <div
          className={`cnode-port-stack cnode-port-stack-left${editing ? ' disabled' : ''}`}
          aria-hidden={editing}
        >
          {(incomingEdges.length === 0 ? [null] : incomingEdges).map((inc, i) => {
            const isPlaceholder = inc === null;
            return (
              <button
                key={isPlaceholder ? '__default' : inc.edgeId}
                type="button"
                className={`cnode-port-left${editing ? ' disabled' : ''}${isPlaceholder ? ' is-empty' : ''}`}
                // Outline (border) inherits the receiver's --cnode-port-fill
                // (the node's own origin colour). Inner dot picks up the
                // source's colour via --port-source-colour set inline.
                style={isPlaceholder ? undefined : { '--port-source-colour': inc.sourceColor }}
                onMouseDown={editing ? undefined : (e) => {
                  // Empty placeholder → start a NEW outgoing draft from
                  // this node. Populated slot → click selects the edge,
                  // drag past threshold reroutes (drop on empty = disconnect).
                  if (isPlaceholder) {
                    onPortMouseDown(e, 'left');
                  } else if (onSlotMouseDown) {
                    onSlotMouseDown(inc.edgeId, e);
                  }
                }}
                disabled={editing}
                title={editing ? 'disabled on edit mode' : (isPlaceholder ? 'Drop a connection here' : 'Click to select, drag to disconnect')}
                aria-label={isPlaceholder ? 'Receive a connection' : 'Connection slot — click to select, drag to disconnect'}
              >
                <span className="cnode-port-dot" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <button
          ref={portRightRef}
          type="button"
          className={`cnode-port-right${editing ? ' disabled' : ''}`}
          onMouseDown={editing ? undefined : (e) => onPortMouseDown(e, 'right')}
          disabled={editing}
          title={editing ? 'disabled on edit mode' : 'Drag to connect'}
          aria-label="Drag to connect (right)"
        >
          <span className="cnode-port-dot" aria-hidden="true" />
        </button>
      </>
      {editing && iframeRef.current && (
        <CanvasEditorCore
          iframe={iframeRef.current}
          node={node}
          boardId={node.board_id}
          onExit={() => onEditingChange?.(false)}
          onSnapshotSaved={() => { /* optional: refresh state */ }}
        />
      )}

      {showCancelPrompt && (
        <CancelEditPrompt
          name={title}
          busy={editorBusy}
          onContinue={() => setShowCancelPrompt(false)}
          onDiscard={async () => {
            setShowCancelPrompt(false);
            await discardAndExit();
          }}
          onSave={async () => {
            setShowCancelPrompt(false);
            await saveAndExit();
          }}
        />
      )}

      {showResetConfirm && (
        <ResetConfirm
          name={title}
          editing={editing}
          busy={resetting}
          onCancel={() => !resetting && setShowResetConfirm(false)}
          onConfirm={async () => {
            if (!onReset) { setShowResetConfirm(false); return; }
            setResetting(true);
            try {
              // Resetting swaps the iframe srcDoc → contentDocument is
              // replaced. The editor caches targetDoc at boot, so we must
              // exit edit mode FIRST so the editor tears down its
              // listeners cleanly. Wait a tick for unmount + the
              // 50ms-deferred teardown to complete before swapping.
              if (editing) {
                onEditingChange?.(false);
                await new Promise((r) => setTimeout(r, 120));
              }
              await onReset();
              setShowResetConfirm(false);
            } finally {
              setResetting(false);
            }
          }}
        />
      )}

      {/* Portal to document.body so the menu's `position: fixed`
          actually anchors to the viewport. CanvasNode lives inside
          TransformWrapper which applies `transform: scale(N)` — any
          fixed-positioned descendant gets reinterpreted as absolute
          relative to that transformed ancestor and is wrongly scaled +
          mispositioned. The portal escapes the transform. */}
      {menuPos && typeof document !== 'undefined' && createPortal(
        <TopbarContextMenu
          x={menuPos.x}
          y={menuPos.y}
          canEdit={renderIframeBody && !!html}
          canReset={renderIframeBody && !!html && hasEdits}
          editing={editing}
          onEdit={() => { setMenuPos(null); onEditingChange?.(!editing); }}
          onDuplicate={() => { setMenuPos(null); onDuplicate?.(); }}
          onDownload={() => { setMenuPos(null); onDownload?.(); }}
          onReset={() => { setMenuPos(null); setShowResetConfirm(true); }}
          onDelete={() => { setMenuPos(null); if (confirm('Delete this node?')) onDelete(); }}
          onClose={() => setMenuPos(null)}
        />,
        document.body
      )}
    </div>
  );
}

function TopbarContextMenu({ x, y, canEdit, canReset, editing, onEdit, onDuplicate, onDownload, onReset, onDelete, onClose }) {
  // Clamp to viewport so the menu stays fully visible. Width matches
  // .empty-drop-menu (260px) so this reads as the same family of menu.
  const W = 260, H_EST = 240;
  const left = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 1280) - W - 8);
  const top = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 800) - H_EST - 8);
  // Reuse the .empty-drop-menu class so the topbar menu inherits the
  // same padding, radius, item shape, and hover behaviour as the
  // canvas right-click menu. .cnode-topbar-menu adds the danger
  // (Delete) variant.
  return (
    <div
      className="empty-drop-menu cnode-topbar-menu"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {canEdit && (
        <button onClick={onEdit}>
          {editing ? <CheckIcon /> : <EditIcon />}
          <span>{editing ? 'Done' : 'Edit'}</span>
        </button>
      )}
      <button onClick={onDuplicate}>
        <DuplicateIcon />
        <span>Duplicate</span>
      </button>
      <button onClick={onDownload}>
        <DownloadIcon />
        <span>Download</span>
      </button>
      {canReset && (
        <button onClick={onReset}>
          <ResetIcon />
          <span>Restore original</span>
        </button>
      )}
      <button className="cnode-topbar-menu-danger" onClick={onDelete}>
        <TrashIcon />
        <span>Delete</span>
      </button>
    </div>
  );
}

function CancelEditPrompt({ busy, onContinue, onDiscard, onSave }) {
  const cardRef = useRef(null);
  // Esc and any click landing outside the card both dismiss the prompt
  // back to editing — same outcome as the explicit X. Capture-phase so we
  // run before global click handlers that might select/move nodes.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onContinue(); }
    function onDown(e) {
      if (busy) return;
      if (cardRef.current && !cardRef.current.contains(e.target)) onContinue();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [busy, onContinue]);

  return (
    <div className="reset-confirm-overlay">
      <div
        ref={cardRef}
        className="popup-card popup-card-anchored cancel-edit-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-edit-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="popup-close-btn cancel-edit-close"
          onClick={onContinue}
          disabled={busy}
          aria-label="Continue editing"
          title="Continue editing"
        >
          <CloseIcon />
        </button>
        <h3 id="cancel-edit-title" className="popup-title">
          <span className="popup-serif"><i>Save</i></span> before exiting?
        </h3>
        <div className="popup-actions popup-actions-center">
          <button type="button" className="popup-btn popup-btn-danger" onClick={onDiscard} disabled={busy}>
            Discard
          </button>
          <button type="button" className="popup-btn popup-btn-primary" onClick={onSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save and exit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetConfirm({ name, editing, busy, onCancel, onConfirm }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key === 'Enter' && !busy) onConfirm();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel, onConfirm]);

  return (
    <div className="reset-confirm-overlay" onMouseDown={(e) => e.stopPropagation()}>
      <div
        className="popup-card popup-card-anchored"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-confirm-title"
      >
        <h3 id="reset-confirm-title" className="popup-title">
          <span className="popup-serif"><i>Reset</i></span> to original?
        </h3>
        <p className="popup-text">
          This discards all edits to <strong>{name || 'this site'}</strong> and
          restores the first capture. This action cannot be undone.
          {editing ? <><br/><span style={{opacity:0.7}}>Edit mode will close first.</span></> : null}
        </p>
        <div className="popup-actions popup-actions-center">
          <button type="button" className="popup-btn popup-btn-outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="popup-btn popup-btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Resetting…' : 'Reset site'}
          </button>
        </div>
      </div>
    </div>
  );
}
