import { sql } from '../../db.js';

// Friendly category label for a node — used in the confirm message when the
// node has no name yet.
function categoryLabel(node) {
  if (!node) return 'node';
  if (node.kind === 'image' || node.kind === 'asset') return 'image';
  if (node.kind === 'designmd') return 'design doc';
  if (node.kind === 'prompt') return 'prompt';
  if (node.kind === 'skill') return 'skill';
  if (node.kind === 'site') return 'website';
  return 'node';
}

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

  // Human-readable confirm message shown verbatim in the chip: the node's
  // name in quotes, or its category when the node has no name yet.
  async summarize(args, ctx) {
    const id = args?.id;
    if (!id) return 'Delete this node?';
    try {
      const rows = await sql`
        SELECT kind, meta FROM nodes
         WHERE id = ${id} AND board_id = ${ctx.boardId}
      `;
      const node = rows[0];
      if (!node) return 'Delete this node?';
      const name = (node.meta?.name || '').trim();
      const label = name || categoryLabel(node);
      return `Delete node "${label.slice(0, 40)}"?`;
    } catch {
      return 'Delete this node?';
    }
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
