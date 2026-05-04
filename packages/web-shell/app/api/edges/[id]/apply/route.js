import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { applyTransplant, applyTokenSwap, applyReskin } from '../../../../../lib/edge-executors.js';

export const runtime = 'nodejs';
export const maxDuration = 120;

async function loadCurrentHtml(sql, nodeId) {
  const [row] = await sql`
    SELECT s.html FROM nodes n
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE n.id = ${nodeId}
  `;
  return row?.html || null;
}

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const { id } = await params;
  const sql = await db();

  // Confirm ownership through board.
  const [edge] = await sql`
    SELECT e.* FROM edges e
      JOIN boards b ON b.id = e.board_id
     WHERE e.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!edge) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sourceHtml = await loadCurrentHtml(sql, edge.source_node_id);
  const targetHtml = await loadCurrentHtml(sql, edge.target_node_id);
  if (!sourceHtml || !targetHtml) {
    return NextResponse.json({ error: 'both nodes need a current snapshot before applying' }, { status: 409 });
  }

  let outHtml;
  try {
    if (edge.kind === 'transplant') {
      outHtml = applyTransplant({ sourceHtml, targetHtml, payload: edge.payload });
    } else if (edge.kind === 'token-swap') {
      outHtml = applyTokenSwap({ sourceHtml, targetHtml });
    } else if (edge.kind === 'reskin') {
      outHtml = await applyReskin({ sourceHtml, targetHtml });
    } else {
      return NextResponse.json({ error: `unknown edge kind: ${edge.kind}` }, { status: 400 });
    }
  } catch (e) {
    console.error('edge apply error', e);
    await sql`UPDATE edges SET status = 'failed', last_error = ${String(e?.message || e)} WHERE id = ${id}`;
    return NextResponse.json({ error: 'apply_failed', detail: String(e?.message || e) }, { status: 502 });
  }

  // Persist as a new snapshot on the target node.
  const [snap] = await sql`
    INSERT INTO snapshots (node_id, html, source, parent_snapshot_id)
    VALUES (${edge.target_node_id}, ${outHtml}, ${edge.kind},
            (SELECT current_snapshot_id FROM nodes WHERE id = ${edge.target_node_id}))
    RETURNING id, created_at
  `;
  await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${edge.target_node_id}`;
  await sql`UPDATE edges SET status = 'applied', applied_at = NOW(), last_error = NULL WHERE id = ${id}`;

  return NextResponse.json({ ok: true, snapshotId: snap.id, targetNodeId: edge.target_node_id });
}
