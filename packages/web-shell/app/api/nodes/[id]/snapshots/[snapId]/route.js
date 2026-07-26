import { NextResponse } from 'next/server';
import { db } from '../../../../../../lib/db.js';
import { requireUser } from '../../../../../../lib/auth.js';
import { parseMotionManifest } from '../../../../../../lib/motion-editor/manifest.js';

// GET /api/nodes/[id]/snapshots/[snapId]
//
// One version's renderable content (html + screenshot_url) for the preview and
// the mini-iframe thumbnail. On-demand only — never bulk-loaded. The snapshot
// must belong to THIS node and the node to the user.
export async function GET(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id, snapId } = await params;

  const [row] = await sql`
    SELECT s.id, s.html, s.design_md, s.screenshot_url, s.source, s.created_at,
           s.native_bundle_id, s.motion_manifest, s.motion_manifest_version,
           nb.schema_version AS native_bundle_schema_version,
           nb.content_hash AS native_bundle_content_hash,
           nb.entry_path AS native_bundle_entry_path,
           nb.runtime_fingerprint AS native_bundle_runtime_fingerprint
      FROM snapshots s
      JOIN nodes n ON n.id = s.node_id
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN native_bundles nb ON nb.bundle_id = s.native_bundle_id
     WHERE s.id = ${snapId} AND s.node_id = ${id} AND b.user_id = ${user.id}
  `;
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const snapshot = {
    id: row.id,
    html: row.html,
    design_md: row.design_md,
    screenshot_url: row.screenshot_url,
    source: row.source,
    created_at: row.created_at,
  };
  if (row.native_bundle_id) {
    snapshot.nativeBundle = {
      schemaVersion: Number(row.native_bundle_schema_version),
      bundleId: row.native_bundle_id,
      contentHash: row.native_bundle_content_hash,
      entryPath: row.native_bundle_entry_path,
      runtimeFingerprint: row.native_bundle_runtime_fingerprint,
    };
    if (row.motion_manifest) {
      snapshot.motionManifest = parseMotionManifest(row.motion_manifest, {
        expectedBundleId: row.native_bundle_id,
      });
      snapshot.motionManifestVersion = Number(row.motion_manifest_version);
    }
  }
  return NextResponse.json({ snapshot });
}

// DELETE /api/nodes/[id]/snapshots/[snapId]
//
// Remove one version from the node's history ("delete from history"). Guards:
// the snapshot must belong to THIS node and the node to the user; the LAST
// remaining snapshot can't be deleted (a node always needs at least one
// version). If the deleted snapshot is the one currently shown, current_snapshot
// repoints to the most recent remaining version. Child snapshots that branched
// off it have their parent pointer cleared so the FK doesn't block the delete.
export async function DELETE(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id, snapId } = await params;

  const [node] = await sql`
    SELECT n.id, n.current_snapshot_id, n.original_snapshot_id
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [snap] = await sql`SELECT id FROM snapshots WHERE id = ${snapId} AND node_id = ${id}`;
  if (!snap) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM snapshots WHERE node_id = ${id}`;
  if (count <= 1) {
    return NextResponse.json(
      { error: 'last_snapshot', detail: 'This is the only version — it can\'t be deleted.' },
      { status: 400 }
    );
  }

  // Repoint current/original pointers off the snapshot being deleted.
  let newCurrentId = node.current_snapshot_id;
  if (node.current_snapshot_id === snapId) {
    const [next] = await sql`
      SELECT id FROM snapshots WHERE node_id = ${id} AND id != ${snapId}
       ORDER BY created_at DESC LIMIT 1
    `;
    newCurrentId = next?.id || null;
  }
  if (node.current_snapshot_id === snapId || node.original_snapshot_id === snapId) {
    await sql`
      UPDATE nodes
         SET current_snapshot_id  = ${node.current_snapshot_id === snapId ? newCurrentId : node.current_snapshot_id},
             original_snapshot_id = ${node.original_snapshot_id === snapId ? null : node.original_snapshot_id}
       WHERE id = ${id}
    `;
  }
  // Clear children's parent pointer so the FK doesn't block the delete.
  await sql`UPDATE snapshots SET parent_snapshot_id = NULL WHERE parent_snapshot_id = ${snapId}`;
  await sql`DELETE FROM snapshots WHERE id = ${snapId} AND node_id = ${id}`;

  return NextResponse.json({ ok: true, currentSnapshotId: newCurrentId });
}
