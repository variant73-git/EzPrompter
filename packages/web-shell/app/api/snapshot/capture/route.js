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

  // Reachability pre-check — fast bail-out so we don't spin Playwright
  // up against a typo or dead host. HEAD first; some servers reject it
  // (405/501) so fall back to a tiny ranged GET. 6s budget.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    let res;
    // Use a realistic browser UA — Cloudflare / WAFs return 403/406 on
    // any "bot-shaped" user-agent. Playwright would still load the page
    // fine (real Chrome), so the pre-check should mirror that posture
    // rather than bail on bot-policy responses.
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    try {
      res = await fetch(url, {
        method: 'HEAD', redirect: 'follow', signal: ctrl.signal,
        headers: { 'user-agent': UA }
      });
      if (!res.ok && [405, 501].includes(res.status)) {
        res = await fetch(url, {
          method: 'GET', redirect: 'follow', signal: ctrl.signal,
          headers: { 'user-agent': UA, range: 'bytes=0-256' }
        });
      }
    } finally { clearTimeout(timer); }
    // 403 / 406 / 429 / 503 are commonly emitted by bot-policy walls on
    // HEAD requests even when the actual page loads in a real browser.
    // We pass those through and let Playwright try — the page may well
    // succeed once it executes with a real-browser fingerprint.
    const passThrough = res && [403, 406, 429, 503].includes(res.status);
    if (!res || (!passThrough && res.status >= 400)) {
      const status = res ? res.status : 0;
      return NextResponse.json({
        error: 'site_unreachable',
        detail: status ? `Server responded with HTTP ${status}.` : 'No response from server.',
        status
      }, { status: 400 });
    }
  } catch (e) {
    const code = e?.cause?.code || e?.code || '';
    const msg = String(e?.message || '');
    const isDns = code === 'ENOTFOUND' || /ENOTFOUND/.test(msg);
    const isAbort = e?.name === 'AbortError';
    return NextResponse.json({
      error: 'site_unreachable',
      detail: isDns
        ? 'Domain not found. Check the spelling.'
        : isAbort
          ? 'Site did not respond within 6 seconds.'
          : 'Could not reach the site.',
      code
    }, { status: 400 });
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
