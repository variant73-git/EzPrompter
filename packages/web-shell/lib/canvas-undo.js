function cloneValue(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Capture the canvas state that a node drag is allowed to mutate.
 *
 * Positions and metadata are intentionally smaller than a full node row, while
 * incident edges and section frames cover the structural side-effects of
 * dragging a node out of (or into) a workflow section.
 */
export function captureMoveUndo(nodes, edges, ids, sectionFrames = {}) {
  const idSet = ids instanceof Set ? ids : new Set(ids || []);
  const movedNodes = (nodes || [])
    .filter((node) => idSet.has(node.id) && !String(node.id).startsWith('temp-'))
    .map((node) => ({
      id: node.id,
      pos_x: node.pos_x,
      pos_y: node.pos_y,
      meta: cloneValue(node.meta),
    }));

  if (movedNodes.length === 0) return null;

  const persistedIds = new Set(movedNodes.map((node) => node.id));
  const incidentEdges = (edges || [])
    .filter((edge) => persistedIds.has(edge.source_node_id) || persistedIds.has(edge.target_node_id))
    .map((edge) => cloneValue(edge));

  return {
    type: 'moveNodes',
    nodes: movedNodes,
    edges: incidentEdges,
    sectionFrames: cloneValue(sectionFrames || {}),
  };
}

/** Restore the local node rows while preserving every field a drag cannot edit. */
export function restoreMovedNodes(nodes, entry) {
  const savedById = new Map((entry?.nodes || []).map((node) => [node.id, node]));
  return (nodes || []).map((node) => {
    const saved = savedById.get(node.id);
    if (!saved) return node;
    return {
      ...node,
      pos_x: saved.pos_x,
      pos_y: saved.pos_y,
      meta: cloneValue(saved.meta),
    };
  });
}

/** Add only edges that disappeared as a side-effect of the drag. */
export function restoreMissingEdges(edges, savedEdges) {
  const current = edges || [];
  const ids = new Set(current.map((edge) => edge.id).filter(Boolean));
  const pairs = new Set(current.map((edge) => `${edge.source_node_id}::${edge.target_node_id}`));
  const missing = (savedEdges || []).filter((edge) => {
    const pair = `${edge.source_node_id}::${edge.target_node_id}`;
    return (!edge.id || !ids.has(edge.id)) && !pairs.has(pair);
  });
  return missing.length ? [...current, ...missing.map((edge) => cloneValue(edge))] : current;
}

