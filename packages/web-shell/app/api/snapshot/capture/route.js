import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { requireUser } from '../../../../lib/auth.js';
import { captureSnapshot } from '../../../../lib/snapshot.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const { url, nodeId } = body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'valid http(s) url required' }, { status: 400 });
  }

  let cap;
  try {
    cap = await captureSnapshot(url);
  } catch (e) {
    console.error('captureSnapshot error', e);
    return NextResponse.json({ error: 'capture_failed', detail: String(e?.message || e) }, { status: 502 });
  }

  // If a nodeId is supplied, persist as snapshot and update node.current_snapshot_id.
  if (nodeId) {
    const sql = await db();
    const [node] = await sql`
      SELECT n.id FROM nodes n
        JOIN boards b ON b.id = n.board_id
       WHERE n.id = ${nodeId} AND b.user_id = ${user.id}
    `;
    if (!node) return NextResponse.json({ error: 'node not found' }, { status: 404 });

    const [snap] = await sql`
      INSERT INTO snapshots (node_id, html, screenshot_url, source)
      VALUES (${nodeId}, ${cap.html}, ${cap.screenshotDataUrl}, 'capture')
      RETURNING id, created_at
    `;
    await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${nodeId}`;
    return NextResponse.json({ ok: true, snapshotId: snap.id, title: cap.title });
  }

  // Anonymous capture (used when adding a URL before the node exists).
  return NextResponse.json({
    ok: true,
    html: cap.html,
    screenshotDataUrl: cap.screenshotDataUrl,
    title: cap.title,
    baseUrl: cap.baseUrl
  });
}
