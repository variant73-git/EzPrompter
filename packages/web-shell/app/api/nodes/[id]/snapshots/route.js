import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';

// GET /api/nodes/[id]/snapshots
//
// Light list of a node's version snapshots — metadata ONLY, never html
// (bandwidth discipline, mirrors the ?light= queries). Newest-first. The
// current snapshot is flagged via isCurrent so the client derives
// "past versions" = !isCurrent for both the floater row and the history menu.
export async function GET(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;

  const [node] = await sql`
    SELECT n.id, n.current_snapshot_id FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const rows = await sql`
    SELECT id, source, created_at, (screenshot_url IS NOT NULL) AS "hasScreenshot",
           native_bundle_id, motion_manifest_version
      FROM snapshots
     WHERE node_id = ${id}
     ORDER BY created_at DESC
  `;

  const snapshots = rows.map((r) => {
    const snapshot = {
      id: r.id,
      source: r.source,
      created_at: r.created_at,
      hasScreenshot: r.hasScreenshot === true,
      isCurrent: r.id === node.current_snapshot_id,
    };
    if (r.native_bundle_id) {
      snapshot.nativeBundleId = r.native_bundle_id;
      if (r.motion_manifest_version != null) {
        snapshot.motionManifestVersion = Number(r.motion_manifest_version);
      }
    }
    return snapshot;
  });
  return NextResponse.json({ snapshots });
}
