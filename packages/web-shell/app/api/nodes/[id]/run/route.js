import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { runCompose } from '../../../../../lib/run-flow.js';

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

  try {
    const result = await runCompose({ target, sources });
    if (!result?.html) return NextResponse.json({ error: 'no_output' }, { status: 502 });

    const [snap] = await sql`
      INSERT INTO snapshots (node_id, html, source, parent_snapshot_id)
      VALUES (${id}, ${result.html}, 'run-flow',
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
    return NextResponse.json({ ok: true, snapshotId: snap.id, html: result.html });
  } catch (e) {
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
