import { sql } from '../../db.js';
import { generateGeminiImage } from '../../image-gen/gemini-imagen.js';
import { generateOpenAIImage } from '../../image-gen/openai-image.js';
import { placeRightOfSources, placeStackDown } from '../../canvas-layout.js';

const VALID_ASPECT = new Set(['1:1', '16:9', '9:16', '3:4', '4:3']);
const VALID_PROVIDER = new Set(['auto', 'gemini', 'openai']);

// Canvas node display dimensions per aspect ratio. Long side capped at 512px
// so the node fits comfortably on the board; the short side is proportional
// so the image inside doesn't letterbox. Without this, every node was 512×512
// and a 16:9 generation looked like a square with black bars top + bottom.
const ASPECT_DIMENSIONS = {
  '1:1':  { width: 512, height: 512 },
  '16:9': { width: 512, height: 288 },
  '9:16': { width: 288, height: 512 },
  '3:4':  { width: 384, height: 512 },
  '4:3':  { width: 512, height: 384 },
};
function dimsForAspect(aspectRatio) {
  return ASPECT_DIMENSIONS[aspectRatio] || ASPECT_DIMENSIONS['1:1'];
}

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
  - image-to-image / edit    — pass baseImageAssetId of the user's target image. The model preserves THAT image's composition and applies changes guided by prompt and any styleReferenceAssetIds.

STYLE-TRANSFER / REMIX — the canonical flow:
  When the user wants to "apply the style of X to Y" or "make Y look like X":
  1. baseImageAssetId = the IMAGE WHOSE COMPOSITION YOU MUST PRESERVE — usually the user's attached image.
  2. styleReferenceAssetIds = the IMAGES WHOSE STYLE YOU WANT TO COPY — usually external references the user pointed to. The tool feeds these DIRECTLY to the image model so you do NOT have to describe them in text. The model sees them.
  3. prompt = a SHORT additional intent (e.g. "warmer palette", "more dramatic lighting"). NEVER paste long style descriptions here — the references are already attached. Keep it under 15 words. Leave blank ("") if no extra direction is needed.
  4. inputAssetIds = [baseImageAssetId, ...styleReferenceAssetIds] so the canvas draws edges from every source node to the result.

The tool internally builds the model prompt with strict preservation language — you do NOT need to write "preserve composition" / "do not change subject" etc. That is already enforced.

DESTRUCTIVE: costs money, pauses for user confirmation (or choice when the conversation model is Claude and provider is 'auto').`,
  classification: 'needs_choice',
  inputSchema: {
    type: 'object',
    properties: {
      prompt:                  { type: 'string', description: 'Short additional intent (≤15 words). In edit mode, leave blank or describe ONLY the change beyond what the references already convey. Long style descriptions belong in styleReferenceAssetIds (the model sees those images directly).' },
      aspectRatio:             { type: 'string', enum: ['1:1', '16:9', '9:16', '3:4', '4:3'], description: 'Aspect ratio of the OUTPUT. Default 1:1. IN EDIT MODE you MUST pass the aspect ratio that matches the base image (a 16:9 base with no aspectRatio arg comes back squared off). The image model does NOT auto-detect from the base.' },
      provider:                { type: 'string', enum: ['auto', 'gemini', 'openai'], description: 'auto picks Gemini for text-to-image; edit mode (baseImageAssetId set) forces openai' },
      attachToBoard:           { type: 'boolean', description: 'When true, also create an asset node on the canvas' },
      baseImageAssetId:        { type: 'string', description: 'UUID of the asset to EDIT — the image whose COMPOSITION + SUBJECT must be preserved. Usually the user-attached image. Setting this forces openai provider.' },
      styleReferenceAssetIds:  {
        type: 'array',
        items: { type: 'string' },
        description: 'UUIDs of style-source assets. Fed DIRECTLY to the image model alongside the base. Use for style-transfer flows: the model attends to these as visual style references without needing a text description. Up to 4 references practical.',
      },
      inputAssetIds:           {
        type: 'array',
        items: { type: 'string' },
        description: 'Canvas wiring only — list of source asset UUIDs that should draw incoming edges to the result node. When attachToBoard:true, an edge is drawn from each source\'s canvas node to the result. Independent of styleReferenceAssetIds (which controls what the IMAGE MODEL sees). Typically: [baseImageAssetId, ...styleReferenceAssetIds].',
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
    const {
      prompt,
      aspectRatio = '1:1',
      provider = 'auto',
      attachToBoard = false,
      baseImageAssetId = null,
      styleReferenceAssetIds = null,
      inputAssetIds = null,
    } = args || {};
    if (prompt == null) return { error: 'invalid_args', message: 'prompt required (empty string OK in edit mode)' };
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

    // Resolve style references → dataUrls. These are fed DIRECTLY to
    // gpt-image-1's multi-image edit endpoint — the model attends to them
    // as additional visual context, no Flash-described-the-style bottleneck.
    // We dedupe + cap at 4 to keep the multipart payload reasonable.
    let styleReferenceDataUrls = null;
    if (Array.isArray(styleReferenceAssetIds) && styleReferenceAssetIds.length > 0 && baseImageAssetId) {
      const dedupedRefs = Array.from(new Set(
        styleReferenceAssetIds
          .filter((id) => typeof id === 'string' && id && id !== baseImageAssetId),
      )).slice(0, 4);
      if (dedupedRefs.length > 0) {
        const refRows = await sql`
          SELECT id, meta FROM assets
          WHERE id = ANY(${dedupedRefs}) AND user_id = ${ctx.userId}
        `;
        const dataUrls = [];
        for (const r of refRows) {
          const u = r.meta?.dataUrl;
          if (typeof u === 'string' && u) dataUrls.push(u);
        }
        if (dataUrls.length > 0) styleReferenceDataUrls = dataUrls;
      }
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
      // Persist enough context to enable re-rolls (different aspect ratio,
      // regen-from-source). styleReferenceAssetIds lets the regen-aspect
      // endpoint re-resolve the same references without going through chat.
      const placeholderAssetMeta = {
        prompt,
        mode,
        aspectRatio,
        status: 'generating',
        ...(baseImageAssetId ? { baseImageAssetId } : {}),
        ...(Array.isArray(styleReferenceAssetIds) && styleReferenceAssetIds.length > 0
          ? { styleReferenceAssetIds: styleReferenceAssetIds.filter((x) => typeof x === 'string' && x) }
          : {}),
      };
      const inserted = await sql`
        INSERT INTO assets (user_id, project_id, type, name, meta)
        VALUES (${ctx.userId}, ${ctx.boardId}, 'image', ${assetName}, ${JSON.stringify(placeholderAssetMeta)}::jsonb)
        RETURNING id
      `;
      asset = inserted[0];

      if (attachToBoard) {
        // Node display dims follow the aspect ratio so the image fills the
        // card without letterboxing. In edit mode the agent doesn't pass
        // aspectRatio (output matches base), so we'd ideally read base dims
        // — for MVP we trust the agent's `aspectRatio` arg when set,
        // otherwise default to 1:1.
        const { width: nodeW, height: nodeH } = dimsForAspect(aspectRatio);

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
          ? await placeRightOfSources(ctx.boardId, sourceNodeIds, nodeW, nodeH, sql)
          : await placeStackDown(ctx.boardId, nodeW, nodeH, sql);
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
            ${ctx.boardId}, 'asset', ${placedX}, ${placedY}, ${nodeW}, ${nodeH},
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
    // Final prompt construction. In EDIT mode, we ignore whatever long
    // style description the agent tried to write and build the prompt from
    // a strict template — the model now sees the style references directly
    // via images.edit multi-image input, so text describing them is at
    // best redundant and at worst hallucinatory (Flash invented "stained
    // glass mosaic" as the style of a painted-wood Hearthstone card, with
    // predictable garbage results). The agent's `prompt` becomes a short
    // optional intent appended to the template.
    const userIntent = (prompt || '').trim();
    let finalPrompt;
    if (baseImageDataUrl) {
      const hasRefs = Array.isArray(styleReferenceDataUrls) && styleReferenceDataUrls.length > 0;
      finalPrompt = hasRefs
        ? [
            'You are editing the FIRST image.',
            'PRESERVE EXACTLY: the subject, composition, framing, perspective, scale, and content of the first image.',
            'APPLY: the visual style of the additional reference image(s) — match their MEDIUM (photograph, illustration, painting, 3D render, etc.) exactly, plus their palette, lighting, texture, line quality, and level of detail.',
            'DO NOT change the subject, swap it for the reference\'s subject, or invent new elements.',
            'The output is the same scene as the first image, re-rendered as if it had been produced in the same medium and style as the references.',
            userIntent ? `Additional intent: ${userIntent}` : '',
          ].filter(Boolean).join(' ')
        : [
            'You are editing the input image.',
            'PRESERVE EXACTLY: the subject, composition, framing, perspective, scale, and content.',
            userIntent ? `APPLY this change: ${userIntent}` : 'APPLY a subtle high-quality refinement that improves clarity and detail without changing anything else.',
            'DO NOT change the subject or invent new elements.',
          ].filter(Boolean).join(' ');
    } else {
      // Pure text-to-image. Pass the agent's prompt verbatim — no template
      // imposition here, since no base image means no preservation contract.
      finalPrompt = userIntent || 'A clean, professional image.';
    }

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
            return generateGeminiImage({ prompt: finalPrompt, aspectRatio, apiKey });
          })()
        : (async () => {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
            return generateOpenAIImage({
              prompt: finalPrompt,
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
    // we already stored stick. We ALSO stash the template-built finalPrompt
    // and the count of style references so a "why did my image come out
    // weird?" debug pass can see exactly what the model was asked.
    try {
      const finalAssetMeta = {
        dataUrl: result.dataUrl,
        mimeType: result.mimeType,
        provider: result.provider,
        model: result.model,
        mode: result.mode || mode,
        status: 'done',
        finalPrompt,
        styleReferenceCount: styleReferenceDataUrls ? styleReferenceDataUrls.length : 0,
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
