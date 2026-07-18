'use client';

import { useEffect } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { CANVAS_MAX_SCALE, CANVAS_MIN_SCALE } from '../lib/canvas-view.js';

const ZOOM_STEP = 0.1;

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
  t.setTransform(cx - wx * targetScale, cy - wy * targetScale, targetScale, 200);
}

export default function ZoomControls({ scale, transformRef, onFit }) {
  function zoomIn() {
    const next = Math.min(CANVAS_MAX_SCALE, (scale || 1) + ZOOM_STEP);
    setAbsoluteScale(transformRef, next);
  }

  function zoomOut() {
    const next = Math.max(CANVAS_MIN_SCALE, (scale || 1) - ZOOM_STEP);
    setAbsoluteScale(transformRef, next);
  }

  useEffect(() => {
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        onFit?.();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, onFit]);

  const pct = Math.round((scale || 1) * 100);

  return (
    <div className="zoom-controls" role="group" aria-label="Zoom controls">
      <button type="button" onClick={zoomOut} title="Zoom out" aria-label="Zoom out">
        <Minus aria-hidden="true" />
      </button>
      <button type="button" className="zoom-value-btn" title="Current zoom" aria-label={`Zoom ${pct}%`}>
        {pct}%
      </button>
      <button type="button" onClick={zoomIn} title="Zoom in" aria-label="Zoom in">
        <Plus aria-hidden="true" />
      </button>
      <button type="button" onClick={() => onFit?.()} title="Fit to View (⌘0)" aria-label="Fit to view">
        <Maximize aria-hidden="true" />
      </button>
    </div>
  );
}
