import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { generateGeminiImage } from '../../../../lib/image-gen/gemini-imagen.js';
import { generateOpenAIImage } from '../../../../lib/image-gen/openai-image.js';

export const runtime = 'nodejs';

const VALID_PROVIDERS = new Set(['auto', 'gemini', 'openai']);

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { prompt, aspectRatio = '1:1', provider = 'auto' } = body || {};

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  }
  if (provider === 'claude') {
    return NextResponse.json({ error: 'Claude does not generate images' }, { status: 400 });
  }
  if (!VALID_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: `invalid provider: ${provider}` }, { status: 400 });
  }

  // 'auto' falls through to Gemini (cheapest default). Claude conversation
  // model emits needs_choice via the agent tool BEFORE this route is called,
  // so 'auto' arriving here means non-Claude — Gemini is the reasonable default.
  const effective = provider === 'auto' ? 'gemini' : provider;

  try {
    let result;
    if (effective === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
      result = await generateGeminiImage({ prompt, aspectRatio, apiKey });
    } else { // openai
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
      result = await generateOpenAIImage({ prompt, aspectRatio, apiKey });
    }
    return NextResponse.json({
      provider: effective,
      base64: result.base64,
      mimeType: result.mimeType,
      dataUrl: result.dataUrl,
      prompt: result.prompt,
      model: result.model,
    });
  } catch (e) {
    console.error('[POST /api/images/generate] error', e);
    return NextResponse.json({ error: e.message || 'generation failed' }, { status: 500 });
  }
}
