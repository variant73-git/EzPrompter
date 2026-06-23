'use client';
import { useEffect, useRef } from 'react';
import VersionThumbnail from './VersionThumbnail.jsx';

// Expanded list of ALL past versions (thumbnail left, date/time right), in the
// frosted canvas-menu family. Opened from the floater's history button.
export default function VersionHistoryMenu({ nodeId, versions, onPick, onClose }) {
  const ref = useRef(null);

  // Close on outside click / Escape.
  useEffect(() => {
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) onClose?.(); }
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="cnode-version-menu" onMouseDown={(e) => e.stopPropagation()}>
      {versions.map((v) => (
        <button
          key={v.id}
          type="button"
          className="cnode-version-menu-row"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onPick?.(v.id); }}
        >
          <VersionThumbnail nodeId={nodeId} snapshotId={v.id} />
          <span className="cnode-version-menu-date">{new Date(v.created_at).toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}
