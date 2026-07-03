import { sql } from '../../db.js';
import { deoverlapSectionForEdge } from '../../canvas-layout.js';

export const addEdgeTool = {
  name: 'addEdge',
  description: 'Create a directed edge from one node to another. Used to wire a source node into a target so the target can read from the source when run.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      fromNodeId: { type: 'string', description: 'Source node id' },
      toNodeId:   { type: 'string', description: 'Target node id' },
      kind:       { type: 'string', description: 'Optional edge kind (default "generic")' },
    },
    required: ['fromNodeId', 'toNodeId'],
  },
  async execute(args, ctx) {
    const { fromNodeId, toNodeId, kind = 'generic' } = args || {};
    if (!fromNodeId || !toNodeId) return { error: 'invalid_args', message: 'fromNodeId and toNodeId are required' };
    if (fromNodeId === toNodeId) return { error: 'invalid_args', message: 'cannot connect a node to itself' };

    const found = await sql`
      SELECT id FROM nodes WHERE board_id = ${ctx.boardId} AND id = ANY(${[fromNodeId, toNodeId]})
    `;
    if (found.length !== 2) return { error: 'target_not_found', message: 'one or both nodes not on this board' };

    const [edge] = await sql`
      INSERT INTO edges (board_id, source_node_id, target_node_id, kind)
      VALUES (${ctx.boardId}, ${fromNodeId}, ${toNodeId}, ${kind})
      RETURNING id, source_node_id AS from_node_id, target_node_id AS to_node_id, kind, created_at
    `;

    // Sections must NEVER overlap. This edge may have just formed or extended a
    // section whose padded FRAME now intrudes on a neighbour — the member nodes
    // were placed without colliding, but a section frame is larger than its
    // nodes. Shift the section clear as a unit (no-op when nothing overlaps).
    // The board is refetched after the run, so the moved positions render.
    await deoverlapSectionForEdge(ctx.boardId, sql, toNodeId);

    // Real-time: show the cord (and any de-overlap shift) immediately.
    if (ctx?.emit) { try { ctx.emit('graph_mutated', { reason: 'addEdge' }); } catch (_) {} }

    return { id: edge.id, fromNodeId: edge.from_node_id, toNodeId: edge.to_node_id, kind: edge.kind };
  },
};
