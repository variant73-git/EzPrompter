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

// Padding a section frame adds around its members on the canvas. New
// standalone nodes must clear the whole frame, so they land WELL away from any
// existing section — not just away from the individual member nodes (a node
// could otherwise slip into the gap between two members and still sit inside
// the section's frame).
//
// These MIRROR the rendered footprint in CanvasClient (sectionCoreRect:
// SECTION_UNIFORM_GAP=165 sides/bottom, SECTION_TOP_GAP=260 top). The top is
// larger to reserve the section TITLE CHIP band — the chip is a stable on-
// screen size, so it occupies more world space when zoomed out. Without this,
// a new node lands in the chip's band and ends up hidden behind it. Keep in
// sync with CanvasClient.
const SECTION_SIDE_PAD = 165;
const SECTION_TOP_PAD = 260;

// Connected components of the board graph. Returns an array of member arrays
// (each member is a node row). Rows without an id are standalone and never
// joined. Shared by section-frame collision AND the section de-overlap planner.
function componentMembers(rows, edgeRows) {
  const byId = new Map();
  for (const r of rows) if (r.id) byId.set(r.id, r);
  const parent = new Map();
  for (const id of byId.keys()) parent.set(id, id);
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  for (const e of edgeRows || []) {
    const s = e.source_node_id, t = e.target_node_id;
    if (byId.has(s) && byId.has(t)) { const rs = find(s), rt = find(t); if (rs !== rt) parent.set(rs, rt); }
  }
  const groups = new Map();
  for (const id of byId.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(byId.get(id));
  }
  return [...groups.values()];
}

// The padded bounding box of a set of member nodes — MIRRORS the rendered
// section footprint (SECTION_TOP_PAD reserves the title-chip band). This is
// both the collision obstacle and the thing two sections must never overlap.
function frameRect(members) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of members) {
    const x = m.pos_x ?? 0, y = m.pos_y ?? 0, w = m.width ?? 0, h = m.height ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  return {
    pos_x: minX - SECTION_SIDE_PAD,
    pos_y: minY - SECTION_TOP_PAD,
    width: (maxX - minX) + SECTION_SIDE_PAD * 2,
    height: (maxY - minY) + SECTION_TOP_PAD + SECTION_SIDE_PAD,
  };
}

// A "section" is a connected component of the board graph with >= 2 nodes.
// Returns each section's padded bounding box (an obstacle rect).
//
// `excludeNodeId`: skip the section that CONTAINS this node. Used when placing
// a node that BELONGS to that section (e.g. an extracted/derived node landing
// next to its source) — its own section's frame must not shove it out.
function sectionRects(rows, edgeRows, excludeNodeId = null) {
  const rects = [];
  for (const members of componentMembers(rows, edgeRows)) {
    if (members.length < 2) continue;
    if (excludeNodeId && members.some((m) => m.id === excludeNodeId)) continue;
    rects.push(frameRect(members));
  }
  return rects;
}

// Gap kept BETWEEN two section frames after a de-overlap shift. The frames
// already bake in their own pads, so a small gap is plenty of breathing room.
const SECTION_VS_SECTION_GAP = 24;

// Pure planner for the "a section gets its OWN space" rule. Placement avoids
// collisions per node, but a section's FRAME is bigger than its member nodes
// (by the pads above), so a freshly-wired chain — built one node at a time —
// can form a section whose frame intrudes on a neighbour even though no two
// nodes touched. When an edge has just joined `activeNodeId` into a section,
// this computes the minimal DOWNWARD shift (consistent with every other
// placement path, which only pushes down) that clears the active section's
// frame from everything it must not cover: every OTHER section's frame AND
// every loose standalone node. Returns { ids, delta } of member nodes to move
// as a unit, or null when nothing overlaps.
export function planSectionDeoverlap(rows, edgeRows, activeNodeId, gap = SECTION_VS_SECTION_GAP) {
  const comps = componentMembers(rows, edgeRows);
  const active = comps.find((m) => m.some((n) => n.id === activeNodeId));
  if (!active || active.length < 2) return null;
  // Obstacles the active section's frame must clear: other sections become
  // their padded frame; a loose node (its own 1-node component) is its raw
  // rect — a section frame must not cover a stray node either.
  const others = [];
  for (const m of comps) {
    if (m === active) continue;
    others.push(m.length >= 2 ? frameRect(m) : m[0]);
  }
  if (!others.length) return null;
  const af = frameRect(active);
  const { y: newY } = resolveDownCollision(af.pos_x, af.pos_y, af.width, af.height, others, gap);
  const delta = newY - af.pos_y;
  if (delta <= 0) return null;
  return { ids: active.map((n) => n.id).filter(Boolean), delta };
}

// DB-applying wrapper: read the board, plan the shift, and move the active
// section's nodes as a UNIT so its frame no longer overlaps any other section.
// Safe to call after every edge insert — a no-op when there's nothing to fix,
// and it never throws into the caller (edge creation must succeed regardless).
export async function deoverlapSectionForEdge(boardId, sql, activeNodeId) {
  try {
    const rows = await sql`SELECT id, pos_x, pos_y, width, height FROM nodes WHERE board_id = ${boardId}`;
    if (!rows.length) return { moved: 0 };
    const edgeRows = await sql`SELECT source_node_id, target_node_id FROM edges WHERE board_id = ${boardId}`;
    const plan = planSectionDeoverlap(rows, edgeRows, activeNodeId);
    if (!plan) return { moved: 0 };
    await sql`UPDATE nodes SET pos_y = pos_y + ${plan.delta} WHERE board_id = ${boardId} AND id = ANY(${plan.ids})`;
    return { moved: plan.ids.length, delta: plan.delta };
  } catch (e) {
    console.warn('[canvas-layout] deoverlapSectionForEdge failed', e?.message || e);
    return { moved: 0 };
  }
}

// Load the board's collision obstacles: every node rect PLUS a padded frame
// rect for each section (>= 2 connected nodes). Returns { rows, obstacles }.
// `excludeSectionOf`: omit the frame of the section containing this node.
async function loadBoardObstacles(boardId, sql, excludeSectionOf = null) {
  const rows = await sql`
    SELECT id, pos_x, pos_y, width, height FROM nodes WHERE board_id = ${boardId}
  `;
  if (!rows.length) return { rows, obstacles: [] };
  const edgeRows = await sql`
    SELECT source_node_id, target_node_id FROM edges WHERE board_id = ${boardId}
  `;
  return { rows, obstacles: [...rows, ...sectionRects(rows, edgeRows, excludeSectionOf)] };
}

// Resolve ANY candidate position against the live board so it never overlaps
// an existing node OR section frame. Used by paths that already have a target
// (x, y) — e.g. the agent passing explicit coords, or a cord-drop extract.
// `excludeSectionOf`: a node whose section the candidate is JOINING — its
// frame is not treated as an obstacle (so a derived node lands next to its
// source instead of being flung out below the section).
export async function resolvePlacement(boardId, x, y, w, h, sql, excludeSectionOf = null) {
  const { rows, obstacles } = await loadBoardObstacles(boardId, sql, excludeSectionOf);
  if (!rows.length) return { x, y };
  return resolveDownCollision(x, y, w, h, obstacles, clearGapFor(rows.length));
}

export async function placeStackDown(boardId, w, h, sql) {
  const { rows, obstacles } = await loadBoardObstacles(boardId, sql);
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
  // Final guard: never overlap ANY node OR section frame (a node/section in
  // another column could still sit under this x-range). Push down to clear.
  return resolveDownCollision(columnX, candidateY, w, h, obstacles, clearGapFor(rows.length));
}

export async function placeRightOfSources(boardId, sourceNodeIds, w, h, sql) {
  if (!Array.isArray(sourceNodeIds) || sourceNodeIds.length === 0) {
    return placeStackDown(boardId, w, h, sql);
  }
  // All nodes + section frames for the collision pass, not just the sources.
  const { rows, obstacles } = await loadBoardObstacles(boardId, sql);
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
  // Don't land on an existing node OR section frame at that y to the right
  // of the sources — push down until clear.
  return resolveDownCollision(x, candidateY, w, h, obstacles, clearGapFor(rows.length));
}
