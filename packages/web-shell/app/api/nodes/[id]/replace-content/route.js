import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';

// Replace a node's media content. The new content may be a different KIND
// than the original (image → html, html → md, etc) — the node row is
// retyped accordingly so its border colour, body renderer, and tools all
// shift to match the new media. Snapshots from the previous kind stay in
// DB but become unreferenced (cheap; the storage footprint is small and a
// future "Restore previous content" feature could expose them).

const VALID_KINDS = new Set(['asset', 'site', 'designmd']);

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id: nodeId } = await params;

  let body;
  try { body = await request.json(); } catch (_) { body = {}; }
  const { kind, dataUrl, mimeType, html, designMd, name } = body || {};

  if (!kind || !VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: 'invalid_args', message: `kind must be one of ${[...VALID_KINDS].join(',')}` }, { status: 400 });
  }

  const [node] = await sql`
    SELECT n.id, n.board_id, n.meta
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${nodeId} AND b.user_id = ${user.id}
  `;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (kind === 'asset') {
    if (typeof dataUrl !== 'string' || !/^data:(?:image|video)\//.test(dataUrl)) {
      return NextResponse.json({ error: 'invalid_args', message: 'asset requires a base64 image or video data URL in dataUrl' }, { status: 400 });
    }
    const newMeta = {
      // Keep the original assetId/baseImageAssetId IF they came from agent
      // generation — but for user-uploaded replacements, strip them so the
      // node is a fresh upload (no stale lineage in Smart Edit reuse).
      ...(node.meta || {}),
      source: 'replace-upload',
      name: name || node.meta?.name || 'uncraft-media',
      dataUrl,
      mimeType: mimeType || 'image/png',
      status: 'done',
    };
    // Strip lineage fields so the new image doesn't reuse old prompts.
    delete newMeta.prompt;
    delete newMeta.finalPrompt;
    delete newMeta.assetId;
    delete newMeta.baseImageAssetId;
    delete newMeta.styleReferenceAssetIds;
    delete newMeta.styleReferenceCount;
    delete newMeta.aspectRatio;
    await sql`
      UPDATE nodes
         SET kind = 'asset',
             meta = ${JSON.stringify(newMeta)}::jsonb,
             current_snapshot_id = NULL
       WHERE id = ${nodeId}
    `;
    return NextResponse.json({ ok: true, kind: 'asset', meta: newMeta });
  }

  if (kind === 'site') {
    if (typeof html !== 'string' || html.length === 0) {
      return NextResponse.json({ error: 'invalid_args', message: 'site requires html' }, { status: 400 });
    }
    // Create a fresh snapshot row so the node has something to render as
    // current_snapshot_id.
    const [snap] = await sql`
      INSERT INTO snapshots (node_id, html, source)
      VALUES (${nodeId}, ${html}, 'replace-upload')
      RETURNING id
    `;
    const newMeta = {
      ...(node.meta || {}),
      source: 'replace-upload',
      name: name || node.meta?.name || 'uncraft-site',
    };
    // Strip image lineage.
    delete newMeta.dataUrl;
    delete newMeta.mimeType;
    delete newMeta.prompt;
    delete newMeta.assetId;
    delete newMeta.aspectRatio;
    delete newMeta.styleReferenceAssetIds;
    await sql`
      UPDATE nodes
         SET kind = 'site',
             meta = ${JSON.stringify(newMeta)}::jsonb,
             current_snapshot_id = ${snap.id}
       WHERE id = ${nodeId}
    `;
    return NextResponse.json({ ok: true, kind: 'site', meta: newMeta, snapshotId: snap.id });
  }

  if (kind === 'designmd') {
    if (typeof designMd !== 'string' || designMd.length === 0) {
      return NextResponse.json({ error: 'invalid_args', message: 'designmd requires designMd' }, { status: 400 });
    }
    const [snap] = await sql`
      INSERT INTO snapshots (node_id, design_md, source)
      VALUES (${nodeId}, ${designMd}, 'replace-upload')
      RETURNING id
    `;
    const newMeta = {
      ...(node.meta || {}),
      source: 'replace-upload',
      name: name || node.meta?.name || 'uncraft.md',
    };
    delete newMeta.dataUrl;
    delete newMeta.mimeType;
    delete newMeta.prompt;
    delete newMeta.assetId;
    delete newMeta.aspectRatio;
    delete newMeta.styleReferenceAssetIds;
    await sql`
      UPDATE nodes
         SET kind = 'designmd',
             meta = ${JSON.stringify(newMeta)}::jsonb,
             current_snapshot_id = ${snap.id}
       WHERE id = ${nodeId}
    `;
    return NextResponse.json({ ok: true, kind: 'designmd', meta: newMeta, snapshotId: snap.id });
  }
}
