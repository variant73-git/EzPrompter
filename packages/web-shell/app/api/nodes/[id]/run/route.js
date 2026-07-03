import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { runCompose } from '../../../../../lib/run-flow.js';
import { BLANK_SITE_HTML } from '../../../../../lib/blank-site-html.js';
import { runBilledOperation, InsufficientCreditsError } from '../../../../../lib/billing/context.js';
import { checkOpsRate } from '../../../../../lib/billing/rate-limit.js';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST /api/nodes/:id/run
// Smart-compose all incoming edges of a target node into a new snapshot.
// Replaces the per-edge /apply route for the run-flow trigger (the
// PromptDock arrow button). One LLM call per target, all sources fed in.
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const { id } = await params;
  const sql = await db();
  const body = await request.json().catch(() => ({}));
  const { modelId } = body || {};

  const [target] = await sql`
    SELECT n.id, n.kind, n.meta, n.board_id,
           s.html AS current_html,
           s.design_md AS current_design_md
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Empty site targets (unpopulated .html node from the Connect-to flow)
  // run as blank compositions — same base the "Add blank website" node
  // uses, so the LLM builds the page from the connected sources instead
  // of the route failing on a missing snapshot.
  if (!target.current_html && target.kind === 'site') {
    target.current_html = BLANK_SITE_HTML;
  }

  const sources = await sql`
    SELECT e.id        AS edge_id,
           e.payload   AS edge_payload,
           n.id        AS source_node_id,
           n.kind      AS kind,
           n.meta      AS meta,
           s.html      AS source_html,
           s.design_md AS source_design_md
      FROM edges e
      JOIN nodes n ON n.id = e.source_node_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE e.target_node_id = ${id}
  `;
  if (sources.length === 0) {
    return NextResponse.json(
      { error: 'no_inputs', detail: 'Target has no incoming edges. Connect a source node and try again.' },
      { status: 400 }
    );
  }

  const rate = await checkOpsRate({ sql, userId: user.id });
  if (!rate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  try {
    const { result, credits, balanceAfter } = await runBilledOperation(
      { sql, userId: user.id, op: 'compose', boardId: target.board_id, nodeId: target.id },
      async () => {
        const composed = await runCompose({ target, sources, modelId });
        if (!composed?.html) {
          const err = new Error('no_output');
          err.code = 'no_output';
          throw err;
        }
        const [snap] = await sql`
          INSERT INTO snapshots (node_id, html, source, parent_snapshot_id)
          VALUES (${id}, ${composed.html}, 'run-flow',
                  (SELECT current_snapshot_id FROM nodes WHERE id = ${id}))
          RETURNING id
        `;
        await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${id}`;
        // Mark all incoming edges as applied so the UI can paint them
        // differently after a successful run.
        await sql`
          UPDATE edges
             SET status = 'applied', applied_at = NOW(), last_error = NULL
           WHERE target_node_id = ${id}
        `;
        return { ok: true, snapshotId: snap.id, html: composed.html };
      },
    );
    return NextResponse.json({ ...result, credits, balanceAfter });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits', estimate: e.estimate, balance: e.balance }, { status: 402 });
    }
    if (e?.code === 'no_output') return NextResponse.json({ error: 'no_output' }, { status: 502 });
    const msg = String(e?.message || e);
    console.error('run-flow error', msg);
    await sql`
      UPDATE edges
         SET status = 'failed', last_error = ${msg}
       WHERE target_node_id = ${id}
    `;
    return NextResponse.json({ error: 'run_failed', detail: msg }, { status: 502 });
  }
}
