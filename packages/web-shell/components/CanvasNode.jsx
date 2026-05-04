'use client';

import { useRef, useState, useCallback } from 'react';

export default function CanvasNode({
  node, selected, onSelect, onMove, onDelete, onStartEdge, onMouseUpAsEdgeTarget, draftActive
}) {
  const dragState = useRef(null);
  const [hover, setHover] = useState(false);

  const onHandleMouseDown = useCallback((e) => {
    e.stopPropagation();
    onSelect();
    if (e.shiftKey) {
      onStartEdge(e);
      return;
    }
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      origX: node.pos_x, origY: node.pos_y
    };
    function move(ev) {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      onMove(dragState.current.origX + dx, dragState.current.origY + dy);
    }
    function up() {
      dragState.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [node.pos_x, node.pos_y, onMove, onSelect, onStartEdge]);

  const html = node.current_html;
  const kindLabel = node.kind === 'site' ? 'site' : node.kind === 'template' ? 'template' : node.kind === 'designmd' ? 'design.md' : 'chunk';

  return (
    <div
      className={`cnode${selected ? ' selected' : ''}${node.is_main ? ' is-main' : ''}`}
      style={{
        left: node.pos_x, top: node.pos_y,
        width: node.width, height: node.height
      }}
      onMouseUp={onMouseUpAsEdgeTarget}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="cnode-handle" onMouseDown={onHandleMouseDown}>
        <span className="kind-pill">{kindLabel}</span>
        <span className="label" title={node.origin_url || node.meta?.name || node.id}>
          {node.origin_url || node.meta?.name || node.template_slug || 'untitled'}
        </span>
        {hover && (
          <button onClick={(e) => { e.stopPropagation(); onStartEdge(e); }} title="Drag to create edge (or shift-drag handle)">
            ↗
          </button>
        )}
        {hover && (
          <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this node?')) onDelete(); }} title="Delete">
            ✕
          </button>
        )}
      </div>
      {node._loading || !html ? (
        <div className="cnode-loading">
          <div className="cnode-spinner" />
          <span>{node.kind === 'site' ? 'Capturing…' : 'Loading…'}</span>
        </div>
      ) : (
        <iframe
          className="cnode-iframe"
          title={node.origin_url || node.id}
          srcDoc={html}
          sandbox="allow-same-origin"
          style={{ pointerEvents: draftActive ? 'none' : 'auto' }}
        />
      )}
    </div>
  );
}
