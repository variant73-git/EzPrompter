import { sql } from '../../db.js';

export const deleteNodeTool = {
  name: 'deleteNode',
  description: `Delete a node from the user's current board.

DESTRUCTIVE: the user will be asked to confirm before this runs. Use sparingly. Always check with queryNodes first to make sure you're targeting the right node, and prefer addressing it by id rather than name.`,
  classification: 'destructive',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'UUID of the node to delete' },
    },
    required: ['id'],
  },
  async execute(args, ctx) {
    const { id } = args || {};
    if (!id) return { error: 'invalid_args', message: 'id required' };

    const owned = await sql`
      SELECT n.id, n.kind, n.meta FROM nodes n
        JOIN boards b ON b.id = n.board_id
       WHERE n.id = ${id} AND b.user_id = ${ctx.userId} AND b.id = ${ctx.boardId}
    `;
    if (!owned.length) return { error: 'forbidden', message: 'node not found on this board' };

    const [del] = await sql`DELETE FROM nodes WHERE id = ${id} RETURNING id`;
    return {
      deleted: true,
      id: del?.id || id,
      summary: `removed ${owned[0].kind} node ${(owned[0].meta?.name || id).slice(0, 40)}`,
    };
  },
};
