export const CANVAS_MIN_SCALE = 0.18;
export const CANVAS_MAX_SCALE = 1.5;
export const CANVAS_DEFAULT_SCALE = 0.72;
// Edit mode has its own wheel range (kept ON PURPOSE — the deep zoom-out is
// the requested "max zoom out"; the defect was the camera persistence, not
// the floor: Sol advise 2026-08-20). These are the canonical values for every
// path that writes a transform; CanvasClient must not carry its own literals.
export const CANVAS_EDIT_MIN_SCALE = 0.04;
export const CANVAS_WHEEL_MAX_SCALE = 2.5;

export function clampCanvasScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) return CANVAS_DEFAULT_SCALE;
  return Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, scale));
}

export function parseCanvasView(raw) {
  if (!raw) return null;
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const positionX = Number(value?.positionX);
    const positionY = Number(value?.positionY);
    const scale = Number(value?.scale);
    if (![positionX, positionY, scale].every(Number.isFinite)) return null;
    // A position is only meaningful WITH the scale it was computed for.
    // Clamping only the scale restored an edit-mode camera (4%) as raw
    // position + 18% scale — the site landed outside the viewport and every
    // zoom-in magnified empty canvas (defect 2, 2026-08-20). An out-of-range
    // scale invalidates the whole view; the mount falls back to fit.
    if (clampCanvasScale(scale) !== scale) return null;
    return { positionX, positionY, scale };
  } catch {
    return null;
  }
}

