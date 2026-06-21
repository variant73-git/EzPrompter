import { describe, it, expect } from 'vitest';
import {
  pointInRect, nodeCenter, shouldTearOut,
  selectGeometricMembersToLatch, TEAR_MARGIN,
} from './section-membership.js';

describe('pointInRect', () => {
  const r = { left: 0, top: 0, right: 100, bottom: 100 };
  it('is inclusive of edges', () => {
    expect(pointInRect(0, 0, r)).toBe(true);
    expect(pointInRect(100, 100, r)).toBe(true);
    expect(pointInRect(50, 50, r)).toBe(true);
  });
  it('rejects points outside', () => {
    expect(pointInRect(-1, 50, r)).toBe(false);
    expect(pointInRect(50, 101, r)).toBe(false);
  });
  it('false for a null rect', () => {
    expect(pointInRect(5, 5, null)).toBe(false);
  });
});

describe('nodeCenter', () => {
  it('uses explicit position when given', () => {
    const n = { pos_x: 0, pos_y: 0, width: 200, height: 100 };
    expect(nodeCenter(n, 10, 20)).toEqual({ cx: 110, cy: 70 });
  });
  it('falls back to the node row position', () => {
    const n = { pos_x: 40, pos_y: 60, width: 100, height: 100 };
    expect(nodeCenter(n)).toEqual({ cx: 90, cy: 110 });
  });
});

describe('shouldTearOut', () => {
  const core = { left: 0, top: 0, right: 100, bottom: 100 };
  it('false while center stays within core + margin', () => {
    // Just outside the core but within the margin band → still attached.
    expect(shouldTearOut(100 + TEAR_MARGIN - 1, 50, core, TEAR_MARGIN)).toBe(false);
    expect(shouldTearOut(50, 50, core, TEAR_MARGIN)).toBe(false);
  });
  it('true once center clears the margin on any side', () => {
    expect(shouldTearOut(100 + TEAR_MARGIN + 1, 50, core, TEAR_MARGIN)).toBe(true);
    expect(shouldTearOut(50, -(TEAR_MARGIN + 1), core, TEAR_MARGIN)).toBe(true);
  });
  it('false when there is no remaining core (nothing to leave)', () => {
    expect(shouldTearOut(9999, 9999, null, TEAR_MARGIN)).toBe(false);
  });
});

describe('selectGeometricMembersToLatch', () => {
  const mk = (id, meta = {}) => ({ id, meta });
  function build(nodes) { return new Map(nodes.map((n) => [n.id, n])); }

  it('latches members with no edge and no adoptedInto', () => {
    const nodeById = build([mk('a'), mk('b'), mk('site')]);
    const sections = [{ rootId: 'a', memberIds: ['a', 'b', 'site'] }];
    const edgeTouchedSet = new Set(['a', 'b']); // a—b connected; site purely geometric
    const out = selectGeometricMembersToLatch({ sections, nodeById, edgeTouchedSet });
    expect(out).toEqual([{ nodeId: 'site', rootId: 'a' }]);
  });

  it('skips edge members and already-adopted members', () => {
    const nodeById = build([mk('a'), mk('b'), mk('c', { adoptedInto: 'a' })]);
    const sections = [{ rootId: 'a', memberIds: ['a', 'b', 'c'] }];
    const edgeTouchedSet = new Set(['a', 'b']);
    const out = selectGeometricMembersToLatch({ sections, nodeById, edgeTouchedSet });
    expect(out).toEqual([]); // c already latched, a/b have edges
  });

  it('skips temp nodes and sub-2 sections', () => {
    const nodeById = build([mk('temp-x'), mk('solo')]);
    const sections = [
      { rootId: 'temp-x', memberIds: ['temp-x', 'solo'] }, // contains a temp node
      { rootId: 'solo', memberIds: ['solo'] },             // singleton, ignored
    ];
    const out = selectGeometricMembersToLatch({ sections, nodeById, edgeTouchedSet: new Set() });
    expect(out).toEqual([{ nodeId: 'solo', rootId: 'temp-x' }]);
  });
});
