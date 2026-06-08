import { sql } from '../../db.js';
import { placeStackDown } from '../../canvas-layout.js';

/**
 * Extract a reusable design artifact from a site node. We snapshot the
 * site's current HTML into a new `designmd` node — a "design template"
 * the user can connect to OTHER site nodes for applyDesign() restyling.
 *
 * Conceptually: extractDesign answers "save this site's look so I can
 * apply it elsewhere". The result is a separate node the user can
 * iterate on (rename, refine), and then plug into multiple targets.
 */
export const extractDesignTool = {
  name: 'extractDesign',
  description: 'Save a site\'s current visual template as a separate "design system" node, so it can later be applied to other site nodes via applyDesign. The resulting designmd node holds the source site\'s HTML as the style reference — the user can rename it, iterate on it, and connect it to multiple targets. Use this when the user says things like "save this style", "extract this design", "I want to reuse this look".',
  classification: 'destructive',
  inputSchema: {
    type: 'object',
    properties: {
      siteNodeId: { type: 'string', description: 'Id of the site node whose current snapshot should be saved as a design template.' },
      name:       { type: 'string', description: 'Optional display name for the new design node. Defaults to the source site\'s name + " — design".' },
    },
    required: ['siteNodeId'],
  },

  async execute(args, ctx) {
    const { siteNodeId, name = null } = args || {};
    if (!siteNodeId) return { error: 'invalid_args', message: 'siteNodeId required' };

    const rows = await sql`
      SELECT n.id, n.kind, n.meta, n.current_snapshot_id, s.html
      FROM nodes n
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
      JOIN boards b ON b.id = n.board_id
      WHERE n.id = ${siteNodeId} AND b.id = ${ctx.boardId} AND b.user_id = ${ctx.userId}
    `;
    if (!rows.length) return { error: 'target_not_found', message: 'siteNodeId not found' };
    const src = rows[0];
    if (src.kind !== 'site') return { error: 'invalid_args', message: 'extractDesign expects a site node' };
    if (!src.current_snapshot_id || !src.html) return { error: 'no_snapshot', message: 'site has no current snapshot to extract' };

    const sourceName = src.meta?.name || 'site';
    const displayName = name || `${sourceName} — design`;
    const width = 480;
    const height = 320;
    const { x: posX, y: posY } = await placeStackDown(ctx.boardId, width, height, sql);
    const meta = { name: displayName, source: 'agent-extracted', sourceSiteNodeId: siteNodeId };

    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
      VALUES (${ctx.boardId}, 'designmd', ${posX}, ${posY}, ${width}, ${height}, ${JSON.stringify(meta)}::jsonb)
      RETURNING id
    `;
    const [snap] = await sql`
      INSERT INTO snapshots (node_id, html, source)
      VALUES (${node.id}, ${src.html}, 'extract')
      RETURNING id
    `;
    await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;

    // Wire the source site → design node so the chain is visible.
    try {
      await sql`
        INSERT INTO edges (board_id, source_node_id, target_node_id, kind)
        VALUES (${ctx.boardId}, ${siteNodeId}, ${node.id}, 'generic')
      `;
    } catch (_) { /* dup edge — ignore */ }

    if (ctx?.emit) {
      try { ctx.emit('graph_mutated', { reason: 'extractDesign:done' }); } catch (_) {}
    }
    return {
      extracted: true,
      designNodeId: node.id,
      sourceSiteNodeId: siteNodeId,
      name: displayName,
    };
  },
};
