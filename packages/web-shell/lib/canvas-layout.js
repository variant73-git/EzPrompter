/**
 * Shared placement helpers for tools / routes that auto-add nodes to the
 * canvas. Replaces the naive "MAX(pos_x + width) + GAP" pattern that put
 * every new node in a straight horizontal line — when the agent built a
 * workflow with 3+ nodes, edges crossing later inputs ran straight
 * through earlier node bodies.
 *
 * Two placement strategies:
 *
 *  - placeStackDown(boardId, w, h, sql)   — inputs / generic creates.
 *      Stack vertically in the rightmost column already in use. The
 *      previous heuristic spread inputs horizontally, which forced
 *      downstream result nodes to span them and cross edges with
 *      neighbours. Now repeated calls in the same turn pile under the
 *      previous one.
 *
 *  - placeRightOfSources(boardId, sourceNodeIds, w, h, sql) — outputs
 *      that feed off existing nodes. Result lands to the right of every
 *      source, vertically centered between them so the two cords meet
 *      at the result's left edge without crossing each other.
 *
 * Both fall back to (0, 0) on empty boards, never throw.
 */

const COL_TOLERANCE = 80;   // x-distance treated as "same column"
const GAP_X = 360;
const GAP_Y = 200;

// Minimum empty space kept around any newly-placed node. The user's rule:
// at least 100px clearance from every existing node/section, allowed to
// shrink proportionally once the board is crowded so a busy board doesn't
// keep flinging new nodes ever-further away. Base 100 → floor 40 as the
// node count climbs.
const BASE_CLEAR_GAP = 100;
const MIN_CLEAR_GAP = 40;
function clearGapFor(nodeCount) {
  // Full linear shrink reached at ~40 nodes; clamped to [40, 100].
  const shrunk = BASE_CLEAR_GAP * (1 - Math.min(nodeCount, 40) / 80);
  return Math.round(Math.max(MIN_CLEAR_GAP, shrunk));
}

// Do two rects (a = candidate, b = existing node) overlap, treating `gap`
// as required empty space around the candidate so they never even touch?
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh, gap) {
  return (
    ax - gap < bx + bw &&
    ax + aw + gap > bx &&
    ay - gap < by + bh &&
    ay + ah + gap > by
  );
}

// Given a candidate top-left (x, y) for a w×h node and the full set of
// existing node rects, push the candidate straight DOWN until it clears
// every node with `gap` breathing room. Pushing down (not sideways) keeps
// column alignment and avoids landing back on the source nodes that sit to
// the left. Bounded loop so a pathological board can't hang.
function resolveDownCollision(x, y, w, h, rows, gap) {
  let cy = y;
  for (let guard = 0; guard < 500; guard++) {
    let pushedTo = null;
    for (const r of rows) {
      const rx = r.pos_x ?? 0, ry = r.pos_y ?? 0, rw = r.width ?? 0, rh = r.height ?? 0;
      if (rectsOverlap(x, cy, w, h, rx, ry, rw, rh, gap)) {
        const below = ry + rh + gap;             // clear past this node
        if (pushedTo == null || below > pushedTo) pushedTo = below;
      }
    }
    if (pushedTo == null) break;                  // no overlap → done
    cy = pushedTo;
  }
  return { x, y: cy };
}

// Resolve ANY candidate position against the live board so it never overlaps
// an existing node. Used by paths that already have a target (x, y) — e.g.
// the agent passing explicit coords — so even those can't land on a node.
export async function resolvePlacement(boardId, x, y, w, h, sql) {
  const rows = await sql`
    SELECT pos_x, pos_y, width, height FROM nodes WHERE board_id = ${boardId}
  `;
  if (!rows.length) return { x, y };
  return resolveDownCollision(x, y, w, h, rows, clearGapFor(rows.length));
}

export async function placeStackDown(boardId, w, h, sql) {
  const rows = await sql`
    SELECT pos_x, pos_y, width, height FROM nodes WHERE board_id = ${boardId}
  `;
  if (!rows.length) return { x: 0, y: 0 };
  // Rightmost LEFT-edge defines the active column.
  let columnX = rows[0].pos_x;
  for (const r of rows) if (r.pos_x > columnX) columnX = r.pos_x;
  // Find the lowest bottom edge of any node in that column.
  let maxBottom = -Infinity;
  let any = false;
  for (const r of rows) {
    if (Math.abs(r.pos_x - columnX) <= COL_TOLERANCE) {
      any = true;
      const b = (r.pos_y ?? 0) + (r.height ?? 0);
      if (b > maxBottom) maxBottom = b;
    }
  }
  const candidateY = any ? maxBottom + GAP_Y : 0;
  // Final guard: never overlap ANY node (a node in another column could
  // still sit under this x-range). Push down until fully clear.
  return resolveDownCollision(columnX, candidateY, w, h, rows, clearGapFor(rows.length));
}

export async function placeRightOfSources(boardId, sourceNodeIds, w, h, sql) {
  if (!Array.isArray(sourceNodeIds) || sourceNodeIds.length === 0) {
    return placeStackDown(boardId, w, h, sql);
  }
  // Need ALL nodes for the collision pass, not just the sources.
  const rows = await sql`
    SELECT id, pos_x, pos_y, width, height FROM nodes WHERE board_id = ${boardId}
  `;
  const sources = rows.filter((r) => sourceNodeIds.includes(r.id));
  if (!sources.length) return placeStackDown(boardId, w, h, sql);
  let maxRight = -Infinity;
  let sumCenterY = 0;
  for (const s of sources) {
    const right = (s.pos_x ?? 0) + (s.width ?? 0);
    if (right > maxRight) maxRight = right;
    sumCenterY += (s.pos_y ?? 0) + (s.height ?? 0) / 2;
  }
  const avgCenterY = sumCenterY / sources.length;
  const x = maxRight + GAP_X;
  const candidateY = Math.round(avgCenterY - h / 2);
  // Don't land on an existing node that happens to sit at that y to the
  // right of the sources — push down until clear.
  return resolveDownCollision(x, candidateY, w, h, rows, clearGapFor(rows.length));
}
