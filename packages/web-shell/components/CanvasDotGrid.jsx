'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

// World-locked dot grid, drawn on a <canvas> instead of a CSS gradient.
//
// The old implementation was a full-viewport radial-gradient whose
// background-size/-position/dot-radius all mutated on every zoom/pan tick:
// each tick invalidated and REPAINTED the entire viewport (millions of
// device pixels on Retina) and planted dots at fractional CSS positions —
// the browser snapped them to a different pixel grid every frame, which
// read as the grid "micro-trembling" during zoom.
//
// Here dots are drawn once per animation frame with centers ROUNDED to
// whole device pixels: stable under zoom (no shimmer), and a 2D draw of a
// few thousand dots is far cheaper than a full-screen gradient repaint.
//
// Visual parity with the old CSS: 28px world spacing, 1.4px world dot
// radius, dot centre offset 1px·scale, colour from --canvas-dot (theme-
// aware, re-read on every draw so light/dark flips just work).
const STEP_WORLD = 28;
const DOT_R_WORLD = 1.4;
const CENTER_OFF_WORLD = 1;
// Below this device-px spacing the old gradient degenerated into sub-pixel
// noise anyway — skip drawing instead of painting tens of thousands of
// invisible smudges per frame at extreme zoom-out.
const MIN_STEP_DEVICE_PX = 10;

const CanvasDotGrid = forwardRef(function CanvasDotGrid(_props, ref) {
  const elRef = useRef(null);
  const stateRef = useRef(null); // { scale, tx, ty } in CSS px
  const rafRef = useRef(null);

  function draw() {
    rafRef.current = null;
    const cv = elRef.current;
    const st = stateRef.current;
    if (!cv || !st) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cv.clientWidth * dpr);
    const h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const step = STEP_WORLD * st.scale * dpr;
    if (step < MIN_STEP_DEVICE_PX) return;
    const r = Math.max(0.5, DOT_R_WORLD * st.scale * dpr);
    const color =
      getComputedStyle(cv).getPropertyValue('--canvas-dot').trim() ||
      'rgba(255, 255, 255, 0.20)';
    const off = CENTER_OFF_WORLD * st.scale * dpr;
    // First visible dot column/row (positive modulo keeps it on-screen for
    // any pan offset sign).
    const x0 = ((st.tx * dpr + off) % step + step) % step - step;
    const y0 = ((st.ty * dpr + off) % step + step) % step - step;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let x = x0; x <= w + step; x += step) {
      const px = Math.round(x);
      for (let y = y0; y <= h + step; y += step) {
        const py = Math.round(y);
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  function schedule() {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw);
  }

  useImperativeHandle(ref, () => ({
    // Called from CanvasClient's onTransformed with the live transform.
    // Coalesced to one draw per frame.
    update(scale, tx, ty) {
      stateRef.current = { scale: scale || 1, tx: tx || 0, ty: ty || 0 };
      schedule();
    },
  }), []);

  useEffect(() => {
    // Initial paint: by the time this rAF fires the parent's effects have
    // exposed window.__uncraftZoom, so the first frame uses the real
    // initial transform (0.6 / -25% world) instead of a guess.
    const raf = requestAnimationFrame(() => {
      const s = window.__uncraftZoom?.getState?.();
      if (s && !stateRef.current) {
        stateRef.current = { scale: s.scale, tx: s.positionX, ty: s.positionY };
      }
      schedule();
    });
    const onResize = () => schedule();
    window.addEventListener('resize', onResize);
    // Theme flips (body.rb-ed-light) change --canvas-dot — redraw.
    const mo = new MutationObserver(() => schedule());
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => {
      cancelAnimationFrame(raf);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
      mo.disconnect();
    };
  }, []);

  // Reuses the .canvas-bg class for positioning (absolute inset-0,
  // pointer-events none) — the CSS gradient declarations were removed.
  return <canvas ref={elRef} className="canvas-bg" aria-hidden="true" />;
});

export default CanvasDotGrid;
