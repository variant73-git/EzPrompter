import { sql } from '../../db.js';

export const listAssetsTool = {
  name: 'listAssets',
  description: 'List the user\'s collected assets. scope="library" returns assets not tied to any project. scope="project" returns assets tied to the current board\'s project.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['library', 'project'], description: 'library (default) or project' },
      type:  { type: 'string', description: 'Optional filter: image, icon, background, font' },
      limit: { type: 'number', description: 'Max results, default 20, cap 100' },
    },
  },
  async execute(args, ctx) {
    const scope = args?.scope === 'project' ? 'project' : 'library';
    const type = args?.type || null;
    const limit = Math.min(Math.max(parseInt(args?.limit ?? 20, 10) || 20, 1), 100);

    const rows = scope === 'library'
      ? await sql`
          SELECT id, type, source_url, thumb_url, created_at
          FROM assets
          WHERE user_id = ${ctx.userId} AND project_id IS NULL
            AND (${type}::text IS NULL OR type = ${type})
          ORDER BY created_at DESC LIMIT ${limit}
        `
      : await sql`
          SELECT id, type, source_url, thumb_url, created_at
          FROM assets
          WHERE user_id = ${ctx.userId} AND project_id = ${ctx.boardId}
            AND (${type}::text IS NULL OR type = ${type})
          ORDER BY created_at DESC LIMIT ${limit}
        `;
    return rows.map((r) => ({
      id: r.id, type: r.type,
      sourceUrl: r.source_url, thumbUrl: r.thumb_url,
      createdAt: r.created_at,
    }));
  },
};
