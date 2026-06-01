import { sql } from '../../db.js';
import { generateGeminiImage } from '../../image-gen/gemini-imagen.js';
import { generateOpenAIImage } from '../../image-gen/openai-image.js';

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
    const { prompt, aspectRatio = '1:1', provider = 'auto', attachToBoard = false, baseImageAssetId = null } = args || {};
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
      // Place to the right of existing nodes (mirrors createNode auto-stagger).
      const [row] = await sql`
        SELECT COALESCE(MAX(pos_x + width), -240) AS right_edge,
               COALESCE(MIN(pos_y), 0) AS top_edge
        FROM nodes
        WHERE board_id = ${ctx.boardId}
      `;
      const GAP = 240;
      placedX = Number(row?.right_edge ?? 0) + GAP;
      placedY = Number(row?.top_edge ?? 0);

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
    };
  },
};
