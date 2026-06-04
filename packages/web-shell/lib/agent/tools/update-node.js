import { sql } from '../../db.js';

export const updateNodeTool = {
  name: 'updateNode',
  description: 'Update a node\'s display name, position, or metadata. Pass only the fields you want changed.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      id:   { type: 'string', description: 'Node id' },
      name: { type: 'string', description: 'New display name (stored in meta.name)' },
      meta: { type: 'object', description: 'Replace meta entirely (rare — usually use name instead)' },
      posX: { type: 'number' },
      posY: { type: 'number' },
    },
    required: ['id'],
  },
  async execute(args, ctx) {
    const { id, name, meta, posX, posY } = args || {};
    if (!id) return { error: 'invalid_args', message: 'id required' };

    const owned = await sql`
      SELECT n.id, n.meta FROM nodes n
      JOIN boards b ON b.id = n.board_id
      WHERE n.id = ${id} AND b.id = ${ctx.boardId} AND b.user_id = ${ctx.userId}
    `;
    if (!owned.length) return { error: 'target_not_found', message: 'node not found on this board' };

    if (name === undefined && meta === undefined && posX === undefined && posY === undefined) {
      return { error: 'invalid_args', message: 'at least one of name/meta/posX/posY required' };
    }

    // Compute next meta if name or meta provided
    let nextMeta = null;
    if (meta !== undefined) {
      nextMeta = meta;
    } else if (name !== undefined) {
      nextMeta = { ...(owned[0].meta || {}), name };
    }

    const [updated] = await sql`
      UPDATE nodes SET
        pos_x = COALESCE(${posX ?? null}, pos_x),
        pos_y = COALESCE(${posY ?? null}, pos_y),
        meta  = COALESCE(${nextMeta ? JSON.stringify(nextMeta) : null}::jsonb, meta)
      WHERE id = ${id}
      RETURNING id, kind, pos_x, pos_y, meta
    `;
    return { id: updated.id, kind: updated.kind, posX: updated.pos_x, posY: updated.pos_y, meta: updated.meta };
  },
};
