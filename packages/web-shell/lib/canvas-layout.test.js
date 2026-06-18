import { describe, it, expect } from 'vitest';
import { placeStackDown, placeRightOfSources } from './canvas-layout.js';

// The placement helpers call `sql` as a tagged template and return rows.
// A fake that ignores the template and resolves to a fixed row set is enough.
const fakeSql = (rows) => () => Promise.resolve(rows);

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
