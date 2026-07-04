import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { renderHtmlScreenshot } from '../../../../../lib/site-screenshot.js';

// Static thumbnail of a node's CURRENT snapshot (perf phase 3b).
//
// CanvasNode swaps the live srcDoc iframe for this image below 40% zoom —
// at that distance a site is an unreadable postage stamp, and a static
// image costs nothing to rasterize while a live iframe keeps its whole
// document, layout and scripts alive.
//
// Cache: snapshots.screenshot_url — the SAME column the chat agent's
// site-vision path fills (capture-sourced snapshots already carry a real
// live-site screenshot there). Each snapshot pays the headless render at
// most once, whoever asks first.
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
  if (!node.current_snapshot_id) {
    return NextResponse.json({ error: 'no_snapshot' }, { status: 404 });
  }

  const [snap] = await sql`
    SELECT id, html, screenshot_url FROM snapshots WHERE id = ${node.current_snapshot_id}
  `;
  if (!snap) return NextResponse.json({ error: 'no_snapshot' }, { status: 404 });

  const cached = typeof snap.screenshot_url === 'string' && snap.screenshot_url.startsWith('data:')
    ? snap.screenshot_url
    : null;
  if (cached) {
    return NextResponse.json({ dataUrl: cached, snapshotId: snap.id });
  }

  if (typeof snap.html !== 'string' || !snap.html.trim()) {
    return NextResponse.json({ error: 'no_html' }, { status: 404 });
  }

  try {
    const dataUrl = await renderHtmlScreenshot(snap.html, {
      // Base origin so relative assets (reconstruct /rasters/…) resolve.
      baseUrl: new URL(request.url).origin,
      // FULL content height (same 12000 clamp the Expand floater uses) —
      // the node shows the thumbnail at EVERY zoom now, so a cut-short
      // capture reads as a broken site. JPEG keeps the tall render small.
      maxHeight: 12000,
      type: 'jpeg',
      quality: 82,
    });
    await sql`UPDATE snapshots SET screenshot_url = ${dataUrl} WHERE id = ${snap.id}`;
    return NextResponse.json({ dataUrl, snapshotId: snap.id });
  } catch (e) {
    console.warn('[thumbnail] render failed', e?.message || e);
    return NextResponse.json({ error: 'render_failed' }, { status: 502 });
  }
}
