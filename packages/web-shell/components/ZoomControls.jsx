'use client';

import { useEffect, useRef, useState } from 'react';

const PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5];
const ZOOM_STEP = 1.2;
const MIN_SCALE = 0.1;
const MAX_SCALE = 2.5;

const ChevronIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6"/>
  </svg>
);

const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8V3h5"/><path d="M21 8V3h-5"/>
    <path d="M3 16v5h5"/><path d="M21 16v5h-5"/>
  </svg>
);

function setAbsoluteScale(transformRef, targetScale) {
  const t = transformRef.current;
  if (!t) return;
  const inst = t.instance || t;
  const wrapper = inst?.wrapperComponent;
  if (!wrapper) {
    t.setTransform?.(0, 0, targetScale, 200);
    return;
  }
  const rect = wrapper.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const state = inst.transformState || t.state || { positionX: 0, positionY: 0, scale: 1 };
  const { positionX, positionY, scale } = state;
  const wx = (cx - positionX) / scale;
  const wy = (cy - positionY) / scale;
  const nextX = cx - wx * targetScale;
  const nextY = cy - wy * targetScale;
  t.setTransform(nextX, nextY, targetScale, 200);
}

export default function ZoomControls({ scale, transformRef, onFit }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  function zoomIn() {
    const next = Math.min(MAX_SCALE, (scale || 1) * ZOOM_STEP);
    setAbsoluteScale(transformRef, next);
  }
  function zoomOut() {
    const next = Math.max(MIN_SCALE, (scale || 1) / ZOOM_STEP);
    setAbsoluteScale(transformRef, next);
  }

  useEffect(() => {
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault(); zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault(); zoomOut();
      } else if (e.key === '0') {
        e.preventDefault(); onFit?.();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, onFit]);

  const pct = Math.round((scale || 1) * 100);

  return (
    <div className="zoom-controls" ref={rootRef}>
      <button
        type="button"
        className="zoom-pill"
        onClick={() => setOpen((p) => !p)}
        title="Zoom"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="zoom-pill-pct">{pct}%</span>
        <ChevronIcon />
      </button>
      <span className="zoom-pill-divider" aria-hidden="true" />
      <button
        type="button"
        className="zoom-fit-btn"
        onClick={() => onFit?.()}
        title="Fit to View (⌘0)"
        aria-label="Fit to view"
      >
        <ExpandIcon />
      </button>

      {open && (
        <div className="zoom-menu" role="menu">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              className={`zoom-menu-item${Math.abs(p - scale) < 0.01 ? ' active' : ''}`}
              onClick={() => { setAbsoluteScale(transformRef, p); setOpen(false); }}
            >
              <span>{Math.round(p * 100)}%</span>
            </button>
          ))}
          <div className="zoom-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="zoom-menu-item"
            onClick={() => { zoomIn(); setOpen(false); }}
          >
            <span>Zoom in</span>
            <span className="zoom-menu-kbd">⌘+</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="zoom-menu-item"
            onClick={() => { zoomOut(); setOpen(false); }}
          >
            <span>Zoom out</span>
            <span className="zoom-menu-kbd">⌘−</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="zoom-menu-item"
            onClick={() => { onFit?.(); setOpen(false); }}
          >
            <span>Fit to View</span>
            <span className="zoom-menu-kbd">⌘0</span>
          </button>
        </div>
      )}
    </div>
  );
}
