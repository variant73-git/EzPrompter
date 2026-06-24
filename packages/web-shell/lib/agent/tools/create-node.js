import { sql } from '../../db.js';
import { BLANK_SITE_HTML, BLANK_SITE_DEFAULTS } from '../../blank-site-html.js';
import { placeStackDown, resolvePlacement } from '../../canvas-layout.js';

// Type → {kind, meta-mixin, ...} map. The agent reasons in these
// user-facing types; we translate to the kind/meta shape the rest of the
// system (nodeOrigin, edge color, runFlow target detection) expects.
//
// Border colors documented in the tool description so the LLM can ack
// "I added a teal blank website node" without guessing.
//
// For blank-website, we also seed an initial HTML snapshot (matching what
// CanvasClient.handleAddBlankSite does via the "+" button) so both creation
// paths produce a visually identical node — same white card with "Blank
// website" heading rendered inside the iframe, instead of an empty body.
const NODE_TYPES = {
  'blank-website':  {
    kind: 'site',
    meta: { source: 'blank' },
    color: 'teal',
    desc: 'Empty website canvas — compose by connecting other nodes into it',
    width: BLANK_SITE_DEFAULTS.width,
    height: BLANK_SITE_DEFAULTS.height,
    defaultName: BLANK_SITE_DEFAULTS.name,
    seedHtml: BLANK_SITE_HTML,
  },
  'prompt':         { kind: 'prompt',   meta: {}, color: 'yellow',  desc: 'A text prompt — give it instructions, then chain it into a website to apply', width: 600, height: 200 },
  'design-system':  { kind: 'designmd', meta: {}, color: 'green',   desc: 'A design.md spec (colors, fonts, spacing) — connect to a website to restyle it' },
  'asset':          { kind: 'asset',    meta: {}, color: 'violet',  desc: 'An image/asset slot — fill via Smart Edit or by attaching uploads' },
  'skill':          { kind: 'skill',    meta: {}, color: 'pink',    desc: 'A reusable skill node (rarely needed — only ask if user mentions skills)' },
};

const TYPE_LIST = Object.keys(NODE_TYPES);
const TYPE_DOC = TYPE_LIST.map((t) => `  - "${t}" (${NODE_TYPES[t].color} border) — ${NODE_TYPES[t].desc}`).join('\n');

export const createNodeTool = {
  name: 'createNode',
  description: `Add a new node to the user's board.

${TYPE_DOC}

If the user wants to CAPTURE a real website by URL (snapshot a live site), don't use this tool — that's a separate flow driven from the input bar.`,
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
      content: { type: 'string', description: 'Optional body for the node. For a "prompt" node: the brief/instruction text (becomes the prompt the node feeds into a site). For a "design-system" node: the DESIGN.md spec text. Omit to leave the node a blank slot the user fills later.' },
      posX: { type: 'number', description: 'Canvas X (optional)' },
      posY: { type: 'number', description: 'Canvas Y (optional)' },
    },
    required: ['type'],
  },
  async execute(args, ctx) {
    const { type, name = null, posX, posY, content = null } = args || {};
    if (!type) return { error: 'invalid_args', message: 'type is required' };
    const mapping = NODE_TYPES[type];
    if (!mapping) return { error: 'invalid_args', message: `type must be one of: ${TYPE_LIST.join(', ')}` };

    const owned = await sql`SELECT id FROM boards WHERE id = ${ctx.boardId} AND user_id = ${ctx.userId}`;
    if (!owned.length) return { error: 'forbidden', message: 'board not found or not owned' };

    const effectiveName = name || mapping.defaultName || null;
    const finalMeta = effectiveName ? { ...mapping.meta, name: effectiveName } : mapping.meta;

    // Prompt nodes carry their brief in meta.prompt — that's what run-flow
    // reads to compose. Without it an agent-made prompt node is inert.
    const metaWithContent = (mapping.kind === 'prompt' && content)
      ? { ...finalMeta, prompt: content }
      : finalMeta;

    const w = mapping.width || 1280;
    let h = mapping.height || 800;
    // A prompt node GENERATED already populated sizes its height to the brief
    // text plus a 20% breathing margin below it, so the field isn't cramped or
    // wastefully tall. Empty prompt nodes keep the compact default.
    if (mapping.kind === 'prompt' && content) {
      const CHARS_PER_LINE = 52;   // ~600px field at 18px Instrument Sans
      const LINE_H = 27;           // 18px × 1.5 line-height
      const CHROME = 76;           // body padding (28) + textarea padding (48)
      const lines = String(content).split('\n')
        .reduce((acc, ln) => acc + Math.max(1, Math.ceil(ln.length / CHARS_PER_LINE)), 0);
      const textH = lines * LINE_H;
      // node.height drives the field (body) height only — topbar is separate.
      h = Math.round(textH * 1.2 + CHROME);          // +20% breathing below text
      h = Math.max(200, Math.min(h, 900));            // sane bounds
    }

    // Auto-place: if caller didn't pass coords, stack vertically in the
    // rightmost column already in use. Each call in the same agent turn
    // picks up the previous insert, so N createNode calls pile under each
    // other instead of running across the canvas as a horizontal line.
    let placedX = posX;
    let placedY = posY;
    if (placedX == null || placedY == null) {
      const pos = await placeStackDown(ctx.boardId, w, h, sql);
      if (placedX == null) placedX = pos.x;
      if (placedY == null) placedY = pos.y;
    } else {
      // Explicit coords still must not overlap anything already on the
      // board — resolve them against the live nodes (push down to clear).
      const pos = await resolvePlacement(ctx.boardId, placedX, placedY, w, h, sql);
      placedX = pos.x;
      placedY = pos.y;
    }

    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
      VALUES (${ctx.boardId}, ${mapping.kind}, ${placedX}, ${placedY}, ${w}, ${h}, ${metaWithContent}::jsonb)
      RETURNING id, kind, pos_x, pos_y, width, height, meta, created_at
    `;

    // Seed an initial snapshot when the type defines one (currently only
    // blank-website). This is what gives the iframe content to render, so
    // the agent-created node looks identical to the "+" button variant.
    if (mapping.seedHtml) {
      const [snap] = await sql`
        INSERT INTO snapshots (node_id, html, source)
        VALUES (${node.id}, ${mapping.seedHtml}, 'seed')
        RETURNING id
      `;
      await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;
    }

    // Design-system nodes with content get a design_md snapshot, so they
    // work as an md source in run-flow (read as source_design_md) AND via
    // applyDesign. No content → blank slot (no snapshot), per the spec.
    if (mapping.kind === 'designmd' && content) {
      const [snap] = await sql`
        INSERT INTO snapshots (node_id, html, design_md, source)
        VALUES (${node.id}, ${null}, ${content}, 'seed')
        RETURNING id
      `;
      await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;
    }

    return {
      id: node.id,
      type,
      color: mapping.color,
      posX: node.pos_x,
      posY: node.pos_y,
      width: node.width,
      height: node.height,
      meta: node.meta,
    };
  },
};
