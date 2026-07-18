import { describe, expect, it } from 'vitest';
import { captureMoveUndo, restoreMissingEdges, restoreMovedNodes } from './canvas-undo.js';

describe('canvas move undo', () => {
  const nodes = [
    { id: 'a', pos_x: 10, pos_y: 20, name: 'Anchor', meta: { adoptedInto: 'root', nested: { value: 1 } } },
    { id: 'b', pos_x: 50, pos_y: 80, name: 'Follower', meta: {} },
    { id: 'c', pos_x: 900, pos_y: 900, name: 'Untouched', meta: {} },
  ];
  const edges = [
    { id: 'edge-ab', source_node_id: 'a', target_node_id: 'b', kind: 'generic' },
    { id: 'edge-c', source_node_id: 'c', target_node_id: 'elsewhere', kind: 'generic' },
  ];

  it('captures only moved persisted nodes plus their structural state', () => {
    const frames = { 'section-a': { left: 1, top: 2, right: 300, bottom: 400 } };
    const entry = captureMoveUndo(
      [...nodes, { id: 'temp-d', pos_x: 1, pos_y: 2, meta: {} }],
      edges,
      new Set(['a', 'b', 'temp-d']),
      frames,
    );

    expect(entry.type).toBe('moveNodes');
    expect(entry.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(entry.edges.map((edge) => edge.id)).toEqual(['edge-ab']);
    expect(entry.sectionFrames).toEqual(frames);

    nodes[0].meta.nested.value = 99;
    frames['section-a'].left = 999;
    expect(entry.nodes[0].meta.nested.value).toBe(1);
    expect(entry.sectionFrames['section-a'].left).toBe(1);
  });

  it('restores positions and metadata without replacing untouched node objects', () => {
    const original = [
      { id: 'a', pos_x: 10, pos_y: 20, meta: { adoptedInto: 'root' } },
      { id: 'b', pos_x: 50, pos_y: 80, meta: {} },
      { id: 'c', pos_x: 900, pos_y: 900, meta: {} },
    ];
    const entry = captureMoveUndo(original, edges, ['a', 'b'], {});
    const moved = original.map((node) => (
      node.id === 'c' ? node : { ...node, pos_x: node.pos_x + 500, pos_y: node.pos_y + 300, meta: { sectionOptOut: 'root' } }
    ));
    const restored = restoreMovedNodes(moved, entry);

    expect(restored[0]).toMatchObject({ pos_x: 10, pos_y: 20, meta: { adoptedInto: 'root' } });
    expect(restored[1]).toMatchObject({ pos_x: 50, pos_y: 80, meta: {} });
    expect(restored[2]).toBe(moved[2]);
  });

  it('restores removed cords once and ignores duplicate endpoint pairs', () => {
    expect(restoreMissingEdges([], [edges[0]])).toEqual([edges[0]]);
    expect(restoreMissingEdges([edges[0]], [edges[0]])).toEqual([edges[0]]);
    expect(restoreMissingEdges([
      { id: 'replacement', source_node_id: 'a', target_node_id: 'b' },
    ], [edges[0]])).toHaveLength(1);
  });

  it('returns null when no persisted selected node exists', () => {
    expect(captureMoveUndo(nodes, edges, ['missing'], {})).toBeNull();
    expect(captureMoveUndo([{ id: 'temp-a' }], [], ['temp-a'], {})).toBeNull();
  });
});

