'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import CanvasEditorCore from './editor/CanvasEditorCore.jsx';
import { nodeOrigin } from '../lib/node-origin.js';

const DRAG_THRESHOLD = 4;

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14"/><path d="M5 12h14"/>
  </svg>
);

const ResetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7"/>
    <path d="M3 4v5h5"/>
  </svg>
);

export default function CanvasNode({
  node, selected, editing = false, onEditingChange,
  onSelect, onMove, onDelete, onReset, onStartEdge, draftActive
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const iframeRef = useRef(null);
  const [editorBusy, setEditorBusy] = useState(false);

  const onTopbarMouseDown = useCallback((e) => {
    if (e.target?.closest?.('button')) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const start = { x: e.clientX, y: e.clientY, ox: node.pos_x, oy: node.pos_y, moved: false };
    function move(ev) {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
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

  const onPortMouseDown = useCallback((e) => {
    if (editing) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    onStartEdge(e);
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

  // Editor mounts via <CanvasEditorCore> below — host=parent, target=iframe.
  useEffect(() => {
    if (!editing) setEditorBusy(false);
  }, [editing]);

  const html = node.current_html;
  const kindLabel = node.kind === 'site' ? 'site' : node.kind === 'template' ? 'template' : node.kind === 'designmd' ? 'design.md' : 'chunk';
  const title = node.origin_url || node.meta?.name || node.template_slug || 'untitled';

  return (
    <div
      className={`cnode origin-${nodeOrigin(node)}${selected ? ' selected' : ''}${node.is_main ? ' is-main' : ''}${editing ? ' editing' : ''}`}
      style={{ left: node.pos_x, top: node.pos_y, width: node.width }}
      data-node-id={node.id}
    >
      <div className="cnode-topbar" onMouseDown={onTopbarMouseDown}>
        <div className="topbar-left">
          <span className="kind-pill">{kindLabel}</span>
          <span className="title" title={title}>{title}</span>
        </div>
        <div className="topbar-grip" aria-hidden>
          <span /><span /><span /><span /><span /><span />
          <span /><span /><span /><span /><span /><span />
        </div>
        <div className="topbar-right">
          {html && (
            <button
              className={editing ? 'btn-edit active' : 'btn-edit'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onEditingChange?.(!editing); }}
              title={editing ? 'Exit edit mode' : 'Open editor (layers + inspector + guides)'}
            >
              {editing ? (editorBusy ? '…' : 'Done') : 'Edit'}
            </button>
          )}
          {html && (
            <button
              className="btn-reset"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setShowResetConfirm(true); }}
              title="Reset site to original capture"
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
      {node._loading || !html ? (
        <div className="cnode-loading">
          <div className="cnode-spinner" />
          <span>{node.kind === 'site' ? 'Capturing…' : 'Loading…'}</span>
        </div>
      ) : (
        <div className="cnode-body" onMouseDown={onBodyMouseDown}>
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
      )}
      {!editing && html && (
        <>
          <span
            className="cnode-port-left"
            title="Drop a connection here"
            aria-label="Connection input"
          >
            <PlusIcon />
          </span>
          <button
            type="button"
            className="cnode-port-right"
            onMouseDown={onPortMouseDown}
            title="Drag to connect"
            aria-label="Drag to connect"
          >
            <PlusIcon />
          </button>
        </>
      )}
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
