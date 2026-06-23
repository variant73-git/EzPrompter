'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/canvas-api.js';

// One square version thumbnail. Renders the snapshot's screenshot when present
// (light), otherwise a scaled, script-free mini-iframe of the version's HTML
// (most edit/run snapshots have no screenshot). Content is fetched ON DEMAND —
// only when this thumbnail mounts (the floater shows ≤3, the menu rows render
// lazily) — so we never bulk-load version HTML.
//
// The mini-iframe renders the page at BASE width and scales the whole thing
// down to the thumb size; the square container clips to the top portion.
const BASE = 1280;

export default function VersionThumbnail({ nodeId, snapshotId, onClick, title, size = 56 }) {
  const [content, setContent] = useState(null); // { html, screenshot_url }
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setContent(null);
    setFailed(false);
    api.getSnapshot(nodeId, snapshotId)
      .then((r) => { if (alive) setContent(r.snapshot || null); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [nodeId, snapshotId]);

  const scale = size / BASE;

  return (
    <button
      type="button"
      className="cnode-version-thumb"
      style={{ width: size, height: size }}
      title={title}
      aria-label={title || 'version'}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    >
      {content?.screenshot_url ? (
        <img src={content.screenshot_url} alt="" draggable={false} />
      ) : content?.html ? (
        <iframe
          srcDoc={content.html}
          sandbox=""
          scrolling="no"
          tabIndex={-1}
          aria-hidden="true"
          style={{ width: BASE, height: BASE, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      ) : (
        <div className={`cnode-version-thumb-blank${failed ? ' failed' : ''}`} />
      )}
    </button>
  );
}
