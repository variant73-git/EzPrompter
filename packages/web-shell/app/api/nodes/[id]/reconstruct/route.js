import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { InsufficientCreditsError, OperationInProgressError } from '../../../../../lib/billing/context.js';
import { checkOpsRate } from '../../../../../lib/billing/rate-limit.js';
import { reconstructSiteNode } from '../../../../../lib/deferred-reconstruction.js';
import { shouldReconstructForAction } from '../../../../../lib/reconstruction-policy.js';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/nodes/:id/reconstruct
// Deferred, billed upgrade of an animated free capture. The client calls this
// when the user enters edit mode. Workflow execution uses the same service
// server-side when an editable runtime is a strict dependency.
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const { id } = await params;
  const sql = await db();
  // The client (canvas-api.reconstructNode) sends an Idempotency-Key; read it so a
  // retry of a lost-response reconstruction dedups instead of charging twice
  // (Sol audit #2 — this route was silently dropping the ticket).
  const idemKey = request.headers.get('idempotency-key') || null;

  const [node] = await sql`
    SELECT n.id, n.kind, n.meta, n.board_id, n.origin_url,
           n.current_snapshot_id, s.html AS current_html,
           s.source AS current_snapshot_source
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!node.origin_url) {
    return NextResponse.json({ error: 'no_origin_url', detail: 'node has no source URL to reconstruct from' }, { status: 400 });
  }

  if (!shouldReconstructForAction({ node, role: 'edit' })) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      node: { id: node.id },
      snapshotId: node.current_snapshot_id,
      snapshotSource: node.current_snapshot_source,
      html: node.current_html,
      meta: node.meta,
      credits: 0,
    });
  }

  const rate = await checkOpsRate({ sql, userId: user.id });
  if (!rate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  try {
    const result = await reconstructSiteNode({ sql, userId: user.id, node, reason: 'edit', idemKey });
    return NextResponse.json({ ...result, snapshotSource: 'reconstruct', node: { id: node.id } });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits', estimate: e.estimate, balance: e.balance }, { status: 402 });
    }
    if (e instanceof OperationInProgressError) {
      return NextResponse.json({ error: 'in_progress' }, { status: 409 });
    }
    if (e?.code === 'no_output') return NextResponse.json({ error: 'no_output' }, { status: 502 });
    console.error('reconstruct error', e);
    return NextResponse.json({ error: 'reconstruct_failed', detail: String(e?.message || e) }, { status: 502 });
  }
}
