import { sql } from '../../db.js';

/**
 * Proximity search: return the K nodes closest to a given node, optionally
 * filtered by kind. Used by the agent to resolve vague references the
 * user makes ("the other image", "apply to that one") by reading the
 * canvas geometry instead of asking. Like Grep('pattern', context=NEAR).
 */
export const findNearestTool = {
  name: 'findNearest',
  description: 'Return the K nodes on the current board that are closest (in canvas-space Euclidean distance) to a given anchor node. Optionally filter by kind. Use this to resolve geometry-pointed references — "the other image", "the closest prompt", "the design system next to this site". The user\'s spatial layout IS their pointing finger.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      fromNodeId: { type: 'string', description: 'Anchor node — distance is measured from this node\'s centre.' },
      kind:       { type: 'string', description: 'Only consider nodes of this kind (e.g. "asset" for image siblings).' },
      limit:      { type: 'number', description: 'Max results, default 5, hard cap 20.' },
    },
    required: ['fromNodeId'],
  },

  async execute(args, ctx) {
    const { fromNodeId, kind = null } = args || {};
    if (!fromNodeId) return { error: 'invalid_args', message: 'fromNodeId required' };
    const limit = Math.min(Math.max(parseInt(args?.limit ?? 5, 10) || 5, 1), 20);

    const anchorRows = await sql`
      SELECT pos_x, pos_y, width, height
      FROM nodes
      WHERE id = ${fromNodeId} AND board_id = ${ctx.boardId}
    `;
    if (!anchorRows.length) return { error: 'target_not_found', message: 'fromNodeId not on this board' };
    const a = anchorRows[0];
    const ax = (a.pos_x || 0) + (a.width || 0) / 2;
    const ay = (a.pos_y || 0) + (a.height || 0) / 2;

    const candRows = await sql`
      SELECT id, kind, meta, pos_x, pos_y, width, height
      FROM nodes
      WHERE board_id = ${ctx.boardId}
        AND id != ${fromNodeId}
        AND (${kind}::text IS NULL OR kind = ${kind})
    `;

    const sorted = candRows
      .map((n) => {
        const cx = (n.pos_x || 0) + (n.width || 0) / 2;
        const cy = (n.pos_y || 0) + (n.height || 0) / 2;
        return { n, dist: Math.sqrt((cx - ax) ** 2 + (cy - ay) ** 2) };
      })
      .sort((x, y) => x.dist - y.dist)
      .slice(0, limit);

    return {
      anchor: { nodeId: fromNodeId, centerX: ax, centerY: ay },
      results: sorted.map(({ n, dist }) => ({
        id: n.id,
        kind: n.kind,
        name: n.meta?.name || n.kind,
        ...(n.kind === 'asset' && n.meta?.assetId ? { assetId: n.meta.assetId } : {}),
        distance: Math.round(dist),
      })),
    };
  },
};
