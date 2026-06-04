import { sql } from '../../db.js';
import { runCompose } from '../../run-flow.js';

export const runFlowTool = {
  name: 'runFlow',
  description: `Run the compose pipeline on a target node, pulling content from its incoming sources (edges) and writing a new snapshot.

DESTRUCTIVE: pauses for user confirmation before running because it costs money. Use after you've created and connected the right nodes — don't call runFlow before any edges exist (the result will be empty). Specify modelId to override the user's picker for this specific run.`,
  classification: 'destructive',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId:  { type: 'string', description: 'UUID of the target node to run the flow on' },
      modelId: { type: 'string', description: 'Optional model override (e.g. "claude-sonnet-4-6", "gpt-5.5", "gemini-3.1-pro")' },
    },
    required: ['nodeId'],
  },
  async execute(args, ctx) {
    const { nodeId, modelId = null } = args || {};
    if (!nodeId) return { error: 'invalid_args', message: 'nodeId required' };

    const [target] = await sql`
      SELECT n.* FROM nodes n
        JOIN boards b ON b.id = n.board_id
       WHERE n.id = ${nodeId} AND b.user_id = ${ctx.userId} AND b.id = ${ctx.boardId}
    `;
    if (!target) return { error: 'forbidden', message: 'node not found on this board' };

    const incoming = await sql`
      SELECT e.*, n.kind AS source_kind, n.current_snapshot_id AS source_snapshot_id
        FROM edges e JOIN nodes n ON n.id = e.from_node_id
       WHERE e.to_node_id = ${nodeId}
    `;
    if (!incoming.length) {
      return { error: 'no_sources', message: 'target has no incoming edges — connect sources before running' };
    }

    const sources = [];
    for (const edge of incoming) {
      let snap = null;
      if (edge.source_snapshot_id) {
        const [s] = await sql`SELECT id, html, design_md, prompt, screenshot_url FROM snapshots WHERE id = ${edge.source_snapshot_id}`;
        snap = s || null;
      }
      sources.push({ kind: edge.source_kind, snapshot: snap, edgeMeta: edge.meta || null });
    }

    try {
      const result = await runCompose({ target, sources, modelId });
      const [newSnap] = await sql`
        INSERT INTO snapshots (node_id, html, source)
        VALUES (${nodeId}, ${result.html}, 'agent-run')
        RETURNING id
      `;
      await sql`UPDATE nodes SET current_snapshot_id = ${newSnap.id} WHERE id = ${nodeId}`;
      return {
        ran: true,
        nodeId,
        snapshotId: newSnap.id,
        bytes: result.html?.length || 0,
      };
    } catch (e) {
      return { error: 'run_failed', message: String(e?.message || e) };
    }
  },
};
