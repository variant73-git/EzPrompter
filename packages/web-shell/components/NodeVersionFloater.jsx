'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import VersionThumbnail from './VersionThumbnail.jsx';
import VersionHistoryMenu from './VersionHistoryMenu.jsx';

// Floating row of version thumbnails below a selected site node. Shows ALL
// versions (newest first); the one currently shown in the node (activeId) gets
// the grey marker. Up to 3 thumbnails, then a history button (only when there
// are MORE than 3) that opens the full menu. Clicking a thumbnail asks the
// parent to PREVIEW that version (clicking the already-shown one is a no-op).
// Right-clicking a thumbnail opens a context menu (Restore / Delete).
const HISTORY_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3v5h5" />
    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
    <path d="M12 7v5l3 2" />
  </svg>
);

// Cursor-anchored right-click menu for a single version thumbnail. Shares the
// canvas-context-menu look (off-black frosted card, grey rows). Portaled to
// <body> so it escapes the node's transformed stacking context.
function VersionThumbMenu({ x, y, onRestore, onDelete, onClose }) {
  useEffect(() => {
    function onDown(e) { if (!e.target?.closest?.('.cnode-version-ctx-menu')) onClose(); }
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="popup-menu canvas-context-menu cnode-version-ctx-menu"
      style={{ position: 'fixed', left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <button type="button" className="popup-menu-btn" onClick={onRestore}>Restore this version</button>
      <button type="button" className="popup-menu-btn cnode-version-menu-delete" onClick={onDelete}>Delete from history</button>
    </div>,
    document.body,
  );
}

export default function NodeVersionFloater({ nodeId, versions, onPreview, onRestore, onDelete, activeId = null, loading = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { snapshotId, x, y }

  if (loading) {
    return (
      <div className="cnode-version-row cnode-version-loading" aria-live="polite">
        <div className="cnode-version-loading-pill">
          {HISTORY_ICON}
          <span>loading history</span>
        </div>
      </div>
    );
  }
  if (!versions?.length) return null;

  // Newest-first, so the row reads newest on the LEFT → oldest on the right,
  // and the "+N" overflow (the oldest versions) sits at the right end.
  const ordered = [...versions].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
  const shown = ordered.slice(0, 3);
  const excess = ordered.slice(3);   // the (older) versions beyond the 3 shown
  const pick = (id) => { if (id !== activeId) onPreview(id); };
  const openCtx = (id, e) => setCtxMenu({ snapshotId: id, x: e.clientX, y: e.clientY });

  return (
    <div className="cnode-version-row" onMouseDown={(e) => e.stopPropagation()}>
      {shown.map((v) => (
        <VersionThumbnail
          key={v.id}
          nodeId={nodeId}
          snapshotId={v.id}
          active={v.id === activeId}
          hint="right click for options"
          onClick={() => pick(v.id)}
          onContextMenu={(e) => openCtx(v.id, e)}
        />
      ))}
      {excess.length > 0 && (
        <button
          type="button"
          className="cnode-version-more-btn"
          title={`${excess.length} more version${excess.length === 1 ? '' : 's'}`}
          aria-label={`${excess.length} more versions`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        >
          +{excess.length}
        </button>
      )}
      {menuOpen && excess.length > 0 && (
        <VersionHistoryMenu
          nodeId={nodeId}
          versions={excess}
          activeId={activeId}
          onPick={(id) => { setMenuOpen(false); pick(id); }}
          onContextMenu={openCtx}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {ctxMenu && (
        <VersionThumbMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onRestore={() => { onRestore?.(ctxMenu.snapshotId); setCtxMenu(null); }}
          onDelete={() => { onDelete?.(ctxMenu.snapshotId); setCtxMenu(null); }}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
