import { sql } from '../../db.js';
import { placeStackDown } from '../../canvas-layout.js';
import { liveReferenceMeta } from '../../url-reference.js';

/**
 * Add a live URL reference to the current board. This is deliberately an
 * immediate database write, not a browser capture: the selected node previews
 * the source in an iframe, and editable reconstruction begins at Edit.
 */
export const captureUrlTool = {
  name: 'captureUrl',
  description: 'Add a live website reference to the canvas immediately. The selected node is scrollable through a lightweight iframe; cloning and editable reconstruction begin only when the user chooses Edit. Returns the new nodeId on success.',
  classification: 'safe',
  timeoutMs: 30 * 1000,
  inputSchema: {
    type: 'object',
    properties: {
      url:  { type: 'string', description: 'https:// URL of the site to capture.' },
      name: { type: 'string', description: 'Optional display name for the node. Defaults to the page title.' },
    },
    required: ['url'],
  },

  async execute(args, ctx) {
    const { url, name = null } = args || {};
    if (!url || typeof url !== 'string') return { error: 'invalid_args', message: 'url required' };
    if (!/^https?:\/\//i.test(url)) return { error: 'invalid_args', message: 'url must be http(s)' };

    const [board] = await sql`SELECT id FROM boards WHERE id = ${ctx.boardId} AND user_id = ${ctx.userId}`;
    if (!board) return { error: 'forbidden', message: 'board not found or not owned' };

    const width = 1280;
    const height = Math.round(width * 9 / 16);
    const { x: posX, y: posY } = await placeStackDown(ctx.boardId, width, height, sql);
    const meta = liveReferenceMeta(url, name);
    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, origin_url, pos_x, pos_y, width, height, meta)
      VALUES (${ctx.boardId}, 'site', ${url}, ${posX}, ${posY}, ${width}, ${height}, ${JSON.stringify(meta)}::jsonb)
      RETURNING id
    `;

    if (ctx?.emit) {
      try { ctx.emit('graph_mutated', { reason: 'captureUrl:referenced' }); } catch (_) {}
    }
    return {
      referenced: true,
      nodeId: node.id,
      url,
      name: meta.name,
      posX,
      posY,
      width,
      height,
    };
  },
};
