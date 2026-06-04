import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';

export const runtime = 'nodejs';

/**
 * POST /api/nodes/[id]/asset-backfill
 *
 * Idempotent: if node.meta.assetId already exists, returns it without touching DB.
 * Otherwise creates an `assets` row from the node's existing meta (dataUrl,
 * source_url, name) and updates node.meta.assetId.
 *
 * Returns { assetId, created: boolean }.
 */
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const sql = await db();
  const { id } = await params;

  const [node] = await sql`
    SELECT n.* FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const existingAssetId = node.meta?.assetId;
  if (existingAssetId) {
    return NextResponse.json({ assetId: existingAssetId, created: false });
  }

  const dataUrl = node.meta?.dataUrl || null;
  const sourceUrl = node.meta?.source_url || node.meta?.sourceUrl || null;
  if (!dataUrl && !sourceUrl) {
    return NextResponse.json(
      { error: 'no_image_data', message: 'node has neither meta.dataUrl nor meta.source_url' },
      { status: 400 },
    );
  }

  const name = node.meta?.name || 'untitled asset';
  const assetMeta = {
    source: 'backfill-from-node',
    nodeId: node.id,
    ...(dataUrl ? { dataUrl } : {}),
  };

  const [asset] = await sql`
    INSERT INTO assets (user_id, project_id, type, name, source_url, meta)
    VALUES (${user.id}, ${node.board_id}, 'image', ${name}, ${sourceUrl}, ${JSON.stringify(assetMeta)}::jsonb)
    RETURNING id
  `;

  const newMeta = { ...(node.meta || {}), assetId: asset.id };
  await sql`UPDATE nodes SET meta = ${JSON.stringify(newMeta)}::jsonb WHERE id = ${id}`;

  return NextResponse.json({ assetId: asset.id, created: true });
}
