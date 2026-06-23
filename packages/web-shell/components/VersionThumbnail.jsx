'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../lib/canvas-api.js';

// One version thumbnail. Renders the snapshot's screenshot when present (light),
// otherwise a script-free mini-iframe of the version's HTML (most edit/run
// snapshots have no screenshot). Content is fetched ON DEMAND only.
//
// The mini-iframe renders the page at BASE width then scales the whole thing to
// the thumb's ACTUAL rendered width (measured) so it stays correct whether the
// thumb is flex-sized (the full-width floater row), fixed-size (the menu), or
// scaled by the canvas zoom. The square container clips to the top portion.
const BASE = 1280;

export default function VersionThumbnail({ nodeId, snapshotId, onClick, title, size = null, active = false }) {
  const [content, setContent] = useState(null); // { html, screenshot_url }
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);
  const [boxW, setBoxW] = useState(size || 56);

  useEffect(() => {
    let alive = true;
    setContent(null);
    setFailed(false);
    api.getSnapshot(nodeId, snapshotId)
      .then((r) => { if (alive) setContent(r.snapshot || null); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [nodeId, snapshotId]);

  // Track the thumb's rendered (layout) width so the iframe scale fills it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBoxW(el.clientWidth || size || 56);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  const scale = (boxW || 56) / BASE;
  const fixed = typeof size === 'number';

  return (
    <button
      ref={ref}
      type="button"
      className={`cnode-version-thumb${fixed ? '' : ' cnode-version-thumb--fill'}${active ? ' is-active' : ''}`}
      style={fixed ? { width: size, height: size } : undefined}
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
