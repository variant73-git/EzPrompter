import { reconstructPage } from './reconstruct.js';
import { runBilledOperation } from './billing/context.js';

// One implementation for every paid upgrade path. Capture stays free; edit
// and strict workflow dependencies call this service only after the policy in
// reconstruction-policy.js has approved the action.
export async function reconstructSiteNode({ sql, userId, node, reason, idemKey = null }) {
  const { result, credits, balanceAfter } = await runBilledOperation(
    { sql, userId, op: 'reconstruct', boardId: node.board_id, nodeId: node.id, idemKey },
    async () => {
      const rec = await reconstructPage(node.origin_url);
      if (!rec?.html) {
        const error = new Error('no_output');
        error.code = 'no_output';
        throw error;
      }
      const [snap] = await sql`
        INSERT INTO snapshots (node_id, html, screenshot_url, source, parent_snapshot_id)
        VALUES (${node.id}, ${rec.html}, ${rec.screenshotDataUrl || null}, 'reconstruct',
                (SELECT current_snapshot_id FROM nodes WHERE id = ${node.id}))
        RETURNING id
      `;
      const nextMeta = {
        animatedDetected: false,
        animatedRuntime: true,
        reconstructionEngine: 'iter9',
        deferredReconstructionReason: reason,
        deferredReconstructedAt: new Date().toISOString(),
      };
      await sql`
        UPDATE nodes
           SET current_snapshot_id = ${snap.id},
               meta = meta || ${JSON.stringify(nextMeta)}::jsonb
         WHERE id = ${node.id}
      `;
      return { ok: true, nodeId: node.id, snapshotId: snap.id, html: rec.html, meta: nextMeta };
    },
  );
  return { ...result, credits, balanceAfter };
}
