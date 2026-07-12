'use client';

import { useEffect, useState } from 'react';
import { nodeOrigin, originColor } from '../lib/node-origin.js';

// Right-side canvas inspector — "Working Table" chrome (unspirit import,
// 2026-07-12). Figma-familiar geometry: Design/Prototype tabs, selection
// title with the node's category dot, then panels. Frame X/Y/W/H are LIVE
// (read from the selected node, editable — commits move/resize through the
// same path as dragging). Everything else is an honest placeholder
// (disabled) until the feature exists. Collapses to a detached 42px button
// under the topbar; the minimap follows via --inspector-w.

const COLLAPSE_KEY = 'uncraft-inspector-collapsed';

const PanelIcon = {
  Collapse: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="m10 9 2.5 3L10 15"/>
    </svg>
  ),
  Chevron: () => (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 15 6-6 6 6"/>
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14"/><path d="M5 12h14"/>
    </svg>
  ),
  More: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
    </svg>
  )
};

// One numeric frame field. Commits on Enter/blur; empty or NaN restores
// the previous value (fields can never be blanked — house editing rule).
function FrameField({ label, value, onCommit, disabled }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  function commit() {
    const n = Math.round(parseFloat(draft));
    if (Number.isNaN(n)) { setDraft(String(value)); return; }
    if (n !== value) onCommit(n);
  }
  return (
    <label className="cinsp-field">
      <span>{label}</span>
      <input
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setDraft(String(value)); e.currentTarget.blur(); }
        }}
        inputMode="numeric"
        spellCheck={false}
      />
    </label>
  );
}

function Panel({ title, children, collapsed }) {
  return (
    <section className="cinsp-panel">
      <header>
        <b>{title}</b>
        <button type="button" disabled title={collapsed ? `${title} — coming soon` : undefined}>
          {collapsed ? <PanelIcon.Plus /> : <PanelIcon.Chevron />}
        </button>
      </header>
      {!collapsed && children}
    </section>
  );
}

export default function CanvasInspector({ node, onFrameChange }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* SSR */ }
  }, []);

  // The minimap anchors off this var so it never sits under the panel.
  useEffect(() => {
    document.documentElement.style.setProperty('--inspector-w', collapsed ? '0px' : '248px');
    return () => { document.documentElement.style.removeProperty('--inspector-w'); };
  }, [collapsed]);

  function toggle() {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  }

  const color = node ? originColor(node) : null;
  const kind = node ? nodeOrigin(node) : null;
  const title = node?.meta?.name || node?.origin_url || (node ? `${kind} node` : '');

  if (collapsed) {
    return (
      <button
        type="button"
        className="canvas-inspector collapsed"
        onClick={toggle}
        title="Expand inspector"
        aria-label="Expand inspector"
      >
        <PanelIcon.Collapse />
      </button>
    );
  }

  return (
    <aside className="canvas-inspector">
      <div className="cinsp-head">
        <div className="cinsp-tabs">
          <button type="button" className="active">Design</button>
          <button type="button" disabled title="Prototype — coming soon">Prototype</button>
        </div>
        <button type="button" className="cinsp-collapse" onClick={toggle} title="Collapse inspector" aria-label="Collapse inspector">
          <PanelIcon.Collapse />
        </button>
      </div>

      {node ? (
        <>
          <div className="cinsp-selection">
            <span className="cinsp-type-dot" style={{ background: color }} />
            <span className="cinsp-selection-name">{title}</span>
            <button type="button" disabled title="More — right-click the node for actions">
              <PanelIcon.More />
            </button>
          </div>

          <Panel title="Frame">
            <div className="cinsp-field-grid">
              <FrameField label="X" value={Math.round(node.pos_x)} onCommit={(v) => onFrameChange(node.id, { posX: v })} />
              <FrameField label="Y" value={Math.round(node.pos_y)} onCommit={(v) => onFrameChange(node.id, { posY: v })} />
              <FrameField label="W" value={Math.round(node.width)} onCommit={(v) => onFrameChange(node.id, { width: Math.max(80, v) })} />
              <FrameField label="H" value={Math.round(node.height)} onCommit={(v) => onFrameChange(node.id, { height: Math.max(60, v) })} />
            </div>
          </Panel>

          <Panel title="Appearance">
            <div className="cinsp-row"><span>Opacity</span><button type="button" disabled title="Coming soon">100%</button></div>
            <div className="cinsp-row"><span>Corner</span><button type="button" disabled title="Coming soon">12</button></div>
          </Panel>

          <Panel title="Fill">
            <div className="cinsp-fill">
              <i style={{ background: color }} />
              <span>{(color || '').replace('#', '').toUpperCase()}</span>
              <span>100%</span>
            </div>
          </Panel>

          <Panel title="Export" collapsed />
        </>
      ) : (
        <div className="cinsp-empty">Select a node to inspect it.</div>
      )}
    </aside>
  );
}
