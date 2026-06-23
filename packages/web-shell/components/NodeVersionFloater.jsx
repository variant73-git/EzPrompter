'use client';
import { useState } from 'react';
import VersionThumbnail from './VersionThumbnail.jsx';
import VersionHistoryMenu from './VersionHistoryMenu.jsx';

// Floating row of version thumbnails below a selected site node. Shows ALL
// versions (newest first); the one currently shown in the node (activeId) gets
// the grey marker. Up to 3 thumbnails, then a history button (only when there
// are MORE than 3) that opens the full menu. Clicking a thumbnail asks the
// parent to PREVIEW that version (clicking the already-shown one is a no-op).
const HISTORY_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3v5h5" />
    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export default function NodeVersionFloater({ nodeId, versions, onPreview, activeId = null, loading = false }) {
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) {
    return (
      <div className="cnode-version-row cnode-version-loading" aria-live="polite">
        {HISTORY_ICON}
        <span>loading history</span>
      </div>
    );
  }
  if (!versions?.length) return null;

  const shown = versions.slice(0, 3);
  const excess = versions.slice(3);   // the versions beyond the 3 shown
  const pick = (id) => { if (id !== activeId) onPreview(id); };

  return (
    <div className="cnode-version-row" onMouseDown={(e) => e.stopPropagation()}>
      {shown.map((v) => (
        <VersionThumbnail
          key={v.id}
          nodeId={nodeId}
          snapshotId={v.id}
          active={v.id === activeId}
          title={new Date(v.created_at).toLocaleString()}
          onClick={() => pick(v.id)}
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
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}
