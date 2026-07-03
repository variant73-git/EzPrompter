import { describe, it, expect } from 'vitest';
import { placeStackDown, placeRightOfSources, resolvePlacement, planSectionDeoverlap, clampFrameToNeighbors, clampMoveToNeighbors, planChainLayout, placeChainOnBoard } from './canvas-layout.js';

// The placement helpers call `sql` as a tagged template and return rows.
// A fake that ignores the template and resolves to a fixed row set is enough.
// (Helpers now also query edges; with this single-value fake the edge query
// returns node rows, which have no source/target_node_id → no sections form,
// so legacy tests behave exactly as before.)
const fakeSql = (rows) => () => Promise.resolve(rows);

// Sequenced fake: returns `nodes` on the first sql call, `edges` on the
// second — matches loadBoardObstacles's (nodes, edges) query order.
const seqSql = (nodes, edges) => { let i = 0; return () => Promise.resolve(i++ === 0 ? nodes : edges); };

// Does a placed w×h node at (x,y) overlap rect r (no gap — strict overlap)?
function overlapsNode(x, y, w, h, r) {
  return (
    x < r.pos_x + r.width &&
    x + w > r.pos_x &&
    y < r.pos_y + r.height &&
    y + h > r.pos_y
  );
}

describe('placeStackDown', () => {
  it('returns (0,0) on an empty board', async () => {
    expect(await placeStackDown('b', 200, 200, fakeSql([]))).toEqual({ x: 0, y: 0 });
  });

  it('stacks below the column and never overlaps that node', async () => {
    const rows = [{ pos_x: 0, pos_y: 0, width: 200, height: 200 }];
    const p = await placeStackDown('b', 200, 200, fakeSql(rows));
    expect(p.x).toBe(0);
    expect(overlapsNode(p.x, p.y, 200, 200, rows[0])).toBe(false);
  });

  it('clears a node in another column that sits under the candidate x-range', async () => {
    const rows = [
      { pos_x: 0,   pos_y: 0,   width: 200, height: 200 },
      { pos_x: 500, pos_y: 0,   width: 200, height: 200 }, // defines column
      { pos_x: 520, pos_y: 360, width: 200, height: 600 }, // blocks the stack
    ];
    const p = await placeStackDown('b', 200, 200, fakeSql(rows));
    for (const r of rows) expect(overlapsNode(p.x, p.y, 200, 200, r)).toBe(false);
  });
});

describe('placeRightOfSources', () => {
  it('places to the right of the source and clears collisions there', async () => {
    const rows = [
      { id: 's1',      pos_x: 0,   pos_y: 0,    width: 200, height: 200 },
      { id: 'blocker', pos_x: 560, pos_y: -100, width: 200, height: 400 }, // sits at the result spot
    ];
    const p = await placeRightOfSources('b', ['s1'], 200, 200, fakeSql(rows));
    expect(p.x).toBe(200 + 360); // maxRight (200) + GAP_X (360)
    for (const r of rows) expect(overlapsNode(p.x, p.y, 200, 200, r)).toBe(false);
  });

  it('falls back to stack-down when sources are missing', async () => {
    const rows = [{ id: 'other', pos_x: 0, pos_y: 0, width: 200, height: 200 }];
    const p = await placeRightOfSources('b', ['nope'], 200, 200, fakeSql(rows));
    expect(overlapsNode(p.x, p.y, 200, 200, rows[0])).toBe(false);
  });
});

describe('resolvePlacement', () => {
  it('keeps a clear candidate where it is', async () => {
    const rows = [{ pos_x: 0, pos_y: 0, width: 200, height: 200 }];
    const p = await resolvePlacement('b', 1000, 1000, 200, 200, fakeSql(rows));
    expect(p).toEqual({ x: 1000, y: 1000 });
  });

  it('pushes an overlapping explicit candidate clear of the node', async () => {
    const rows = [{ pos_x: 0, pos_y: 0, width: 400, height: 400 }];
    // Explicit coords land right on top of the node — must be resolved.
    const p = await resolvePlacement('b', 50, 50, 200, 200, fakeSql(rows));
    expect(overlapsNode(p.x, p.y, 200, 200, rows[0])).toBe(false);
    expect(p.y).toBeGreaterThanOrEqual(400); // pushed below the node
  });

  it('returns the candidate unchanged on an empty board', async () => {
    const p = await resolvePlacement('b', 30, 40, 200, 200, fakeSql([]));
    expect(p).toEqual({ x: 30, y: 40 });
  });
});

describe('section-aware placement (keep new nodes clear of section frames)', () => {
  it('clears the whole section frame, not just individual members', async () => {
    // Two connected nodes (a→b) form a section with a 400px gap between them.
    const nodes = [
      { id: 'a', pos_x: 0, pos_y: 0,   width: 300, height: 300 },
      { id: 'b', pos_x: 0, pos_y: 700, width: 300, height: 300 },
    ];
    const edges = [{ source_node_id: 'a', target_node_id: 'b' }];
    // Candidate dropped into the gap between a and b.
    const p = await resolvePlacement('board', 0, 400, 200, 200, seqSql(nodes, edges));
    // Section frame now mirrors the rendered footprint: y[-260 .. 1000+165].
    // The node must be pushed below the whole frame.
    expect(p.y).toBeGreaterThanOrEqual(1165);
  });

  it('reserves the title-chip band above a section (new node never lands behind the chip)', async () => {
    const nodes = [
      { id: 'a', pos_x: 0, pos_y: 1000, width: 300, height: 300 },
      { id: 'b', pos_x: 0, pos_y: 1700, width: 300, height: 300 },
    ];
    const edges = [{ source_node_id: 'a', target_node_id: 'b' }];
    // Drop a candidate in the band just ABOVE the top member (y 800), where
    // the section TITLE CHIP lives (within the 260px top reservation). It must
    // not stay there — it clears the whole frame and lands below the bottom.
    const p = await resolvePlacement('board', 0, 800, 200, 200, seqSql(nodes, edges));
    expect(p.y).toBeGreaterThanOrEqual(2165); // maxY 2000 + 165 bottom pad
  });

  it('does NOT treat two unconnected nodes as a section (gap is usable)', async () => {
    const nodes = [
      { id: 'a', pos_x: 0, pos_y: 0,   width: 300, height: 300 },
      { id: 'b', pos_x: 0, pos_y: 700, width: 300, height: 300 },
    ];
    const edges = []; // no edge → no section
    const p = await resolvePlacement('board', 0, 400, 200, 200, seqSql(nodes, edges));
    expect(p.y).toBeLessThan(700); // stays in the gap; only clears the nodes
  });

  it('excludeSectionOf lets a derived node land inside its source section', async () => {
    // a→b form a section. Extracting from `a` and dropping to the right (in
    // empty space inside the section) must KEEP the node there — not shove it
    // out below the frame.
    const nodes = [
      { id: 'a', pos_x: 1000, pos_y: 1000, width: 400, height: 400 },
      { id: 'b', pos_x: 1000, pos_y: 1700, width: 400, height: 400 },
    ];
    const edges = [{ source_node_id: 'a', target_node_id: 'b' }];
    // Without the exclusion, the source's own frame flings it far down.
    const flung = await resolvePlacement('board', 1500, 1050, 600, 600, seqSql(nodes, edges));
    expect(flung.y).toBeGreaterThan(1050);
    // With the exclusion, it stays at the drop point.
    const kept = await resolvePlacement('board', 1500, 1050, 600, 600, seqSql(nodes, edges), 'a');
    expect(kept).toEqual({ x: 1500, y: 1050 });
  });
});

describe('planSectionDeoverlap (#3 — sections must never overlap)', () => {
  // Section A (existing): a1→a2 stacked at the top.
  const sectionA = [
    { id: 'a1', pos_x: 0, pos_y: 0, width: 200, height: 200 },
    { id: 'a2', pos_x: 0, pos_y: 300, width: 200, height: 200 },
  ];
  const edgeA = { source_node_id: 'a1', target_node_id: 'a2' };

  it('shifts the active section down when its frame intrudes on a neighbour', () => {
    // Section B (just wired) sits only ~100px below A's nodes — no node
    // collides, but B's frame (260px title band on top) overlaps A's frame.
    const nodes = [
      ...sectionA,
      { id: 'b1', pos_x: 0, pos_y: 600, width: 200, height: 200 },
      { id: 'b2', pos_x: 0, pos_y: 900, width: 200, height: 200 },
    ];
    const edges = [edgeA, { source_node_id: 'b1', target_node_id: 'b2' }];
    const plan = planSectionDeoverlap(nodes, edges, 'b2');
    expect(plan).not.toBeNull();
    expect([...plan.ids].sort()).toEqual(['b1', 'b2']);
    // A's frame bottom is y=665 (maxY 500 + SIDE_PAD 165); B's frame top is
    // y=340 (minY 600 − TOP_PAD 260). Clearing with the 24px gap pushes B's
    // frame top to 689 → delta 349.
    expect(plan.delta).toBe(349);
  });

  it('returns null when the two sections are already clear of each other', () => {
    const nodes = [
      ...sectionA,
      { id: 'b1', pos_x: 0, pos_y: 2000, width: 200, height: 200 },
      { id: 'b2', pos_x: 0, pos_y: 2300, width: 200, height: 200 },
    ];
    const edges = [edgeA, { source_node_id: 'b1', target_node_id: 'b2' }];
    expect(planSectionDeoverlap(nodes, edges, 'b2')).toBeNull();
  });

  it('returns null when there is only one section (nothing to clear against)', () => {
    const edges = [edgeA];
    expect(planSectionDeoverlap(sectionA, edges, 'a2')).toBeNull();
  });

  it('returns null when the active node is standalone (no section formed)', () => {
    const nodes = [...sectionA, { id: 'loner', pos_x: 0, pos_y: 5000, width: 200, height: 200 }];
    const edges = [edgeA];
    expect(planSectionDeoverlap(nodes, edges, 'loner')).toBeNull();
  });

  it('shifts the active section down when its frame would cover a LOOSE node', () => {
    // A stray node `L` sits just above where section B forms. No edge touches
    // L, but B's frame (260px title band on top) would cover it. The section
    // must clear the loose node too, not just other sections.
    const nodes = [
      { id: 'L', pos_x: 0, pos_y: 0, width: 200, height: 200 },
      { id: 'b1', pos_x: 0, pos_y: 400, width: 200, height: 200 },
      { id: 'b2', pos_x: 0, pos_y: 700, width: 200, height: 200 },
    ];
    const edges = [{ source_node_id: 'b1', target_node_id: 'b2' }];
    const plan = planSectionDeoverlap(nodes, edges, 'b2');
    expect(plan).not.toBeNull();
    expect([...plan.ids].sort()).toEqual(['b1', 'b2']);
    // B's frame top is y=140 (minY 400 − TOP_PAD 260); L's bottom is y=200.
    // Clearing with the 24px gap pushes B's frame top to 224 → delta 84.
    expect(plan.delta).toBe(84);
  });
});

describe('clampFrameToNeighbors (#5 — resize never invades another section)', () => {
  // Frames as the client passes them: {left, top, right, bottom}. Gap = 24.
  const start = { left: 0, top: 0, right: 400, bottom: 400 };

  it('leaves a frame alone when it stays clear of every neighbour', () => {
    const neighbor = { left: 1000, top: 0, right: 1400, bottom: 400 };
    const candidate = { ...start, right: 700 };
    expect(clampFrameToNeighbors(candidate, start, [neighbor])).toEqual(candidate);
  });

  it('holds the right edge at the wall when growing into a neighbour on the right', () => {
    const neighbor = { left: 600, top: 0, right: 1000, bottom: 400 };
    const candidate = { ...start, right: 800 }; // dragged well past the neighbour's left
    const out = clampFrameToNeighbors(candidate, start, [neighbor]);
    expect(out.right).toBe(600 - 24); // neighbour.left − gap
    expect(out.left).toBe(start.left);
    expect(out.top).toBe(start.top);
    expect(out.bottom).toBe(start.bottom);
  });

  it('holds the left edge when growing into a neighbour on the left', () => {
    const neighbor = { left: -1000, top: 0, right: -200, bottom: 400 };
    const candidate = { ...start, left: -500 };
    const out = clampFrameToNeighbors(candidate, start, [neighbor]);
    expect(out.left).toBe(-200 + 24); // neighbour.right + gap
  });

  it('holds the bottom edge when growing into a neighbour below', () => {
    const neighbor = { left: 0, top: 600, right: 400, bottom: 1000 };
    const candidate = { ...start, bottom: 900 };
    const out = clampFrameToNeighbors(candidate, start, [neighbor]);
    expect(out.bottom).toBe(600 - 24); // neighbour.top − gap
  });

  it('holds the top edge when growing into a neighbour above', () => {
    const neighbor = { left: 0, top: -1000, right: 400, bottom: -200 };
    const candidate = { ...start, top: -500 };
    const out = clampFrameToNeighbors(candidate, start, [neighbor]);
    expect(out.top).toBe(-200 + 24); // neighbour.bottom + gap
  });

  it('corrects the smaller intrusion on a diagonal approach (both axes were clear)', () => {
    // Neighbour sits diagonally down-right; SE drag intrudes 76px in x and
    // 176px in y → the x correction is cheaper, so only `right` is clamped.
    const neighbor = { left: 600, top: 600, right: 1000, bottom: 1000 };
    const candidate = { ...start, right: 652, bottom: 752 };
    const out = clampFrameToNeighbors(candidate, start, [neighbor]);
    expect(out.right).toBe(600 - 24);
    expect(out.bottom).toBe(752); // untouched — x clamp alone clears the overlap
  });

  it('passes through frames that already overlapped at gesture start (no wall to hold)', () => {
    const neighbor = { left: 200, top: 200, right: 800, bottom: 800 }; // overlaps `start` on both axes
    const candidate = { ...start, right: 500, bottom: 500 };
    expect(clampFrameToNeighbors(candidate, start, [neighbor])).toEqual(candidate);
  });

  it('clamps against several neighbours independently', () => {
    const rightWall = { left: 700, top: 0, right: 1100, bottom: 400 };
    const bottomWall = { left: 0, top: 900, right: 400, bottom: 1300 };
    const candidate = { ...start, right: 900, bottom: 1100 }; // SE drag into both
    const out = clampFrameToNeighbors(candidate, start, [rightWall, bottomWall]);
    expect(out.right).toBe(700 - 24);
    expect(out.bottom).toBe(900 - 24);
  });

  it('never clamps past the start frame (a resting frame at the gap boundary stays put)', () => {
    // Start frame already exactly 24px from the neighbour; dragging further
    // right is fully rejected, back to the start edge.
    const neighbor = { left: 424, top: 0, right: 800, bottom: 400 };
    const candidate = { ...start, right: 500 };
    const out = clampFrameToNeighbors(candidate, start, [neighbor]);
    expect(out.right).toBe(400);
  });

  it('still holds the wall when the start frame sits INSIDE the gap band (legacy tight frames)', () => {
    // Frames only 20px apart (violating the 24px gap) but NOT overlapping —
    // e.g. persisted pre-wall layouts. The wall must freeze the edge at its
    // start position, not silently vanish and allow a full invasion.
    const tightStart = { left: 0, top: 0, right: 480, bottom: 400 };
    const neighbor = { left: 500, top: 0, right: 900, bottom: 400 };
    const out = clampFrameToNeighbors({ ...tightStart, right: 800 }, tightStart, [neighbor]);
    expect(out.right).toBe(480); // frozen at the start edge — no pass-through
  });

  it('wallMemory keeps the first chosen wall for the whole gesture (no mid-drag axis flip)', () => {
    const neighbor = { left: 600, top: 600, right: 1000, bottom: 1000 };
    const memory = new Map();
    // First move: x-intrusion (76) cheaper than y (176) → right clamped.
    const first = clampFrameToNeighbors({ ...start, right: 652, bottom: 752 }, start, [neighbor], undefined, memory);
    expect(first.right).toBe(576);
    expect(first.bottom).toBe(752);
    // Later move: y-intrusion (76) is now cheaper than x (324), but the
    // remembered wall sticks — still the right edge, bottom stays free.
    const second = clampFrameToNeighbors({ ...start, right: 900, bottom: 652 }, start, [neighbor], undefined, memory);
    expect(second.right).toBe(576);
    expect(second.bottom).toBe(652);
  });
});

describe('clampMoveToNeighbors (section drag never lands on other elements)', () => {
  // The dragged section's frame at gesture start; obstacles are neighbour
  // frames or loose node rects. Gap = 24.
  const start = { left: 0, top: 0, right: 400, bottom: 400 };

  it('leaves the deltas alone when the path is clear', () => {
    const neighbor = { left: 1000, top: 0, right: 1400, bottom: 400 };
    expect(clampMoveToNeighbors(start, 300, 50, [neighbor])).toEqual({ dx: 300, dy: 50 });
    expect(clampMoveToNeighbors(start, 300, 50, [])).toEqual({ dx: 300, dy: 50 });
  });

  it('stops the drag at the gap before a neighbour frame on the right', () => {
    const neighbor = { left: 600, top: 0, right: 1000, bottom: 400 };
    const out = clampMoveToNeighbors(start, 300, 0, [neighbor]);
    expect(out).toEqual({ dx: 176, dy: 0 }); // frame right lands at 576 = 600 − 24
  });

  it('slides along the wall — the blocked axis clamps, the free axis keeps moving', () => {
    const neighbor = { left: 600, top: 0, right: 1000, bottom: 400 };
    const out = clampMoveToNeighbors(start, 300, 100, [neighbor]);
    expect(out).toEqual({ dx: 176, dy: 100 });
  });

  it('lets the frame pass once it has cleared the neighbour band', () => {
    const neighbor = { left: 600, top: 0, right: 1000, bottom: 400 };
    // Dropped low enough that the y-bands no longer overlap — x is free.
    const out = clampMoveToNeighbors(start, 300, 500, [neighbor]);
    expect(out).toEqual({ dx: 300, dy: 500 });
  });

  it('stops the drag before an obstacle below', () => {
    const neighbor = { left: 0, top: 600, right: 400, bottom: 1000 };
    const out = clampMoveToNeighbors(start, 0, 300, [neighbor]);
    expect(out).toEqual({ dx: 0, dy: 176 }); // frame bottom lands at 576 = 600 − 24
  });

  it('a loose node rect is a wall too — the frame can never cover it', () => {
    const looseNode = { left: 500, top: 100, right: 700, bottom: 300 };
    const out = clampMoveToNeighbors(start, 200, 0, [looseNode]);
    expect(out).toEqual({ dx: 76, dy: 0 }); // frame right lands at 476 = 500 − 24
  });

  it('freezes a gap-violating start toward the obstacle but stays free moving away', () => {
    const tightStart = { left: 0, top: 0, right: 480, bottom: 400 };
    const neighbor = { left: 500, top: 0, right: 900, bottom: 400 }; // only 20px away
    expect(clampMoveToNeighbors(tightStart, 100, 0, [neighbor])).toEqual({ dx: 0, dy: 0 });
    expect(clampMoveToNeighbors(tightStart, -100, 0, [neighbor])).toEqual({ dx: -100, dy: 0 });
  });

  it('wallMemory keeps the first chosen wall across moves (no mid-drag axis flip)', () => {
    const neighbor = { left: 600, top: 600, right: 1000, bottom: 1000 };
    const memory = new Map();
    // First move: x-intrusion (76) cheaper than y (176) → x clamps.
    expect(clampMoveToNeighbors(start, 252, 352, [neighbor], undefined, memory)).toEqual({ dx: 176, dy: 352 });
    // Later move: y-intrusion is now cheaper, but the remembered x-wall sticks.
    expect(clampMoveToNeighbors(start, 500, 252, [neighbor], undefined, memory)).toEqual({ dx: 176, dy: 252 });
  });

  it('a zero-size point obstacle walls the frame (foreign node centers vs the moved core)', () => {
    // The core wall in startSectionMove: each non-member node's CENTER is a
    // point obstacle for the section's core rect, gap 1 — the center must
    // never end inside the core (that's what geometric absorption tests).
    const core = { left: 0, top: 0, right: 400, bottom: 400 };
    const center = { left: 500, top: 200, right: 500, bottom: 200 };
    const out = clampMoveToNeighbors(core, 200, 0, [center], 1);
    expect(out).toEqual({ dx: 99, dy: 0 }); // core right stops at 499 — center stays strictly outside
  });

  it('clamps against several obstacles independently (corner pocket drop)', () => {
    // Tall wall on the right + wide wall below form a corner pocket. A
    // diagonal drag into the corner stops at BOTH gaps.
    const rightWall = { left: 700, top: 0, right: 1100, bottom: 1300 };
    const bottomWall = { left: 0, top: 900, right: 1100, bottom: 1300 };
    const out = clampMoveToNeighbors(start, 500, 700, [rightWall, bottomWall]);
    expect(out).toEqual({ dx: 276, dy: 476 }); // right at 676 = 700−24, bottom at 876 = 900−24
  });
});

describe('planChainLayout (agent chains: horizontal sequence, vertical variants)', () => {
  it('lays a dependency sequence out horizontally (columns advance rightward)', () => {
    const specs = [
      { key: 'brief', width: 600, height: 200 },
      { key: 'site',  width: 1280, height: 720 },
    ];
    const plan = planChainLayout(specs, [{ from: 'brief', to: 'site' }]);
    expect(plan.positions.site.x).toBeGreaterThan(plan.positions.brief.x + 600);
    expect(plan.width).toBeGreaterThanOrEqual(600 + 1280);
  });

  it('stacks variants (same depth) vertically in the same column', () => {
    const specs = [
      { key: 'brief', width: 600, height: 200 },
      { key: 'v1', width: 1280, height: 720 },
      { key: 'v2', width: 1280, height: 720 },
    ];
    const plan = planChainLayout(specs, [
      { from: 'brief', to: 'v1' },
      { from: 'brief', to: 'v2' },
    ]);
    expect(plan.positions.v1.x).toBe(plan.positions.v2.x);
    expect(Math.abs(plan.positions.v1.y - plan.positions.v2.y)).toBeGreaterThanOrEqual(720);
  });

  it('normalizes to a (0,0) origin and reports the true bbox', () => {
    const specs = [
      { key: 'a', width: 600, height: 200 },
      { key: 'b', width: 1280, height: 720 },
      { key: 'c', width: 1280, height: 720 },
    ];
    const plan = planChainLayout(specs, [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of specs) {
      const p = plan.positions[s.key];
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.width); maxY = Math.max(maxY, p.y + s.height);
    }
    expect(minX).toBe(0);
    expect(minY).toBe(0);
    expect(plan.width).toBe(maxX);
    expect(plan.height).toBe(maxY);
  });

  it('survives a cycle without hanging (bounded relaxation)', () => {
    const specs = [
      { key: 'a', width: 100, height: 100 },
      { key: 'b', width: 100, height: 100 },
    ];
    const plan = planChainLayout(specs, [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]);
    expect(plan.width).toBeGreaterThan(0);
  });
});

describe('placeChainOnBoard (whole-chain area reserved before insert)', () => {
  it('lands the chain clear to the RIGHT of everything, frame included', async () => {
    // Existing section: two connected nodes (frame extends 165/260 beyond).
    const nodes = [
      { id: 'a', pos_x: 0, pos_y: 0, width: 1280, height: 720 },
      { id: 'b', pos_x: 1600, pos_y: 0, width: 1280, height: 720 },
    ];
    const edges = [{ source_node_id: 'a', target_node_id: 'b' }];
    const pos = await placeChainOnBoard('board-1', 2000, 900, seqSql(nodes, edges));
    // Frame right edge of the existing section = 1600+1280+165 = 3045; the
    // chain's own frame extends 165 left of its first node — must clear it.
    expect(pos.x - 165).toBeGreaterThan(3045);
    // Chain frame (x-165, y-260, w+330, h+425) must not overlap the section
    // frame (-165, -260, 2610x1240).
    const fx = pos.x - 165, fy = pos.y - 260;
    expect(fx).toBeGreaterThanOrEqual(3045);
    expect(typeof fy).toBe('number');
  });

  it('returns (0,0) on an empty board', async () => {
    const pos = await placeChainOnBoard('board-1', 2000, 900, seqSql([], []));
    expect(pos).toEqual({ x: 0, y: 0 });
  });
});
