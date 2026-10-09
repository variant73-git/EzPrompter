// Publicação da cópia (spec 2026-10-09 §4.1): snapshot 'canonical' + ponteiro do node + tarefa 'ready' numa
// instrução só. Só publica se a tarefa ainda está em 'packaging' na MESMA geração e com a MESMA trava, e se o
// node ainda aponta para a versão de quando a tarefa nasceu. Senão: publish_conflict, nada muda.
import { createEmptyMotionManifest } from '../motion-editor/manifest.js';

export async function publishCanonical({ sql, job, owner, descriptor, html }) {
  const manifest = createEmptyMotionManifest({ baseBundleId: descriptor.bundleId, runtimeFingerprint: descriptor.runtimeFingerprint });
  const meta = { canonicalJobId: job.id, canonicalPreparedAt: new Date().toISOString() };
  const rows = await sql`
    WITH fence AS (
      SELECT j.id FROM canonical_jobs j
       WHERE j.id = ${job.id} AND j.status = 'packaging' AND j.generation = ${job.generation} AND j.lease_owner = ${owner}
       FOR UPDATE
    ), current_node AS (
      SELECT n.id FROM nodes n, fence
       WHERE n.id = ${job.node_id} AND n.current_snapshot_id = ${job.source_snapshot_id}
       FOR UPDATE OF n
    ), inserted AS (
      INSERT INTO snapshots (
        node_id, html, screenshot_url, source, parent_snapshot_id,
        native_bundle_id, motion_manifest, motion_manifest_version
      )
      SELECT ${job.node_id}, ${html},
             (SELECT screenshot_url FROM snapshots WHERE id = ${job.source_snapshot_id}),
             'canonical', ${job.source_snapshot_id},
             ${descriptor.bundleId}, ${JSON.stringify(manifest)}::jsonb, ${manifest.schemaVersion}
        FROM current_node
      RETURNING id
    ), updated_node AS (
      UPDATE nodes
         SET current_snapshot_id = inserted.id,
             meta = meta || ${JSON.stringify(meta)}::jsonb
        FROM inserted
       WHERE nodes.id = ${job.node_id} AND nodes.current_snapshot_id = ${job.source_snapshot_id}
      RETURNING inserted.id AS snapshot_id
    ), done AS (
      UPDATE canonical_jobs
         SET status = 'ready', generation = generation + 1, progress_pct = 100,
             result_bundle_id = ${descriptor.bundleId},
             result_snapshot_id = (SELECT snapshot_id FROM updated_node),
             lease_owner = NULL, lease_until = NULL, updated_at = NOW()
       WHERE id = ${job.id} AND EXISTS (SELECT 1 FROM updated_node)
      RETURNING id
    )
    SELECT (SELECT snapshot_id FROM updated_node) AS snapshot_id, (SELECT id FROM done) AS job_id`;
  const snapshotId = rows[0]?.snapshot_id || null;
  if (!snapshotId || !rows[0]?.job_id) throw Object.assign(new Error('publish_conflict'), { code: 'publish_conflict' });
  return { snapshotId, motionManifest: manifest };
}
