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
  if (!any) return { x: columnX, y: 0 };
  return { x: columnX, y: maxBottom + GAP_Y };
}

export async function placeRightOfSources(boardId, sourceNodeIds, w, h, sql) {
  if (!Array.isArray(sourceNodeIds) || sourceNodeIds.length === 0) {
    return placeStackDown(boardId, w, h, sql);
  }
  const sources = await sql`
    SELECT pos_x, pos_y, width, height FROM nodes
    WHERE board_id = ${boardId} AND id = ANY(${sourceNodeIds})
  `;
  if (!sources.length) return placeStackDown(boardId, w, h, sql);
  let maxRight = -Infinity;
  let sumCenterY = 0;
  for (const s of sources) {
    const right = (s.pos_x ?? 0) + (s.width ?? 0);
    if (right > maxRight) maxRight = right;
    sumCenterY += (s.pos_y ?? 0) + (s.height ?? 0) / 2;
  }
  const avgCenterY = sumCenterY / sources.length;
  return {
    x: maxRight + GAP_X,
    y: Math.round(avgCenterY - h / 2),
  };
}
