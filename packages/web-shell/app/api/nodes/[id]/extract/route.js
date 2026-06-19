import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { runExtract } from '../../../../../lib/extract.js';
import { placeStackDown } from '../../../../../lib/canvas-layout.js';

export const runtime = 'nodejs';

// POST /api/nodes/[id]/extract { to }
// Creates a NEW node derived from node [id]. Mirrors extractDesign's persist
// shape: insert node + snapshot + a 'generic' edge from source → new node.
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const { id } = await params;
  const sql = await db();
  const body = await request.json().catch(() => ({}));
  const to = body?.to;
  if (!to) return NextResponse.json({ error: 'to required' }, { status: 400 });

  const rows = await sql`
    SELECT n.id, n.board_id, n.kind, n.meta, s.html, s.design_md
      FROM nodes n
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!rows.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const src = rows[0];

  let out;
  try {
    out = await runExtract({ to, node: { id: src.id, kind: src.kind, html: src.html, meta: src.meta } });
  } catch (e) {
    return NextResponse.json({ error: 'extract_failed', message: String(e?.message || e) }, { status: 502 });
  }
  if (out.error) {
    const status = out.error === 'unsupported_combo' || out.error === 'invalid_to' ? 400 : 409;
    return NextResponse.json(out, { status });
  }

  const DIMS = { designmd: { width: 600, height: 600 }, asset: { width: 600, height: 600 }, prompt: { width: 600, height: 200 } };
  const { width, height } = DIMS[out.kind] || DIMS.designmd;

  const { x: posX, y: posY } = await placeStackDown(src.board_id, width, height, sql);

  const meta = { ...out.meta };
  const [node] = await sql`
    INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
    VALUES (${src.board_id}, ${out.kind}, ${posX}, ${posY}, ${width}, ${height}, ${JSON.stringify(meta)}::jsonb)
    RETURNING id, board_id, kind, pos_x, pos_y, width, height, meta, created_at
  `;
  const [snap] = await sql`
    INSERT INTO snapshots (node_id, html, design_md, source)
    VALUES (${node.id}, ${out.html}, ${out.designMd}, 'extract')
    RETURNING id
  `;
  await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;
  if (out.dataUrl) {
    await sql`UPDATE nodes SET meta = meta || ${JSON.stringify({ dataUrl: out.dataUrl })}::jsonb WHERE id = ${node.id}`;
    node.meta = { ...node.meta, dataUrl: out.dataUrl };
  }
  try {
    await sql`INSERT INTO edges (board_id, source_node_id, target_node_id, kind)
              VALUES (${src.board_id}, ${src.id}, ${node.id}, 'generic')`;
  } catch (_) { /* dup edge — ignore */ }

  return NextResponse.json({ node, truncated: out.truncated });
}
