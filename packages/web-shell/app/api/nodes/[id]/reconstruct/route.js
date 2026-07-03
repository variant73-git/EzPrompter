import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { reconstructPage } from '../../../../../lib/reconstruct.js';
import { runBilledOperation, InsufficientCreditsError } from '../../../../../lib/billing/context.js';
import { checkOpsRate } from '../../../../../lib/billing/rate-limit.js';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/nodes/:id/reconstruct
// Deliberate, BILLED vision rebuild of an animated site (spec: capture is
// always free; reconstruct is the 10×-priced opt-in the client offers when
// the capture probe flags an animated builder).
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const { id } = await params;
  const sql = await db();

  const [node] = await sql`
    SELECT n.id, n.board_id, n.origin_url
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!node.origin_url) {
    return NextResponse.json({ error: 'no_origin_url', detail: 'node has no source URL to reconstruct from' }, { status: 400 });
  }

  const rate = await checkOpsRate({ sql, userId: user.id });
  if (!rate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  try {
    const { result, credits, balanceAfter } = await runBilledOperation(
      { sql, userId: user.id, op: 'reconstruct', boardId: node.board_id, nodeId: node.id },
      async () => {
        const rec = await reconstructPage(node.origin_url);
        if (!rec?.html) {
          const err = new Error('no_output');
          err.code = 'no_output';
          throw err;
        }
        const [snap] = await sql`
          INSERT INTO snapshots (node_id, html, screenshot_url, source, parent_snapshot_id)
          VALUES (${id}, ${rec.html}, ${rec.screenshotDataUrl || null}, 'reconstruct',
                  (SELECT current_snapshot_id FROM nodes WHERE id = ${id}))
          RETURNING id
        `;
        await sql`UPDATE nodes SET current_snapshot_id = ${snap.id}, meta = meta || '{"animatedDetected":false}'::jsonb WHERE id = ${id}`;
        return { ok: true, snapshotId: snap.id, html: rec.html };
      },
    );
    return NextResponse.json({ ...result, node: { id: node.id }, credits, balanceAfter });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits', estimate: e.estimate, balance: e.balance }, { status: 402 });
    }
    if (e?.code === 'no_output') return NextResponse.json({ error: 'no_output' }, { status: 502 });
    console.error('reconstruct error', e);
    return NextResponse.json({ error: 'reconstruct_failed', detail: String(e?.message || e) }, { status: 502 });
  }
}
