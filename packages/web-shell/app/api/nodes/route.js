import { NextResponse } from 'next/server';
import { db } from '../../../lib/db.js';
import { requireUser } from '../../../lib/auth.js';

const VALID_KINDS = new Set(['site', 'template', 'designmd', 'chunk', 'prompt', 'skill', 'asset']);

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const { boardId, kind, originUrl, templateSlug, posX = 0, posY = 0, width = 1280, height = 800, isMain = false, meta = {}, html, designMd, snapshotSource } = body || {};
  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 });
  if (!VALID_KINDS.has(kind)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  const initialSnapshotSource = snapshotSource === 'capture' ? 'capture' : 'upload';

  const sql = await db();
  const [board] = await sql`SELECT id FROM boards WHERE id = ${boardId} AND user_id = ${user.id}`;
  if (!board) return NextResponse.json({ error: 'board not found' }, { status: 404 });

  const [node] = await sql`
    INSERT INTO nodes (board_id, kind, origin_url, template_slug, pos_x, pos_y, width, height, is_main, meta)
    VALUES (${boardId}, ${kind}, ${originUrl || null}, ${templateSlug || null},
            ${posX}, ${posY}, ${width}, ${height}, ${isMain}, ${meta}::jsonb)
    RETURNING *
  `;

  // Seed the first snapshot when content arrives with the node. designMd
  // WITHOUT html (a .md upload) seeds a snapshot too — snapshots.html is
  // NOT NULL so md-only rows store html = ''. (Previously md-only content
  // was silently dropped server-side and vanished on reload.)
  if (html || designMd) {
    const [snap] = await sql`
      INSERT INTO snapshots (node_id, html, design_md, source)
      VALUES (${node.id}, ${html || ''}, ${designMd || null}, ${initialSnapshotSource})
      RETURNING id
    `;
    await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;
    node.current_snapshot_id = snap.id;
  }

  return NextResponse.json({ node });
}
