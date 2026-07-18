export const CANVAS_MIN_SCALE = 0.18;
export const CANVAS_MAX_SCALE = 1.5;
export const CANVAS_DEFAULT_SCALE = 0.72;

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
    return { positionX, positionY, scale: clampCanvasScale(scale) };
  } catch {
    return null;
  }
}

