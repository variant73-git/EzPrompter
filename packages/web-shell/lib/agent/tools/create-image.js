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

    // ── Skeleton flow ───────────────────────────────────────────────────
    // The image gen call is the long part (~20s on Imagen, 20-60s on
    // openai images.edit). Inserting the result row + edges BEFORE that
    // call, then emitting `graph_mutated` so the canvas refetches, lets
    // the user watch the workflow assemble in real time instead of
    // staring at "thinking" for the full duration.
    //
    // Display name on the canvas node — short + contextual instead of the
    // full prompt. The full prompt still lives in meta.prompt for traceability.
    const mode = baseImageDataUrl ? 'edit' : 'generate';
    const assetName = mode === 'edit' ? 'Edited image' : 'Generated image';

    // Step 1: INSERT placeholder rows + edges. Wrapped in a single try so
    // any DB failure here returns persist_failed before we even touch the
    // image-gen adapter (cheaper to fail fast on infra problems).
    let asset;
    let nodeId = null;
    let placedX = 0;
    let placedY = 0;
    let sourceNodeIds = [];
    const edgesCreated = [];
    try {
      const placeholderAssetMeta = {
        prompt,
        mode,
        aspectRatio,
        status: 'generating',
        ...(baseImageAssetId ? { baseImageAssetId } : {}),
      };
      const inserted = await sql`
        INSERT INTO assets (user_id, project_id, type, name, meta)
        VALUES (${ctx.userId}, ${ctx.boardId}, 'image', ${assetName}, ${JSON.stringify(placeholderAssetMeta)}::jsonb)
        RETURNING id
      `;
      asset = inserted[0];

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

        const placeholderNodeMeta = {
          source: 'agent-generated',
          assetId: asset.id,
          name: assetName,
          status: 'generating',
        };
        const [node] = await sql`
          INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
          VALUES (
            ${ctx.boardId}, 'asset', ${placedX}, ${placedY}, 512, 512,
            ${JSON.stringify(placeholderNodeMeta)}::jsonb
          )
          RETURNING id
        `;
        nodeId = node.id;

        // Wire source nodes → result placeholder so the skeleton already
        // shows the chain. Duplicate-edge inserts (unique constraint) are
        // silently swallowed.
        for (const fromId of sourceNodeIds) {
          if (fromId === nodeId) continue;
          try {
            const [edge] = await sql`
              INSERT INTO edges (board_id, source_node_id, target_node_id, kind)
              VALUES (${ctx.boardId}, ${fromId}, ${nodeId}, 'generic')
              RETURNING id
            `;
            edgesCreated.push({ id: edge.id, fromNodeId: fromId, toNodeId: nodeId });
          } catch (_) { /* dup edge — ignore */ }
        }
      }
    } catch (e) {
      return { error: 'persist_failed', message: String(e?.message || e) };
    }

    // Step 2: emit graph_mutated so the canvas refetches and renders the
    // skeleton (sources + placeholder result + edges). The CanvasNode
    // renderer shows a spinner + "Generating…" pulse for status:'generating'.
    if (ctx?.emit) {
      try { ctx.emit('graph_mutated', { reason: 'createImage:placeholder' }); } catch (_) {}
    }

    // Step 3: actually generate the image. On failure, mark the placeholder
    // node as errored so the visible card shows "Generation failed" instead
    // of a stuck spinner.
    let result;
    try {
      // Belt-and-suspenders: even if the underlying SDK timeout / driver
      // 3-min cap don't fire (observed in field), this explicit Promise.race
      // guarantees the await resolves within 90s.
      const GEN_TIMEOUT_MS = 90_000;
      const genPromise = effective === 'gemini'
        ? (async () => {
            const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
            if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
            return generateGeminiImage({ prompt, aspectRatio, apiKey });
          })()
        : (async () => {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
            return generateOpenAIImage({ prompt, aspectRatio, apiKey, baseImageDataUrl });
          })();
      result = await Promise.race([
        genPromise,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error(`${effective} gen exceeded ${GEN_TIMEOUT_MS / 1000}s`)),
          GEN_TIMEOUT_MS,
        )),
      ]);
      // Normalize shape so downstream code has result.provider.
      result.provider = effective;
    } catch (e) {
      if (nodeId) {
        try {
          await sql`UPDATE nodes SET meta = meta || '{"status":"error"}'::jsonb WHERE id = ${nodeId}`;
        } catch (_) {}
      }
      try {
        await sql`UPDATE assets SET meta = meta || '{"status":"error"}'::jsonb WHERE id = ${asset.id}`;
      } catch (_) {}
      if (ctx?.emit) {
        try { ctx.emit('graph_mutated', { reason: 'createImage:error' }); } catch (_) {}
      }
      return { error: 'image_gen_failed', message: String(e?.message || e) };
    }

    // Step 4: backfill the asset + node with the real dataUrl. jsonb concat
    // (`||`) merges into the placeholder meta so the prompt/mode/aspectRatio
    // we already stored stick.
    try {
      const finalAssetMeta = {
        dataUrl: result.dataUrl,
        mimeType: result.mimeType,
        provider: result.provider,
        model: result.model,
        mode: result.mode || mode,
        status: 'done',
      };
      await sql`UPDATE assets SET meta = meta || ${JSON.stringify(finalAssetMeta)}::jsonb WHERE id = ${asset.id}`;
      if (nodeId) {
        const finalNodeMeta = {
          dataUrl: result.dataUrl,
          mimeType: result.mimeType,
          status: 'done',
        };
        await sql`UPDATE nodes SET meta = meta || ${JSON.stringify(finalNodeMeta)}::jsonb WHERE id = ${nodeId}`;
      }
    } catch (e) {
      return { error: 'persist_failed', message: String(e?.message || e) };
    }

    // Step 5: emit graph_mutated again so canvas refetches and swaps the
    // skeleton for the real image. The route also emits one at tool 'done',
    // but emitting here means the visible swap happens the moment the UPDATE
    // commits, not after the tool_result block round-trips through the LLM.
    if (ctx?.emit) {
      try { ctx.emit('graph_mutated', { reason: 'createImage:done' }); } catch (_) {}
    }

    return {
      generated: true,
      mode: result.mode || mode,
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
