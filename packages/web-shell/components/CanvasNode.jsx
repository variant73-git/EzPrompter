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
  onSelect, onMove, onResize, onDelete, onReset, onDuplicate, onDownload,
  onStartEdge, onSlotMouseDown, onPromptTextChange,
  incomingEdges = [], draftActive
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [menuPos, setMenuPos] = useState(null); // {x, y} for topbar context menu
  const iframeRef = useRef(null);
  const [editorBusy, setEditorBusy] = useState(false);

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

  const onIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0, 800);
      iframe.style.height = Math.min(h, 12000) + 'px';
    } catch (e) { /* cross-origin */ }
  }, []);

  const html = node.current_html;
  const kindLabel =
    node.kind === 'site' ? 'site' :
    node.kind === 'template' ? 'template' :
    node.kind === 'designmd' ? 'design.md' :
    node.kind === 'prompt' ? 'prompt' :
    node.kind === 'skill' ? 'skill' :
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

  // Forward wheel events from inside the iframe out to the host canvas so
  // the user can zoom by scrolling over a node. iframes capture wheel
  // events in their own contentDocument — pointer-events:none on the host
  // side doesn't help because the inner browser still handles them. We
  // re-dispatch a synthetic wheel on .cnode-body (which is NOT in the
  // TransformWrapper's `excluded` list) so react-zoom-pan-pinch picks it
  // up. Skip this in edit mode so the editor's own scroll/wheel logic
  // still works inside the iframe.
  useEffect(() => {
    if (editing) return;
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
        // Always replace any prior listener — StrictMode + hot-reload can
        // leave stale handlers bound to a previous parentElement reference.
        if (doc._uncraftWheel) {
          try { doc.removeEventListener('wheel', doc._uncraftWheel, { capture: true }); } catch (err) {}
        }
        handler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Direct path — call the canvas zoom API CanvasClient exposes.
          // Survives any synthetic-event quirks with react-zoom-pan-pinch.
          if (window.__uncraftZoom) {
            const z = window.__uncraftZoom;
            const dy = e.deltaY || 0;
            if (dy === 0) return;
            // Step proportional to deltaY magnitude so trackpad scroll
            // feels smooth (small deltas = small zoom changes).
            const cur = z.getScale();
            const factor = Math.exp(-dy * 0.0015);
            z.setScale(Math.max(0.1, Math.min(2.5, cur * factor)));
            return;
          }
          // Fallback for environments without the canvas API — re-dispatch
          // a synthetic wheel on cnode-body so TransformWrapper picks it up.
          const r = iframe.getBoundingClientRect();
          const synth = new WheelEvent('wheel', {
            bubbles: true, cancelable: true,
            ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
            deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
            clientX: r.left + e.clientX, clientY: r.top + e.clientY
          });
          (iframe.parentElement || iframe).dispatchEvent(synth);
        };
        doc._uncraftWheel = handler;
        doc.addEventListener('wheel', handler, { passive: false, capture: true });
      } catch (err) { /* cross-origin / not ready */ }
    }
    attach();
    // Re-attach if iframe reloads (e.g., after reset)
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
          <span className="title" title={title}>{title}</span>
        </div>
        <div className="topbar-grip" aria-hidden>
          <span /><span /><span /><span /><span /><span />
          <span /><span /><span /><span /><span /><span />
        </div>
        <div className="topbar-right">
          {/* "More" button — hidden by default, shown via CSS in
              collapsed-topbar mode (zoom-low / narrow node). Opens the
              same dropdown as right-click on the topbar. */}
          <button
            className="btn-more"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              // Open to the RIGHT of the button (small gap), top
              // edges aligned. Clamping inside TopbarContextMenu
              // handles the screen-edge case (menu falls back to
              // overflow-friendly position automatically).
              setMenuPos({
                x: r.right + 6,
                y: r.top
              });
            }}
            title="Actions"
            aria-label="Open node actions menu"
          >
            <MoreIcon />
          </button>
          {renderIframeBody && html && (
            <button
              className={editing ? 'btn-edit active' : 'btn-edit'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onEditingChange?.(!editing); }}
              title={editing ? 'Exit edit mode' : 'Open editor (layers + inspector + guides)'}
            >
              {editing ? <CheckIcon /> : <EditIcon />}
              <span className="btn-edit-lbl">{editing ? (editorBusy ? '…' : 'Done') : 'Edit'}</span>
            </button>
          )}
          <button
            className="btn-duplicate"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDuplicate?.(); }}
            title="Duplicate node"
            aria-label="Duplicate node"
          >
            <DuplicateIcon />
          </button>
          <button
            className="btn-download"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDownload?.(); }}
            title={node.kind === 'designmd' ? 'Download as .md' : 'Download as .html'}
            aria-label="Download node content"
          >
            <DownloadIcon />
          </button>
          {renderIframeBody && html && (
            <button
              className="btn-reset"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { if (!hasEdits) return; e.stopPropagation(); setShowResetConfirm(true); }}
              disabled={!hasEdits}
              title={hasEdits ? 'Reset site to original capture' : 'No edits to reset'}
              aria-label="Reset site to original"
            >
              <ResetIcon />
            </button>
          )}
          <button
            className="btn-delete"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (confirm('Delete this node?')) onDelete(); }}
            title="Delete node"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      {node._loading ? (
        <div className="cnode-loading">
          <div className="cnode-spinner" />
          <span>{node.kind === 'site' ? 'Capturing…' : 'Loading…'}</span>
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
          >
            <iframe
              ref={iframeRef}
              className="cnode-iframe"
              title={title}
              srcDoc={html}
              sandbox="allow-same-origin allow-scripts"
              onLoad={onIframeLoad}
              style={{
                pointerEvents: editing ? 'auto' : 'none',
                height: 800
              }}
            />
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
        className="reset-confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-confirm-title"
      >
        <h3 id="reset-confirm-title" className="reset-confirm-title">Reset to original?</h3>
        <p className="reset-confirm-body">
          This discards all edits to <strong>{name || 'this site'}</strong> and
          restores the first capture. This action cannot be undone.
          {editing ? <><br/><span style={{opacity:0.7}}>Edit mode will close first.</span></> : null}
        </p>
        <div className="reset-confirm-actions">
          <button type="button" className="btn-outline reset-confirm-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-danger reset-confirm-btn" onClick={onConfirm} disabled={busy}>
            {busy ? 'Resetting…' : 'Reset site'}
          </button>
        </div>
      </div>
    </div>
  );
}
