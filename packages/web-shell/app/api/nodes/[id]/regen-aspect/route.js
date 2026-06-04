import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { generateOpenAIImage } from '../../../../../lib/image-gen/openai-image.js';
import { generateGeminiImage } from '../../../../../lib/image-gen/gemini-imagen.js';

// Regenerate an asset node's image at a different aspect ratio. Reuses the
// stored prompt, baseImageAssetId, and styleReferenceAssetIds from the
// asset meta so the user can pivot 1:1 → 16:9 without going through chat.
//
// Semantics: REPLACE in place (same nodeId, same assetId) — user chose
// to swap, not branch. Old dataUrl is overwritten. Node width/height are
// updated to match the new aspect so the image fills the card without
// letterboxing.

const VALID_ASPECT = new Set(['1:1', '16:9', '9:16', '3:4', '4:3']);
const ASPECT_DIMENSIONS = {
  '1:1':  { width: 512, height: 512 },
  '16:9': { width: 512, height: 288 },
  '9:16': { width: 288, height: 512 },
  '3:4':  { width: 384, height: 512 },
  '4:3':  { width: 512, height: 384 },
};

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id: nodeId } = await params;

  let body;
  try { body = await request.json(); } catch (_) { body = {}; }
  const newAspect = body?.aspectRatio;
  if (!newAspect || !VALID_ASPECT.has(newAspect)) {
    return NextResponse.json({ error: 'invalid_args', message: `aspectRatio must be one of ${[...VALID_ASPECT].join(',')}` }, { status: 400 });
  }

  // Ownership + fetch in one go.
  const [node] = await sql`
    SELECT n.id, n.board_id, n.meta, n.pos_x, n.pos_y
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${nodeId} AND b.user_id = ${user.id}
  `;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const assetId = node.meta?.assetId;
  if (!assetId) {
    return NextResponse.json({
      error: 'no_asset',
      message: 'This node is not linked to an asset record. Use Smart Edit first to backfill.',
    }, { status: 400 });
  }

  const [asset] = await sql`
    SELECT id, meta FROM assets WHERE id = ${assetId} AND user_id = ${user.id}
  `;
  if (!asset) return NextResponse.json({ error: 'asset_not_found' }, { status: 404 });

  const m = asset.meta || {};
  const prompt = m.prompt || '';
  const baseImageAssetId = m.baseImageAssetId || null;
  const styleReferenceAssetIds = Array.isArray(m.styleReferenceAssetIds) ? m.styleReferenceAssetIds : null;
  const mode = m.mode || (baseImageAssetId ? 'edit' : 'generate');
  const oldAspect = m.aspectRatio || '1:1';

  if (oldAspect === newAspect) {
    // No-op; nothing to regen. Treat as success.
    return NextResponse.json({ ok: true, unchanged: true });
  }

  // Resolve baseImageDataUrl + style reference dataUrls (only in edit mode).
  let baseImageDataUrl = null;
  let styleReferenceDataUrls = null;
  if (mode === 'edit' && baseImageAssetId) {
    const baseRows = await sql`
      SELECT meta FROM assets WHERE id = ${baseImageAssetId} AND user_id = ${user.id}
    `;
    if (baseRows.length && baseRows[0].meta?.dataUrl) {
      baseImageDataUrl = baseRows[0].meta.dataUrl;
    }
    if (styleReferenceAssetIds && styleReferenceAssetIds.length > 0) {
      const refRows = await sql`
        SELECT meta FROM assets
         WHERE id = ANY(${styleReferenceAssetIds.slice(0, 4)})
           AND user_id = ${user.id}
      `;
      const refs = [];
      for (const r of refRows) {
        const url = r.meta?.dataUrl;
        if (typeof url === 'string' && url) refs.push(url);
      }
      if (refs.length > 0) styleReferenceDataUrls = refs;
    }
  }

  // Build the same structured prompt the create-image tool uses so the model
  // gets the consistent preservation language. In edit mode we ignore the
  // stored `prompt` for the heavy lifting (references are already attached).
  const userIntent = (prompt || '').trim();
  let finalPrompt;
  if (baseImageDataUrl) {
    const hasRefs = Array.isArray(styleReferenceDataUrls) && styleReferenceDataUrls.length > 0;
    finalPrompt = hasRefs
      ? [
          'You are editing the FIRST image.',
          'PRESERVE EXACTLY: the subject, composition, framing, perspective, scale, and content of the first image.',
          'APPLY: the artistic style — palette, lighting, brushwork or texture, line work, level of detail, and overall mood — visible in the additional reference image(s).',
          'DO NOT change the subject, swap it for the reference\'s subject, or invent new elements.',
          'The output should be the same scene as the first image, rendered as if drawn or painted in the style of the references.',
          userIntent ? `Additional intent: ${userIntent}` : '',
        ].filter(Boolean).join(' ')
      : [
          'You are editing the input image.',
          'PRESERVE EXACTLY: the subject, composition, framing, perspective, scale, and content.',
          userIntent ? `APPLY this change: ${userIntent}` : 'APPLY a subtle high-quality refinement that improves clarity and detail without changing anything else.',
          'DO NOT change the subject or invent new elements.',
        ].filter(Boolean).join(' ');
  } else {
    finalPrompt = userIntent || 'A clean, professional image.';
  }

  // Mark node + asset as regenerating so the canvas shows a spinner.
  try {
    await sql`UPDATE nodes SET meta = meta || '{"status":"generating"}'::jsonb WHERE id = ${nodeId}`;
    await sql`UPDATE assets SET meta = meta || '{"status":"generating"}'::jsonb WHERE id = ${assetId}`;
  } catch (_) {}

  // Run the gen. Edit mode forces openai. Text-to-image keeps the asset's
  // original provider when possible.
  let result;
  try {
    if (baseImageDataUrl) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
      result = await generateOpenAIImage({
        prompt: finalPrompt,
        aspectRatio: newAspect,
        apiKey,
        baseImageDataUrl,
        styleReferenceDataUrls,
      });
    } else {
      const provider = m.provider || 'gemini';
      if (provider === 'openai') {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
        result = await generateOpenAIImage({ prompt: finalPrompt, aspectRatio: newAspect, apiKey });
      } else {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
        result = await generateGeminiImage({ prompt: finalPrompt, aspectRatio: newAspect, apiKey });
      }
    }
  } catch (e) {
    try {
      await sql`UPDATE nodes SET meta = meta || '{"status":"error"}'::jsonb WHERE id = ${nodeId}`;
      await sql`UPDATE assets SET meta = meta || '{"status":"error"}'::jsonb WHERE id = ${assetId}`;
    } catch (_) {}
    return NextResponse.json({ error: 'image_gen_failed', message: String(e?.message || e) }, { status: 500 });
  }

  // Persist new dataUrl + bump asset meta. Node gets the new dims so the
  // image fills the card.
  const { width: newW, height: newH } = ASPECT_DIMENSIONS[newAspect];
  try {
    const assetMetaPatch = {
      dataUrl: result.dataUrl,
      mimeType: result.mimeType,
      aspectRatio: newAspect,
      finalPrompt,
      status: 'done',
    };
    await sql`UPDATE assets SET meta = meta || ${JSON.stringify(assetMetaPatch)}::jsonb WHERE id = ${assetId}`;
    const nodeMetaPatch = {
      dataUrl: result.dataUrl,
      mimeType: result.mimeType,
      aspectRatio: newAspect,
      status: 'done',
    };
    await sql`
      UPDATE nodes
         SET meta = meta || ${JSON.stringify(nodeMetaPatch)}::jsonb,
             width = ${newW},
             height = ${newH}
       WHERE id = ${nodeId}
    `;
  } catch (e) {
    return NextResponse.json({ error: 'persist_failed', message: String(e?.message || e) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    nodeId,
    assetId,
    aspectRatio: newAspect,
    width: newW,
    height: newH,
    dataUrl: result.dataUrl,
    mimeType: result.mimeType,
  });
}
