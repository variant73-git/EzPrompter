'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

// Screen-constant dot grid, drawn on a <canvas> instead of a CSS gradient.
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
// Visual parity with the Working Table reference: a 20px screen grid with
// 1px dots, anchored to the visible canvas area (after sidebar + topbar).
// The grid does not become dense noise when the world is zoomed out.
const STEP_CSS = 20;
const DOT_R_CSS = 1;

const CanvasDotGrid = forwardRef(function CanvasDotGrid(_props, ref) {
  const elRef = useRef(null);
  const stateRef = useRef(null);
  const rafRef = useRef(null);

  function draw() {
    rafRef.current = null;
    const cv = elRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cv.clientWidth * dpr);
    const h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const step = STEP_CSS * dpr;
    const r = DOT_R_CSS * dpr;
    const color =
      getComputedStyle(cv).getPropertyValue('--canvas-dot').trim() ||
      'rgba(255, 255, 255, 0.20)';
    const rootStyle = getComputedStyle(document.documentElement);
    const editMode = document.body.classList.contains('rb-ed-active');
    const left = editMode ? 0 : (parseFloat(rootStyle.getPropertyValue('--sidebar-w')) || 224);
    const top = editMode ? 0 : (parseFloat(rootStyle.getPropertyValue('--topbar-h')) || 46);
    const x0 = Math.round(left * dpr);
    const y0 = Math.round(top * dpr);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let x = x0; x <= w; x += step) {
      const px = Math.round(x);
      for (let y = y0; y <= h; y += step) {
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
    // Called from CanvasClient's onTransformed. The reference grid is screen
    // constant, so transform values only trigger a coalesced redraw.
    update() {
      stateRef.current = true;
      schedule();
    },
  }), []);

  useEffect(() => {
    // Initial paint after the fixed chrome has exposed its CSS dimensions.
    const raf = requestAnimationFrame(() => {
      stateRef.current = true;
      schedule();
    });
    const onResize = () => schedule();
    window.addEventListener('resize', onResize);
    // Theme flips (body.rb-ed-light) change --canvas-dot — redraw.
    const mo = new MutationObserver(() => schedule());
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
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
