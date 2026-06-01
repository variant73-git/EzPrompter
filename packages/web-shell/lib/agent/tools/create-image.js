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
  description: `Generate a new image with a text-to-image model and optionally drop it onto the user's canvas as an asset node.

DESTRUCTIVE: costs money, pauses for user confirmation (or choice when the conversation model is Claude and provider is 'auto' — Claude doesn't generate images so the user picks Gemini or GPT-5.5).

Use when the user asks for an image to be generated. If they want to attach the result to the board, pass attachToBoard:true.`,
  classification: 'needs_choice',
  inputSchema: {
    type: 'object',
    properties: {
      prompt:        { type: 'string', description: 'Text prompt describing the image' },
      aspectRatio:   { type: 'string', enum: ['1:1', '16:9', '9:16', '3:4', '4:3'], description: 'Aspect ratio (default 1:1)' },
      provider:      { type: 'string', enum: ['auto', 'gemini', 'openai'], description: 'Which provider — auto picks based on conversation model' },
      attachToBoard: { type: 'boolean', description: 'When true, also create an asset node on the canvas' },
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
    const { prompt, aspectRatio = '1:1', provider = 'auto', attachToBoard = false } = args || {};
    if (!prompt) return { error: 'invalid_args', message: 'prompt required' };
    if (!VALID_ASPECT.has(aspectRatio)) return { error: 'invalid_args', message: `aspectRatio must be one of ${[...VALID_ASPECT].join(',')}` };
    if (!VALID_PROVIDER.has(provider)) return { error: 'invalid_args', message: `provider must be one of ${[...VALID_PROVIDER].join(',')}` };

    // Resolve effective provider:
    //   1. ctx.choice (user picked in needs_choice flow) wins
    //   2. provider !== 'auto' wins next
    //   3. conversation model dictates family (gpt → openai; gemini → gemini; default gemini)
    let effective;
    if (ctx?.choice && ctx.choice !== 'auto') effective = ctx.choice;
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
        // openai
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return { error: 'image_gen_failed', message: 'OPENAI_API_KEY not configured' };
        result = await generateOpenAIImage({ prompt, aspectRatio, apiKey });
      }
      // Normalize shape so downstream code has result.provider.
      result.provider = effective;
    } catch (e) {
      return { error: 'image_gen_failed', message: String(e?.message || e) };
    }

    const assetName = `generated:${prompt.slice(0, 50)}`;
    const meta = {
      dataUrl: result.dataUrl,
      mimeType: result.mimeType,
      prompt,
      provider: result.provider,
      model: result.model,
      aspectRatio,
    };
    const [asset] = await sql`
      INSERT INTO assets (user_id, project_id, type, name, meta)
      VALUES (${ctx.userId}, ${ctx.boardId}, 'image', ${assetName}, ${JSON.stringify(meta)}::jsonb)
      RETURNING id
    `;

    let nodeId = null;
    if (attachToBoard) {
      const [node] = await sql`
        INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
        VALUES (
          ${ctx.boardId}, 'asset', 0, 0, 512, 512,
          ${JSON.stringify({ source: 'agent-generated', assetId: asset.id, name: assetName })}::jsonb
        )
        RETURNING id
      `;
      nodeId = node.id;
    }

    return {
      generated: true,
      assetId: asset.id,
      nodeId,
      provider: result.provider,
      dataUrl: result.dataUrl,
      bytes: Math.floor((result.base64 || '').length * 0.75),
    };
  },
};
