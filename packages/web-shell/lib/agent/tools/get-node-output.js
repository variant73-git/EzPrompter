import { sql } from '../../db.js';

export const getNodeOutputTool = {
  name: 'getNodeOutput',
  description: 'Read the current snapshot content (HTML and/or design.md) of a node. Default reads are truncated to maxChars (4000) for cheap inspection. When you need the WHOLE document — e.g. to carve/split a site\'s HTML into derived nodes deterministically — pass a high maxChars (up to 200000): a full site fits, so "the HTML is too big to read" is never a reason to fall back to regeneration.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId:   { type: 'string', description: 'Node id to read' },
      maxChars: { type: 'number', description: 'Truncate combined output to this many chars (default 4000 for inspection; pass up to 200000 to read a full site HTML for deterministic splitting/derivation)' },
    },
    required: ['nodeId'],
  },
  async execute(args, ctx) {
    const { nodeId } = args || {};
    if (!nodeId) return { error: 'invalid_args', message: 'nodeId required' };
    const maxChars = Math.min(Math.max(parseInt(args?.maxChars ?? 4000, 10) || 4000, 100), 200000);

    const rows = await sql`
      SELECT s.id, s.html, s.design_md
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
      WHERE n.id = ${nodeId} AND b.id = ${ctx.boardId} AND b.user_id = ${ctx.userId}
    `;
    if (!rows.length) return { error: 'target_not_found', message: 'node not found' };
    const snap = rows[0];
    if (!snap.id) return { error: 'no_snapshot', message: 'node has no current snapshot' };

    const parts = [];
    if (snap.html) parts.push(`# HTML\n${snap.html}`);
    if (snap.design_md) parts.push(`# design.md\n${snap.design_md}`);
    let content = parts.join('\n\n---\n\n');
    let truncated = false;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + `\n\n[...truncated ${content.length - maxChars} chars]`;
      truncated = true;
    }
    return { kind: 'snapshot', content, truncated };
  },
};
