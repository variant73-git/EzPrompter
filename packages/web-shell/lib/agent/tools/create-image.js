import { sql } from '../../db.js';
import { generateGeminiImage } from '../../image-gen/gemini-imagen.js';
import { generateOpenAIImage } from '../../image-gen/openai-image.js';
import { placeRightOfSources, placeStackDown } from '../../canvas-layout.js';
import { decodeImageDimsFromDataUrl, pickAspectForDims } from '../../image-dims.js';

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
  description: `Generate or edit an image. Optionally adds the result to the canvas as an asset node connected to its inputs.

Modes:
- Text-to-image: pass \`prompt\` only.
- Edit: pass \`baseImageAssetId\`. The image model receives that image plus your prompt and interprets the prompt LITERALLY — there is no automatic preservation wrapper. Write the prompt yourself describing what to keep (subject, framing, padding, aspect, blank space around the content) and what to change. If you can see the base image (multimodal), be specific about what's visually there.
- Style transfer / remix: pass \`baseImageAssetId\` AND \`styleReferenceAssetIds\`. The references are fed DIRECTLY to the image model alongside the base, so describing the references' style in text is redundant. The prompt should describe what about the BASE to preserve.

Costs money. Pauses for confirmation when the conversation model is Claude (so the user can pick Gemini vs GPT for the underlying generation).`,
  classification: 'needs_choice',
  inputSchema: {
    type: 'object',
    properties: {
      prompt:                  { type: 'string', description: 'Plain-language description of what to generate, or — in edit mode — the change to apply. Can be empty in edit mode when the style references already convey the intent.' },
      aspectRatio:             { type: 'string', enum: ['1:1', '16:9', '9:16', '3:4', '4:3'], description: 'Aspect ratio of the output. Optional in edit mode — when omitted, the image model preserves the base image\'s aspect automatically. In generate mode, defaults to 1:1.' },
      provider:                { type: 'string', enum: ['auto', 'gemini', 'openai'], description: 'Image-model provider. "auto" picks Gemini for text-to-image. Edit mode (baseImageAssetId set) always uses openai (Gemini Imagen has no image-edit endpoint).' },
      attachToBoard:           { type: 'boolean', description: 'When true, also create an asset node on the canvas for the result.' },
      baseImageAssetId:        { type: 'string', description: 'Asset id of the image to edit. Composition and subject are preserved; the prompt and any styleReferenceAssetIds describe the change.' },
      styleReferenceAssetIds:  {
        type: 'array',
        items: { type: 'string' },
        description: 'Asset ids of additional images whose visual style should be applied. Fed directly to the image model alongside the base, so no text description of the style is needed. Up to 4.',
      },
      inputAssetIds:           {
        type: 'array',
        items: { type: 'string' },
        description: 'Canvas wiring: source asset ids that should draw incoming edges to the result node (when attachToBoard:true). Independent of styleReferenceAssetIds, which controls what the image model sees.',
      },
      replaceAssetId:          { type: 'string', description: 'Asset id of an EXISTING result to update in place. When set, the linked node and asset are updated with the new dataUrl — no new node, no new edges, the existing graph + spatial layout is preserved. Use this for "re-run" / "tweak" requests on a workflow whose terminal you already know.' },
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
      provider = 'auto',
      attachToBoard = false,
      baseImageAssetId = null,
      styleReferenceAssetIds = null,
      inputAssetIds = null,
      replaceAssetId = null,
    } = args || {};
    // aspectRatio is OPTIONAL. null = "infer from the base image's actual
    // dimensions in edit mode, or fall back to 1:1 in generate mode". Kept
    // mutable so we can override with the inferred value before kicking off
    // the generation.
    let aspectRatio = (args && Object.prototype.hasOwnProperty.call(args, 'aspectRatio'))
      ? args.aspectRatio
      : null;
    if (prompt == null) return { error: 'invalid_args', message: 'prompt required (empty string OK in edit mode)' };
    if (aspectRatio !== null && !VALID_ASPECT.has(aspectRatio)) return { error: 'invalid_args', message: `aspectRatio must be one of ${[...VALID_ASPECT].join(',')}` };
    if (!VALID_PROVIDER.has(provider)) return { error: 'invalid_args', message: `provider must be one of ${[...VALID_PROVIDER].join(',')}` };

    // Replace-in-place path: resolve the existing asset + linked node up
    // front so we know they exist (and belong to the user) before we
    // start spending money on image gen. The rest of the function then
    // either creates a NEW asset/node (replaceAssetId=null, original path)
    // or updates the existing rows (replaceAssetId set).
    let replaceTargetNodeId = null;
    if (replaceAssetId) {
      const r = await sql`SELECT id, meta FROM assets WHERE id = ${replaceAssetId} AND user_id = ${ctx.userId}`;
      if (!r.length) return { error: 'invalid_args', message: 'replaceAssetId not found or not owned' };
      const linkedNode = await sql`
        SELECT id FROM nodes WHERE board_id = ${ctx.boardId} AND meta->>'assetId' = ${replaceAssetId} LIMIT 1
      `;
      if (linkedNode.length > 0) replaceTargetNodeId = linkedNode[0].id;
    }

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

    // When the agent didn't pass an explicit aspectRatio in edit mode, infer
    // the closest supported one from the BASE IMAGE's actual pixel
    // dimensions. gpt-image-1's `size: 'auto'` was supposed to do this for
    // us, but in practice it returns a 1024x1024 square whenever the input
    // doesn't match one of its 3 canonical sizes (1024² / 1024x1536 /
    // 1536x1024). Decoding the PNG/JPEG header server-side and mapping to
    // the nearest supported aspect gives us a deterministic output ratio
    // that actually tracks the source.
    if (!aspectRatio && baseImageDataUrl) {
      const dims = decodeImageDimsFromDataUrl(baseImageDataUrl);
      if (dims) {
        const picked = pickAspectForDims(dims);
        if (picked) aspectRatio = picked;
      }
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
    //
    // When replaceAssetId is set, we SKIP the INSERT path entirely: the
    // existing asset + node rows ARE the target. We just flip them into
    // the generating state so the canvas shows a spinner, and reuse the
    // same ids for the UPDATE at the end. No new edges, no new node, the
    // user's spatial layout and graph stay intact.
    let asset;
    let nodeId = null;
    let placedX = 0;
    let placedY = 0;
    let sourceNodeIds = [];
    const edgesCreated = [];
    if (replaceAssetId) {
      asset = { id: replaceAssetId };
      nodeId = replaceTargetNodeId;
      try {
        await sql`UPDATE assets SET meta = meta || '{"status":"generating"}'::jsonb WHERE id = ${replaceAssetId}`;
        if (nodeId) {
          await sql`UPDATE nodes SET meta = meta || '{"status":"generating"}'::jsonb WHERE id = ${nodeId}`;
        }
      } catch (e) {
        return { error: 'persist_failed', message: String(e?.message || e) };
      }
    } else try {
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
        // Node display dims:
        //   1. Explicit aspectRatio from agent → dimsForAspect(that).
        //   2. Edit mode with no aspectRatio → copy the base node's dims so
        //      the result pairs visually with its source (matches what
        //      gpt-image-1 will return via size:'auto').
        //   3. Fallback → 1:1 square (text-to-image with no hint).
        let nodeW;
        let nodeH;
        if (aspectRatio) {
          ({ width: nodeW, height: nodeH } = dimsForAspect(aspectRatio));
        } else if (baseImageAssetId) {
          const baseNodeRows = await sql`
            SELECT width, height FROM nodes
            WHERE board_id = ${ctx.boardId}
              AND meta->>'assetId' = ${baseImageAssetId}
            LIMIT 1
          `;
          if (baseNodeRows.length > 0 && baseNodeRows[0].width && baseNodeRows[0].height) {
            nodeW = baseNodeRows[0].width;
            nodeH = baseNodeRows[0].height;
          } else {
            ({ width: nodeW, height: nodeH } = dimsForAspect('1:1'));
          }
        } else {
          ({ width: nodeW, height: nodeH } = dimsForAspect('1:1'));
        }

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
    // The agent's `prompt` passes through verbatim. The previous hardcoded
    // preservation template ("PRESERVE EXACTLY composition, framing…") was
    // being interpreted by gpt-image-1 as "preserve the SUBJECT" — the
    // model then filled the canvas with the subject and dropped any
    // empty space / padding around it, producing the "cropped" feel. The
    // agent can see the base image (multimodal) and write preservation
    // language tailored to it. Edit-mode callers with an empty prompt
    // get a minimal safety net so the model has something to act on.
    const userIntent = (prompt || '').trim();
    const finalPrompt = userIntent || (baseImageDataUrl
      ? 'Re-render the input image with the style of the references applied. Preserve the subject, framing, padding, and overall canvas composition exactly.'
      : 'A clean, professional image.');

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
            // Gemini Imagen has no equivalent of gpt-image-1's size:'auto';
            // it requires a concrete aspectRatio string. Fall back to 1:1
            // when null (text-to-image with no explicit aspect from agent).
            return generateGeminiImage({ prompt: finalPrompt, aspectRatio: aspectRatio || '1:1', apiKey });
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
    // (`||`) merges over existing keys, so we ALSO write back the call's
    // prompt + mode + aspectRatio + base + refs. That keeps the asset's
    // re-run config up to date when the agent replaced in place with
    // different args (e.g. modified prompt, swapped refs). On the
    // non-replace path these fields were already written by the placeholder
    // INSERT, so re-writing them is a no-op.
    try {
      const finalAssetMeta = {
        prompt,
        mode,
        aspectRatio,
        ...(baseImageAssetId ? { baseImageAssetId } : {}),
        ...(Array.isArray(styleReferenceAssetIds) && styleReferenceAssetIds.length > 0
          ? { styleReferenceAssetIds: styleReferenceAssetIds.filter((x) => typeof x === 'string' && x) }
          : {}),
        dataUrl: result.dataUrl,
        mimeType: result.mimeType,
        provider: result.provider,
        model: result.model,
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
