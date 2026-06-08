import { sql } from '../../db.js';

/**
 * Topology of the current board: counts per kind, list of nodes with
 * position + assetId (no heavy fields), edge count, connected-component
 * summary. Meant for the agent's "what's on this canvas?" question —
 * the equivalent of `ls` against a project.
 *
 * Returns lean data so the agent can fit a large board in a single
 * response. Use viewNode(id) for the full meta of a single node.
 */
export const listBoardTool = {
  name: 'listBoard',
  description: 'List the topology of the current board: counts per node kind, every node\'s id/kind/name/position/dims (plus assetId for assets), edge list, and a summary of connected components (workflows). Use this when you need to know what\'s on the canvas right now — it\'s the read-only `ls` of the board. Optional filters narrow by kind, name substring, or proximity to a node.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      kind:       { type: 'string', description: 'Only return nodes of this kind (e.g. "asset", "site", "prompt", "designmd").' },
      nearNodeId: { type: 'string', description: 'Anchor proximity sort to this node. Nodes appear ordered by Euclidean distance from its centre (closest first).' },
      limit:      { type: 'number', description: 'Max nodes returned, default 50, hard cap 200.' },
    },
  },

  async execute(args, ctx) {
    const { kind = null, nearNodeId = null } = args || {};
    const limit = Math.min(Math.max(parseInt(args?.limit ?? 50, 10) || 50, 1), 200);

    const nodeRows = await sql`
      SELECT id, kind, meta, pos_x, pos_y, width, height
      FROM nodes
      WHERE board_id = ${ctx.boardId}
        AND (${kind}::text IS NULL OR kind = ${kind})
    `;
    const edgeRows = await sql`
      SELECT id, source_node_id, target_node_id, kind FROM edges WHERE board_id = ${ctx.boardId}
    `;

    // Counts by kind
    const counts = {};
    for (const r of nodeRows) counts[r.kind] = (counts[r.kind] || 0) + 1;

    // Optional proximity sort
    let ordered = nodeRows;
    if (nearNodeId) {
      const anchor = nodeRows.find((n) => n.id === nearNodeId)
        || (await sql`SELECT id, pos_x, pos_y, width, height FROM nodes WHERE id = ${nearNodeId} AND board_id = ${ctx.boardId}`)[0];
      if (anchor) {
        const ax = (anchor.pos_x || 0) + (anchor.width || 0) / 2;
        const ay = (anchor.pos_y || 0) + (anchor.height || 0) / 2;
        ordered = [...nodeRows]
          .map((n) => {
            const cx = (n.pos_x || 0) + (n.width || 0) / 2;
            const cy = (n.pos_y || 0) + (n.height || 0) / 2;
            return { n, dist: Math.sqrt((cx - ax) ** 2 + (cy - ay) ** 2) };
          })
          .sort((a, b) => a.dist - b.dist)
          .map(({ n }) => n);
      }
    }

    const nodes = ordered.slice(0, limit).map((n) => ({
      id: n.id,
      kind: n.kind,
      name: n.meta?.name || n.kind,
      posX: n.pos_x,
      posY: n.pos_y,
      width: n.width,
      height: n.height,
      ...(n.kind === 'asset' && n.meta?.assetId ? { assetId: n.meta.assetId } : {}),
    }));

    // Connected-components summary (workflows = size >= 2).
    const parent = new Map(nodeRows.map((n) => [n.id, n.id]));
    const find = (x) => {
      let cur = x;
      while (parent.get(cur) !== cur) cur = parent.get(cur);
      return cur;
    };
    for (const e of edgeRows) {
      if (!parent.has(e.source_node_id) || !parent.has(e.target_node_id)) continue;
      const a = find(e.source_node_id);
      const b = find(e.target_node_id);
      if (a !== b) parent.set(a, b);
    }
    const componentSizes = new Map();
    for (const n of nodeRows) {
      const root = find(n.id);
      componentSizes.set(root, (componentSizes.get(root) || 0) + 1);
    }
    const workflowsCount = [...componentSizes.values()].filter((s) => s >= 2).length;

    return {
      totalNodes: nodeRows.length,
      countsByKind: counts,
      edges: edgeRows.length,
      workflows: workflowsCount,
      truncated: ordered.length > limit,
      returned: nodes.length,
      nodes,
    };
  },
};
