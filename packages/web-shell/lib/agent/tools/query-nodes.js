import { sql } from '../../db.js';

export const queryNodesTool = {
  name: 'queryNodes',
  description: 'List nodes on the current board, optionally filtered by kind and/or a name substring. Returns up to 30 nodes by default.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      kind:        { type: 'string', description: 'Filter by node kind (e.g. "site", "prompt")' },
      namePattern: { type: 'string', description: 'Case-insensitive substring match against meta.name' },
      limit:       { type: 'number', description: 'Max results, default 30, hard cap 100' },
    },
  },
  async execute(args, ctx) {
    const { kind = null, namePattern = null } = args || {};
    const limit = Math.min(Math.max(parseInt(args?.limit ?? 30, 10) || 30, 1), 100);

    const rows = await sql`
      SELECT id, kind, pos_x, pos_y, meta, current_snapshot_id, created_at
      FROM nodes
      WHERE board_id = ${ctx.boardId}
        AND (${kind}::text IS NULL OR kind = ${kind})
        AND (${namePattern}::text IS NULL OR (meta->>'name') ILIKE '%' || ${namePattern} || '%')
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id, kind: r.kind, posX: r.pos_x, posY: r.pos_y, meta: r.meta,
      hasSnapshot: !!r.current_snapshot_id, createdAt: r.created_at,
    }));
  },
};
