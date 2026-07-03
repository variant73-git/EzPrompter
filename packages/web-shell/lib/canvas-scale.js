// Cheap read of the current canvas zoom scale.
//
// Hot paths (drag/resize mousemove handlers, 60+ Hz) previously read the
// `--canvas-scale` CSS variable via getComputedStyle() on every event.
// getComputedStyle forces a style/layout flush when the tree is dirty —
// which it always is mid-drag (each frame just wrote new inline styles) —
// so every mousemove paid a synchronous reflow.
//
// window.__uncraftZoom.getScale() (exposed by CanvasClient) reads the
// react-zoom-pan-pinch transformState directly: a plain property access,
// no layout involvement, updated synchronously before onTransformed fires.
// The CSS-variable read stays as a fallback for contexts where the zoom
// API isn't mounted (SSR, tests, canvas unmounted).
export function readCanvasScale() {
  if (typeof window !== 'undefined') {
    const api = window.__uncraftZoom;
    if (api && typeof api.getScale === 'function') {
      const s = api.getScale();
      if (typeof s === 'number' && s > 0) return s;
    }
    if (typeof document !== 'undefined') {
      const v = parseFloat(
        window.getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale')
      );
      if (v > 0) return v;
    }
  }
  return 1;
}
