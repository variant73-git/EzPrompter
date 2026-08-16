import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { parseMotionManifest } from '../../../../../lib/motion-editor/manifest.js';

// POST /api/nodes/[id]/restore-version  { snapshotId }
//
// Restore a past version: point current_snapshot_id at a chosen snapshot.
// Non-destructive — no snapshot is deleted, so the user can switch back and
// forth freely; later edits branch from the restored version. The snapshot
// must belong to this node and the node to the user. Returns the restored
// content so the client renders immediately without a board refetch.
// (The existing /reset route — which always points at the FIRST snapshot —
// is left untouched.)
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const snapshotId = body?.snapshotId;
  if (!snapshotId) return NextResponse.json({ error: 'snapshotId required' }, { status: 400 });

  const [snap] = await sql`
    SELECT s.id, s.html, s.design_md, s.screenshot_url, s.source,
           s.native_bundle_id, s.motion_manifest, s.motion_manifest_version,
           nb.runtime_fingerprint AS native_bundle_runtime_fingerprint
      FROM snapshots s
      JOIN nodes n ON n.id = s.node_id
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN native_bundles nb ON nb.bundle_id = s.native_bundle_id
     WHERE s.id = ${snapshotId} AND s.node_id = ${id} AND b.user_id = ${user.id}
  `;
  if (!snap) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await sql`
    WITH closed_sessions AS (
      UPDATE native_motion_edit_sessions
         SET status = 'discarded', updated_at = NOW(), closed_at = NOW()
       WHERE node_id = ${id} AND status = 'active'
      RETURNING id
    )
    UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${id}
  `;

  const result = {
    ok: true,
    snapshot_id: snap.id,
    html: snap.html,
    design_md: snap.design_md,
    screenshot_url: snap.screenshot_url,
    source: snap.source,
    native_bundle_id: snap.native_bundle_id || null,
    motion_manifest_version: snap.motion_manifest_version == null
      ? null
      : Number(snap.motion_manifest_version),
  };
  if (snap.native_bundle_id && snap.motion_manifest) {
    result.motion_manifest = parseMotionManifest(snap.motion_manifest, {
      expectedBundleId: snap.native_bundle_id,
      runtimeFingerprint: snap.native_bundle_runtime_fingerprint,
    });
  }
  return NextResponse.json(result);
}
