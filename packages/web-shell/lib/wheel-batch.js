// Batch wheel-gesture input to one transform update per animation frame.
//
// Wheel events fire at the input device rate (often 120–480 Hz); each
// zoom/pan apply runs the full downstream pipeline synchronously
// (setTransform → onTransformed → CSS-var broadcast → style recalc of every
// --canvas-scale consumer). Screens paint once per frame, so per-event
// applies between paints are pure waste.
//
// Deltas SUM — the zoom factor is exp(-deltaY·k), and exp(a)·exp(b) ===
// exp(a+b), so applying the summed deltaY once is mathematically identical
// to applying each event in sequence. The zoom anchor uses the LATEST
// cursor position (cursor movement within one frame is sub-perceptual).
// Pan fires before zoom when both land in the same frame.
export function createWheelBatcher({ onPan, onZoom }) {
  let pending = null;
  let rafId = null;

  function fire() {
    rafId = null;
    const p = pending;
    pending = null;
    if (!p) return;
    if (p.panX || p.panY) onPan(p.panX, p.panY);
    if (p.zoomDelta) onZoom(p.zoomDelta, p.cx, p.cy);
  }

  function ensure() {
    if (rafId == null) rafId = requestAnimationFrame(fire);
  }

  function blank() {
    return { panX: 0, panY: 0, zoomDelta: 0, cx: 0, cy: 0 };
  }

  return {
    addPan(dx, dy) {
      pending = pending || blank();
      pending.panX += dx;
      pending.panY += dy;
      ensure();
    },
    addZoom(deltaY, cx, cy) {
      pending = pending || blank();
      pending.zoomDelta += deltaY;
      pending.cx = cx;
      pending.cy = cy;
      ensure();
    },
    cancel() {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      pending = null;
    },
  };
}
