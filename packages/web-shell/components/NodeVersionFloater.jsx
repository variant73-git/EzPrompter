'use client';
import { useState } from 'react';
import VersionThumbnail from './VersionThumbnail.jsx';
import VersionHistoryMenu from './VersionHistoryMenu.jsx';

// Floating row of past-version thumbnails below a selected site node.
// Up to 3 most-recent past versions, then a history button (only when there are
// MORE than 3 — with ≤3 the thumbnails already show everything). The button
// opens the full history menu. Clicking any thumbnail asks the parent to PREVIEW
// that version (parent then shows it in the body + a confirm bar).
const HISTORY_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3v5h5" />
    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export default function NodeVersionFloater({ nodeId, pastVersions, onPreview }) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (!pastVersions?.length) return null;

  const shown = pastVersions.slice(0, 3);
  const hasMore = pastVersions.length > 3;

  return (
    <div className="cnode-version-row" onMouseDown={(e) => e.stopPropagation()}>
      {shown.map((v) => (
        <VersionThumbnail
          key={v.id}
          nodeId={nodeId}
          snapshotId={v.id}
          title={new Date(v.created_at).toLocaleString()}
          onClick={() => onPreview(v.id)}
        />
      ))}
      {hasMore && (
        <button
          type="button"
          className="cnode-version-history-btn"
          title="Version history"
          aria-label="Version history"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        >
          {HISTORY_ICON}
        </button>
      )}
      {menuOpen && hasMore && (
        <VersionHistoryMenu
          nodeId={nodeId}
          versions={pastVersions}
          onPick={(id) => { setMenuOpen(false); onPreview(id); }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}
