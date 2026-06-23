import { sql } from '../../db.js';
import { resolvePlacement } from '../../canvas-layout.js';

// Remove a node from its section. A "section" is a group of edge-connected
// nodes, so a node leaves it by having its edges CUT — exactly what dragging it
// out of the section does (client commitNodeRemoval). This tool replicates that
// drag-out server-side: cut every edge touching the node, clear any adoption
// marker, and nudge it to a clear spot outside the (now smaller) section.
export const removeFromSectionTool = {
  name: 'removeFromSection',
  description: `Remove a node from its section (the group of edge-connected nodes it belongs to). Replicates dragging the node out of the section: it CUTS every edge touching the node so it's no longer part of the group, clears any adoption marker, and moves it to a clear spot outside. The node and its content are untouched — only its connections are cut.

DESTRUCTIVE: cuts the node's edges (reversible by reconnecting). The user confirms before it runs. Use when the user asks to take a node out of / remove it from a section, group, or workflow.`,
  classification: 'destructive',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'UUID of the node to remove from its section' },
    },
    required: ['nodeId'],
  },

  async summarize(args, ctx) {
    const id = args?.nodeId;
    if (!id) return 'Remove this node from its section?';
    try {
      const rows = await sql`SELECT kind, meta FROM nodes WHERE id = ${id} AND board_id = ${ctx.boardId}`;
      const node = rows[0];
      const name = (node?.meta?.name || '').trim() || node?.kind || 'node';
      return `Remove "${name.slice(0, 40)}" from its section?`;
    } catch {
      return 'Remove this node from its section?';
    }
  },

  async execute(args, ctx) {
    const id = args?.nodeId;
    if (!id) return { error: 'invalid_args', message: 'nodeId required' };

    const owned = await sql`
      SELECT n.id, n.kind, n.meta, n.pos_x, n.pos_y, n.width, n.height
        FROM nodes n JOIN boards b ON b.id = n.board_id
       WHERE n.id = ${id} AND b.user_id = ${ctx.userId} AND b.id = ${ctx.boardId}
    `;
    if (!owned.length) return { error: 'forbidden', message: 'node not found on this board' };
    const node = owned[0];

    // Cut every edge touching the node — this is what removes it from the
    // edge-defined section (mirrors the drag-out commitNodeRemoval).
    const cut = await sql`
      DELETE FROM edges
       WHERE board_id = ${ctx.boardId}
         AND (source_node_id = ${id} OR target_node_id = ${id})
      RETURNING id
    `;

    // A geometric/dropped-in member leaves by clearing its adoption marker.
    const meta = { ...(node.meta || {}) };
    delete meta.adoptedInto;

    // Nudge it clear of the now-smaller section so it reads as "outside".
    let pos = { x: node.pos_x, y: node.pos_y };
    try {
      pos = await resolvePlacement(ctx.boardId, node.pos_x, node.pos_y, node.width || 1280, node.height || 720, sql);
    } catch { /* keep current position if placement can't be computed */ }

    await sql`
      UPDATE nodes
         SET pos_x = ${pos.x}, pos_y = ${pos.y}, meta = ${JSON.stringify(meta)}::jsonb
       WHERE id = ${id}
    `;

    const cutN = Array.isArray(cut) ? cut.length : 0;
    return {
      removed: true,
      id,
      edgesCut: cutN,
      summary: `removed ${(node.meta?.name || node.kind || 'node').slice(0, 40)} from its section (cut ${cutN} edge${cutN === 1 ? '' : 's'})`,
    };
  },
};
