import { sql } from '../../db.js';
import { runCompose } from '../../run-flow.js';
import { runBilledOperation, InsufficientCreditsError } from '../../billing/context.js';
import { deriveIdemKey } from '../../billing/idem-derive.js';

export const runFlowTool = {
  name: 'runFlow',
  description: `Run the compose pipeline on a target node, pulling content from its incoming sources (edges) and writing a new snapshot.

Use after you've created and connected the right nodes — don't call runFlow before any edges exist (the result will be empty). The previous snapshot is preserved in history, so the operation is recoverable. Specify modelId to override the user's picker for this specific run.`,
  // 2026-06-12 user decision: confirm chips are reserved for DELETES only.
  // runFlow overwrites the target's snapshot, but history (parent_snapshot_id
  // + saved versions + reset) makes it recoverable — not chip-worthy.
  classification: 'safe',
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
      SELECT n.id, n.kind, n.meta, n.board_id,
             s.html AS current_html,
             s.design_md AS current_design_md
        FROM nodes n
        JOIN boards b ON b.id = n.board_id
        LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
       WHERE n.id = ${nodeId} AND b.user_id = ${ctx.userId} AND b.id = ${ctx.boardId}
    `;
    if (!target) return { error: 'forbidden', message: 'node not found on this board' };

    const incoming = await sql`
      SELECT e.id        AS edge_id,
             e.payload   AS edge_payload,
             n.id        AS source_node_id,
             n.kind      AS kind,
             n.meta      AS meta,
             s.html      AS source_html,
             s.design_md AS source_design_md
        FROM edges e
        JOIN nodes n ON n.id = e.source_node_id
        LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
       WHERE e.target_node_id = ${nodeId}
    `;
    if (!incoming.length) {
      return { error: 'no_sources', message: 'target has no incoming edges — connect sources before running' };
    }

    const sources = incoming;

    try {
      // The tool bills as its OWN compose operation — the surrounding chat
      // context stays free (innermost context wins).
      const { result: payload, credits, balanceAfter } = await runBilledOperation(
        { sql, userId: ctx.userId, op: 'compose', boardId: ctx.boardId, nodeId, idemKey: deriveIdemKey([ctx.runId, 'compose', nodeId, modelId || '']) },
        async () => {
          // Model priority: explicit tool arg > the user's dock picker >
          // runCompose's default. The picker is the user's standing choice —
          // an agent-initiated run must honor it (same rule as createImage).
          const result = await runCompose({ target, sources, modelId: modelId || ctx?.pickerModel || null });
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
        },
      );
      return { ...payload, credits, balanceAfter };
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        return { error: 'insufficient_credits', estimate: e.estimate, balance: e.balance };
      }
      return { error: 'run_failed', message: String(e?.message || e) };
    }
  },
};
