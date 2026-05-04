'use client';

import { useEffect, useState, useRef } from 'react';

/**
 * EditorOverlay — selection + hover rectangles drawn in the parent document,
 * positioned to track an element inside an iframe whose contents we own
 * (same-origin, allow-same-origin sandbox).
 *
 * Tracks via getBoundingClientRect (returns screen coords post-transform).
 */
export default function EditorOverlay({ iframe, selectedEl, hoverEl }) {
  const [selRect, setSelRect] = useState(null);
  const [hoverRect, setHoverRect] = useState(null);
  const rafRef = useRef(null);

  useEffect(() => {
    function rectFor(el) {
      if (!el || !iframe) return null;
      const elRect = el.getBoundingClientRect();        // coords in iframe's own viewport
      const iRect = iframe.getBoundingClientRect();     // iframe screen rect, post-transform
      // Effective scale = iframe's actually-rendered width / its layout width.
      const scale = iframe.offsetWidth ? (iRect.width / iframe.offsetWidth) : 1;
      return {
        left:   iRect.left + elRect.left * scale,
        top:    iRect.top  + elRect.top  * scale,
        width:  elRect.width  * scale,
        height: elRect.height * scale
      };
    }

    function recalc() {
      setSelRect(rectFor(selectedEl));
      setHoverRect(hoverEl && hoverEl !== selectedEl ? rectFor(hoverEl) : null);
    }

    function loop() {
      recalc();
      rafRef.current = requestAnimationFrame(loop);
    }
    loop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [selectedEl, hoverEl, iframe]);

  const fmt = (r, color, bg) => r && (
    <div style={{
      position: 'fixed',
      left: r.left, top: r.top, width: r.width, height: r.height,
      pointerEvents: 'none',
      outline: `2px solid ${color}`,
      outlineOffset: '-1px',
      background: bg,
      zIndex: 250,
      borderRadius: 2
    }} />
  );

  return (
    <>
      {fmt(hoverRect, 'rgba(167, 139, 250, 0.6)', 'transparent')}
      {fmt(selRect, '#7c3aed', 'rgba(124, 58, 237, 0.08)')}
      {selectedEl && selRect && (
        <div style={{
          position: 'fixed',
          left: selRect.left, top: Math.max(selRect.top - 22, 4),
          background: '#7c3aed', color: '#fff',
          padding: '2px 8px', borderRadius: 4,
          fontSize: 11, fontWeight: 600,
          fontFamily: '-apple-system, sans-serif',
          pointerEvents: 'none',
          zIndex: 251,
          whiteSpace: 'nowrap'
        }}>
          {selectorBadge(selectedEl)}
        </div>
      )}
    </>
  );
}

function selectorBadge(el) {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = (el.className && typeof el.className === 'string')
    ? el.className.trim().split(/\s+/).slice(0, 1).map((c) => `.${c}`).join('')
    : '';
  return `${tag}${id}${cls}`;
}
