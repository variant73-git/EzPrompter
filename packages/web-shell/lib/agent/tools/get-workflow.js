import { sql } from '../../db.js';

/**
 * Get the workflow / chain that a given node participates in: the BFS
 * connected component reachable through edges, plus the terminal node
 * identification (the asset member with incoming-from-member edges and
 * no outgoing-to-member edges — same heuristic the section-rerun
 * endpoint and the workflow hint use).
 *
 * Used by the agent to inspect any workflow on demand, not just the
 * one the user has selected as active context.
 */
export const getWorkflowTool = {
  name: 'getWorkflow',
  description: 'Return the workflow that a node participates in: every connected member (via edges), the directed edges between them, and which member is the terminal — i.e. the result asset of the chain. Use this to inspect a workflow the user did not select as active context, or to verify the chain shape before calling runFlow / createImage with replaceAssetId.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Any node id in the workflow. The workflow is computed as the connected component reachable from this node.' },
    },
    required: ['nodeId'],
  },

  async execute(args, ctx) {
    const { nodeId } = args || {};
    if (!nodeId) return { error: 'invalid_args', message: 'nodeId required' };

    const nodeRows = await sql`
      SELECT id, kind, meta, pos_x, pos_y, width, height
      FROM nodes
      WHERE board_id = ${ctx.boardId}
    `;
    const seed = nodeRows.find((n) => n.id === nodeId);
    if (!seed) return { error: 'target_not_found', message: 'nodeId not on this board' };

    const edgeRows = await sql`
      SELECT id, source_node_id, target_node_id, kind FROM edges WHERE board_id = ${ctx.boardId}
    `;

    // BFS over undirected edges to find the connected component.
    const adj = new Map();
    for (const n of nodeRows) adj.set(n.id, new Set());
    for (const e of edgeRows) {
      if (!adj.has(e.source_node_id) || !adj.has(e.target_node_id)) continue;
      adj.get(e.source_node_id).add(e.target_node_id);
      adj.get(e.target_node_id).add(e.source_node_id);
    }
    const visited = new Set([nodeId]);
    const queue = [nodeId];
    while (queue.length) {
      const v = queue.shift();
      for (const u of adj.get(v) || []) {
        if (!visited.has(u)) { visited.add(u); queue.push(u); }
      }
    }
    const members = nodeRows.filter((n) => visited.has(n.id));
    const memberSet = new Set(members.map((m) => m.id));
    const innerEdges = edgeRows.filter((e) => memberSet.has(e.source_node_id) && memberSet.has(e.target_node_id));

    // Terminal: asset member with incoming-from-member edges and no
    // outgoing-to-member edges. If 0 or >1, return null (caller can
    // disambiguate or fall back).
    const terminals = members.filter((n) => {
      if (n.kind !== 'asset') return false;
      const incoming = innerEdges.some((e) => e.target_node_id === n.id);
      const outgoing = innerEdges.some((e) => e.source_node_id === n.id);
      return incoming && !outgoing;
    });
    const terminal = terminals.length === 1 ? terminals[0] : null;

    return {
      memberCount: members.length,
      isStandalone: members.length === 1,
      members: members.map((n) => ({
        id: n.id,
        kind: n.kind,
        name: n.meta?.name || n.kind,
        ...(n.kind === 'asset' && n.meta?.assetId ? { assetId: n.meta.assetId } : {}),
      })),
      edges: innerEdges.map((e) => ({
        id: e.id,
        from: e.source_node_id,
        to: e.target_node_id,
        kind: e.kind,
      })),
      terminal: terminal
        ? {
            nodeId: terminal.id,
            assetId: terminal.meta?.assetId || null,
          }
        : null,
    };
  },
};
