import { sql } from '../../db.js';
import { reskin } from '../../demarcelize.js';
import { placeRightOfSources } from '../../canvas-layout.js';

/**
 * Apply a design template (a designmd node holding a reference HTML)
 * to a target site node. Uses Demarcelizer's reskin(): the target's
 * content is preserved and re-rendered in the visual style of the
 * design template. The result is a NEW site node connected to both
 * sources, so the user has a record of what fed into the restyle.
 */
export const applyDesignTool = {
  name: 'applyDesign',
  description: 'Apply a saved design template (a designmd node) to a target site node — produces a NEW site node whose content matches the target but whose visual style matches the design. Uses Demarcelizer\'s reskin pipeline. The result is wired with edges from both source nodes so the chain reads as "[content site] + [design template] → [restyled site]". Use this when the user says "apply this design to that site", "restyle X with Y", "make X look like Y".',
  // Confirm chips are reserved for deletes (2026-06-12). applyDesign
  // creates a NEW node; sources are untouched.
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      designNodeId: { type: 'string', description: 'Id of the designmd node providing the visual template.' },
      siteNodeId:   { type: 'string', description: 'Id of the site node providing the content to keep.' },
      name:         { type: 'string', description: 'Optional display name for the resulting site node.' },
      model:        { type: 'string', description: 'Optional LLM override for the restyling call (defaults to the demarcelize.js default).' },
    },
    required: ['designNodeId', 'siteNodeId'],
  },

  async execute(args, ctx) {
    const { designNodeId, siteNodeId, name = null, model = undefined } = args || {};
    if (!designNodeId) return { error: 'invalid_args', message: 'designNodeId required' };
    if (!siteNodeId)   return { error: 'invalid_args', message: 'siteNodeId required' };

    const rows = await sql`
      SELECT n.id, n.kind, n.meta, s.html
      FROM nodes n
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
      JOIN boards b ON b.id = n.board_id
      WHERE n.id = ANY(${[designNodeId, siteNodeId]})
        AND b.id = ${ctx.boardId} AND b.user_id = ${ctx.userId}
    `;
    const design = rows.find((r) => r.id === designNodeId);
    const site   = rows.find((r) => r.id === siteNodeId);
    if (!design) return { error: 'target_not_found', message: 'designNodeId not found' };
    if (!site)   return { error: 'target_not_found', message: 'siteNodeId not found' };
    if (design.kind !== 'designmd') return { error: 'invalid_args', message: 'designNodeId must point to a designmd node' };
    if (site.kind   !== 'site')     return { error: 'invalid_args', message: 'siteNodeId must point to a site node' };
    if (!design.html) return { error: 'no_snapshot', message: 'design node has no snapshot' };
    if (!site.html)   return { error: 'no_snapshot', message: 'site node has no snapshot' };

    let restyledHtml;
    try {
      restyledHtml = await reskin({ targetHtml: site.html, referenceHtml: design.html, model });
    } catch (e) {
      return { error: 'restyle_failed', message: String(e?.message || e) };
    }

    const width = 1280;
    const height = Math.round(width * 9 / 16);
    const pos = await placeRightOfSources(ctx.boardId, [designNodeId, siteNodeId], width, height, sql);
    const baseName = name || `${site.meta?.name || 'site'} — restyled`;
    const meta = { name: baseName, source: 'agent-restyled', restyledFrom: { siteNodeId, designNodeId } };

    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
      VALUES (${ctx.boardId}, 'site', ${pos.x}, ${pos.y}, ${width}, ${height}, ${JSON.stringify(meta)}::jsonb)
      RETURNING id
    `;
    const [snap] = await sql`
      INSERT INTO snapshots (node_id, html, source)
      VALUES (${node.id}, ${restyledHtml}, 'reskin')
      RETURNING id
    `;
    await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;

    // Wire both sources into the result so the chain is visible.
    const edgesCreated = [];
    for (const fromId of [siteNodeId, designNodeId]) {
      try {
        const [edge] = await sql`
          INSERT INTO edges (board_id, source_node_id, target_node_id, kind)
          VALUES (${ctx.boardId}, ${fromId}, ${node.id}, 'reskin')
          RETURNING id
        `;
        edgesCreated.push({ id: edge.id, from: fromId, to: node.id });
      } catch (_) { /* dup edge — ignore */ }
    }

    if (ctx?.emit) {
      try { ctx.emit('graph_mutated', { reason: 'applyDesign:done' }); } catch (_) {}
    }
    return {
      restyled: true,
      newSiteNodeId: node.id,
      name: baseName,
      edges: edgesCreated,
    };
  },
};
