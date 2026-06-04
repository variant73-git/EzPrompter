import { sql } from '../../db.js';
import { generateGeminiImage } from '../../image-gen/gemini-imagen.js';
import { generateOpenAIImage } from '../../image-gen/openai-image.js';
import { placeRightOfSources, placeStackDown } from '../../canvas-layout.js';

const VALID_ASPECT = new Set(['1:1', '16:9', '9:16', '3:4', '4:3']);
const VALID_PROVIDER = new Set(['auto', 'gemini', 'openai']);

const AUTO_CHOICES_CLAUDE = [
  { id: 'gemini', label: 'Gemini (auto)', hint: 'Fast, cheaper' },
  { id: 'openai', label: 'GPT-5.5',       hint: 'Higher detail, more expensive' },
];
const AUTO_SINGLE = [{ id: 'auto', label: 'Generate' }];

export const createImageTool = {
  name: 'createImage',
  description: `Generate a new image and optionally drop it onto the user's canvas as an asset node.

Modes:
  - text-to-image (default) — just pass prompt
  - image-to-image / edit    — pass baseImageAssetId of an existing asset; the model edits that image guided by prompt (style transfer, inpainting, variation). Auto-routes to OpenAI.

When the user asks "apply the style of X to Y", "make Y look like X", or "transfer style", DO THIS:
  1. Ingest each external reference URL with addAssetFromUrl first (so you have asset IDs to work with).
  2. Describe the reference image style YOURSELF in the prompt (you can see the image — you don't need a separate tool). Be specific about palette, lighting, brushwork, composition.
  3. Call createImage with baseImageAssetId = target asset, and a prompt that says "Apply this style: <your description>. Preserve composition/subject."

DESTRUCTIVE: costs money, pauses for user confirmation (or choice when the conversation model is Claude and provider is 'auto').`,
  classification: 'needs_choice',
  inputSchema: {
    type: 'object',
    properties: {
      prompt:             { type: 'string', description: 'Text prompt. In edit mode, describe the desired change AND the reference style verbatim — the model only sees the prompt + base image, not external references.' },
      aspectRatio:        { type: 'string', enum: ['1:1', '16:9', '9:16', '3:4', '4:3'], description: 'Aspect ratio (default 1:1, ignored in edit mode — output matches the base image size)' },
      provider:           { type: 'string', enum: ['auto', 'gemini', 'openai'], description: 'auto picks Gemini for text-to-image; edit mode (baseImageAssetId set) forces openai' },
      attachToBoard:      { type: 'boolean', description: 'When true, also create an asset node on the canvas' },
      baseImageAssetId:   { type: 'string', description: 'Optional. UUID of an existing asset to EDIT (image-to-image). Forces openai provider.' },
      inputAssetIds:      {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of source asset UUIDs (e.g. style references you ingested + the base image). When provided AND attachToBoard:true, the tool will draw an edge from each source asset\'s canvas node to the new result node, so the workflow is visible on the canvas instead of being implicit. Always set this when doing image-to-image so the user sees the chain. Typically: [referenceAssetId, baseImageAssetId].',
      },
    },
    required: ['prompt'],
  },

  choices(args, ctx) {
    const provider = args?.provider || 'auto';
    const model = ctx?.conversationModel || '';
    if (provider !== 'auto') return AUTO_SINGLE;
    if (/^(claude|opus|sonnet|haiku)/i.test(model)) return AUTO_CHOICES_CLAUDE;
    return AUTO_SINGLE;
  },

  async execute(args, ctx) {
    const { prompt, aspectRatio = '1:1', provider = 'auto', attachToBoard = false, baseImageAssetId = null, inputAssetIds = null } = args || {};
    if (!prompt) return { error: 'invalid_args', message: 'prompt required' };
    if (!VALID_ASPECT.has(aspectRatio)) return { error: 'invalid_args', message: `aspectRatio must be one of ${[...VALID_ASPECT].join(',')}` };
    if (!VALID_PROVIDER.has(provider)) return { error: 'invalid_args', message: `provider must be one of ${[...VALID_PROVIDER].join(',')}` };

    // Edit mode requires OpenAI (Gemini Imagen has no equivalent images.edit).
    let baseImageDataUrl = null;
    if (baseImageAssetId) {
      const rows = await sql`
        SELECT meta FROM assets
        WHERE id = ${baseImageAssetId} AND user_id = ${ctx.userId}
      `;
      if (!rows.length) return { error: 'invalid_args', message: 'baseImageAssetId not found or not owned' };
      const m = rows[0].meta || {};
      baseImageDataUrl = m.dataUrl || null;
      if (!baseImageDataUrl) return { error: 'invalid_args', message: 'base asset has no dataUrl (only generated/ingested images can be edited)' };
    }

    // Resolve effective provider:
    //   0. baseImageAssetId present → forces openai (only adapter with images.edit)
    //   1. ctx.choice (user picked in needs_choice flow) wins next
    //   2. provider !== 'auto' wins next
    //   3. conversation model dictates family (gpt → openai; gemini → gemini; default gemini)
    let effective;
    if (baseImageDataUrl) effective = 'openai';
    else if (ctx?.choice && ctx.choice !== 'auto') effective = ctx.choice;
    else if (provider !== 'auto') effective = provider;
    else {
      const m = ctx?.conversationModel || '';
      if (/^(gpt|openai|o[1-9])/i.test(m)) effective = 'openai';
      else if (/^gemini/i.test(m))           effective = 'gemini';
      else                                    effective = 'gemini';
    }

    // Call adapters directly — server-to-server fetch would hit requireUser
    // without auth cookies and return 401.
    let result;
    try {
      if (effective === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) return { error: 'image_gen_failed', message: 'GEMINI_API_KEY not configured' };
        result = await generateGeminiImage({ prompt, aspectRatio, apiKey });
      } else {
        // openai — text-to-image or edit (when baseImageDataUrl is set)
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return { error: 'image_gen_failed', message: 'OPENAI_API_KEY not configured' };
        result = await generateOpenAIImage({ prompt, aspectRatio, apiKey, baseImageDataUrl });
      }
      // Normalize shape so downstream code has result.provider.
      result.provider = effective;
    } catch (e) {
      return { error: 'image_gen_failed', message: String(e?.message || e) };
    }

    const mode = result.mode || 'generate';
    const assetName = `${mode === 'edit' ? 'edited' : 'generated'}:${prompt.slice(0, 50)}`;
    const meta = {
      dataUrl: result.dataUrl,
      mimeType: result.mimeType,
      prompt,
      provider: result.provider,
      model: result.model,
      aspectRatio,
      mode,
      ...(baseImageAssetId ? { baseImageAssetId } : {}),
    };
    const [asset] = await sql`
      INSERT INTO assets (user_id, project_id, type, name, meta)
      VALUES (${ctx.userId}, ${ctx.boardId}, 'image', ${assetName}, ${JSON.stringify(meta)}::jsonb)
      RETURNING id
    `;

    let nodeId = null;
    let placedX = 0;
    let placedY = 0;
    if (attachToBoard) {
      // Resolve placement: when the agent passed source assets (image-to-
      // image / style transfer), drop the result to the RIGHT of every
      // source, vertically centered between them so the input edges don't
      // cross. Otherwise fall back to the rightmost-column stack-down used
      // by other auto-creates.
      const allSourceAssetIds = Array.from(new Set([
        ...(baseImageAssetId ? [baseImageAssetId] : []),
        ...(Array.isArray(inputAssetIds) ? inputAssetIds.filter((x) => typeof x === 'string' && x) : []),
      ]));
      let sourceNodeIds = [];
      if (allSourceAssetIds.length > 0) {
        const srcRows = await sql`
          SELECT id FROM nodes
          WHERE board_id = ${ctx.boardId}
            AND meta->>'assetId' = ANY(${allSourceAssetIds})
        `;
        sourceNodeIds = srcRows.map((r) => r.id);
      }
      const pos = sourceNodeIds.length > 0
        ? await placeRightOfSources(ctx.boardId, sourceNodeIds, 512, 512, sql)
        : await placeStackDown(ctx.boardId, 512, 512, sql);
      placedX = pos.x;
      placedY = pos.y;

      const [node] = await sql`
        INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
        VALUES (
          ${ctx.boardId}, 'asset', ${placedX}, ${placedY}, 512, 512,
          ${JSON.stringify({ source: 'agent-generated', assetId: asset.id, name: assetName, dataUrl: result.dataUrl, mimeType: result.mimeType })}::jsonb
        )
        RETURNING id
      `;
      nodeId = node.id;
    }

    // Wire source assets → result node so the canvas shows the workflow
    // as a visible chain (Flora / Comfy-style), not as a pile of disconnected
    // nodes. Map each input assetId to its canvas node via assets.id →
    // nodes.meta.assetId, then INSERT an edge per match. Silently skip
    // sources that don't have a node on the board (some assets are storage-
    // only — chat attachments + addAssetFromUrl + this tool's own output
    // always create nodes, so the typical style-transfer path lights up).
    const edgesCreated = [];
    if (nodeId && Array.isArray(inputAssetIds) && inputAssetIds.length > 0) {
      // Always include baseImageAssetId implicitly so the agent doesn't have
      // to duplicate it.
      const all = Array.from(new Set([
        ...(baseImageAssetId ? [baseImageAssetId] : []),
        ...inputAssetIds.filter((x) => typeof x === 'string' && x),
      ]));
      if (all.length > 0) {
        // For each source assetId, look up the matching node on this board.
        // Use a JSONB match against nodes.meta->>'assetId'.
        const rows = await sql`
          SELECT id, meta->>'assetId' AS asset_id
          FROM nodes
          WHERE board_id = ${ctx.boardId}
            AND meta->>'assetId' = ANY(${all})
        `;
        for (const row of rows) {
          if (!row?.id || row.id === nodeId) continue;
          try {
            const [edge] = await sql`
              INSERT INTO edges (board_id, source_node_id, target_node_id, kind)
              VALUES (${ctx.boardId}, ${row.id}, ${nodeId}, 'generic')
              RETURNING id
            `;
            edgesCreated.push({ id: edge.id, fromAssetId: row.asset_id, fromNodeId: row.id, toNodeId: nodeId });
          } catch (e) {
            // Edge insert can fail on duplicates (unique constraint) — ignore.
          }
        }
      }
    }

    return {
      generated: true,
      mode,
      assetId: asset.id,
      nodeId,
      provider: result.provider,
      dataUrl: result.dataUrl,
      bytes: Math.floor((result.base64 || '').length * 0.75),
      posX: placedX,
      posY: placedY,
      edges: edgesCreated,
    };
  },
};
