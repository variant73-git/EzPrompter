'use client';

import { useState, useMemo } from 'react';

const HIDDEN = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT', 'BASE', 'TITLE']);

export default function EditorLayers({ iframe, selectedEl, onSelect, onHover }) {
  const [refresh, setRefresh] = useState(0);
  const root = iframe?.contentDocument?.body;
  // Expose a manual refresh hook (Inspector edits → tree update).
  // We rebuild the tree on every render; React reconciles efficiently.

  if (!root) return null;

  return (
    <aside className="editor-panel layers-panel" data-panel="layers">
      <div className="panel-handle">
        <span className="panel-title">Layers</span>
        <button className="panel-refresh" onClick={() => setRefresh((n) => n + 1)} title="Refresh tree">⟳</button>
      </div>
      <div className="panel-body">
        <LayerNode
          el={root} depth={0}
          selectedEl={selectedEl}
          onSelect={onSelect}
          onHover={onHover}
          refresh={refresh}
        />
      </div>
    </aside>
  );
}

function LayerNode({ el, depth, selectedEl, onSelect, onHover, refresh }) {
  const [open, setOpen] = useState(depth < 2);
  const tag = el.tagName?.toLowerCase() || '';
  const id = el.id;
  const cls = (typeof el.className === 'string' && el.className.trim()) ? el.className.split(/\s+/)[0] : '';
  const children = Array.from(el.children || []).filter((c) => !HIDDEN.has(c.tagName));
  const hasKids = children.length > 0;
  const isSel = el === selectedEl;

  const label = `${tag}${id ? `#${id}` : ''}${cls ? `.${cls}` : ''}`;

  return (
    <div className="layer-node">
      <div
        className={`layer-row${isSel ? ' selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={(e) => { e.stopPropagation(); onSelect(el); }}
        onMouseEnter={() => onHover(el)}
        onMouseLeave={() => onHover(null)}
      >
        {hasKids ? (
          <button
            className="layer-toggle"
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            aria-label={open ? 'collapse' : 'expand'}
          >{open ? '▾' : '▸'}</button>
        ) : <span className="layer-toggle-spacer" />}
        <span className="layer-label" title={label}>{label}</span>
      </div>
      {open && hasKids && children.map((c, i) => (
        <LayerNode
          key={i + (c.id || '') + c.tagName}
          el={c} depth={depth + 1}
          selectedEl={selectedEl} onSelect={onSelect} onHover={onHover} refresh={refresh}
        />
      ))}
    </div>
  );
}
