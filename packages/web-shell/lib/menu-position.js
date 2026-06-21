// Clamp a menu's top-left so the WHOLE box stays inside the viewport with a
// margin — it flips off the far edge instead of overflowing. The old call
// sites used fixed-size Math.min guesses that couldn't know the real height,
// so tall menus (e.g. the Connect-to / Extract menu) ran off the bottom.
// Pure of the DOM (vw/vh passed in) so it's unit-testable.
export function clampToViewport(x, y, w, h, vw, vh, margin = 8) {
  let left = x, top = y;
  if (left + w > vw - margin) left = vw - margin - w;
  if (top + h > vh - margin) top = vh - margin - h;
  return { left: Math.max(margin, left), top: Math.max(margin, top) };
}
