export const MIN_VISIBLE_RATIO = 0.25;
export const MEANINGFUL_VISIBLE_PX = 32;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRect(rect) {
  if (!rect) return null;
  const left = finite(rect.left ?? rect.x);
  const top = finite(rect.top ?? rect.y);
  const width = Math.max(0, finite(rect.width, finite(rect.right) - left));
  const height = Math.max(0, finite(rect.height, finite(rect.bottom) - top));
  const right = finite(rect.right, left + width);
  const bottom = finite(rect.bottom, top + height);
  return {
    left,
    top,
    right: Math.max(left, right),
    bottom: Math.max(top, bottom),
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * The pixel threshold is a visible block, not an area tally. Requiring both
 * axes to expose 32 px prevents a 1-2 px edge that spans the whole viewport
 * from moving an otherwise offscreen element. Small elements still qualify
 * through the 25 percent area rule.
 */
export function measureVisibility({ elementRect, viewportRect }) {
  const element = normalizeRect(elementRect);
  const viewport = normalizeRect(viewportRect);
  if (!element || !viewport) {
    return { ratio: 0, visibleWidth: 0, visibleHeight: 0, meaningful: false, reason: 'missing' };
  }
  if (element.width <= 0 || element.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { ratio: 0, visibleWidth: 0, visibleHeight: 0, meaningful: false, reason: 'empty' };
  }

  const visibleWidth = Math.max(0, Math.min(element.right, viewport.right) - Math.max(element.left, viewport.left));
  const visibleHeight = Math.max(0, Math.min(element.bottom, viewport.bottom) - Math.max(element.top, viewport.top));
  const visibleArea = visibleWidth * visibleHeight;
  const ratio = visibleArea / Math.max(1, element.width * element.height);
  if (visibleArea <= 0) {
    return { ratio: 0, visibleWidth, visibleHeight, meaningful: false, reason: 'offscreen' };
  }
  if (ratio >= MIN_VISIBLE_RATIO) {
    return { ratio, visibleWidth, visibleHeight, meaningful: true, reason: 'ratio' };
  }
  if (visibleWidth >= MEANINGFUL_VISIBLE_PX && visibleHeight >= MEANINGFUL_VISIBLE_PX) {
    return { ratio, visibleWidth, visibleHeight, meaningful: true, reason: 'pixels' };
  }
  return { ratio, visibleWidth, visibleHeight, meaningful: false, reason: 'sliver' };
}

export function isMeaningfullyVisible(input) {
  return measureVisibility(input).meaningful;
}
