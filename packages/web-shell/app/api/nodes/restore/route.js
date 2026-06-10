import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { requireUser } from '../../../../lib/auth.js';

/**
 * POST /api/nodes/restore
 *
 * Reinsert nodes + edges that were just deleted. Keeps the ORIGINAL ids so
 * any in-flight references (other edges, chat history, undo stacks) keep
 * working. Used by the canvas Cmd+Z undo path after a multi-delete.
 *
 * Body shape:
 *   {
 *     boardId,
 *     nodes:  [{ id, kind, pos_x, pos_y, width, height, meta, ... }],
 *     edges:  [{ id, source_node_id, target_node_id, kind }],
 *   }
 *
 * If a node id already exists on the board, it is skipped (idempotent).
 * Edge inserts are best-effort — duplicates are swallowed silently so a
 * repeated undo doesn't error.
 */
export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { boardId, nodes = [], edges = [] } = body || {};
  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 });
  if (!Array.isArray(nodes) && !Array.isArray(edges)) {
    return NextResponse.json({ error: 'nodes or edges array required' }, { status: 400 });
  }

  const sql = await db();
  const [board] = await sql`SELECT id FROM boards WHERE id = ${boardId} AND user_id = ${user.id}`;
  if (!board) return NextResponse.json({ error: 'board not found' }, { status: 404 });

  const restoredNodes = [];
  for (const n of nodes) {
    if (!n?.id || !n?.kind) continue;
    try {
      const [row] = await sql`
        INSERT INTO nodes (id, board_id, kind, origin_url, template_slug, pos_x, pos_y, width, height, is_main, meta, current_snapshot_id)
        VALUES (
          ${n.id}, ${boardId}, ${n.kind},
          ${n.origin_url || null}, ${n.template_slug || null},
          ${n.pos_x ?? 0}, ${n.pos_y ?? 0}, ${n.width ?? 1280}, ${n.height ?? 800},
          ${n.is_main ?? false}, ${n.meta || {}}::jsonb, ${n.current_snapshot_id || null}
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `;
      if (row) {
        // Deleting a node CASCADE-dropped its snapshots, so the restored
        // row's current_snapshot_id points at nothing. When the client
        // shipped the content along (html / design_md captured in the undo
        // entry), recreate a snapshot so the node survives a reload with
        // its content intact; otherwise null the stale pointer.
        const html = typeof n.html === 'string' && n.html.length ? n.html : null;
        const designMd = typeof n.design_md === 'string' && n.design_md.length ? n.design_md : null;
        if (html || designMd) {
          const [snap] = await sql`
            INSERT INTO snapshots (node_id, html, design_md, source)
            VALUES (${row.id}, ${html || ''}, ${designMd}, 'restore')
            RETURNING id
          `;
          await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${row.id}`;
          row.current_snapshot_id = snap.id;
        } else if (row.current_snapshot_id) {
          const [live] = await sql`SELECT id FROM snapshots WHERE id = ${row.current_snapshot_id}`;
          if (!live) {
            await sql`UPDATE nodes SET current_snapshot_id = NULL WHERE id = ${row.id}`;
            row.current_snapshot_id = null;
          }
        }
        restoredNodes.push(row);
      }
    } catch (e) {
      // Skip nodes that can't be reinserted (e.g. referenced snapshot is
      // gone). The remaining ones still come back so the undo is useful.
      console.warn('[restore] node insert failed', n.id, e?.message || e);
    }
  }

  const restoredEdges = [];
  for (const e of edges) {
    if (!e?.source_node_id || !e?.target_node_id) continue;
    try {
      const [row] = await sql`
        INSERT INTO edges (id, board_id, source_node_id, target_node_id, kind)
        VALUES (
          ${e.id || sql`gen_random_uuid()`},
          ${boardId},
          ${e.source_node_id}, ${e.target_node_id},
          ${e.kind || 'generic'}
        )
        ON CONFLICT DO NOTHING
        RETURNING *
      `;
      if (row) restoredEdges.push(row);
    } catch (err) {
      console.warn('[restore] edge insert failed', e?.id, err?.message || err);
    }
  }

  return NextResponse.json({ nodes: restoredNodes, edges: restoredEdges });
}
