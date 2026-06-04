import { sql } from '../../db.js';
import { runCompose } from '../../run-flow.js';
import { EDIT_SITE_SYSTEM } from '../prompts.js';

export const editSiteTool = {
  name: 'editSite',
  description: `Apply a plain-language edit to a website node, producing a new snapshot.

DESTRUCTIVE: pauses for user confirmation. Use when the user describes a change to an existing site rather than building something new — e.g. "make the hero teal", "rewrite the headline to say X", "swap the logo for this image".

This will refuse if the user is currently editing the node in-place (you'll get error="node_open_in_edit") — wait for them to close edit mode first.`,
  classification: 'destructive',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId:      { type: 'string', description: 'UUID of the site node to edit' },
      instruction: { type: 'string', description: 'Plain-language instruction describing the change' },
    },
    required: ['nodeId', 'instruction'],
  },
  async execute(args, ctx) {
    const { nodeId, instruction } = args || {};
    if (!nodeId || !instruction) return { error: 'invalid_args', message: 'nodeId and instruction required' };

    const [target] = await sql`
      SELECT n.id, n.kind, n.meta, n.board_id,
             s.html AS current_html,
             s.design_md AS current_design_md
        FROM nodes n
        JOIN boards b ON b.id = n.board_id
        LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
       WHERE n.id = ${nodeId} AND b.user_id = ${ctx.userId} AND b.id = ${ctx.boardId}
    `;
    if (!target) return { error: 'forbidden', message: 'node not found on this board' };

    if (target.meta?.editing === true) {
      return { error: 'node_open_in_edit', message: 'node is currently open in edit mode — ask the user to close it' };
    }
    if (!target.current_html) {
      return { error: 'no_snapshot', message: 'node has no current snapshot to edit' };
    }

    try {
      const result = await runCompose({
        target,
        sources: [
          { kind: 'site', source_html: target.current_html },
          { kind: 'prompt', meta: { prompt: instruction } },
        ],
        systemPromptOverride: EDIT_SITE_SYSTEM,
      });
      const [newSnap] = await sql`
        INSERT INTO snapshots (node_id, html, source)
        VALUES (${nodeId}, ${result.html}, 'agent-edit')
        RETURNING id
      `;
      await sql`UPDATE nodes SET current_snapshot_id = ${newSnap.id} WHERE id = ${nodeId}`;
      return { edited: true, nodeId, snapshotId: newSnap.id, bytes: result.html?.length || 0 };
    } catch (e) {
      return { error: 'edit_failed', message: String(e?.message || e) };
    }
  },
};
