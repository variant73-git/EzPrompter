import { sql } from '../../db.js';

// Type → {kind, meta-mixin} map. The agent reasons in these user-facing
// types; we translate to the kind/meta shape the rest of the system
// (nodeOrigin, edge color, runFlow target detection) expects.
//
// Border colors are documented for the LLM in the tool description so it
// can ack "I added a teal blank website node" without guessing.
const NODE_TYPES = {
  'blank-website':  { kind: 'site',     meta: { source: 'blank' }, color: 'teal',    desc: 'Empty website canvas — compose by connecting other nodes into it' },
  'prompt':         { kind: 'prompt',   meta: {},                  color: 'yellow',  desc: 'A text prompt — give it instructions, then chain it into a website to apply' },
  'design-system':  { kind: 'designmd', meta: {},                  color: 'green',   desc: 'A design.md spec (colors, fonts, spacing) — connect to a website to restyle it' },
  'asset':          { kind: 'asset',    meta: {},                  color: 'violet',  desc: 'An image/asset slot — fill via Smart Edit or by attaching uploads' },
  'skill':          { kind: 'skill',    meta: {},                  color: 'pink',    desc: 'A reusable skill node (rarely needed — only ask if user mentions skills)' },
};

const TYPE_LIST = Object.keys(NODE_TYPES);
const TYPE_DOC = TYPE_LIST.map((t) => `  - "${t}" (${NODE_TYPES[t].color} border) — ${NODE_TYPES[t].desc}`).join('\n');

export const createNodeTool = {
  name: 'createNode',
  description: `Add a new node to the user's board. Pick "type" by what the user actually wants:

${TYPE_DOC}

IMPORTANT picking tips:
- "blank website", "site em branco", "blank node", "novo site vazio", "empty canvas to fill" → type "blank-website" (teal). NOT "html-snippet" or bare site. Blank is for the user to manually compose by dragging things in.
- "prompt node", "node de prompt", "instruction" → type "prompt"
- "design system", "design.md", "tokens", "style guide" → type "design-system"
- "image slot", "asset", "placeholder for an image" → type "asset"

If the user wants a CAPTURED website (a real URL they want to snapshot), don't use this tool — ask them to paste the URL into the input bar; the capture flow is separate.`,
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: TYPE_LIST,
        description: 'What KIND of node to add. See description for the full meaning of each type.',
      },
      name: { type: 'string', description: 'Optional display name shown on the node' },
      posX: { type: 'number', description: 'Canvas X (optional)' },
      posY: { type: 'number', description: 'Canvas Y (optional)' },
    },
    required: ['type'],
  },
  async execute(args, ctx) {
    const { type, name = null, posX = 0, posY = 0 } = args || {};
    if (!type) return { error: 'invalid_args', message: 'type is required' };
    const mapping = NODE_TYPES[type];
    if (!mapping) return { error: 'invalid_args', message: `type must be one of: ${TYPE_LIST.join(', ')}` };

    const owned = await sql`SELECT id FROM boards WHERE id = ${ctx.boardId} AND user_id = ${ctx.userId}`;
    if (!owned.length) return { error: 'forbidden', message: 'board not found or not owned' };

    const finalMeta = name ? { ...mapping.meta, name } : mapping.meta;

    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, pos_x, pos_y, meta)
      VALUES (${ctx.boardId}, ${mapping.kind}, ${posX}, ${posY}, ${finalMeta}::jsonb)
      RETURNING id, kind, pos_x, pos_y, meta, created_at
    `;
    return {
      id: node.id,
      type,
      color: mapping.color,
      posX: node.pos_x,
      posY: node.pos_y,
      meta: node.meta,
    };
  },
};
