'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { injectEditor, detachEditor } from '../lib/inject-editor.js';

const DRAG_THRESHOLD = 4;

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
);

export default function CanvasNode({
  node, selected, editing = false, onEditingChange,
  onSelect, onMove, onDelete, onStartEdge, draftActive
}) {
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

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    setEditorBusy(true);
    const t = setTimeout(async () => {
      try { await injectEditor(iframeRef.current); }
      catch (e) { console.warn('editor injection failed', e); }
      finally { if (!cancelled) setEditorBusy(false); }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
      try { detachEditor(iframeRef.current); } catch (e) { /* swallow */ }
    };
  }, [editing, node.current_snapshot_id]);

  const html = node.current_html;
  const kindLabel = node.kind === 'site' ? 'site' : node.kind === 'template' ? 'template' : node.kind === 'designmd' ? 'design.md' : 'chunk';
  const title = node.origin_url || node.meta?.name || node.template_slug || 'untitled';

  return (
    <div
      className={`cnode${selected ? ' selected' : ''}${node.is_main ? ' is-main' : ''}${editing ? ' editing' : ''}`}
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
          {!editing && (
            <div className="cnode-edge-hint">click + drag → connect to another node</div>
          )}
        </div>
      )}
    </div>
  );
}
