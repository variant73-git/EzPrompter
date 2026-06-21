/**
 * Pure helpers for section membership stickiness + the organic node-removal
 * gesture. Kept DOM-free and side-effect-free so they're unit-testable; the
 * stateful wiring lives in CanvasClient.
 *
 * See docs/superpowers/specs/2026-06-20-section-membership-removal-design.md.
 */

// Is a point inside a rect (inclusive)? rect = {left, top, right, bottom}.
export function pointInRect(cx, cy, rect) {
  if (!rect) return false;
  return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
}

// Center point of a node placed at (posX, posY).
export function nodeCenter(node, posX, posY) {
  const x = posX != null ? posX : (node.pos_x || 0);
  const y = posY != null ? posY : (node.pos_y || 0);
  return { cx: x + (node.width || 0) / 2, cy: y + (node.height || 0) / 2 };
}

// The dragged node "tears out" of its section when its center clears the core
// of the REMAINING members by `margin` on any side. Using the remaining-core
// (which does not chase the dragged node) gives a stable, predictable
// threshold: small moves stretch the frame, a decisive pull past the margin
// detaches. Returns false when there's no remaining core (nothing to leave).
export function shouldTearOut(cx, cy, remainingCore, margin) {
  if (!remainingCore) return false;
  const expanded = {
    left: remainingCore.left - margin,
    top: remainingCore.top - margin,
    right: remainingCore.right + margin,
    bottom: remainingCore.bottom + margin,
  };
  return !pointInRect(cx, cy, expanded);
}

// Members that belong to a section ONLY geometrically — no real edge and no
// persisted adoption marker — and therefore need their membership latched
// (write meta.adoptedInto = section root) so it survives future position
// changes. Returns [{ nodeId, rootId }]. `edgeTouchedSet` is the set of node
// ids that have at least one real edge; `nodeById` maps id → node row.
export function selectGeometricMembersToLatch({ sections, nodeById, edgeTouchedSet }) {
  const out = [];
  for (const s of sections || []) {
    if (!s.memberIds || s.memberIds.length < 2) continue;
    for (const id of s.memberIds) {
      if (String(id).startsWith('temp-')) continue;
      if (edgeTouchedSet.has(id)) continue;            // edge member — already sticky
      const n = nodeById.get(id);
      if (!n) continue;
      if (n.meta?.adoptedInto) continue;               // already latched
      out.push({ nodeId: id, rootId: s.rootId });
    }
  }
  return out;
}

// How far past the remaining-core the dragged node's center must travel to
// detach (world px). Calibrated for a decisive pull, not an accidental nudge.
export const TEAR_MARGIN = 70;
