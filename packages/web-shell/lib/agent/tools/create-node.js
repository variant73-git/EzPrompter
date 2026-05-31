import { sql } from '../../db.js';

const VALID_KINDS = ['site', 'template', 'designmd', 'chunk', 'prompt', 'skill', 'asset'];

export const createNodeTool = {
  name: 'createNode',
  description: 'Create a new node on the user\'s current board. Use kind="prompt" for a writable text prompt node, "site" for a website snapshot placeholder (use updateNode meta.url later), "designmd" for a design.md container, "asset" for an image/asset slot.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: VALID_KINDS, description: 'Node kind' },
      name: { type: 'string', description: 'Optional display name' },
      meta: { type: 'object', description: 'Arbitrary metadata' },
      posX: { type: 'number', description: 'Canvas X position (optional, auto-placed if omitted)' },
      posY: { type: 'number', description: 'Canvas Y position' },
    },
    required: ['kind'],
  },
  async execute(args, ctx) {
    const { kind, name = null, meta = {}, posX = 0, posY = 0 } = args || {};
    if (!kind) return { error: 'invalid_args', message: 'kind is required' };
    if (!VALID_KINDS.includes(kind)) return { error: 'invalid_args', message: `kind must be one of: ${VALID_KINDS.join(', ')}` };

    const owned = await sql`SELECT id FROM boards WHERE id = ${ctx.boardId} AND user_id = ${ctx.userId}`;
    if (!owned.length) return { error: 'forbidden', message: 'board not found or not owned' };

    const enrichedMeta = name ? { ...meta, name } : meta;

    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, pos_x, pos_y, meta)
      VALUES (${ctx.boardId}, ${kind}, ${posX}, ${posY}, ${enrichedMeta}::jsonb)
      RETURNING id, kind, pos_x, pos_y, meta, created_at
    `;
    return { id: node.id, kind: node.kind, posX: node.pos_x, posY: node.pos_y, meta: node.meta };
  },
};
