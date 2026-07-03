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

// Wall rule for a section frame being resized by hand: the candidate frame
// must never invade a neighbouring section's frame. Clamps the candidate's
// edges back to SECTION_VS_SECTION_GAP short of each obstacle it would
// otherwise overlap — and never further out than the gesture's start edge,
// so a frame that already sat INSIDE the gap band (legacy persisted frames,
// tight layouts committed by the member-containment override) is frozen at
// its start position instead of silently losing the wall. Only an axis that
// was CLEAR of the obstacle at gesture start can be its wall — the other
// axis already shared a range (side-by-side frames always share an x- or
// y-band) and clamping it would teleport the frame. When both axes were
// clear (diagonal approach), the smaller intrusion is corrected, and
// `wallMemory` (an optional per-gesture Map keyed by obstacle index) keeps
// the first chosen wall while the obstacle is still hit so the clamped axis
// never flips mid-drag. Frames truly overlapping the obstacle on both axes
// at gesture start have no wall to hold and pass through unchanged. Rects
// are {left, top, right, bottom}; returns a new rect, never mutates.
// Clamping only shrinks toward startFrame, so resolving one obstacle can
// never create overlap with another.
export function clampFrameToNeighbors(candidate, startFrame, obstacles, gap = SECTION_VS_SECTION_GAP, wallMemory = null) {
  let { left, top, right, bottom } = candidate;
  const list = obstacles || [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r) continue;
    const xHit = left < r.right + gap && right > r.left - gap;
    const yHit = top < r.bottom + gap && bottom > r.top - gap;
    if (!xHit || !yHit) { wallMemory?.delete(i); continue; }
    const walls = [];
    if (startFrame.right <= r.left) { const v = Math.max(startFrame.right, r.left - gap); walls.push({ edge: 'right', v, cost: right - v }); }
    if (startFrame.left >= r.right) { const v = Math.min(startFrame.left, r.right + gap); walls.push({ edge: 'left', v, cost: v - left }); }
    if (startFrame.bottom <= r.top) { const v = Math.max(startFrame.bottom, r.top - gap); walls.push({ edge: 'bottom', v, cost: bottom - v }); }
    if (startFrame.top >= r.bottom) { const v = Math.min(startFrame.top, r.bottom + gap); walls.push({ edge: 'top', v, cost: v - top }); }
    if (!walls.length) continue;
    walls.sort((a, b) => a.cost - b.cost);
    let w = walls[0];
    const sticky = wallMemory?.get(i);
    if (sticky) w = walls.find((x) => x.edge === sticky) || w;
    wallMemory?.set(i, w.edge);
    if (w.edge === 'right') right = Math.min(right, w.v);
    else if (w.edge === 'left') left = Math.max(left, w.v);
    else if (w.edge === 'bottom') bottom = Math.min(bottom, w.v);
    else top = Math.max(top, w.v);
  }
  return { left, top, right, bottom };
}

// Wall rule for a section frame being MOVED by hand (grip drag): the frame
// translates rigidly, so instead of clamping edges we clamp the translation
// deltas — the dragged section slides along a neighbour's wall and stops
// SECTION_VS_SECTION_GAP short of it, never on top of it (and never pushes
// it: the DRAGGED frame is the one that yields). Same wall qualification as
// clampFrameToNeighbors: only an axis that was clear of the obstacle at
// gesture start can be its wall, gap-band starts are frozen at their start
// offset on that axis (still free to move away), truly-overlapping starts
// pass through, and `wallMemory` (optional per-gesture Map keyed by obstacle
// index) keeps a diagonal obstacle's first chosen wall so the clamped axis
// never flips mid-drag. Obstacles are {left, top, right, bottom} rects —
// neighbouring section frames AND loose node rects (a section must not cover
// a stray node either). Returns clamped { dx, dy }.
export function clampMoveToNeighbors(startFrame, dx, dy, obstacles, gap = SECTION_VS_SECTION_GAP, wallMemory = null) {
  let cdx = dx, cdy = dy;
  const list = obstacles || [];
  // Clamping one axis against obstacle A can slide the frame back into
  // obstacle B's band — re-run until stable. Bounded: every clamp only
  // shrinks a delta toward the start position, which was valid (or frozen).
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r) continue;
      const left = startFrame.left + cdx, right = startFrame.right + cdx;
      const top = startFrame.top + cdy, bottom = startFrame.bottom + cdy;
      const xHit = left < r.right + gap && right > r.left - gap;
      const yHit = top < r.bottom + gap && bottom > r.top - gap;
      if (!xHit || !yHit) {
        // Only the RAW deltas (pass 0) decide whether the obstacle was left
        // behind — later passes see post-clamp positions sitting exactly at
        // the wall, which would wrongly reset the hysteresis every call.
        if (pass === 0) wallMemory?.delete(i);
        continue;
      }
      const walls = [];
      if (startFrame.right <= r.left) {
        const lim = Math.max(startFrame.right, r.left - gap) - startFrame.right;
        walls.push({ axis: 'x', dir: 1, lim, cost: cdx - lim });
      }
      if (startFrame.left >= r.right) {
        const lim = Math.min(startFrame.left, r.right + gap) - startFrame.left;
        walls.push({ axis: 'x', dir: -1, lim, cost: lim - cdx });
      }
      if (startFrame.bottom <= r.top) {
        const lim = Math.max(startFrame.bottom, r.top - gap) - startFrame.bottom;
        walls.push({ axis: 'y', dir: 1, lim, cost: cdy - lim });
      }
      if (startFrame.top >= r.bottom) {
        const lim = Math.min(startFrame.top, r.bottom + gap) - startFrame.top;
        walls.push({ axis: 'y', dir: -1, lim, cost: lim - cdy });
      }
      if (!walls.length) continue;
      walls.sort((a, b) => a.cost - b.cost);
      let w = walls[0];
      const sticky = wallMemory?.get(i);
      if (sticky) w = walls.find((x) => x.axis === sticky.axis && x.dir === sticky.dir) || w;
      wallMemory?.set(i, { axis: w.axis, dir: w.dir });
      if (w.axis === 'x') {
        const next = w.dir === 1 ? Math.min(cdx, w.lim) : Math.max(cdx, w.lim);
        if (next !== cdx) { cdx = next; changed = true; }
      } else {
        const next = w.dir === 1 ? Math.min(cdy, w.lim) : Math.max(cdy, w.lim);
        if (next !== cdy) { cdy = next; changed = true; }
      }
    }
    if (!changed) break;
  }
  return { dx: cdx, dy: cdy };
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

// ── Agent chain layout (2026-07-03) ─────────────────────────────────────
// Layout planner for agent-built node chains (createWorkflow tool). The
// user's rule: a chain flows HORIZONTALLY — every dependency step (edge
// from → to) advances one column to the right; VARIANTS of the same thing
// (nodes at the same dependency depth) stack VERTICALLY within the column.
// Single-node columns take a gentle alternating vertical offset so the
// flow undulates instead of reading as a ruler line — pretty but organized,
// and the section stays horizontal.
//
// Pure: takes node dimensions + links, returns positions relative to a
// (0,0) top-left origin plus the total bbox — so the caller can measure
// the chain's full area BEFORE choosing a spot on the board.
const CHAIN_GAP_X = 360;   // between dependency columns (mirrors GAP_X)
const CHAIN_GAP_Y = 140;   // between stacked variants in a column
const CHAIN_ZIGZAG = 60;   // alternating vertical offset for 1-node columns

export function planChainLayout(specs, links) {
  const byKey = new Map(specs.map((s) => [s.key, s]));
  // Longest-path depth from the roots. Bounded relaxation — a cycle simply
  // stops advancing instead of hanging.
  const depth = new Map(specs.map((s) => [s.key, 0]));
  for (let pass = 0; pass < specs.length; pass++) {
    let changed = false;
    for (const l of links || []) {
      if (!byKey.has(l.from) || !byKey.has(l.to)) continue;
      const d = depth.get(l.from) + 1;
      if (d > depth.get(l.to) && d <= specs.length) { depth.set(l.to, d); changed = true; }
    }
    if (!changed) break;
  }
  // Columns by depth (input order preserved within a column).
  const colDepths = [...new Set([...depth.values()])].sort((a, b) => a - b);
  const columns = colDepths.map((d) => specs.filter((s) => depth.get(s.key) === d));
  let x = 0;
  const colX = [];
  for (const col of columns) {
    colX.push(x);
    x += Math.max(...col.map((s) => s.width || 0)) + CHAIN_GAP_X;
  }
  // Stack each column centered on a shared midline; single-node columns
  // zigzag around it.
  const positions = {};
  for (let c = 0; c < columns.length; c++) {
    const col = columns[c];
    const stackH = col.reduce((h, s) => h + (s.height || 0), 0) + CHAIN_GAP_Y * (col.length - 1);
    let y = -stackH / 2;
    if (col.length === 1) y += (c % 2 === 0 ? -1 : 1) * CHAIN_ZIGZAG;
    for (const s of col) {
      positions[s.key] = { x: colX[c], y };
      y += (s.height || 0) + CHAIN_GAP_Y;
    }
  }
  // Normalize to (0,0) and measure the bbox.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of specs) {
    const p = positions[s.key];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + (s.width || 0) > maxX) maxX = p.x + (s.width || 0);
    if (p.y + (s.height || 0) > maxY) maxY = p.y + (s.height || 0);
  }
  for (const s of specs) { positions[s.key].x -= minX; positions[s.key].y -= minY; }
  return { positions, width: maxX - minX, height: maxY - minY };
}

// Find a top-left origin for a w×h chain such that its future SECTION FRAME
// (side/top pads baked in) cannot overlap ANY existing node or section
// frame — the whole area is reserved BEFORE the first insert, so an
// agent-built chain always gets a spot of its own (sections never overlap).
// Strategy: to the RIGHT of all existing content (infinite canvas — always
// fits), frame top-aligned with the topmost existing content.
export async function placeChainOnBoard(boardId, w, h, sql) {
  const { rows, obstacles } = await loadBoardObstacles(boardId, sql);
  if (!rows.length) return { x: 0, y: 0 };
  let maxRight = -Infinity, minY = Infinity;
  for (const o of obstacles) {
    const r = (o.pos_x ?? 0) + (o.width ?? 0);
    if (r > maxRight) maxRight = r;
    if ((o.pos_y ?? 0) < minY) minY = o.pos_y ?? 0;
  }
  // Obstacle rects already include section frames; our own frame extends
  // SECTION_SIDE_PAD left of the first node — clear both plus breathing room.
  const x = maxRight + SECTION_SIDE_PAD + SECTION_VS_SECTION_GAP + BASE_CLEAR_GAP;
  const y = minY + SECTION_TOP_PAD;
  // Belt-and-suspenders: verify the padded frame against every obstacle and
  // push down if a stray rect still intersects (shouldn't, but boards drift).
  const fx = x - SECTION_SIDE_PAD;
  const fw = w + SECTION_SIDE_PAD * 2;
  const fh = h + SECTION_TOP_PAD + SECTION_SIDE_PAD;
  let fy = y - SECTION_TOP_PAD;
  for (let guard = 0; guard < 200; guard++) {
    let pushed = null;
    for (const o of obstacles) {
      if (rectsOverlap(fx, fy, fw, fh, o.pos_x ?? 0, o.pos_y ?? 0, o.width ?? 0, o.height ?? 0, SECTION_VS_SECTION_GAP)) {
        const below = (o.pos_y ?? 0) + (o.height ?? 0) + SECTION_VS_SECTION_GAP;
        if (pushed == null || below > pushed) pushed = below;
      }
    }
    if (pushed == null) break;
    fy = pushed;
  }
  return { x, y: fy + SECTION_TOP_PAD };
}
