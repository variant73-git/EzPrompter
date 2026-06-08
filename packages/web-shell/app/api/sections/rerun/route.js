/**
 * Server-side re-run for a workflow / section terminal node.
 *
 * The user clicks Play on a section. The client passes us the terminal
 * node id (the node at the end of the chain — the generated result).
 * We read that asset's stored meta — prompt, mode, aspectRatio,
 * baseImageAssetId, styleReferenceAssetIds, provider — call the same
 * image-gen adapter that originally produced it, and REPLACE the
 * dataUrl in place. No agent involved; the entire decision space is
 * data-driven, so the model can't get confused or ask questions.
 *
 * If the asset's meta is missing required fields (older asset, or one
 * that wasn't produced by createImage), we bail with a clear error so
 * the client can surface a toast.
 */
import { NextResponse } from 'next/server';
import { sql } from '../../../../lib/db.js';
import { requireUser } from '../../../../lib/auth.js';
import { generateGeminiImage } from '../../../../lib/image-gen/gemini-imagen.js';
import { generateOpenAIImage } from '../../../../lib/image-gen/openai-image.js';
import { decodeImageDimsFromDataUrl, pickAspectForDims } from '../../../../lib/image-dims.js';

export const runtime = 'nodejs';

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { terminalNodeId } = body || {};
  if (!terminalNodeId) {
    return NextResponse.json({ error: 'terminalNodeId required' }, { status: 400 });
  }

  // 1. Load the terminal node + its asset row, verify ownership.
  const nodeRows = await sql`
    SELECT n.id, n.board_id, n.meta, b.user_id
    FROM nodes n
    JOIN boards b ON b.id = n.board_id
    WHERE n.id = ${terminalNodeId}
  `;
  if (!nodeRows.length) return NextResponse.json({ error: 'node_not_found' }, { status: 404 });
  const node = nodeRows[0];
  if (node.user_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const assetId = node.meta?.assetId;
  if (!assetId) {
    return NextResponse.json({
      error: 'no_asset',
      message: 'Terminal node has no linked asset to re-run.',
    }, { status: 400 });
  }

  const assetRows = await sql`SELECT id, meta FROM assets WHERE id = ${assetId} AND user_id = ${user.id}`;
  if (!assetRows.length) return NextResponse.json({ error: 'asset_not_found' }, { status: 404 });
  const asset = assetRows[0];
  const meta = asset.meta || {};

  // 2. Pull the re-run config from stored meta. All required for an
  //    edit-mode regeneration; generate-mode (no base) needs prompt only.
  const prompt        = (meta.prompt ?? '').toString();
  const mode          = meta.mode || (meta.baseImageAssetId ? 'edit' : 'generate');
  let   aspectRatio   = meta.aspectRatio || null;
  const baseAssetId   = meta.baseImageAssetId || null;
  const refAssetIds   = Array.isArray(meta.styleReferenceAssetIds) ? meta.styleReferenceAssetIds : [];
  const provider      = meta.provider || (baseAssetId ? 'openai' : 'gemini');

  if (mode === 'edit' && !baseAssetId) {
    return NextResponse.json({
      error: 'incomplete_meta',
      message: 'This asset was edited from a base image but the base reference is missing — cannot re-run.',
    }, { status: 400 });
  }

  // 3. Resolve base + style-ref dataUrls from their assets table rows.
  let baseImageDataUrl = null;
  if (baseAssetId) {
    const r = await sql`SELECT meta FROM assets WHERE id = ${baseAssetId} AND user_id = ${user.id}`;
    if (!r.length) {
      return NextResponse.json({ error: 'incomplete_meta', message: 'Base image asset is gone.' }, { status: 400 });
    }
    baseImageDataUrl = r[0].meta?.dataUrl || null;
    if (!baseImageDataUrl) {
      return NextResponse.json({ error: 'incomplete_meta', message: 'Base image has no data — cannot re-run.' }, { status: 400 });
    }
    // Infer the aspect from the base image's real pixel dims when the
    // stored meta didn't lock one in. Matches the createImage tool's
    // own inference so re-runs and first runs always pick the same size.
    if (!aspectRatio) {
      const dims = decodeImageDimsFromDataUrl(baseImageDataUrl);
      if (dims) {
        const picked = pickAspectForDims(dims);
        if (picked) aspectRatio = picked;
      }
    }
  }
  let styleReferenceDataUrls = null;
  if (refAssetIds.length > 0) {
    const rows = await sql`
      SELECT id, meta FROM assets
      WHERE id = ANY(${refAssetIds}) AND user_id = ${user.id}
    `;
    const urls = [];
    for (const r of rows) {
      const u = r.meta?.dataUrl;
      if (typeof u === 'string' && u) urls.push(u);
    }
    if (urls.length > 0) styleReferenceDataUrls = urls;
  }

  // 4. Flip the asset + node into the generating state so the client
  //    shows a spinner if it refetches while we work. Optimistic UI in
  //    CanvasClient does the same locally; this also covers reload.
  try {
    await sql`UPDATE assets SET meta = meta || '{"status":"generating"}'::jsonb WHERE id = ${asset.id}`;
    await sql`UPDATE nodes  SET meta = meta || '{"status":"generating"}'::jsonb WHERE id = ${node.id}`;
  } catch (_) { /* not fatal; press on */ }

  // 5. Actually generate. Same provider routing + same 90s belt-and-
  //    suspenders timeout used by the createImage tool — keeps a stuck
  //    upstream call from hanging the request indefinitely.
  let result;
  try {
    const GEN_TIMEOUT_MS = 90_000;
    const effective = (baseImageDataUrl ? 'openai' : provider) || 'gemini';
    const genPromise = effective === 'gemini'
      ? (async () => {
          const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
          if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
          return generateGeminiImage({ prompt: prompt || 'A clean, professional image.', aspectRatio: aspectRatio || '1:1', apiKey });
        })()
      : (async () => {
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
          return generateOpenAIImage({
            prompt: prompt || 'Re-render preserving the subject, framing, padding, and overall canvas composition exactly.',
            aspectRatio,
            apiKey,
            baseImageDataUrl,
            styleReferenceDataUrls,
          });
        })();
    result = await Promise.race([
      genPromise,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`${effective} gen exceeded ${GEN_TIMEOUT_MS / 1000}s`)),
        GEN_TIMEOUT_MS,
      )),
    ]);
    result.provider = effective;
  } catch (e) {
    // Mark error state on both rows so the canvas card shows "Generation failed".
    try {
      await sql`UPDATE assets SET meta = meta || '{"status":"error"}'::jsonb WHERE id = ${asset.id}`;
      await sql`UPDATE nodes  SET meta = meta || '{"status":"error"}'::jsonb WHERE id = ${node.id}`;
    } catch (_) {}
    return NextResponse.json({ error: 'gen_failed', message: String(e?.message || e) }, { status: 500 });
  }

  // 6. Patch the result back into the asset + node meta IN PLACE — same
  //    rows, new dataUrl. This is the whole point of re-run: the user's
  //    existing graph (edges, position, name) is preserved; only the
  //    pixels change.
  try {
    const newAssetMeta = {
      dataUrl: result.dataUrl,
      mimeType: result.mimeType,
      provider: result.provider,
      model: result.model,
      mode: result.mode || mode,
      status: 'done',
    };
    const newNodeMeta = {
      dataUrl: result.dataUrl,
      mimeType: result.mimeType,
      status: 'done',
    };
    await sql`UPDATE assets SET meta = meta || ${JSON.stringify(newAssetMeta)}::jsonb WHERE id = ${asset.id}`;
    await sql`UPDATE nodes  SET meta = meta || ${JSON.stringify(newNodeMeta)}::jsonb  WHERE id = ${node.id}`;
  } catch (e) {
    return NextResponse.json({ error: 'persist_failed', message: String(e?.message || e) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    nodeId: node.id,
    assetId: asset.id,
    dataUrl: result.dataUrl,
    mimeType: result.mimeType,
    provider: result.provider,
  });
}
