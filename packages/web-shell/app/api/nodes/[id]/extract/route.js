import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { runExtract } from '../../../../../lib/extract.js';
import { placeStackDown, resolvePlacement } from '../../../../../lib/canvas-layout.js';
import { runBilledOperation, InsufficientCreditsError } from '../../../../../lib/billing/context.js';
import { checkOpsRate } from '../../../../../lib/billing/rate-limit.js';

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
  // Requested drop position (world coords from where the user released the
  // cord). When present, the derived node lands THERE (collision-avoided)
  // instead of being stacked at the bottom of the board — so it stays put
  // where the user asked, matching its loading placeholder.
  const reqX = Number.isFinite(body?.posX) ? Math.round(body.posX) : null;
  const reqY = Number.isFinite(body?.posY) ? Math.round(body.posY) : null;

  const rows = await sql`
    SELECT n.id, n.board_id, n.kind, n.meta, s.html, s.design_md
      FROM nodes n
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!rows.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const src = rows[0];

  const rate = await checkOpsRate({ sql, userId: user.id });
  if (!rate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  let out, credits = 0, balanceAfter = null;
  try {
    const billed = await runBilledOperation(
      { sql, userId: user.id, op: `extract.${to}`, boardId: src.board_id, nodeId: src.id },
      async () => {
        const result = await runExtract({ to, node: { id: src.id, kind: src.kind, html: src.html, meta: src.meta } });
        if (result?.error) {
          // Structured extract errors must not charge — throw so the hold
          // refunds, then map the payload back to its response below.
          const err = new Error(result.error);
          err.extractError = result;
          throw err;
        }
        return result;
      },
    );
    out = billed.result;
    credits = billed.credits;
    balanceAfter = billed.balanceAfter;
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits', estimate: e.estimate, balance: e.balance }, { status: 402 });
    }
    if (e?.extractError) {
      const payload = e.extractError;
      const status = payload.error === 'unsupported_combo' || payload.error === 'invalid_to' ? 400 : 409;
      return NextResponse.json(payload, { status });
    }
    return NextResponse.json({ error: 'extract_failed', message: String(e?.message || e) }, { status: 502 });
  }

  const DIMS = { designmd: { width: 600, height: 600 }, asset: { width: 600, height: 600 }, prompt: { width: 600, height: 200 }, site: { width: 1280, height: 720 } };
  const { width, height } = DIMS[out.kind] || DIMS.designmd;

  const { x: posX, y: posY } =
    reqX != null && reqY != null
      // Exclude the SOURCE's own section: the derived node belongs to it, so
      // its frame must not push the node out (was landing far below). It still
      // avoids overlapping individual nodes + other sections.
      ? await resolvePlacement(src.board_id, reqX, reqY, width, height, sql, src.id)
      : await placeStackDown(src.board_id, width, height, sql);

  const meta = { ...out.meta };
  const [node] = await sql`
    INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
    VALUES (${src.board_id}, ${out.kind}, ${posX}, ${posY}, ${width}, ${height}, ${JSON.stringify(meta)}::jsonb)
    RETURNING id, board_id, kind, pos_x, pos_y, width, height, meta, created_at
  `;
  // Only create a snapshot when there's snapshot-worthy content. prompt nodes
  // carry their text in meta.prompt and asset (screenshot) nodes carry the
  // image in meta.dataUrl — neither needs a snapshot row (mirrors createNode /
  // createImage). Inserting one with html+design_md both null is useless and
  // would dangle current_snapshot_id at an empty row.
  if (out.html != null || out.designMd != null) {
    const [snap] = await sql`
      INSERT INTO snapshots (node_id, html, design_md, source)
      VALUES (${node.id}, ${out.html}, ${out.designMd}, 'extract')
      RETURNING id
    `;
    await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;
  }
  if (out.dataUrl) {
    await sql`UPDATE nodes SET meta = meta || ${JSON.stringify({ dataUrl: out.dataUrl })}::jsonb WHERE id = ${node.id}`;
    node.meta = { ...node.meta, dataUrl: out.dataUrl };
  }
  try {
    await sql`INSERT INTO edges (board_id, source_node_id, target_node_id, kind)
              VALUES (${src.board_id}, ${src.id}, ${node.id}, 'generic')`;
  } catch (_) { /* dup edge — ignore */ }

  return NextResponse.json({ node, truncated: out.truncated, credits, balanceAfter });
}
