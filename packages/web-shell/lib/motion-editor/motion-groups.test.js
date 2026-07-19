import { describe, expect, it } from 'vitest';
import { applyStaggerDelays, groupMotionClips } from './motion-groups.js';

function clip(id, overrides = {}) {
  return {
    id,
    engine: 'GSAP',
    name: id,
    editability: 'adapter',
    driver: { type: 'time' },
    timing: { delay: 0, duration: 1000, ...(overrides.timing || {}) },
    tracks: overrides.tracks || [{ property: 'opacity', keyframes: [] }],
    group: {
      targetId: null,
      parentId: null,
      splitRootId: null,
      splitRootLabel: null,
      timelineId: null,
      timelineLabel: null,
      timelineScroll: false,
      targetCount: 1,
      ...(overrides.group || {}),
    },
    ...(overrides.rest || {}),
  };
}

describe('groupMotionClips', () => {
  it('collapses split-text character clips into one text-reveal row', () => {
    const clips = [
      clip('char-1', { timing: { delay: 0 }, group: { splitRootId: 'el-title', splitRootLabel: 'CropTab', parentId: 'el-title' } }),
      clip('char-2', { timing: { delay: 40 }, group: { splitRootId: 'el-title', splitRootLabel: 'CropTab', parentId: 'el-title' } }),
      clip('char-3', { timing: { delay: 80 }, group: { splitRootId: 'el-title', splitRootLabel: 'CropTab', parentId: 'el-title' } }),
      clip('solo'),
    ];
    const rows = groupMotionClips(clips);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: 'group',
      type: 'text-reveal',
      label: 'CropTab',
      count: 3,
      stagger: 40,
    });
    expect(rows[0].clip.id).toBe('char-1');
    expect(rows[0].clips.map((item) => item.id)).toEqual(['char-1', 'char-2', 'char-3']);
    expect(rows[1]).toMatchObject({ kind: 'single' });
    expect(rows[1].clip.id).toBe('solo');
  });

  it('collapses timeline children under their parent timeline row', () => {
    const clips = [
      clip('a', { group: { timelineId: 'timeline-1', timelineLabel: 'intro', timelineScroll: true } }),
      clip('b', { group: { timelineId: 'timeline-1', timelineLabel: 'intro', timelineScroll: true } }),
    ];
    const rows = groupMotionClips(clips);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'group',
      type: 'timeline',
      id: 'group:timeline:timeline-1',
      label: 'intro',
      count: 2,
      driver: { type: 'scroll' },
    });
  });

  it('groups three or more staggered siblings sharing parent, props and duration', () => {
    const clips = [
      clip('card-1', { timing: { delay: 100 }, group: { parentId: 'el-grid', targetId: 'el-c1' } }),
      clip('card-2', { timing: { delay: 200 }, group: { parentId: 'el-grid', targetId: 'el-c2' } }),
      clip('card-3', { timing: { delay: 300 }, group: { parentId: 'el-grid', targetId: 'el-c3' } }),
    ];
    const rows = groupMotionClips(clips);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'group', type: 'stagger', count: 3, stagger: 100 });
    expect(rows[0].clip.id).toBe('card-1');
  });

  it('reports a null stagger when delays are not actually uniform', () => {
    // [0, 0, 1000] has delta median 500 — presenting that as "the stagger" would
    // fabricate a spacing that never existed on the page.
    const group = { splitRootId: 'el-title', splitRootLabel: 'CropTab', parentId: 'el-title' };
    const rows = groupMotionClips([
      clip('char-1', { timing: { delay: 0 }, group }),
      clip('char-2', { timing: { delay: 0 }, group }),
      clip('char-3', { timing: { delay: 1000 }, group }),
    ]);
    expect(rows[0].kind).toBe('group');
    expect(rows[0].stagger).toBeNull();
  });

  it('never stagger-groups clips that repeat a target — two animations on one element are not a stagger', () => {
    const rows = groupMotionClips([
      clip('card-1', { timing: { delay: 100 }, group: { parentId: 'el-grid', targetId: 'el-c1' } }),
      clip('card-1b', { timing: { delay: 200 }, group: { parentId: 'el-grid', targetId: 'el-c1' } }),
      clip('card-2', { timing: { delay: 300 }, group: { parentId: 'el-grid', targetId: 'el-c2' } }),
    ]);
    expect(rows.every((row) => row.kind === 'single')).toBe(true);
  });

  it('never stagger-groups scroll-driven siblings — independent scroll reveals are not a stagger', () => {
    const rows = groupMotionClips([
      clip('reveal-1', { group: { parentId: 'el-page' }, rest: { driver: { type: 'scroll' } } }),
      clip('reveal-2', { group: { parentId: 'el-page' }, rest: { driver: { type: 'scroll' } } }),
      clip('reveal-3', { group: { parentId: 'el-page' }, rest: { driver: { type: 'scroll' } } }),
    ]);
    expect(rows.every((row) => row.kind === 'single')).toBe(true);
  });

  it('does not stagger-group siblings animating different properties or only two members', () => {
    const rows = groupMotionClips([
      clip('a', { group: { parentId: 'el-grid' } }),
      clip('b', { group: { parentId: 'el-grid' }, tracks: [{ property: 'x', keyframes: [] }] }),
      clip('c', { group: { parentId: 'el-other' } }),
    ]);
    expect(rows.every((row) => row.kind === 'single')).toBe(true);
  });

  it('degrades a group of one to a single row and dedups repeated clip ids', () => {
    const rows = groupMotionClips([
      clip('only', { group: { splitRootId: 'el-title' } }),
      clip('only', { group: { splitRootId: 'el-title' } }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('single');
  });

  it('prefers the split-text grouping when a clip carries both split and timeline ids', () => {
    const rows = groupMotionClips([
      clip('char-1', { group: { splitRootId: 'el-title', timelineId: 'timeline-1' } }),
      clip('char-2', { group: { splitRootId: 'el-title', timelineId: 'timeline-1' } }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('text-reveal');
  });
});

describe('applyStaggerDelays', () => {
  it('re-spaces member delays from the earliest member', () => {
    const members = [
      clip('b', { timing: { delay: 90 } }),
      clip('a', { timing: { delay: 20 } }),
      clip('c', { timing: { delay: 200 } }),
    ];
    const result = applyStaggerDelays(members, 50);
    expect(result.map((item) => item.clip.id)).toEqual(['a', 'b', 'c']);
    expect(result.map((item) => item.delay)).toEqual([20, 70, 120]);
  });

  it('clamps negative stagger to zero spacing', () => {
    const result = applyStaggerDelays([
      clip('a', { timing: { delay: 10 } }),
      clip('b', { timing: { delay: 60 } }),
    ], -25);
    expect(result.map((item) => item.delay)).toEqual([10, 10]);
  });
});
