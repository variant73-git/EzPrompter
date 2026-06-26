import { describe, it, expect } from 'vitest';
import { placeStackDown, placeRightOfSources, resolvePlacement, planSectionDeoverlap } from './canvas-layout.js';

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
